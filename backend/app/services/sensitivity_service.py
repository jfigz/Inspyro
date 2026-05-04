
import ast
import math
import logging

# Configure logger
logger = logging.getLogger('sensitivity')

class SensitivityAnalyzer:
    """
    Service to handle sensitivity analysis calculations with dependency resolution.
    """
    
    def __init__(self):
        self.safe_builtins = {
            'abs': abs, 'min': min, 'max': max, 'sum': sum,
            'round': round, 'pow': pow, 'len': len,
            'int': int, 'float': float, 'bool': bool,
            'True': True, 'False': False, 'None': None,
            # Math functions
            'sqrt': math.sqrt, 'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
            'log': math.log, 'log10': math.log10, 'exp': math.exp,
            'pi': math.pi, 'e': math.e,
            'ceil': math.ceil, 'floor': math.floor,
            'asin': math.asin, 'acos': math.acos, 'atan': math.atan,
            'atan2': math.atan2, 'degrees': math.degrees, 'radians': math.radians,
        }

    def extract_dependencies(self, formula: str) -> set[str]:
        """Extracts variable names from a formula string."""
        try:
            tree = ast.parse(formula, mode='eval')
            names = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Name):
                    names.add(node.id)
            return names
        except SyntaxError:
            # If formula is invalid syntax, we can't extract deps, likely will fail eval later
            return set()
        except Exception:
            return set()

    def analyze(self, modified_variables: dict, formulas: dict, current_values: dict, output_variables: list) -> dict:
        """
        Performs the sensitivity analysis.
        
        Args:
            modified_variables: Dictionary of variables with their new values.
            formulas: Dictionary of {variable_name: formula_string}.
            current_values: Dictionary of current values for all variables (fallback/context).
            output_variables: List of variable names to return in the result.
            
        Returns:
            Dictionary of {variable_name: calculated_value} for requested outputs.
        """
        logger.info(f"Starting analysis with {len(modified_variables)} mods and {len(formulas)} formulas")

        # 1. Prepare namespace
        namespace = dict(current_values)
        namespace.update(self.safe_builtins)
        
        # Inject standard scientific libraries
        self._inject_libraries(namespace)
        
        # Apply modifications (these override everything)
        namespace.update(modified_variables)
        
        # 2. Identify Pending Formulas
        # Filter out literal numbers and formulas for variables that are being directly modified
        pending_formulas = {}
        for var_name, formula in formulas.items():
            if var_name in modified_variables:
                logger.debug(f"Skipping formula for {var_name} (already modified)")
                continue
            
            # Simple heuristic to skip literals (e.g. "123.45")
            # REMOVED: potentially unsafe if current_values diverge from formula constant
            # if self._is_literal(formula):
            #    logger.debug(f"Skipping literal formula: {var_name} = {formula}")
            #    continue
                
            pending_formulas[var_name] = formula

        # 3. Pre-calculate dependencies
        formula_dependencies = {}
        for var_name, formula in pending_formulas.items():
            formula_dependencies[var_name] = self.extract_dependencies(formula)

        pending_vars = set(pending_formulas.keys())
        
        # 4. Evaluation Loop (Topological Sort intent)
        max_iterations = len(pending_formulas) + 10
        iteration = 0
        
        while pending_formulas and iteration < max_iterations:
            iteration += 1
            progress = False
            
            for var_name, formula in list(pending_formulas.items()):
                # Check dependencies
                deps = formula_dependencies.get(var_name, set())
                pending_deps = deps.intersection(pending_vars)
                
                if pending_deps:
                    # Waiting for dependencies to be resolved
                    continue

                # Ready to evaluate
                try:
                    # SECURITY NOTE: eval() is NOT sandboxed despite __builtins__={}.
                    # Mitigated by: (1) local-only execution (no network exposure),
                    # (2) formulas come from user's own notebook code.
                    # If exposing to untrusted input, replace with ast.literal_eval or
                    # a sandboxed evaluator (e.g., RestrictedPython, simpleeval).
                    result = eval(formula, {"__builtins__": {}}, namespace)
                    namespace[var_name] = result
                    del pending_formulas[var_name]
                    pending_vars.discard(var_name)
                    progress = True
                    logger.debug(f"Evaluated {var_name} = {result}")
                except NameError as ne:
                    logger.warning(f"NameError for {var_name}: {ne}")
                    # If execution fails, we might just leave the old value from current_values
                    # (which is already in namespace)
                    pass
                except Exception as e:
                    logger.error(f"Error evaluating {var_name}: {e}")
                    # Keep old value
                    if var_name in current_values:
                        namespace[var_name] = current_values[var_name]
                    del pending_formulas[var_name]
                    pending_vars.discard(var_name)
                    progress = True
            
            if not progress and pending_formulas:
                logger.error(f"Stuck! Remaining formulas: {list(pending_formulas.keys())}")
                for k in pending_formulas:
                    deps = formula_dependencies.get(k, set())
                    rem = deps.intersection(pending_vars)
                    logger.debug(f"  - {k} is waiting on: {rem}")
                break

        # 5. Extract Results
        results = {}
        for var_name in output_variables:
            if var_name in namespace:
                val = namespace[var_name]
                results[var_name] = self._serialize_value(val)
            else:
                logger.warning(f"Output {var_name} not found in namespace")
                
        return results

    def _inject_libraries(self, namespace: dict):
        try:
            import numpy
            namespace['numpy'] = numpy
            namespace['np'] = numpy
        except ImportError:
            pass

        try:
            import pandas
            namespace['pandas'] = pandas
            namespace['pd'] = pandas
        except ImportError:
            pass

    def _is_literal(self, text: str) -> bool:
        clean = text.strip().replace('.', '').replace('-', '').replace('e', '').replace('+', '')
        return clean.isdigit()

    def _serialize_value(self, val):
        if isinstance(val, (int, float, bool)):
            return val
        elif isinstance(val, complex):
            return val.real
        else:
            try:
                return float(val)
            except (TypeError, ValueError):
                return str(val)
