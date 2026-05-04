from __future__ import annotations

import ast
import math
import random
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass
class OptimizationCandidate:
    values: dict[str, float]
    outputs: dict[str, Any]
    score: float
    feasible: bool
    failed_constraints: int
    total_violation: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "values": self.values,
            "outputs": self.outputs,
            "score": self.score,
            "feasible": self.feasible,
            "failed_constraints": self.failed_constraints,
            "total_violation": self.total_violation,
        }


class EngineeringOptimizationService:
    """
    Implementación inicial de optimización/validación para flujos de ingeniería.

    La evaluación de expresiones usa `eval` con builtins acotados y namespace local.
    Está orientado a notebooks locales del usuario (no a input multi-tenant no confiable).
    """

    def __init__(self):
        self.safe_builtins: dict[str, Any] = {
            "abs": abs,
            "min": min,
            "max": max,
            "sum": sum,
            "round": round,
            "pow": pow,
            "int": int,
            "float": float,
            "bool": bool,
            "True": True,
            "False": False,
            "None": None,
            "sqrt": math.sqrt,
            "sin": math.sin,
            "cos": math.cos,
            "tan": math.tan,
            "log": math.log,
            "log10": math.log10,
            "exp": math.exp,
            "pi": math.pi,
            "e": math.e,
            "ceil": math.ceil,
            "floor": math.floor,
        }

    def optimize_design(
        self,
        objective: dict[str, Any],
        variables: list[dict[str, Any]],
        constraints: list[dict[str, Any]],
        formulas: dict[str, str],
        current_values: dict[str, Any],
        *,
        iterations: int = 80,
        seed: int = 42,
    ) -> dict[str, Any]:
        rng = random.Random(seed)
        iterations = max(8, min(1000, int(iterations or 80)))
        objective_targets = self._parse_objective_targets(objective)
        penalty_weight = self._to_float(objective.get("penalty_weight"), default=1000.0)

        variable_defs = self._parse_variables(variables, current_values)
        if not variable_defs:
            return {
                "error": "No hay variables de diseño válidas para optimizar",
                "evaluated_candidates": 0,
                "pareto_front": [],
                "recommended_design": None,
            }

        base_values = {name: cfg["initial"] for name, cfg in variable_defs.items()}
        candidates: list[OptimizationCandidate] = []

        for idx in range(iterations):
            sample = self._sample_design(variable_defs, base_values, rng, idx)
            namespace = self._evaluate_formulas(formulas, current_values, sample)
            failed_constraints, total_violation = self._evaluate_constraints(constraints, namespace)
            feasible = failed_constraints == 0
            outputs = self._collect_outputs(namespace, objective_targets, constraints)
            obj_vector = self._objective_vector(namespace, objective_targets)
            base_score = sum(term for _, term in obj_vector)
            score = base_score + (total_violation * penalty_weight)
            candidates.append(
                OptimizationCandidate(
                    values=sample,
                    outputs=outputs,
                    score=score,
                    feasible=feasible,
                    failed_constraints=failed_constraints,
                    total_violation=total_violation,
                )
            )

        candidates.sort(
            key=lambda c: (
                not c.feasible,
                c.failed_constraints,
                c.total_violation,
                c.score,
            )
        )
        recommended = candidates[0] if candidates else None
        pareto = self._pareto_front(candidates, objective_targets)

        return {
            "evaluated_candidates": len(candidates),
            "pareto_front": [c.to_dict() for c in pareto],
            "recommended_design": recommended.to_dict() if recommended else None,
            "objective_targets": objective_targets,
            "constraints_total": len(constraints or []),
            "feasible_candidates": sum(1 for c in candidates if c.feasible),
        }

    def analyze_load_envelope(
        self,
        combinations: list[dict[str, Any]],
        outputs: list[str],
        formulas: dict[str, str],
        current_values: dict[str, Any],
    ) -> dict[str, Any]:
        combos = combinations or []
        if not combos:
            return {"evaluations": [], "envelopes": {}, "warning": "No se enviaron combinaciones"}

        evaluations: list[dict[str, Any]] = []
        for combo in combos:
            combo_name = str(combo.get("name") or f"Combo_{len(evaluations)+1}")
            factors = combo.get("factors") if isinstance(combo.get("factors"), dict) else {}
            overrides = combo.get("overrides") if isinstance(combo.get("overrides"), dict) else {}
            modified_values = dict(current_values or {})

            for var_name, factor in factors.items():
                factor_num = self._to_float(factor, default=1.0)
                base_num = self._to_float(modified_values.get(var_name), default=0.0)
                modified_values[var_name] = base_num * factor_num
            for var_name, value in overrides.items():
                modified_values[var_name] = value

            namespace = self._evaluate_formulas(formulas, modified_values, {})
            evaluated_outputs = {
                out_name: self._resolve_numeric_or_value(out_name, namespace)
                for out_name in outputs or []
            }
            evaluations.append(
                {
                    "combination": combo_name,
                    "outputs": evaluated_outputs,
                }
            )

        envelopes: dict[str, dict[str, Any]] = {}
        for out_name in outputs or []:
            values: list[tuple[str, float]] = []
            for item in evaluations:
                val = self._to_float(item["outputs"].get(out_name), default=float("nan"))
                if math.isnan(val):
                    continue
                values.append((item["combination"], val))
            if not values:
                continue
            gov_min = min(values, key=lambda t: t[1])
            gov_max = max(values, key=lambda t: t[1])
            envelopes[out_name] = {
                "min": gov_min[1],
                "max": gov_max[1],
                "governing_min": gov_min[0],
                "governing_max": gov_max[0],
            }

        return {
            "evaluations": evaluations,
            "envelopes": envelopes,
        }

    def run_code_checks(
        self,
        checks: list[dict[str, Any]],
        formulas: dict[str, str],
        current_values: dict[str, Any],
        code_profile: str | None = None,
    ) -> dict[str, Any]:
        namespace = self._evaluate_formulas(formulas, current_values, {})
        check_items = checks or []
        results: list[dict[str, Any]] = []

        for idx, check in enumerate(check_items):
            name = str(check.get("name") or f"check_{idx+1}")
            op = str(check.get("op") or "<=")
            message = check.get("message")
            reference = check.get("reference")
            expr = check.get("expr")
            passed = False
            lhs_value = None
            rhs_value = None
            margin = None
            error = None

            try:
                if isinstance(expr, str) and expr.strip():
                    expr_result = self._eval_expression(expr, namespace)
                    passed = bool(expr_result)
                else:
                    lhs_raw = check.get("lhs", check.get("left"))
                    rhs_raw = check.get("rhs", check.get("right"))
                    lhs_value = self._resolve_numeric_or_value(lhs_raw, namespace)
                    rhs_value = self._resolve_numeric_or_value(rhs_raw, namespace)
                    lhs_num = self._to_float(lhs_value, default=float("nan"))
                    rhs_num = self._to_float(rhs_value, default=float("nan"))
                    passed, margin = self._compare_with_margin(lhs_num, rhs_num, op)
            except Exception as exc:
                error = str(exc)
                passed = False

            results.append(
                {
                    "name": name,
                    "passed": bool(passed),
                    "op": op,
                    "lhs": lhs_value,
                    "rhs": rhs_value,
                    "margin": margin,
                    "message": message,
                    "reference": reference,
                    "error": error,
                    "is_active_constraint": not passed,
                }
            )

        total = len(results)
        passed_count = sum(1 for item in results if item["passed"])
        failed = [item for item in results if not item["passed"]]
        score = (100.0 * passed_count / total) if total else 0.0

        failed.sort(
            key=lambda item: (
                0 if isinstance(item.get("margin"), (int, float)) else 1,
                item.get("margin") if isinstance(item.get("margin"), (int, float)) else 0,
            )
        )

        return {
            "profile": code_profile or "custom",
            "summary": {
                "total": total,
                "passed": passed_count,
                "failed": total - passed_count,
                "score": score,
            },
            "checks": results,
            "active_constraints": failed,
        }

    def compare_scenarios(
        self,
        baseline: dict[str, Any],
        candidates: list[dict[str, Any]],
        outputs: list[str],
        formulas: dict[str, str],
        current_values: dict[str, Any],
    ) -> dict[str, Any]:
        baseline_values = baseline.get("values") if isinstance(baseline.get("values"), dict) else {}
        baseline_namespace = self._evaluate_formulas(formulas, current_values, baseline_values)
        baseline_outputs = {
            out_name: self._resolve_numeric_or_value(out_name, baseline_namespace)
            for out_name in outputs or []
        }

        comparisons: list[dict[str, Any]] = []
        for idx, scenario in enumerate(candidates or []):
            scenario_name = str(scenario.get("name") or f"scenario_{idx+1}")
            scenario_values = scenario.get("values") if isinstance(scenario.get("values"), dict) else {}
            namespace = self._evaluate_formulas(formulas, current_values, scenario_values)
            scenario_outputs = {
                out_name: self._resolve_numeric_or_value(out_name, namespace)
                for out_name in outputs or []
            }
            deltas: dict[str, Any] = {}
            for out_name, base_value in baseline_outputs.items():
                cand_value = scenario_outputs.get(out_name)
                base_num = self._to_float(base_value, default=float("nan"))
                cand_num = self._to_float(cand_value, default=float("nan"))
                if math.isnan(base_num) or math.isnan(cand_num):
                    deltas[out_name] = {"absolute": None, "percent": None}
                    continue
                abs_delta = cand_num - base_num
                pct_delta = (abs_delta / base_num * 100.0) if base_num != 0 else None
                deltas[out_name] = {"absolute": abs_delta, "percent": pct_delta}
            comparisons.append(
                {
                    "name": scenario_name,
                    "outputs": scenario_outputs,
                    "delta_vs_baseline": deltas,
                }
            )

        return {
            "baseline": {
                "name": str(baseline.get("name") or "baseline"),
                "outputs": baseline_outputs,
            },
            "comparisons": comparisons,
            "outputs": outputs or [],
        }

    def _parse_variables(
        self, variables: list[dict[str, Any]], current_values: dict[str, Any]
    ) -> dict[str, dict[str, float]]:
        parsed: dict[str, dict[str, float]] = {}
        for raw in variables or []:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            min_value = self._to_float(raw.get("min"), default=float("nan"))
            max_value = self._to_float(raw.get("max"), default=float("nan"))
            if math.isnan(min_value) or math.isnan(max_value):
                continue
            if min_value > max_value:
                min_value, max_value = max_value, min_value
            initial = raw.get("initial", current_values.get(name, min_value))
            initial_num = self._to_float(initial, default=min_value)
            initial_num = min(max(initial_num, min_value), max_value)
            step = self._to_float(raw.get("step"), default=0.0)
            parsed[name] = {
                "min": min_value,
                "max": max_value,
                "initial": initial_num,
                "step": max(0.0, step),
            }
        return parsed

    def _sample_design(
        self,
        variable_defs: dict[str, dict[str, float]],
        base_values: dict[str, float],
        rng: random.Random,
        iteration: int,
    ) -> dict[str, float]:
        if iteration == 0:
            return dict(base_values)
        values: dict[str, float] = {}
        for name, cfg in variable_defs.items():
            lower = cfg["min"]
            upper = cfg["max"]
            step = cfg["step"]
            raw = rng.uniform(lower, upper)
            if step > 0:
                raw = round(raw / step) * step
            values[name] = min(max(raw, lower), upper)
        return values

    def _parse_objective_targets(self, objective: dict[str, Any]) -> list[dict[str, Any]]:
        raw_targets = objective.get("targets")
        if isinstance(raw_targets, list) and raw_targets:
            parsed: list[dict[str, Any]] = []
            for item in raw_targets:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not isinstance(name, str) or not name.strip():
                    continue
                goal = str(item.get("goal") or "min").lower()
                if goal not in {"min", "max"}:
                    goal = "min"
                parsed.append(
                    {
                        "name": name.strip(),
                        "goal": goal,
                        "weight": self._to_float(item.get("weight"), default=1.0),
                    }
                )
            if parsed:
                return parsed
        return [{"name": "weight", "goal": "min", "weight": 1.0}]

    def _collect_outputs(
        self,
        namespace: dict[str, Any],
        objective_targets: list[dict[str, Any]],
        constraints: list[dict[str, Any]],
    ) -> dict[str, Any]:
        outputs: dict[str, Any] = {}
        for target in objective_targets:
            name = target.get("name")
            if not isinstance(name, str):
                continue
            outputs[name] = self._resolve_numeric_or_value(name, namespace)
        for check in constraints or []:
            if isinstance(check, dict):
                name = check.get("name")
                if isinstance(name, str) and name not in outputs:
                    outputs[name] = self._resolve_numeric_or_value(name, namespace)
        return outputs

    def _objective_vector(
        self, namespace: dict[str, Any], objective_targets: list[dict[str, Any]]
    ) -> list[tuple[str, float]]:
        vec: list[tuple[str, float]] = []
        for target in objective_targets:
            name = target.get("name")
            if not isinstance(name, str):
                continue
            value = self._resolve_numeric_or_value(name, namespace)
            val_num = self._to_float(value, default=0.0)
            weight = self._to_float(target.get("weight"), default=1.0)
            goal = str(target.get("goal") or "min").lower()
            oriented = val_num if goal == "min" else -val_num
            vec.append((name, oriented * weight))
        return vec

    def _pareto_front(
        self, candidates: list[OptimizationCandidate], objective_targets: list[dict[str, Any]]
    ) -> list[OptimizationCandidate]:
        if not candidates:
            return []
        feasible = [c for c in candidates if c.feasible]
        if not feasible:
            return candidates[:10]

        def candidate_vector(candidate: OptimizationCandidate) -> list[float]:
            namespace = dict(candidate.values)
            namespace.update(candidate.outputs)
            return [term for _, term in self._objective_vector(namespace, objective_targets)]

        vectors = [candidate_vector(c) for c in feasible]
        front: list[OptimizationCandidate] = []
        for idx, candidate in enumerate(feasible):
            dominated = False
            for jdx, other in enumerate(feasible):
                if idx == jdx:
                    continue
                if self._dominates(vectors[jdx], vectors[idx]):
                    dominated = True
                    break
            if not dominated:
                front.append(candidate)
        front.sort(key=lambda c: c.score)
        return front[:15]

    @staticmethod
    def _dominates(vector_a: Iterable[float], vector_b: Iterable[float]) -> bool:
        a = list(vector_a)
        b = list(vector_b)
        if len(a) != len(b):
            return False
        less_or_equal = all(x <= y for x, y in zip(a, b))
        strictly_less = any(x < y for x, y in zip(a, b))
        return less_or_equal and strictly_less

    def _evaluate_constraints(
        self, constraints: list[dict[str, Any]], namespace: dict[str, Any]
    ) -> tuple[int, float]:
        failed = 0
        total_violation = 0.0
        for constraint in constraints or []:
            if not isinstance(constraint, dict):
                continue
            op = str(constraint.get("op") or "<=")
            lhs_raw = constraint.get("lhs", constraint.get("left", constraint.get("expr")))
            rhs_raw = constraint.get("rhs", constraint.get("right", constraint.get("value")))
            lhs = self._resolve_numeric_or_value(lhs_raw, namespace)
            rhs = self._resolve_numeric_or_value(rhs_raw, namespace)
            lhs_num = self._to_float(lhs, default=float("nan"))
            rhs_num = self._to_float(rhs, default=float("nan"))
            passed, margin = self._compare_with_margin(lhs_num, rhs_num, op)
            if not passed:
                failed += 1
                total_violation += abs(margin) if isinstance(margin, (int, float)) else 1.0
        return failed, total_violation

    def _compare_with_margin(self, lhs: float, rhs: float, op: str) -> tuple[bool, float | None]:
        if math.isnan(lhs) or math.isnan(rhs):
            return False, None
        if op == "<=":
            margin = rhs - lhs
            return lhs <= rhs, margin
        if op == "<":
            margin = rhs - lhs
            return lhs < rhs, margin
        if op == ">=":
            margin = lhs - rhs
            return lhs >= rhs, margin
        if op == ">":
            margin = lhs - rhs
            return lhs > rhs, margin
        if op == "==":
            margin = -abs(lhs - rhs)
            return lhs == rhs, margin
        return False, None

    def _evaluate_formulas(
        self,
        formulas: dict[str, str],
        current_values: dict[str, Any],
        overrides: dict[str, Any],
    ) -> dict[str, Any]:
        namespace: dict[str, Any] = {}
        namespace.update(self.safe_builtins)
        namespace.update(current_values or {})
        namespace.update(overrides or {})

        pending = dict(formulas or {})
        deps = {name: self._extract_dependencies(expr) for name, expr in pending.items()}
        pending_names = set(pending.keys())

        max_iterations = len(pending) + 10
        for _ in range(max_iterations):
            progressed = False
            for var_name, expr in list(pending.items()):
                needed = deps.get(var_name, set()).intersection(pending_names)
                if needed:
                    continue
                try:
                    namespace[var_name] = self._eval_expression(expr, namespace)
                    pending.pop(var_name, None)
                    pending_names.discard(var_name)
                    progressed = True
                except Exception:
                    pending.pop(var_name, None)
                    pending_names.discard(var_name)
                    progressed = True
            if not pending or not progressed:
                break
        return namespace

    def _extract_dependencies(self, expression: Any) -> set[str]:
        if not isinstance(expression, str):
            return set()
        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError:
            return set()
        deps = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                deps.add(node.id)
        return deps

    def _resolve_numeric_or_value(self, raw: Any, namespace: dict[str, Any]) -> Any:
        if isinstance(raw, str):
            stripped = raw.strip()
            if not stripped:
                return None
            if stripped in namespace:
                return namespace[stripped]
            try:
                return self._eval_expression(stripped, namespace)
            except Exception:
                return raw
        return raw

    def _eval_expression(self, expression: Any, namespace: dict[str, Any]) -> Any:
        if isinstance(expression, (int, float, bool)):
            return expression
        if not isinstance(expression, str):
            return expression
        return eval(expression, {"__builtins__": {}}, namespace)

    @staticmethod
    def _to_float(value: Any, *, default: float) -> float:
        if isinstance(value, bool):
            return float(value)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except ValueError:
                return default
        return default


engineering_optimization_service = EngineeringOptimizationService()
