"""
Servicio de ejecución de código Python en contenedores Docker aislados.
Proporciona sandboxing seguro para la ejecución de código de usuario.
"""

import docker
import json
import logging
import os
import tempfile
import time
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class DockerPythonExecutor:
    """Ejecutor de código Python en contenedores Docker seguros"""
    
    def __init__(self):
        try:
            self.client = docker.from_env()
            self.image_name = "python:3.11-slim"
            self.ensure_image_available()
        except Exception as e:
            logger.warning("Error inicializando Docker client: %s", e)
            self.client = None
    
    def ensure_image_available(self):
        """Asegura que la imagen de Python esté disponible"""
        try:
            self.client.images.get(self.image_name)
        except docker.errors.ImageNotFound:
            logger.info("Descargando imagen %s...", self.image_name)
            self.client.images.pull(self.image_name)
    
    def create_execution_script(self, user_code: str, mode: str = "run_all") -> str:
        """Crea el script de ejecución que incluye el código del usuario"""
        
        if mode == "step_by_step":
            # Para modo paso a paso, incluir el trazador
            execution_script = f'''
import sys
import json
import traceback
from types import TracebackType

# Trazador simplificado para el contenedor
class SimpleTracer:
    def __init__(self):
        self.states = []
        self.step = 0
    
    def trace_calls(self, frame, event, arg):
        if event == 'line':
            self.step += 1
            state = {{
                "step": self.step,
                "line": frame.f_lineno,
                "filename": frame.f_code.co_filename,
                "function": frame.f_code.co_name,
                "locals": {{k: str(v)[:100] for k, v in frame.f_locals.items() if not k.startswith('_')}}
            }}
            self.states.append(state)
            print(f"TRACE_STATE:{json.dumps(state)}")
        return self.trace_calls

try:
    tracer = SimpleTracer()
    sys.settrace(tracer.trace_calls)
    
    # Código del usuario
{user_code}

    sys.settrace(None)
    print(f"TRACE_COMPLETE:{{json.dumps(tracer.states)}}")
    
except Exception as e:
    print(f"ERROR: {{str(e)}}")
    print(f"TRACEBACK: {{traceback.format_exc()}}")
'''
        else:
            # Modo ejecución completa con captura de variables
            indented = "\n".join(["    " + line for line in user_code.splitlines()])
            static_script = '''
import sys
import json
import traceback
from typing import Any, Dict

def _convert_numpy_types(obj):
    try:
        import numpy as np
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, str):
            return str(obj)
        elif obj is None:
            return None
        elif isinstance(obj, (list, tuple)):
            return [_convert_numpy_types(item) for item in obj]
        elif isinstance(obj, dict):
            return {{k: _convert_numpy_types(v) for k, v in obj.items()}}
        else:
            return obj
    except ImportError:
        return obj

def serialize_value(value: Any) -> Dict[str, Any]:
    try:
        value_type = type(value).__name__
        # Pandas DataFrame
        if hasattr(value, 'to_dict') and hasattr(value, 'columns') and hasattr(value, 'index'):
            try:
                import pandas as pd
                if isinstance(value, pd.DataFrame):
                    max_rows = 100
                    max_cols = 20
                    display_df = value.head(max_rows).iloc[:, :max_cols]
                    return {
                        "type": "DataFrame",
                        "subtype": "pandas",
                        "shape": value.shape,
                        "columns": list(value.columns),
                        "dtypes": {col: str(dtype) for col, dtype in value.dtypes.items()},
                        "data": [
                            {k: _convert_numpy_types(v) for k, v in record.items()}
                            for record in display_df.to_dict('records')
                        ],
                        "preview": _convert_numpy_types(display_df.to_dict()),
                        "repr": f"DataFrame[{value.shape[0]} filas × {value.shape[1]} columnas]",
                        "value": f"DataFrame ({value.shape[0]}×{value.shape[1]})",
                        "memory_usage": int(value.memory_usage(deep=True).sum()) if hasattr(value, 'memory_usage') else None,
                        "is_engineering_data": True,
                        "statistics": _convert_numpy_types(value.describe().to_dict()) if not value.empty else {}
                    }
            except ImportError:
                pass
        # NumPy Array
        if hasattr(value, 'shape') and hasattr(value, 'dtype'):
            try:
                import numpy as np
                if isinstance(value, np.ndarray):
                    max_elements = 1000
                    if value.size <= max_elements:
                        data = value.tolist() if value.ndim <= 2 else f"Array {value.ndim}D - mostrar muestra"
                    else:
                        if value.ndim == 1:
                            data = value[:min(100, value.size)].tolist()
                        elif value.ndim == 2:
                            data = value[:min(10, value.shape[0]), :min(10, value.shape[1])].tolist()
                        else:
                            data = "Array muy grande para mostrar"
                    return {
                        "type": "ndarray",
                        "subtype": "numpy",
                        "shape": value.shape,
                        "dtype": str(value.dtype),
                        "size": int(value.size),
                        "ndim": int(value.ndim),
                        "data": _convert_numpy_types(data),
                        "repr": f"Array{list(value.shape)} dtype={value.dtype}",
                        "value": f"Array {value.shape}",
                        "memory_usage": int(value.nbytes),
                        "is_engineering_data": True,
                        "statistics": {
                            "min": _convert_numpy_types(value.min()) if value.size > 0 and value.dtype.kind in 'biufc' else None,
                            "max": _convert_numpy_types(value.max()) if value.size > 0 and value.dtype.kind in 'biufc' else None,
                            "mean": _convert_numpy_types(value.mean()) if value.size > 0 and value.dtype.kind in 'biufc' else None,
                        } if value.size > 0 else None
                    }
            except ImportError:
                pass
        # Pandas Series
        if hasattr(value, 'to_dict') and hasattr(value, 'index') and hasattr(value, 'name'):
            try:
                import pandas as pd
                if isinstance(value, pd.Series):
                    max_elements = 100
                    display_series = value.head(max_elements)
                    return {
                        "type": "Series",
                        "subtype": "pandas",
                        "name": value.name,
                        "length": len(value),
                        "dtype": str(value.dtype),
                        "data": _convert_numpy_types(display_series.to_dict()),
                        "repr": f"Series[{len(value)} elementos] dtype={value.dtype}",
                        "value": f"Series ({len(value)})",
                        "is_engineering_data": True,
                        "statistics": {
                            "min": _convert_numpy_types(value.min()) if value.dtype.kind in 'biufc' else None,
                            "max": _convert_numpy_types(value.max()) if value.dtype.kind in 'biufc' else None,
                            "mean": _convert_numpy_types(value.mean()) if value.dtype.kind in 'biufc' else None,
                        } if len(value) > 0 else None
                    }
            except ImportError:
                pass
        # Primitivos / colecciones
        if value is None:
            return {"type": "NoneType", "value": "None", "repr": "None"}
        elif isinstance(value, (int, float, bool)):
            return {"type": type(value).__name__, "value": value, "repr": repr(value)}
        elif isinstance(value, str):
            return {"type": "str", "value": value, "repr": repr(value)}
        elif isinstance(value, list):
            return {"type": "list", "length": len(value), "value": f"[{len(value)} elementos]", "repr": repr(value) if len(value) <= 5 else "[...]"}
        elif isinstance(value, dict):
            return {"type": "dict", "length": len(value), "value": f"{{{len(value)} elementos}}", "repr": repr(value) if len(value) <= 3 else "{...}"}
        elif isinstance(value, tuple):
            return {"type": "tuple", "length": len(value), "value": f"({len(value)} elementos)", "repr": repr(value) if len(value) <= 5 else "(...)"}
        elif isinstance(value, set):
            return {"type": "set", "length": len(value), "value": f"{{{len(value)} únicos}}", "repr": repr(value) if len(value) <= 3 else "{...}"}
        elif callable(value):
            name = getattr(value, '__name__', 'callable')
            return {"type": "function", "name": name, "value": f"function {name}", "repr": repr(value)}
        else:
            tname = type(value).__name__
            return {"type": tname, "class": value.__class__.__name__, "value": f"<{tname} object>", "repr": repr(value)[:100]}
    except Exception as e:
        return {"type": "error", "value": f"Error serializando: {str(e)}", "repr": "<serialization error>"}

def is_user_defined_variable(name: str, value: Any) -> bool:
    system_variables = {
        '__name__', '__file__', '__doc__', '__package__', '__loader__',
        '__spec__', '__annotations__', '__builtins__', '__cached__',
        'print', 'len', 'str', 'int', 'float', 'list', 'dict', 'tuple',
        'range', 'enumerate', 'zip', 'map', 'filter', 'sum', 'max', 'min',
        'abs', 'round', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr'
    }
    if name.startswith('__') and name.endswith('__'):
        return False
    if name in system_variables:
        return False
    if callable(value) and hasattr(value, '__module__') and value.__module__ in ('builtins', None):
        return False
    if len(name) <= 2 and name.islower() and name not in ['df', 'pd', 'np', 'x', 'y', 'z', 'i', 'j', 'k']:
        return False
    return True

'''
            execution_script = static_script + f'''
try:
{indented}
    user_vars = {{}}
    for n, v in list(locals().items()):
        if is_user_defined_variable(n, v):
            user_vars[n] = serialize_value(v)
    print('VARS:' + json.dumps(user_vars))
except Exception as e:
    print('ERROR: ' + str(e))
    print('TRACEBACK: ' + traceback.format_exc())
'''
        
        return execution_script
    
    def execute_code(self, code: str, mode: str = "run_all", timeout: int = 30) -> Dict[str, Any]:
        """
        Ejecuta código Python en un contenedor Docker aislado
        
        Args:
            code: Código Python a ejecutar
            mode: 'run_all' o 'step_by_step'
            timeout: Timeout en segundos
        """
        if not self.client:
            return {
                "success": False,
                "error": "Docker no está disponible",
                "stdout": "",
                "stderr": "Docker client no inicializado"
            }
        
        # Crear directorio temporal
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            script_path = temp_path / "user_script.py"
            
            # Escribir script de ejecución
            execution_script = self.create_execution_script(code, mode)
            script_path.write_text(execution_script, encoding='utf-8')
            
            container = None
            try:
                # Crear y ejecutar contenedor
                container = self.client.containers.run(
                    image=self.image_name,
                    command=["python", "/workspace/user_script.py"],
                    volumes={str(temp_path): {'bind': '/workspace', 'mode': 'ro'}},
                    working_dir="/workspace",
                    network_mode="none",  # Sin acceso a red
                    mem_limit="128m",     # Límite de memoria
                    cpu_period=100000,    # Límite de CPU
                    cpu_quota=50000,      # 50% de CPU
                    detach=True,
                    remove=True,
                    user="nobody"         # Usuario sin privilegios
                )
                
                # Esperar a que termine la ejecución
                try:
                    result = container.wait(timeout=timeout)
                    logs = container.logs().decode('utf-8')
                    
                    # Procesar logs para extraer información de trazado y variables
                    stdout_lines = []
                    stderr_lines = []
                    trace_states = []
                    variables = {}
                    
                    for line in logs.split('\n'):
                        if line.startswith('TRACE_STATE:'):
                            try:
                                state_json = line[12:]  # Remover prefijo
                                state = json.loads(state_json)
                                trace_states.append(state)
                            except Exception:
                                pass
                        elif line.startswith('TRACE_COMPLETE:'):
                            try:
                                states_json = line[15:]
                                all_states = json.loads(states_json)
                                trace_states.extend(all_states)
                            except Exception:
                                pass
                        elif line.startswith('VARS:'):
                            try:
                                vars_json = line[5:]
                                variables = json.loads(vars_json)
                            except Exception:
                                pass
                        elif line.startswith('ERROR:'):
                            stderr_lines.append(line[6:])
                        elif line.startswith('TRACEBACK:'):
                            stderr_lines.append(line[10:])
                        else:
                            if line.strip():
                                stdout_lines.append(line)
                    
                    return {
                        "success": result['StatusCode'] == 0,
                        "return_code": result['StatusCode'],
                        "stdout": '\n'.join(stdout_lines),
                        "stderr": '\n'.join(stderr_lines),
                        "trace_states": trace_states if mode == "step_by_step" else [],
                        "variables": variables if mode == "run_all" else {},
                        "execution_time": time.time()  # Placeholder
                    }
                    
                except docker.errors.ContainerError as e:
                    return {
                        "success": False,
                        "error": f"Error en contenedor: {e}",
                        "stdout": "",
                        "stderr": str(e)
                    }
                except Exception as e:
                    return {
                        "success": False,
                        "error": f"Timeout/espera fallida en contenedor: {e}",
                        "stdout": "",
                        "stderr": str(e)
                    }
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Error ejecutando código: {e}",
                    "stdout": "",
                    "stderr": str(e)
                }
            finally:
                if container is not None:
                    try:
                        container.reload()
                        if getattr(container, "status", None) not in ("exited", "dead"):
                            container.kill()
                    except Exception:
                        pass
                    try:
                        container.remove(force=True)
                    except Exception:
                        pass
    
    def health_check(self) -> bool:
        """Verifica que Docker esté funcionando correctamente"""
        try:
            self.client.ping()
            return True
        except Exception:
            return False


# Instancia global del ejecutor
docker_executor = DockerPythonExecutor()
