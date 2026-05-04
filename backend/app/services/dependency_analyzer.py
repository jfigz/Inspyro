"""
Analizador de Dependencias de Variables para Inspyro.

Este módulo analiza código Python usando AST y Jedi para construir
grafos de dependencias entre variables, funciones y clases.
Soporta análisis cross-cell en notebooks y cross-file para imports.
"""

from __future__ import annotations

import ast
import copy
import hashlib
import importlib.util
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False
    nx = None  # type: ignore

try:
    import jedi
    HAS_JEDI = True
except ImportError:
    HAS_JEDI = False
    jedi = None  # type: ignore

_logger = logging.getLogger(__name__)

# Import del parser de anotaciones
try:
    from app.services.annotation_parser import (
        extract_annotations_for_symbol,
        AnnotationData,
    )
    HAS_ANNOTATION_PARSER = True
except ImportError:
    HAS_ANNOTATION_PARSER = False
    extract_annotations_for_symbol = None  # type: ignore
    AnnotationData = None  # type: ignore

# -----------------------------------------------------------------------------
# Configuración
# -----------------------------------------------------------------------------

MAX_DEPTH = 10  # Profundidad máxima de análisis recursivo
MAX_NODES = 500  # Número máximo de nodos en el grafo
MAX_WORKSPACE_IMPACT_SCAN_FILES = 300
WORKSPACE_SCAN_EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "venv",
    "venv_inspyro",
    "env",
    "node_modules",
    "build",
    "dist",
    "output",
    "Docx_Documents",
}


# -----------------------------------------------------------------------------
# Tipos y Estructuras de Datos
# -----------------------------------------------------------------------------

class NodeType(str, Enum):
    """Tipos de nodos en el grafo de dependencias."""
    VARIABLE = "variable"
    FUNCTION = "function"
    CLASS = "class"
    IMPORT = "import"
    PARAMETER = "parameter"
    CONSTANT = "constant"
    ATTRIBUTE = "attribute"
    CHECK = "check"  # Nodo de verificación (assert, condiciones)
    UNKNOWN = "unknown"


class RelationType(str, Enum):
    """Tipos de relaciones entre nodos."""
    ASSIGNS = "assigns"        # x = y (y → x)
    CALLS = "calls"            # x = func() (func → x)
    IMPORTS = "imports"        # from mod import x
    USES = "uses"              # expresión que usa una variable
    ATTRIBUTE_OF = "attribute_of"  # obj.attr


RELATION_PRIORITY: Dict[RelationType, int] = {
    RelationType.IMPORTS: 5,
    RelationType.CALLS: 4,
    RelationType.ATTRIBUTE_OF: 3,
    RelationType.ASSIGNS: 2,
    RelationType.USES: 1,
}


def _pick_stronger_relation(current: RelationType, incoming: RelationType) -> RelationType:
    """Retorna la relación más específica según prioridad semántica."""
    if RELATION_PRIORITY.get(incoming, 0) > RELATION_PRIORITY.get(current, 0):
        return incoming
    return current


@dataclass
class Location:
    """Ubicación de un símbolo en el código."""
    file: str = ""
    line: int = 0
    column: int = 0
    end_line: int = 0
    end_column: int = 0
    cell_index: Optional[int] = None  # Para notebooks

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file,
            "line": self.line,
            "column": self.column,
            "end_line": self.end_line,
            "end_column": self.end_column,
            "cell_index": self.cell_index
        }


@dataclass
class SymbolBinding:
    """Binding de símbolo para resolución token-aware."""
    qn: str
    name: str
    location: Location
    scope_path: str
    cell_index: Optional[int] = None


@dataclass
class ImportBindingInfo:
    """Metadata rica para un binding de import."""
    kind: str
    module: str
    original_name: str
    alias: str
    level: int = 0
    source_file: str = ""
    resolved_module_name: Optional[str] = None
    resolved_path: Optional[str] = None
    target_qn: Optional[str] = None

    @property
    def full_name(self) -> str:
        module_name = self.resolved_module_name or self.module
        if self.kind == "from":
            return f"{module_name}.{self.original_name}" if module_name else self.original_name
        return module_name or self.original_name


@dataclass(frozen=True)
class ResolvedWorkspaceImport:
    """Resultado de resolución segura de un import local del workspace."""
    module_name: str
    file_path: str


@dataclass
class FunctionParameterInfo:
    """Metadata minima para enlazar parametros formales con callsites."""
    qn: str
    name: str
    accepts_positional: bool = True


@dataclass
class CallsiteInfo:
    """Representa un callsite resoluble de forma estatica."""
    callee_name: str
    context_scope: str
    location: Location
    positional_args: List[Optional[str]] = field(default_factory=list)
    keyword_args: Dict[str, Optional[str]] = field(default_factory=dict)
    is_attribute_call: bool = False


@dataclass
class DependencyNode:
    """Nodo en el grafo de dependencias."""
    id: str
    name: str
    node_type: NodeType
    location: Location
    value_preview: Optional[str] = None
    docstring: Optional[str] = None
    full_name: Optional[str] = None  # ej: "math.sqrt"
    is_external: bool = False  # True si es de librería externa
    # Campos de anotación para ingeniería
    description: Optional[str] = None       # @desc: Descripción semántica
    unit: Optional[str] = None              # @unit: Unidad física (kN, m, etc.)
    valid_range: Optional[Tuple[Optional[float], Optional[float]]] = None  # @range
    category: Optional[str] = None          # @category: material/geometry/load/result/factor
    category_inferred: bool = False         # True si categoría fue inferida por heurística
    reference: Optional[str] = None         # @ref: Referencia normativa
    is_check: bool = False                  # True si es nodo de verificación
    check_message: Optional[str] = None     # Mensaje del check (assert)
    check_result: Optional[bool] = None     # Resultado de la verificación (True/False/None)
    # Jerarquía de scopes
    scope_path: Optional[str] = None        # Ruta jerárquica (ej: Clase.metodo.var)
    parent_id: Optional[str] = None         # ID del nodo contenedor padre
    children_ids: List[str] = field(default_factory=list) # IDs de nodos contenidos
    is_container: bool = False              # True si es un contenedor (clase, función)
    container_type: Optional[str] = None    # "class", "function", "method"

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "id": self.id,
            "name": self.name,
            "type": self.node_type.value,
            "node_type": self.node_type.value,
            "location": self.location.to_dict(),
            "value_preview": self.value_preview,
            "docstring": self.docstring,
            "full_name": self.full_name,
            "is_external": self.is_external,
            # Campos de anotación
            "description": self.description,
            "unit": self.unit,
            "valid_range": list(self.valid_range) if self.valid_range else None,
            "category": self.category,
            "category_inferred": self.category_inferred,
            "reference": self.reference,
            "is_check": self.is_check,
            "check_message": self.check_message,
            "check_result": self.check_result,
            # Campos de jerarquía
            "scope_path": self.scope_path,
            "parent_id": self.parent_id,
            "children_ids": self.children_ids,
            "is_container": self.is_container,
            "container_type": self.container_type,
        }
        return result


@dataclass
class DependencyEdge:
    """Arista en el grafo de dependencias."""
    source_id: str
    target_id: str
    relation: RelationType

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source_id,
            "target": self.target_id,
            "relation": self.relation.value
        }


@dataclass
class DependencyGraph:
    """Grafo completo de dependencias."""
    nodes: List[DependencyNode] = field(default_factory=list)
    edges: List[DependencyEdge] = field(default_factory=list)
    root_id: str = ""
    analysis_complete: bool = True
    warnings: List[str] = field(default_factory=list)
    # Clasificación de nodos para vista inputs/outputs
    input_node_ids: List[str] = field(default_factory=list)
    output_node_ids: List[str] = field(default_factory=list)
    check_node_ids: List[str] = field(default_factory=list)
    analysis_mode: str = "dependencies"
    parse_errors: List[str] = field(default_factory=list)
    runtime_enriched: bool = False
    meta: Dict[str, Any] = field(default_factory=dict)
    # Sets internos para lookup O(1)
    _node_ids: Set[str] = field(default_factory=set, repr=False)
    _edge_keys: Set[Tuple[str, str]] = field(default_factory=set, repr=False)
    _edge_index: Dict[Tuple[str, str], int] = field(default_factory=dict, repr=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "root_id": self.root_id,
            "analysis_complete": self.analysis_complete,
            "warnings": self.warnings,
            "input_node_ids": self.input_node_ids,
            "output_node_ids": self.output_node_ids,
            "check_node_ids": self.check_node_ids,
            "analysis_mode": self.analysis_mode,
            "parse_errors": self.parse_errors,
            "runtime_enriched": self.runtime_enriched,
            "meta": self.meta,
        }

    def has_node_by_name(self, name: str) -> bool:
        """Verifica si un nodo existe por nombre o scope_path."""
        return any(n.scope_path == name or n.name == name for n in self.nodes)

    def add_node(self, node: DependencyNode) -> None:
        """Añade un nodo si no existe ya (O(1) lookup)."""
        if node.id not in self._node_ids:
            self._node_ids.add(node.id)
            self.nodes.append(node)

    def add_edge(self, edge: DependencyEdge) -> None:
        """Añade una arista si no existe ya (O(1) lookup)."""
        key = (edge.source_id, edge.target_id)
        if key not in self._edge_keys:
            self._edge_keys.add(key)
            self._edge_index[key] = len(self.edges)
            self.edges.append(edge)
            return

        existing_index = self._edge_index.get(key)
        if existing_index is None:
            return
        existing_edge = self.edges[existing_index]
        existing_edge.relation = _pick_stronger_relation(existing_edge.relation, edge.relation)

    def has_node(self, node_id: str) -> bool:
        return node_id in self._node_ids


# -----------------------------------------------------------------------------
# Visitor AST para Extraer Dependencias
# -----------------------------------------------------------------------------

class DependencyVisitor(ast.NodeVisitor):
    """Visita el AST para extraer dependencias de un símbolo."""

    def __init__(self, target_name: str, source_code: str, file_path: str = "",
                 cell_index: Optional[int] = None, module_prefix: str = ""):
        self.target_name = target_name
        self.source_code = source_code
        self.file_path = file_path
        self.cell_index = cell_index
        self.module_prefix = module_prefix.strip(".")
        self.lines = source_code.splitlines()

        # Stack de scopes para análisis jerárquico
        self.scope_stack: List[str] = []

        # Resultados
        self.assignments: Dict[str, ast.AST] = {}  # qualified_name -> nodo de asignación
        self.dependencies: Dict[str, Set[str]] = {}  # qualified_name -> set de referencias (nombres simples)
        self.dependency_relations: Dict[str, Dict[str, RelationType]] = {}  # qualified_name -> dep_name -> relation
        self.dependency_scopes: Dict[str, str] = {}  # qualified_name -> scope donde se observaron las deps
        self.node_types: Dict[str, NodeType] = {} # qualified_name -> tipo
        self.locations: Dict[str, Location] = {} # qualified_name -> location
        self.value_previews: Dict[str, str] = {} # qualified_name -> preview
        self.imports: Dict[str, ImportBindingInfo] = {}  # qualified_name -> metadata rica
        self.functions: Dict[str, ast.FunctionDef] = {} # qualified_name -> node
        self.classes: Dict[str, ast.ClassDef] = {} # qualified_name -> node
        
        # Metadatos de contenedores
        self.container_metadata: Dict[str, Dict[str, Any]] = {} # qualified_name -> {type: "class", ...}

        # Anotaciones de ingeniería extraídas de comentarios
        self.annotations: Dict[str, Any] = {}  # qualified_name -> AnnotationData
        self.checks: Dict[str, Dict] = {}  # qualified_name -> {condition, message, deps}

        # Resolución token-aware / scope-aware
        self.bindings_by_name: Dict[str, List[SymbolBinding]] = {}  # simple_name -> bindings
        self.scope_intervals: List[Tuple[Location, str, int]] = []  # (location, scope_qn, depth)

        # Estado para dependencias de control e interprocedural
        self.control_dependency_stack: List[Set[str]] = []
        self.function_scope_stack: List[str] = []
        self.function_parameters: Dict[str, List[FunctionParameterInfo]] = {}
        self.callsites: List[CallsiteInfo] = []
        self.assignment_call_targets: Dict[str, str] = {}
        self.instance_types: Dict[str, str] = {}

    def _get_current_scope_prefix(self) -> str:
        """Retorna el prefijo del scope actual (ej: 'Viga.calcular.')."""
        parts: List[str] = []
        if self.module_prefix:
            parts.append(self.module_prefix)
        parts.extend(self.scope_stack)
        if not parts:
            return ""
        return ".".join(parts) + "."

    def _get_current_scope_path(self) -> str:
        """Retorna el scope actual sin el punto final."""
        return self._get_current_scope_prefix().rstrip(".")

    def _get_qualified_name(self, name: str) -> str:
        """Retorna el nombre cualificado incluyendo scope."""
        prefix = self._get_current_scope_prefix()
        # Evitar doble punto si el nombre ya empieza raro, aunque usualmente name es simple
        return f"{prefix}{name}"

    def _register_scope_interval(self, scope_qn: str, node: ast.AST) -> None:
        location = self._make_location(node)
        depth = scope_qn.count(".")
        self.scope_intervals.append((location, scope_qn, depth))

    @staticmethod
    def _location_contains_point(location: Location, line: int, column: int) -> bool:
        if line <= 0:
            return False
        start_line = location.line or 0
        end_line = location.end_line or start_line
        start_col = location.column or 0
        end_col = location.end_column or start_col
        if start_line <= 0:
            return False
        if line < start_line or line > end_line:
            return False
        if start_line == end_line:
            return start_col <= column <= max(start_col, end_col)
        if line == start_line:
            return column >= start_col
        if line == end_line:
            return column <= max(0, end_col)
        return True

    def get_innermost_scope_at(self, line: int, column: int) -> str:
        if not isinstance(line, int) or line <= 0:
            return ""
        safe_column = column if isinstance(column, int) and column >= 0 else 0
        matching: List[Tuple[int, int, str]] = []
        for location, scope_qn, depth in self.scope_intervals:
            if self._location_contains_point(location, line, safe_column):
                span = max(1, (location.end_line or location.line) - (location.line or 0))
                matching.append((depth, span, scope_qn))
        if not matching:
            return ""
        matching.sort(key=lambda item: (-item[0], item[1]))
        return matching[0][2]

    def _register_binding(self, qn: str, name: str, location: Location) -> None:
        if not qn or not name:
            return
        binding = SymbolBinding(
            qn=qn,
            name=name,
            location=location,
            scope_path=self._get_current_scope_prefix().rstrip("."),
            cell_index=self.cell_index,
        )
        self.bindings_by_name.setdefault(name, []).append(binding)

    def _current_control_dependencies(self) -> Set[str]:
        if not self.control_dependency_stack:
            return set()
        merged: Set[str] = set()
        for deps in self.control_dependency_stack:
            merged.update(deps)
        return merged

    def _apply_control_dependencies(
        self,
        deps: Set[str],
        relation_hints: Optional[Dict[str, RelationType]] = None,
    ) -> Tuple[Set[str], Dict[str, RelationType]]:
        merged_deps = set(deps or set())
        merged_hints = dict(relation_hints or {})
        control_deps = self._current_control_dependencies()
        for dep in control_deps:
            if dep not in merged_deps:
                merged_deps.add(dep)
            if dep not in merged_hints:
                merged_hints[dep] = RelationType.USES
        return merged_deps, merged_hints

    def _register_container(self, name: str, node: ast.AST, c_type: str):
        """Registra un contenedor (Clase/Función) como un nodo."""
        qn = self._get_qualified_name(name)
        self.locations[qn] = self._make_location(node)
        self.value_previews[qn] = self._get_value_preview(node)
        self.container_metadata[qn] = {"type": c_type}
        
        # Las funciones/clases pueden depender de decoradores o bases
        deps = set()
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                deps.update(self._extract_names(base))
            # Decoradores de clase
            for decorator in node.decorator_list:
                deps.update(self._extract_names(decorator))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
             for decorator in node.decorator_list:
                 deps.update(self._extract_names(decorator))

        relation_hints = self._extract_dependency_relations(node)
        self._set_dependencies_for_symbol(
            qn,
            deps,
            relation_hints=relation_hints,
            default_relation=RelationType.USES,
        )
        return qn

    def _make_location(self, node: ast.AST) -> Location:
        """Crea Location desde un nodo AST."""
        return Location(
            file=self.file_path,
            line=getattr(node, 'lineno', 0),
            column=getattr(node, 'col_offset', 0),
            end_line=getattr(node, 'end_lineno', 0),
            end_column=getattr(node, 'end_col_offset', 0),
            cell_index=self.cell_index
        )

    def _make_alias_location(self, alias: ast.alias, fallback_node: ast.AST) -> Location:
        if hasattr(alias, "lineno"):
            return Location(
                file=self.file_path,
                line=getattr(alias, "lineno", 0),
                column=getattr(alias, "col_offset", 0),
                end_line=getattr(alias, "end_lineno", getattr(alias, "lineno", 0)),
                end_column=getattr(alias, "end_col_offset", getattr(alias, "col_offset", 0)),
                cell_index=self.cell_index,
            )
        return self._make_location(fallback_node)

    def _register_import_binding(
        self,
        qn: str,
        *,
        kind: str,
        module: str,
        original_name: str,
        alias: str,
        level: int,
        node: ast.AST,
        alias_node: Optional[ast.alias] = None,
    ) -> None:
        location = self._make_alias_location(alias_node, node) if alias_node else self._make_location(node)
        self.imports[qn] = ImportBindingInfo(
            kind=kind,
            module=module,
            original_name=original_name,
            alias=alias,
            level=level,
            source_file=self.file_path,
        )
        self.node_types[qn] = NodeType.IMPORT
        self.locations[qn] = location
        self._register_binding(qn, alias, location)
        self._set_dependencies_for_symbol(qn, set(), default_relation=RelationType.IMPORTS)

    def _get_value_preview(self, node: ast.AST, max_len: int = 200) -> str:
        """Intenta obtener una vista previa del valor asignado."""
        try:
            line_no = getattr(node, 'lineno', 0)
            if 0 < line_no <= len(self.lines):
                line = self.lines[line_no - 1].strip()
                if len(line) > max_len:
                    line = line[:max_len] + "..."
                return line
        except Exception:
            pass
        return ""

    @staticmethod
    def _attribute_to_name(node: ast.AST) -> Optional[str]:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base_name = DependencyVisitor._attribute_to_name(node.value)
            if base_name:
                return f"{base_name}.{node.attr}"
        return None

    @staticmethod
    def _extract_simple_reference_name(node: ast.AST) -> Optional[str]:
        """Extrae un nombre simple o dotted cuando el nodo es una referencia directa."""
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return DependencyVisitor._attribute_to_name(node)
        return None

    @staticmethod
    def _extract_direct_call_name(node: ast.AST) -> Optional[str]:
        if isinstance(node, ast.Call):
            return DependencyVisitor._extract_simple_reference_name(node.func)
        return None

    def _extract_names(self, node: ast.AST) -> Set[str]:
        """Extrae todos los nombres usados en una expresión."""
        names = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Name):
                names.add(child.id)
            elif isinstance(child, ast.Attribute):
                dotted_name = self._attribute_to_name(child)
                if dotted_name:
                    names.add(dotted_name)
                if isinstance(child.value, ast.Name):
                    if child.value.id != "self":
                        names.add(child.value.id)
                    if child.value.id == "self":
                        names.add(f"self.{child.attr}")
        names.discard("self")
        return names

    def _register_dependency_relation(self, owner_qn: str, dep_name: str, relation: RelationType) -> None:
        if not owner_qn or not dep_name:
            return
        per_symbol = self.dependency_relations.setdefault(owner_qn, {})
        if dep_name in per_symbol:
            per_symbol[dep_name] = _pick_stronger_relation(per_symbol[dep_name], relation)
        else:
            per_symbol[dep_name] = relation

    def _set_dependencies_for_symbol(
        self,
        owner_qn: str,
        deps: Set[str],
        relation_hints: Optional[Dict[str, RelationType]] = None,
        default_relation: RelationType = RelationType.USES,
        merge: bool = True,
    ) -> None:
        normalized_deps, normalized_hints = self._apply_control_dependencies(
            set(deps or set()),
            relation_hints,
        )

        if merge and owner_qn in self.dependencies:
            normalized_deps.update(self.dependencies[owner_qn])

        self.dependencies[owner_qn] = normalized_deps
        self.dependency_scopes[owner_qn] = self._get_current_scope_path()
        if owner_qn not in self.dependency_relations or not merge:
            self.dependency_relations[owner_qn] = {}

        for dep in normalized_deps:
            hinted_relation = relation_hints.get(dep) if relation_hints else None
            if hinted_relation is None:
                hinted_relation = normalized_hints.get(dep)
            self._register_dependency_relation(owner_qn, dep, hinted_relation or default_relation)

    def _extract_dependency_relations(self, node: ast.AST) -> Dict[str, RelationType]:
        relations: Dict[str, RelationType] = {}

        def set_relation(dep_name: str, relation: RelationType) -> None:
            existing = relations.get(dep_name)
            if existing is None:
                relations[dep_name] = relation
            else:
                relations[dep_name] = _pick_stronger_relation(existing, relation)

        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                if isinstance(child.func, ast.Name):
                    set_relation(child.func.id, RelationType.CALLS)
                elif isinstance(child.func, ast.Attribute):
                    dotted_name = self._attribute_to_name(child.func)
                    if dotted_name:
                        set_relation(dotted_name, RelationType.CALLS)
                    base_name = self._attribute_to_name(child.func.value)
                    if base_name and base_name != "self":
                        set_relation(base_name, RelationType.CALLS)
            elif isinstance(child, ast.Attribute):
                dotted_name = self._attribute_to_name(child)
                if dotted_name:
                    set_relation(dotted_name, RelationType.ATTRIBUTE_OF)
                base_name = self._attribute_to_name(child.value)
                if base_name and base_name != "self":
                    set_relation(base_name, RelationType.ATTRIBUTE_OF)
        return relations

    def _register_callsite(self, node: ast.Call) -> None:
        callee_name = self._extract_simple_reference_name(node.func)
        if not callee_name:
            return

        positional_args = [self._extract_simple_reference_name(arg) for arg in node.args]
        keyword_args: Dict[str, Optional[str]] = {}
        for keyword in node.keywords:
            if keyword.arg is None:
                continue
            keyword_args[keyword.arg] = self._extract_simple_reference_name(keyword.value)

        self.callsites.append(
            CallsiteInfo(
                callee_name=callee_name,
                context_scope=self._get_current_scope_path(),
                location=self._make_location(node.func),
                positional_args=positional_args,
                keyword_args=keyword_args,
                is_attribute_call=isinstance(node.func, ast.Attribute),
            )
        )

    def _find_class_scope(self) -> Optional[str]:
        """Busca la clase más cercana en el scope_stack usando enumerate (no index)."""
        for i in range(len(self.scope_stack) - 1, -1, -1):
            parts: List[str] = []
            if self.module_prefix:
                parts.append(self.module_prefix)
            parts.extend(self.scope_stack[:i + 1])
            scope_prefix = ".".join(parts)
            if scope_prefix in self.classes:
                return scope_prefix
        return None

    def visit_Import(self, node: ast.Import) -> None:
        """Procesa: import module [as alias]"""
        for alias in node.names:
            # Import define un nombre en el scope actual
            name = alias.asname or alias.name
            qn = self._get_qualified_name(name)
            self._register_import_binding(
                qn,
                kind="import",
                module=alias.name,
                original_name=alias.name,
                alias=name,
                level=0,
                node=node,
                alias_node=alias,
            )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """Procesa: from module import name [as alias]"""
        module = node.module or ""
        for alias in node.names:
            name = alias.asname or alias.name
            qn = self._get_qualified_name(name)
            self._register_import_binding(
                qn,
                kind="from",
                module=module,
                original_name=alias.name,
                alias=name,
                level=getattr(node, "level", 0) or 0,
                node=node,
                alias_node=alias,
            )
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        """Procesa asignaciones: x = expr"""
        deps = self._extract_names(node.value)
        relation_hints = self._extract_dependency_relations(node.value)
        direct_call_name = self._extract_direct_call_name(node.value)

        for target in node.targets:
            if isinstance(target, ast.Name):
                name = self._get_qualified_name(target.id)
                self.assignments[name] = node
                if direct_call_name:
                    self.assignment_call_targets[name] = direct_call_name
                else:
                    self.assignment_call_targets.pop(name, None)
                self._set_dependencies_for_symbol(
                    name,
                    deps,
                    relation_hints=relation_hints,
                    default_relation=RelationType.ASSIGNS,
                )
                self.node_types[name] = NodeType.VARIABLE
                self.locations[name] = self._make_location(target)
                self._register_binding(name, target.id, self.locations[name])
                self.value_previews[name] = self._get_value_preview(node)
            elif isinstance(target, ast.Attribute):
                # Detectar asignación a self.x dentro de métodos
                if isinstance(target.value, ast.Name) and target.value.id == "self":
                    class_scope = self._find_class_scope()
                    
                    if class_scope:
                        name = f"{class_scope}.self.{target.attr}"
                    else:
                        name = self._get_qualified_name(f"self.{target.attr}")
                        
                    self.assignments[name] = node
                    if direct_call_name:
                        self.assignment_call_targets[name] = direct_call_name
                    else:
                        self.assignment_call_targets.pop(name, None)
                    self._set_dependencies_for_symbol(
                        name,
                        deps,
                        relation_hints=relation_hints,
                        default_relation=RelationType.ASSIGNS,
                    )
                    self.node_types[name] = NodeType.ATTRIBUTE
                    self.locations[name] = self._make_location(target)
                    self._register_binding(name, target.attr, self.locations[name])
                    self._register_binding(name, f"self.{target.attr}", self.locations[name])
                    self.value_previews[name] = self._get_value_preview(node)

            elif isinstance(target, ast.Tuple):
                # Desempaquetado: a, b = expr
                for elt in target.elts:
                    if isinstance(elt, ast.Name):
                        name = self._get_qualified_name(elt.id)
                        self.assignments[name] = node
                        if direct_call_name:
                            self.assignment_call_targets[name] = direct_call_name
                        else:
                            self.assignment_call_targets.pop(name, None)
                        self._set_dependencies_for_symbol(
                            name,
                            deps,
                            relation_hints=relation_hints,
                            default_relation=RelationType.ASSIGNS,
                        )
                        self.node_types[name] = NodeType.VARIABLE
                        self.locations[name] = self._make_location(elt)
                        self._register_binding(name, elt.id, self.locations[name])
                        self.value_previews[name] = self._get_value_preview(node)

        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        """Procesa asignaciones anotadas: x: int = expr"""
        if isinstance(node.target, ast.Name) and node.value:
            name = self._get_qualified_name(node.target.id)
            self.assignments[name] = node
            direct_call_name = self._extract_direct_call_name(node.value)
            if direct_call_name:
                self.assignment_call_targets[name] = direct_call_name
            else:
                self.assignment_call_targets.pop(name, None)
            deps = self._extract_names(node.value)
            relation_hints = self._extract_dependency_relations(node.value)
            self._set_dependencies_for_symbol(
                name,
                deps,
                relation_hints=relation_hints,
                default_relation=RelationType.ASSIGNS,
            )
            self.node_types[name] = NodeType.VARIABLE
            self.locations[name] = self._make_location(node.target)
            self._register_binding(name, node.target.id, self.locations[name])
            self.value_previews[name] = self._get_value_preview(node)
        elif isinstance(node.target, ast.Attribute) and node.value:
            # Asignación anotada atributo: self.x: int = 1
            if isinstance(node.target.value, ast.Name) and node.target.value.id == "self":
                class_scope = self._find_class_scope()
                
                if class_scope:
                    name = f"{class_scope}.self.{node.target.attr}"
                else:
                    name = self._get_qualified_name(f"self.{node.target.attr}")
                
                self.assignments[name] = node
                direct_call_name = self._extract_direct_call_name(node.value)
                if direct_call_name:
                    self.assignment_call_targets[name] = direct_call_name
                else:
                    self.assignment_call_targets.pop(name, None)
                deps = self._extract_names(node.value)
                relation_hints = self._extract_dependency_relations(node.value)
                self._set_dependencies_for_symbol(
                    name,
                    deps,
                    relation_hints=relation_hints,
                    default_relation=RelationType.ASSIGNS,
                )
                self.node_types[name] = NodeType.ATTRIBUTE
                self.locations[name] = self._make_location(node.target)
                self._register_binding(name, node.target.attr, self.locations[name])
                self._register_binding(name, f"self.{node.target.attr}", self.locations[name])
                self.value_previews[name] = self._get_value_preview(node)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        """Procesa asignaciones aumentadas: x += expr"""
        if isinstance(node.target, ast.Name):
            name = self._get_qualified_name(node.target.id)
            deps = self._extract_names(node.value)
            deps.add(node.target.id)  # Depende de sí misma (valor anterior)
            deps.update(self.dependencies.get(name, set()))
            relation_hints = self._extract_dependency_relations(node.value)
            relation_hints[node.target.id] = RelationType.ASSIGNS
            self._set_dependencies_for_symbol(
                name,
                deps,
                relation_hints=relation_hints,
                default_relation=RelationType.ASSIGNS,
            )
            
            self.node_types[name] = NodeType.VARIABLE
            self.locations[name] = self._make_location(node.target)
            self._register_binding(name, node.target.id, self.locations[name])
        elif isinstance(node.target, ast.Attribute) and isinstance(node.target.value, ast.Name) and node.target.value.id == "self":
             class_scope = self._find_class_scope()
             
             if class_scope:
                 name = f"{class_scope}.self.{node.target.attr}"
             else:
                 name = self._get_qualified_name(f"self.{node.target.attr}")
                 
             deps = self._extract_names(node.value)
             deps.update(self.dependencies.get(name, set()))
             relation_hints = self._extract_dependency_relations(node.value)
             self._set_dependencies_for_symbol(
                 name,
                 deps,
                 relation_hints=relation_hints,
                 default_relation=RelationType.ASSIGNS,
             )
             self.node_types[name] = NodeType.ATTRIBUTE
             self.locations[name] = self._make_location(node.target)
             self._register_binding(name, node.target.attr, self.locations[name])
             self._register_binding(name, f"self.{node.target.attr}", self.locations[name])
             
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        """Procesa definiciones de funciones y sus contenidos."""
        # Determinar si es método: el scope padre inmediato debe ser una clase.
        parent_scope = ".".join(self.scope_stack) if self.scope_stack else ""
        is_method = bool(parent_scope and parent_scope in self.classes)
        # O heurística simple: si estamos dentro de algo, probablemente es método o nested function.
        # Mejor: usar container_type basado en nesting
        container_type = "method" if is_method else "function" # Simplificación
        
        # Registrar la función/método EN EL SCOPE ACTUAL
        qn = self._register_container(node.name, node, container_type)
        self.node_types[qn] = NodeType.FUNCTION
        self.functions[qn] = node
        self._register_scope_interval(qn, node)
        self._register_binding(qn, node.name, self.locations[qn])
        self._register_binding(qn, qn, self.locations[qn])
        
        # Entrar al scope
        self.scope_stack.append(node.name)
        self.function_scope_stack.append(qn)

        # Dependencias interprocedurales del encabezado de función:
        # defaults, kw_defaults, anotaciones de args y retorno.
        header_deps: Set[str] = set()
        header_relations: Dict[str, RelationType] = {}
        default_nodes = list(node.args.defaults) + [item for item in node.args.kw_defaults if item is not None]
        for default_node in default_nodes:
            header_deps.update(self._extract_names(default_node))
            header_relations.update(self._extract_dependency_relations(default_node))

        for arg in list(node.args.args) + list(node.args.kwonlyargs):
            if arg.annotation is not None:
                header_deps.update(self._extract_names(arg.annotation))
                header_relations.update(self._extract_dependency_relations(arg.annotation))
        if node.returns is not None:
            header_deps.update(self._extract_names(node.returns))
            header_relations.update(self._extract_dependency_relations(node.returns))
        if header_deps:
            self._set_dependencies_for_symbol(
                qn,
                header_deps,
                relation_hints=header_relations,
                default_relation=RelationType.USES,
            )
        
        # Registrar argumentos como variables en el nuevo scope
        for arg in list(node.args.posonlyargs) + list(node.args.args):
            arg_qn = self._get_qualified_name(arg.arg)
            self.node_types[arg_qn] = NodeType.PARAMETER
            self.locations[arg_qn] = self._make_location(arg)
            self._register_binding(arg_qn, arg.arg, self.locations[arg_qn])
            self._set_dependencies_for_symbol(arg_qn, set()) # Parámetros no dependen de nada explícitamente aquí
        
        self.function_parameters[qn] = [
            FunctionParameterInfo(
                qn=self._get_qualified_name(arg.arg),
                name=arg.arg,
                accepts_positional=True,
            )
            for arg in list(node.args.posonlyargs) + list(node.args.args)
        ]

        # Visitar cuerpo
        self.generic_visit(node)
        
        # Salir del scope
        self.function_scope_stack.pop()
        self.scope_stack.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        """Procesa definiciones de funciones async."""
        self.visit_FunctionDef(node)  # type: ignore

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        """Procesa definiciones de clases y su contenido."""
        # Registrar clase en scope actual
        qn = self._register_container(node.name, node, "class")
        self.classes[qn] = node
        self.node_types[qn] = NodeType.CLASS
        self._register_scope_interval(qn, node)
        self._register_binding(qn, node.name, self.locations[qn])
        self._register_binding(qn, qn, self.locations[qn])
        
        # Entrar al scope
        self.scope_stack.append(node.name)
        
        self.generic_visit(node)
        
        # Salir del scope
        self.scope_stack.pop()

    def visit_For(self, node: ast.For) -> None:
        """Procesa variables de bucle for."""
        if isinstance(node.target, ast.Name):
            name = self._get_qualified_name(node.target.id)
            self.node_types[name] = NodeType.VARIABLE
            self.locations[name] = self._make_location(node.target)
            self._register_binding(name, node.target.id, self.locations[name])
            deps = self._extract_names(node.iter)
            relation_hints = self._extract_dependency_relations(node.iter)
            self._set_dependencies_for_symbol(
                name,
                deps,
                relation_hints=relation_hints,
                default_relation=RelationType.USES,
            )
        control_deps = self._extract_names(node.iter)
        self.control_dependency_stack.append(control_deps)
        try:
            self.visit(node.target)
            self.visit(node.iter)
            for stmt in node.body:
                self.visit(stmt)
            for stmt in node.orelse:
                self.visit(stmt)
        finally:
            self.control_dependency_stack.pop()

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # type: ignore[arg-type]

    def visit_Call(self, node: ast.Call) -> None:
        self._register_callsite(node)
        self.generic_visit(node)

    def visit_comprehension(self, node: ast.comprehension) -> None:
        """Procesa variables de comprensiones."""
        if isinstance(node.target, ast.Name):
            name = self._get_qualified_name(node.target.id)
            self.node_types[name] = NodeType.VARIABLE
            self.locations[name] = self._make_location(node.iter)
            self._register_binding(name, node.target.id, self.locations[name])
            deps = self._extract_names(node.iter)
            relation_hints = self._extract_dependency_relations(node.iter)
            self._set_dependencies_for_symbol(
                name,
                deps,
                relation_hints=relation_hints,
                default_relation=RelationType.USES,
            )
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        control_deps = self._extract_names(node.test)
        self.visit(node.test)
        self.control_dependency_stack.append(control_deps)
        try:
            for stmt in node.body:
                self.visit(stmt)
            for stmt in node.orelse:
                self.visit(stmt)
        finally:
            self.control_dependency_stack.pop()

    def visit_While(self, node: ast.While) -> None:
        control_deps = self._extract_names(node.test)
        self.visit(node.test)
        self.control_dependency_stack.append(control_deps)
        try:
            for stmt in node.body:
                self.visit(stmt)
            for stmt in node.orelse:
                self.visit(stmt)
        finally:
            self.control_dependency_stack.pop()

    def visit_Try(self, node: ast.Try) -> None:
        for stmt in node.body:
            self.visit(stmt)

        for handler in node.handlers:
            guard_deps: Set[str] = set()
            if handler.type is not None:
                guard_deps = self._extract_names(handler.type)
                self.visit(handler.type)
            self.control_dependency_stack.append(guard_deps)
            try:
                for stmt in handler.body:
                    self.visit(stmt)
            finally:
                self.control_dependency_stack.pop()

        for stmt in node.orelse:
            self.visit(stmt)
        for stmt in node.finalbody:
            self.visit(stmt)

    def _register_function_output_dependencies(self, value_node: Optional[ast.AST]) -> None:
        if not self.function_scope_stack or value_node is None:
            return
        function_qn = self.function_scope_stack[-1]
        deps = self._extract_names(value_node)
        relation_hints = self._extract_dependency_relations(value_node)
        self._set_dependencies_for_symbol(
            function_qn,
            deps,
            relation_hints=relation_hints,
            default_relation=RelationType.USES,
        )

    def visit_Return(self, node: ast.Return) -> None:
        self._register_function_output_dependencies(node.value)
        self.generic_visit(node)

    def visit_Yield(self, node: ast.Yield) -> None:
        self._register_function_output_dependencies(node.value)
        self.generic_visit(node)

    def visit_YieldFrom(self, node: ast.YieldFrom) -> None:
        self._register_function_output_dependencies(node.value)
        self.generic_visit(node)

    def visit_Assert(self, node: ast.Assert) -> None:
        """
        Procesa statements assert como nodos de verificación.
        
        Ejemplo: assert sigma <= sigma_adm, "Falla por flexión"
        """
        # Generar nombre único para el check
        line_no = getattr(node, 'lineno', 0)
        # Check también pertenece al scope actual
        check_name = self._get_qualified_name(f"_check_L{line_no}")
        
        # Extraer dependencias de la condición
        deps = self._extract_names(node.test)
        
        # Extraer mensaje si existe
        check_message = None
        if node.msg:
            if isinstance(node.msg, ast.Constant):
                check_message = str(node.msg.value)
            else:
                check_message = self._get_value_preview(node.msg)
        
        # Registrar el check
        self.node_types[check_name] = NodeType.CHECK
        self.locations[check_name] = self._make_location(node)
        relation_hints = self._extract_dependency_relations(node.test)
        self._set_dependencies_for_symbol(
            check_name,
            deps,
            relation_hints=relation_hints,
            default_relation=RelationType.USES,
        )
        self.value_previews[check_name] = self._get_value_preview(node)
        self.checks[check_name] = {
            'condition': ast.unparse(node.test) if hasattr(ast, 'unparse') else str(node.test),
            'message': check_message,
            'deps': list(deps),
            'line': line_no,
        }
        
        self.generic_visit(node)


# -----------------------------------------------------------------------------
# Analizador Principal
# -----------------------------------------------------------------------------

class DependencyAnalyzer:
    """
    Analizador de dependencias que combina AST y Jedi para análisis profundo.
    
    Soporta:
    - Análisis intra-celda y cross-cell en notebooks
    - Resolución de imports usando Jedi
    - Grafos de dependencias con límite de profundidad
    """

    def __init__(self):
        if not HAS_NETWORKX:
            _logger.warning("networkx no disponible. Funcionalidad limitada.")
        if not HAS_JEDI:
            _logger.warning("jedi no disponible. Resolución cross-file limitada.")
        # Caché AST usando hash del código fuente
        self._ast_cache: Dict[str, ast.AST] = {}
        self._module_visitor_cache: Dict[Tuple[str, str, str], DependencyVisitor] = {}

    def _generate_node_id(self, name: str, file: str = "", line: int = 0,
                          cell_index: Optional[int] = None) -> str:
        """Genera un ID único para un nodo."""
        key = f"{file}:{cell_index}:{line}:{name}"
        return hashlib.md5(key.encode()).hexdigest()[:16]

    def _is_builtin(self, name: str) -> bool:
        """Verifica si un nombre es un builtin de Python."""
        import builtins
        return hasattr(builtins, name)

    def _is_builtin_dependency_name(self, name: str) -> bool:
        """Detecta dependencias no resueltas que son builtins de Python."""
        if not name:
            return False
        root_name = name.split(".", 1)[0]
        return self._is_builtin(root_name)

    def _filter_reportable_unresolved_dependencies(self, names: Set[str]) -> Set[str]:
        """Evita reportar builtins como fallas de analisis de dependencias."""
        return {
            name
            for name in names
            if not self._is_builtin_dependency_name(name)
        }

    def _is_external_module(self, module_name: str) -> bool:
        """Verifica si un módulo es externo (no del workspace)."""
        root_module = module_name.split('.')[0]
        known_aliases = {'np', 'pd', 'plt', 'tf', 'sp'}
        if root_module in known_aliases:
            return True
            
        try:
            spec = importlib.util.find_spec(root_module)
            if spec is None:
                return False
            # Si tiene origin (archivo), verificar que no sea del workspace
            if spec.origin:
                if spec.origin in ('built-in', 'frozen'):
                    return True
                origin = spec.origin.replace('\\', '/')
                # Módulos del stdlib o site-packages son externos
                # En Windows, python built-ins están en algo como C:/Python31x/lib/...
                return 'site-packages' in origin or '/lib/' in origin.lower() or '/python' in origin.lower()
            # Módulos namespace (sin origin) se consideran externos
            return True
        except (ModuleNotFoundError, ValueError):
            return False

    @staticmethod
    def _read_text_file(path: Path) -> str:
        return path.read_text(encoding="utf-8-sig")

    def _get_workspace_root(
        self,
        workspace_path: Optional[str],
        file_path: str = "",
    ) -> Optional[Path]:
        candidates: List[str] = []
        if isinstance(workspace_path, str) and workspace_path.strip():
            candidates.append(workspace_path)

        try:
            from app.services import workspace_service

            snapshot = workspace_service.get_workspace_snapshot()
            for key in ("active_workspace", "workspace_path", "workspace_root"):
                candidate = snapshot.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    candidates.append(candidate)
        except Exception:
            pass

        for candidate in candidates:
            try:
                root = Path(candidate).expanduser().resolve(strict=False)
            except OSError:
                continue
            if root.exists() and root.is_dir():
                return root

        if isinstance(file_path, str) and file_path.strip():
            try:
                resolved_file = Path(file_path).expanduser().resolve(strict=False)
            except OSError:
                return None
            if resolved_file.exists() and resolved_file.is_file():
                return resolved_file.parent
        return None

    @staticmethod
    def _path_is_within_workspace(path: Path, workspace_root: Path) -> bool:
        try:
            path.relative_to(workspace_root)
            return True
        except ValueError:
            return False

    def _module_name_from_path(self, file_path: str, workspace_root: Optional[Path]) -> Optional[str]:
        if not workspace_root or not file_path:
            return None

        try:
            resolved_file = Path(file_path).expanduser().resolve(strict=False)
        except OSError:
            return None

        if not self._path_is_within_workspace(resolved_file, workspace_root):
            return None
        if resolved_file.suffix != ".py":
            return None

        try:
            relative_path = resolved_file.relative_to(workspace_root)
        except ValueError:
            return None

        relative_without_suffix = relative_path.with_suffix("")
        parts = list(relative_without_suffix.parts)
        if not parts:
            return None
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts:
            return None
        return ".".join(parts)

    def _package_parts_for_file(self, file_path: str, workspace_root: Optional[Path]) -> List[str]:
        module_name = self._module_name_from_path(file_path, workspace_root)
        if not module_name:
            return []

        try:
            resolved_file = Path(file_path).expanduser().resolve(strict=False)
        except OSError:
            return []

        if resolved_file.name == "__init__.py":
            return module_name.split(".")
        parts = module_name.split(".")
        return parts[:-1]

    def _resolve_local_module_path(
        self,
        module_name: str,
        workspace_root: Optional[Path],
    ) -> Optional[Path]:
        if not workspace_root or not module_name:
            return None

        relative_path = Path(*module_name.split("."))
        file_candidate = (workspace_root / relative_path).with_suffix(".py")
        if file_candidate.exists() and file_candidate.is_file() and self._path_is_within_workspace(file_candidate, workspace_root):
            return file_candidate

        package_candidate = workspace_root / relative_path / "__init__.py"
        if package_candidate.exists() and package_candidate.is_file() and self._path_is_within_workspace(package_candidate, workspace_root):
            return package_candidate
        return None

    def _resolve_workspace_import(
        self,
        import_info: ImportBindingInfo,
        current_file: str,
        workspace_root: Optional[Path],
    ) -> Optional[ResolvedWorkspaceImport]:
        if not workspace_root or not current_file:
            return None

        module_name = import_info.module or ""

        if import_info.kind == "import":
            module_name = module_name or import_info.original_name
        elif import_info.level > 0:
            package_parts = self._package_parts_for_file(current_file, workspace_root)
            if not package_parts and import_info.level > 0:
                return None
            ascend = max(import_info.level - 1, 0)
            if ascend > len(package_parts):
                return None
            base_parts = package_parts[: len(package_parts) - ascend]
            relative_parts = module_name.split(".") if module_name else []
            module_name = ".".join([part for part in [*base_parts, *relative_parts] if part])

        if not module_name:
            return None

        resolved_path = self._resolve_local_module_path(module_name, workspace_root)
        if not resolved_path:
            return None

        return ResolvedWorkspaceImport(module_name=module_name, file_path=str(resolved_path))

    def _iter_workspace_python_files(self, workspace_root: Optional[Path]):
        if not workspace_root or not workspace_root.exists():
            return
        try:
            root = workspace_root.resolve(strict=False)
        except OSError:
            return
        for path in root.rglob("*.py"):
            try:
                relative_parts = path.relative_to(root).parts
            except ValueError:
                continue
            skip = False
            for index, part in enumerate(relative_parts[:-1]):
                relative_dir = "/".join(relative_parts[: index + 1])
                if part in WORKSPACE_SCAN_EXCLUDED_DIRS or relative_dir in WORKSPACE_SCAN_EXCLUDED_DIRS:
                    skip = True
                    break
            if skip:
                continue
            yield path

    def _parse_source_to_visitor(
        self,
        *,
        target_name: str,
        source_code: str,
        file_path: str,
        cell_index: Optional[int],
        module_prefix: str = "",
    ) -> DependencyVisitor:
        code_hash = hashlib.md5(source_code.encode("utf-8")).hexdigest()
        if code_hash in self._ast_cache:
            tree = copy.deepcopy(self._ast_cache[code_hash])
        else:
            tree = ast.parse(source_code)
            self._ast_cache[code_hash] = tree
            tree = copy.deepcopy(tree)

        visitor = DependencyVisitor(
            target_name,
            source_code,
            file_path,
            cell_index=cell_index,
            module_prefix=module_prefix,
        )
        visitor.visit(tree)
        return visitor

    def _load_module_visitor(
        self,
        module_name: str,
        file_path: str,
    ) -> Optional[DependencyVisitor]:
        try:
            resolved_path = Path(file_path).expanduser().resolve(strict=False)
        except OSError:
            return None
        if not resolved_path.exists() or not resolved_path.is_file():
            return None

        try:
            source_code = self._read_text_file(resolved_path)
        except (OSError, UnicodeDecodeError):
            return None

        content_hash = hashlib.md5(source_code.encode("utf-8")).hexdigest()
        cache_key = (str(resolved_path), content_hash, module_name)
        cached = self._module_visitor_cache.get(cache_key)
        if cached:
            return cached

        visitor = self._parse_source_to_visitor(
            target_name="",
            source_code=source_code,
            file_path=str(resolved_path),
            cell_index=None,
            module_prefix=module_name,
        )
        self._module_visitor_cache[cache_key] = visitor
        return visitor

    def _collect_visitors_and_symbols(
        self,
        *,
        symbol_name: str,
        source_code: str,
        notebook_context: Optional[List[str]],
        file_path: str,
        workspace_path: Optional[str],
        include_workspace_consumers: bool = False,
        max_workspace_files: int = MAX_WORKSPACE_IMPACT_SCAN_FILES,
    ) -> Tuple[List[DependencyVisitor], Dict[str, Tuple[DependencyVisitor, int]], int, List[str], Dict[str, Any]]:
        all_cells_code: List[Tuple[str, int]] = []
        if notebook_context:
            for idx, cell_code in enumerate(notebook_context):
                all_cells_code.append((cell_code, idx))
        current_cell_index = len(all_cells_code)
        all_cells_code.append((source_code, current_cell_index))

        global_visitors: List[DependencyVisitor] = []
        parse_messages: List[str] = []
        for code, cell_idx in all_cells_code:
            try:
                visitor = self._parse_source_to_visitor(
                    target_name=symbol_name,
                    source_code=code,
                    file_path=file_path,
                    cell_index=cell_idx,
                )
                global_visitors.append(visitor)
            except SyntaxError as exc:
                parse_messages.append(f"Error de sintaxis en celda {cell_idx}: {exc}")

        workspace_root = self._get_workspace_root(workspace_path, file_path=file_path)
        scan_meta: Dict[str, Any] = {
            "workspace_scanned_files": 0,
            "workspace_reverse_index_used": False,
            "workspace_scan_truncated": False,
        }
        queued_modules: Set[str] = set()
        queue = list(global_visitors)

        while queue:
            visitor = queue.pop(0)
            for import_info in visitor.imports.values():
                if import_info.kind not in {"import", "from"}:
                    continue
                resolved_import = self._resolve_workspace_import(import_info, visitor.file_path, workspace_root)
                if not resolved_import:
                    continue

                import_info.resolved_module_name = resolved_import.module_name
                import_info.resolved_path = resolved_import.file_path

                if resolved_import.module_name in queued_modules:
                    continue
                queued_modules.add(resolved_import.module_name)

                try:
                    module_visitor = self._load_module_visitor(
                        resolved_import.module_name,
                        resolved_import.file_path,
                    )
                except SyntaxError as exc:
                    parse_messages.append(
                        f"Error de sintaxis en import local '{resolved_import.module_name}': {exc}"
                    )
                    module_visitor = None
                if not module_visitor:
                    continue
                global_visitors.append(module_visitor)
                queue.append(module_visitor)

        should_scan_workspace = False
        if include_workspace_consumers and workspace_root and file_path:
            try:
                source_file = Path(file_path).expanduser().resolve(strict=False)
                should_scan_workspace = (
                    source_file.suffix == ".py"
                    and source_file.exists()
                    and source_file.is_file()
                    and self._path_is_within_workspace(source_file, workspace_root)
                )
            except OSError:
                should_scan_workspace = False

        if should_scan_workspace and workspace_root:
            scan_meta["workspace_reverse_index_used"] = True
            loaded_paths: Set[str] = set()
            for visitor in global_visitors:
                if visitor.cell_index is not None:
                    continue
                if not visitor.file_path:
                    continue
                try:
                    loaded_paths.add(str(Path(visitor.file_path).expanduser().resolve(strict=False)))
                except OSError:
                    continue

            scanned_files = 0
            for py_path in self._iter_workspace_python_files(workspace_root) or []:
                try:
                    resolved_py = py_path.expanduser().resolve(strict=False)
                except OSError:
                    continue
                resolved_key = str(resolved_py)
                if resolved_key in loaded_paths:
                    continue
                if scanned_files >= max_workspace_files:
                    scan_meta["workspace_scan_truncated"] = True
                    break
                module_name = self._module_name_from_path(str(resolved_py), workspace_root)
                if not module_name:
                    continue
                try:
                    module_visitor = self._load_module_visitor(module_name, str(resolved_py))
                except SyntaxError as exc:
                    parse_messages.append(
                        f"Error de sintaxis en índice workspace '{module_name}': {exc}"
                    )
                    continue
                if not module_visitor:
                    continue
                global_visitors.append(module_visitor)
                loaded_paths.add(resolved_key)
                scanned_files += 1
            scan_meta["workspace_scanned_files"] = scanned_files

        all_symbols: Dict[str, Tuple[DependencyVisitor, int]] = {}
        for visitor in global_visitors:
            cell_idx = visitor.cell_index or 0
            all_keys = (
                set(visitor.dependencies.keys())
                | set(visitor.imports.keys())
                | set(visitor.assignments.keys())
                | set(visitor.functions.keys())
                | set(visitor.classes.keys())
            )
            for qn in all_keys:
                all_symbols[qn] = (visitor, cell_idx)

        for visitor in global_visitors:
            for qn, import_info in visitor.imports.items():
                if import_info.kind == "from":
                    resolved_import = self._resolve_workspace_import(import_info, visitor.file_path, workspace_root)
                    if not resolved_import:
                        continue
                    import_info.resolved_module_name = resolved_import.module_name
                    import_info.resolved_path = resolved_import.file_path
                    target_qn = (
                        f"{resolved_import.module_name}.{import_info.original_name}"
                        if import_info.original_name != "*"
                        else None
                    )
                    if not target_qn or target_qn not in all_symbols:
                        continue
                    import_info.target_qn = target_qn
                    visitor._set_dependencies_for_symbol(
                        qn,
                        {target_qn},
                        relation_hints={target_qn: RelationType.IMPORTS},
                        default_relation=RelationType.IMPORTS,
                        merge=False,
                    )
                    continue

                resolved_import = self._resolve_workspace_import(import_info, visitor.file_path, workspace_root)
                if not resolved_import:
                    continue
                import_info.resolved_module_name = resolved_import.module_name
                import_info.resolved_path = resolved_import.file_path
                import_info.target_qn = resolved_import.module_name

        self._populate_instance_types(global_visitors, all_symbols)

        return global_visitors, all_symbols, current_cell_index, parse_messages, scan_meta

    def _populate_instance_types(
        self,
        global_visitors: List[DependencyVisitor],
        all_symbols: Dict[str, Tuple[DependencyVisitor, int]],
    ) -> None:
        for visitor in global_visitors:
            visitor.instance_types.clear()

        for visitor in global_visitors:
            for owner_qn, call_name in visitor.assignment_call_targets.items():
                if not call_name:
                    continue
                scope_context = ".".join(owner_qn.split(".")[:-1])
                callee_candidates = self._resolve_symbol_candidates(
                    call_name,
                    scope_context,
                    all_symbols,
                    context_visitor=visitor,
                )
                same_visitor_candidates = [
                    candidate
                    for candidate in callee_candidates
                    if all_symbols.get(candidate, (None, None))[0] is visitor
                ]
                if len(same_visitor_candidates) == 1:
                    callee_qn = same_visitor_candidates[0]
                else:
                    callee_qn = self._resolve_unique_symbol(
                        call_name,
                        scope_context,
                        all_symbols,
                        context_visitor=visitor,
                    )
                if not callee_qn:
                    continue
                callee_qn = self._follow_import_target(callee_qn, all_symbols)
                callee_meta = all_symbols.get(callee_qn)
                if not callee_meta:
                    continue
                callee_visitor, _ = callee_meta
                if callee_visitor.node_types.get(callee_qn) != NodeType.CLASS:
                    continue
                visitor.instance_types[owner_qn] = callee_qn

    def _resolve_star_import_references(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor],
    ) -> List[str]:
        if not context_visitor or not name or "." in name:
            return []

        candidates: List[str] = []

        def add_candidate(candidate: str) -> None:
            if candidate in all_symbols and candidate not in candidates:
                candidates.append(candidate)

        parts = context_scope.split(".") if context_scope else []
        for i in range(len(parts), -1, -1):
            prefix = ".".join(parts[:i])
            for import_qn, import_info in context_visitor.imports.items():
                if import_info.kind != "from" or import_info.original_name != "*":
                    continue
                import_scope = ".".join(import_qn.split(".")[:-1])
                if import_scope != prefix:
                    continue
                target_base = import_info.target_qn or import_info.resolved_module_name
                if not target_base:
                    continue
                add_candidate(f"{target_base}.{name}")

        return candidates

    def _resolve_instance_member_reference(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor],
    ) -> Optional[str]:
        if not context_visitor or "." not in name:
            return None

        head, tail = name.split(".", 1)
        if not head or not tail:
            return None

        instance_qn = self._resolve_symbol(
            head,
            context_scope,
            all_symbols,
            context_visitor=context_visitor,
        )
        if not instance_qn:
            return None

        class_qn = context_visitor.instance_types.get(instance_qn)
        if not class_qn:
            return None

        method_candidate = f"{class_qn}.{tail}"
        if method_candidate in all_symbols:
            return method_candidate

        attribute_candidate = f"{class_qn}.self.{tail}"
        if attribute_candidate in all_symbols:
            return attribute_candidate

        return None


    def _resolve_imported_reference(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor],
    ) -> Optional[str]:
        if not context_visitor or "." not in name:
            return None

        head, tail = name.split(".", 1)
        if not head or not tail:
            return None

        parts = context_scope.split(".") if context_scope else []
        for i in range(len(parts), -1, -1):
            prefix = ".".join(parts[:i])
            candidate = f"{prefix}.{head}" if prefix else head
            import_info = context_visitor.imports.get(candidate)
            if not import_info:
                continue

            target_base = import_info.target_qn or import_info.resolved_module_name
            if not target_base:
                continue

            resolved_candidate = f"{target_base}.{tail}"
            if resolved_candidate in all_symbols:
                return resolved_candidate

        return None

    def _resolve_symbol(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor] = None,
    ) -> Optional[str]:
        """
        Resuelve un nombre simple a un Qualified Name (QN) basado en el contexto.
        Sigue reglas LEGB simplificadas: Local (context_scope) -> Enclosing (parent scopes) -> Global.
        """
        if not name:
            return None
        normalized_name = name.strip()
        if not normalized_name:
            return None

        # Si el usuario pasa un QN explícito, respetarlo primero.
        if "." in normalized_name and normalized_name in all_symbols:
            return normalized_name

        instance_member_candidate = self._resolve_instance_member_reference(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        )
        if instance_member_candidate:
            return instance_member_candidate

        imported_candidate = self._resolve_imported_reference(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        )
        if imported_candidate:
            return imported_candidate

        star_candidates = self._resolve_star_import_references(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        )
        if len(star_candidates) == 1:
            return star_candidates[0]

        base_name = normalized_name.split(".")[-1] if "." in normalized_name else normalized_name
        parts = context_scope.split(".") if context_scope else []

        # 1) Resolver en scope local/enclosing (estricto por contexto)
        for i in range(len(parts), -1, -1):
            prefix = ".".join(parts[:i])
            scoped_candidate = f"{prefix}.{normalized_name}" if prefix else normalized_name
            if scoped_candidate in all_symbols:
                return scoped_candidate

            if base_name and not normalized_name.startswith("self."):
                self_candidate = f"{prefix}.self.{base_name}" if prefix else f"self.{base_name}"
                if self_candidate in all_symbols:
                    return self_candidate

        # 2) Fallback global
        if normalized_name in all_symbols:
            return normalized_name
        if normalized_name.startswith("self.") and base_name in all_symbols:
            return base_name

        return None

    def _resolve_symbol_candidates(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor] = None,
    ) -> List[str]:
        if not name:
            return []

        candidates: List[str] = []

        def add_candidate(candidate: str) -> None:
            if candidate in all_symbols and candidate not in candidates:
                candidates.append(candidate)

        normalized_name = name.strip()
        if not normalized_name:
            return []

        base_name = normalized_name.split(".")[-1] if "." in normalized_name else normalized_name
        explicit_qn = "." in normalized_name

        if explicit_qn:
            add_candidate(normalized_name)

        instance_member_candidate = self._resolve_instance_member_reference(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        )
        if instance_member_candidate:
            add_candidate(instance_member_candidate)

        imported_candidate = self._resolve_imported_reference(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        )
        if imported_candidate:
            add_candidate(imported_candidate)

        for star_candidate in self._resolve_star_import_references(
            normalized_name,
            context_scope,
            all_symbols,
            context_visitor,
        ):
            add_candidate(star_candidate)

        parts = context_scope.split(".") if context_scope else []
        for i in range(len(parts), -1, -1):
            prefix = ".".join(parts[:i])
            scoped_candidate = f"{prefix}.{normalized_name}" if prefix else normalized_name
            add_candidate(scoped_candidate)

            if base_name and not normalized_name.startswith("self."):
                self_candidate = f"{prefix}.self.{base_name}" if prefix else f"self.{base_name}"
                add_candidate(self_candidate)

        if not explicit_qn:
            add_candidate(normalized_name)

        if normalized_name.startswith("self.") and base_name:
            add_candidate(base_name)

        return candidates

    def _fallback_unique_candidates(
        self,
        symbol_name: str,
        all_symbols: Dict[str, Any],
    ) -> List[str]:
        if not symbol_name:
            return []

        normalized_name = symbol_name.strip()
        base_name = normalized_name.split(".")[-1] if "." in normalized_name else normalized_name
        candidates: List[str] = []

        for qn in all_symbols.keys():
            if qn == normalized_name:
                candidates.append(qn)
                continue
            if qn.endswith(f".{normalized_name}"):
                candidates.append(qn)
                continue
            if base_name and qn.endswith(f".{base_name}"):
                candidates.append(qn)
                continue
            if base_name and qn.endswith(f".self.{base_name}"):
                candidates.append(qn)

        # De-duplicar preservando orden
        return list(dict.fromkeys(candidates))

    def _resolve_dependency_reference(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor] = None,
    ) -> Optional[str]:
        resolved = self._resolve_symbol(
            name,
            context_scope,
            all_symbols,
            context_visitor=context_visitor,
        )
        if resolved:
            return resolved
        if "." in name and not name.startswith("self."):
            return None
        fallback = self._fallback_unique_candidates(name, all_symbols)
        if len(fallback) == 1:
            return fallback[0]
        return None

    def _resolve_unique_symbol(
        self,
        name: str,
        context_scope: str,
        all_symbols: Dict[str, Any],
        context_visitor: Optional[DependencyVisitor] = None,
    ) -> Optional[str]:
        candidates = self._resolve_symbol_candidates(
            name,
            context_scope,
            all_symbols,
            context_visitor=context_visitor,
        )
        candidates = list(dict.fromkeys(candidates))
        if len(candidates) == 1:
            return candidates[0]
        if candidates:
            return None
        if "." in name and not name.startswith("self."):
            return None
        fallback = self._fallback_unique_candidates(name, all_symbols)
        if len(fallback) == 1:
            return fallback[0]
        return None

    @staticmethod
    def _follow_import_target(
        symbol_qn: str,
        all_symbols: Dict[str, Tuple[DependencyVisitor, int]],
    ) -> str:
        resolved = symbol_qn
        seen: Set[str] = set()
        while resolved not in seen and resolved in all_symbols:
            seen.add(resolved)
            visitor, _ = all_symbols[resolved]
            import_info = visitor.imports.get(resolved)
            target_qn = import_info.target_qn if import_info else None
            if not target_qn or target_qn not in all_symbols:
                break
            resolved = target_qn
        return resolved

    def _build_interprocedural_dependencies(
        self,
        global_visitors: List[DependencyVisitor],
        all_symbols: Dict[str, Tuple[DependencyVisitor, int]],
    ) -> Dict[str, Dict[str, RelationType]]:
        resolved_calls_by_callee: Dict[str, List[Dict[str, str]]] = {}

        for visitor in global_visitors:
            for callsite in visitor.callsites:
                callee_qn = self._resolve_unique_symbol(
                    callsite.callee_name,
                    callsite.context_scope,
                    all_symbols,
                    context_visitor=visitor,
                )
                if not callee_qn:
                    continue
                callee_qn = self._follow_import_target(callee_qn, all_symbols)
                callee_meta = all_symbols.get(callee_qn)
                if not callee_meta:
                    continue
                callee_visitor, _ = callee_meta
                callee_node_type = callee_visitor.node_types.get(callee_qn)
                effective_callee_qn = callee_qn
                callee_is_constructor = False
                if callee_node_type == NodeType.CLASS:
                    init_qn = f"{callee_qn}.__init__"
                    if init_qn not in all_symbols:
                        continue
                    effective_callee_qn = init_qn
                    init_meta = all_symbols.get(init_qn)
                    if not init_meta:
                        continue
                    callee_visitor, _ = init_meta
                    callee_is_constructor = True

                parameter_specs = list(callee_visitor.function_parameters.get(effective_callee_qn, []))
                if not parameter_specs:
                    continue

                effective_specs = parameter_specs
                if (
                    (callsite.is_attribute_call or callee_is_constructor)
                    and effective_specs
                    and effective_specs[0].name in {"self", "cls"}
                ):
                    effective_specs = effective_specs[1:]

                positional_specs = [spec for spec in effective_specs if spec.accepts_positional]
                mapping: Dict[str, str] = {}

                for index, actual_name in enumerate(callsite.positional_args):
                    if actual_name is None or index >= len(positional_specs):
                        continue
                    actual_qn = self._resolve_unique_symbol(
                        actual_name,
                        callsite.context_scope,
                        all_symbols,
                        context_visitor=visitor,
                    )
                    if not actual_qn:
                        continue
                    mapping[positional_specs[index].qn] = actual_qn

                specs_by_name = {spec.name: spec for spec in effective_specs}
                for keyword_name, actual_name in callsite.keyword_args.items():
                    if actual_name is None:
                        continue
                    parameter_spec = specs_by_name.get(keyword_name)
                    if not parameter_spec:
                        continue
                    actual_qn = self._resolve_unique_symbol(
                        actual_name,
                        callsite.context_scope,
                        all_symbols,
                        context_visitor=visitor,
                    )
                    if not actual_qn:
                        continue
                    mapping[parameter_spec.qn] = actual_qn

                if mapping:
                    resolved_calls_by_callee.setdefault(effective_callee_qn, []).append(mapping)

        interprocedural_dependencies: Dict[str, Dict[str, RelationType]] = {}
        for call_mappings in resolved_calls_by_callee.values():
            if len(call_mappings) != 1:
                continue
            for parameter_qn, actual_qn in call_mappings[0].items():
                per_parameter = interprocedural_dependencies.setdefault(parameter_qn, {})
                current_relation = per_parameter.get(actual_qn)
                per_parameter[actual_qn] = (
                    _pick_stronger_relation(current_relation, RelationType.ASSIGNS)
                    if current_relation
                    else RelationType.ASSIGNS
                )

        return interprocedural_dependencies

    def _get_symbol_dependencies(
        self,
        qn: str,
        visitor: DependencyVisitor,
        interprocedural_dependencies: Dict[str, Dict[str, RelationType]],
    ) -> Tuple[Set[str], Dict[str, RelationType]]:
        deps = set(visitor.dependencies.get(qn, set()))
        dep_relations = dict(visitor.dependency_relations.get(qn, {}))

        for dep_name, relation in interprocedural_dependencies.get(qn, {}).items():
            deps.add(dep_name)
            current_relation = dep_relations.get(dep_name)
            dep_relations[dep_name] = (
                _pick_stronger_relation(current_relation, relation)
                if current_relation
                else relation
            )

        return deps, dep_relations

    @staticmethod
    def _prefer_current_cell_candidates(
        candidates: List[str],
        all_symbols: Dict[str, Tuple[Any, int]],
        current_cell_index: int,
    ) -> List[str]:
        if not candidates:
            return []
        in_current_cell = [
            candidate for candidate in candidates
            if all_symbols.get(candidate, (None, -1))[1] == current_cell_index
        ]
        return in_current_cell or candidates

    @staticmethod
    def _extract_symbol_token_at_position(
        source_code: str,
        line: int,
        column: int,
    ) -> Optional[str]:
        if not source_code or not isinstance(line, int) or line <= 0:
            return None
        lines = source_code.splitlines()
        if line > len(lines):
            return None
        row = lines[line - 1]
        if not row:
            return None

        def is_symbol_char(char: str) -> bool:
            return char.isalnum() or char in {"_", "."}

        idx = column if isinstance(column, int) and column >= 0 else 0
        if idx >= len(row):
            idx = len(row) - 1
        if idx < 0:
            return None

        if not is_symbol_char(row[idx]):
            if idx > 0 and is_symbol_char(row[idx - 1]):
                idx -= 1
            else:
                return None

        start = idx
        end = idx
        while start > 0 and is_symbol_char(row[start - 1]):
            start -= 1
        while end + 1 < len(row) and is_symbol_char(row[end + 1]):
            end += 1

        token = row[start:end + 1].strip(".")
        if not token:
            return None
        parts = [part for part in token.split(".") if part]
        if not parts:
            return None
        if any(not part.isidentifier() for part in parts):
            return None
        return ".".join(parts)

    def _binding_candidates_at_position(
        self,
        visitor: DependencyVisitor,
        line: int,
        column: int,
        token_hint: Optional[str],
    ) -> List[str]:
        matched_bindings: List[SymbolBinding] = []
        for bindings in visitor.bindings_by_name.values():
            for binding in bindings:
                if DependencyVisitor._location_contains_point(binding.location, line, column):
                    matched_bindings.append(binding)

        if not matched_bindings:
            return []

        # Preferir bindings definidos exactamente en la línea clickeada.
        # Evita que funciones/clases (cuyo Location cubre todo el bloque)
        # eclipsen tokens internos del cuerpo.
        line_exact = [b for b in matched_bindings if (b.location.line or 0) == line]
        if line_exact:
            matched_bindings = line_exact

        normalized_hint = token_hint.strip() if isinstance(token_hint, str) else ""
        base_hint = normalized_hint.split(".")[-1] if normalized_hint else ""
        if normalized_hint:
            exact = [b for b in matched_bindings if b.name == normalized_hint]
            if exact:
                matched_bindings = exact
            else:
                coarse = [
                    b for b in matched_bindings
                    if (
                        b.name == base_hint
                        or b.name.endswith(f".{base_hint}")
                        or b.qn.endswith(f".{base_hint}")
                    )
                ]
                if coarse:
                    matched_bindings = coarse
                else:
                    return []

        def span_size(location: Location) -> int:
            start_line = location.line or 0
            end_line = location.end_line or start_line
            start_col = location.column or 0
            end_col = location.end_column or start_col
            line_span = max(0, end_line - start_line)
            col_span = max(0, end_col - start_col)
            return line_span * 2000 + col_span

        matched_bindings.sort(
            key=lambda binding: (
                -binding.qn.count("."),
                span_size(binding.location),
                -len(binding.name),
            )
        )

        ordered_qn: List[str] = []
        seen_qn: Set[str] = set()
        for binding in matched_bindings:
            if binding.qn in seen_qn:
                continue
            seen_qn.add(binding.qn)
            ordered_qn.append(binding.qn)
        return ordered_qn

    def _resolve_requested_root_qn(
        self,
        symbol_name: str,
        source_code: str,
        line: Optional[int],
        column: Optional[int],
        current_cell_index: int,
        all_symbols: Dict[str, Tuple[DependencyVisitor, int]],
        current_visitor: Optional[DependencyVisitor],
    ) -> Tuple[Optional[str], str, List[str], int]:
        safe_line = line if isinstance(line, int) and line > 0 else None
        safe_column = column if isinstance(column, int) and column >= 0 else 0
        context_scope = ""
        if current_visitor and safe_line is not None:
            context_scope = current_visitor.get_innermost_scope_at(safe_line, safe_column)

        token_symbol = None
        if safe_line is not None:
            token_symbol = self._extract_symbol_token_at_position(
                source_code=source_code,
                line=safe_line,
                column=safe_column,
            )

        query_order: List[Tuple[str, str]] = []
        if token_symbol:
            query_order.append(("token", token_symbol))
        if symbol_name and symbol_name != token_symbol:
            query_order.append(("symbol", symbol_name))

        if safe_line is None:
            for _, query_name in query_order:
                if "." in query_name:
                    continue
                fallback_candidates = self._fallback_unique_candidates(query_name, all_symbols)
                fallback_candidates = self._prefer_current_cell_candidates(
                    fallback_candidates,
                    all_symbols,
                    current_cell_index,
                )
                if len(fallback_candidates) == 1:
                    return fallback_candidates[0], "fallback_unique", [], 0
                if len(fallback_candidates) > 1:
                    return None, "ambiguous", fallback_candidates[:8], 1

        if current_visitor and safe_line is not None:
            for source_kind, query_name in query_order:
                binding_candidates = self._binding_candidates_at_position(
                    visitor=current_visitor,
                    line=safe_line,
                    column=safe_column,
                    token_hint=query_name,
                )
                binding_candidates = self._prefer_current_cell_candidates(
                    binding_candidates,
                    all_symbols,
                    current_cell_index,
                )
                if len(binding_candidates) == 1:
                    strategy = "token_binding_strict" if source_kind == "token" else "binding_scope_strict"
                    return binding_candidates[0], strategy, [], 0
                if len(binding_candidates) > 1:
                    return None, "ambiguous", binding_candidates[:8], 1

        for source_kind, query_name in query_order:
            strict_candidates = self._resolve_symbol_candidates(
                query_name,
                context_scope,
                all_symbols,
                context_visitor=current_visitor,
            )
            strict_candidates = self._prefer_current_cell_candidates(
                strict_candidates,
                all_symbols,
                current_cell_index,
            )
            if strict_candidates:
                strategy = "token_scope_strict" if source_kind == "token" else "scope_strict"
                return strict_candidates[0], strategy, [], 0

        for _, query_name in query_order:
            fallback_candidates = self._fallback_unique_candidates(query_name, all_symbols)
            fallback_candidates = self._prefer_current_cell_candidates(
                fallback_candidates,
                all_symbols,
                current_cell_index,
            )
            if len(fallback_candidates) == 1:
                return fallback_candidates[0], "fallback_unique", [], 0
            if len(fallback_candidates) > 1:
                return None, "ambiguous", fallback_candidates[:8], 1

        return None, "unresolved", [], 1

    @staticmethod
    def _normalize_parent_scope(scope_path: str) -> str:
        """
        Normaliza parent scope para mantener compatibilidad con scope_path legacy.

        Ejemplo:
        - Beam.self.b -> Beam
        - Outer.Inner.self.x -> Outer.Inner
        """
        if ".self." in scope_path:
            return scope_path.split(".self.", 1)[0]
        if "." not in scope_path:
            return ""
        return scope_path.rsplit(".", 1)[0]

    def _build_hierarchy(self, graph: DependencyGraph, all_symbols: Dict[str, Any]) -> None:
        """
        Construye la jerarquía visual (contenedores) y asegura que todos los ancestros existan.
        """
        # 1. Identificar y agregar contenedores faltantes
        # Si tenemos "Class.method.var", necesitamos asegurar que "Class.method" y "Class" estén en el grafo
        nodes_to_process = list(graph.nodes)
        added_containers = set()
        
        while nodes_to_process:
            node = nodes_to_process.pop(0)
            if not node.scope_path:
                # Intentar inferir scope_path del ID o Name si no está set
                # (Para nodos legacy o creados sin scope explícito)
                pass
            
            if not node.scope_path or "." not in node.scope_path:
                continue

            # "Class.method.var" -> "Class.method"
            # "Class.self.attr" -> "Class"
            parent_scope = self._normalize_parent_scope(node.scope_path)

            if parent_scope and not graph.has_node_by_name(parent_scope) and parent_scope in all_symbols:
                if parent_scope in added_containers:
                    continue
                
                # Crear nodo contenedor
                visitor, _ = all_symbols[parent_scope]
                c_metadata = visitor.container_metadata.get(parent_scope, {})
                c_type = c_metadata.get("type", "function") # Default
                
                # Crear nodo
                container_node = self._create_node_from_symbol(
                    parent_scope, 
                    parent_scope, # QN is the name here
                    all_symbols
                )
                if container_node:
                    container_node.is_container = True
                    container_node.container_type = c_type
                    container_node.scope_path = parent_scope
                    
                    graph.add_node(container_node)
                    nodes_to_process.append(container_node)
                    added_containers.add(parent_scope)

        # 2. Link parent_id and children_ids
        # Re-index nodes by scope_path (QN)
        nodes_by_qn = {n.scope_path: n for n in graph.nodes if n.scope_path}
        
        for node in graph.nodes:
            if not node.scope_path or "." not in node.scope_path:
                continue

            parent_scope = self._normalize_parent_scope(node.scope_path)
            if parent_scope in nodes_by_qn:
                parent = nodes_by_qn[parent_scope]
                node.parent_id = parent.id
                if node.id not in parent.children_ids:
                    parent.children_ids.append(node.id)

    def _create_node_from_symbol(self, name: str, qn: str, all_symbols: Dict[str, Any]) -> Optional[DependencyNode]:
        """Crea un DependencyNode a partir de un símbolo en all_symbols."""
        if qn not in all_symbols:
            return None
            
        visitor, cell_idx = all_symbols[qn]
        node_type = visitor.node_types.get(qn, NodeType.UNKNOWN)
        location = visitor.locations.get(qn, Location())
        value_preview = visitor.value_previews.get(qn)
        
        file_path = visitor.file_path
        node_id = self._generate_node_id(qn, file_path, location.line, cell_idx)
        
        is_external = False
        full_name = qn
        if qn in visitor.imports:
            import_info = visitor.imports[qn]
            full_name = import_info.full_name
            if import_info.resolved_path:
                try:
                    workspace_root = self._get_workspace_root(None, file_path=import_info.resolved_path)
                    resolved_path = Path(import_info.resolved_path).expanduser().resolve(strict=False)
                    is_external = not (
                        workspace_root
                        and self._path_is_within_workspace(resolved_path, workspace_root)
                    )
                except OSError:
                    is_external = self._is_external_module(import_info.resolved_module_name or import_info.full_name)
            else:
                is_external = self._is_external_module(import_info.resolved_module_name or import_info.full_name)

        annotations = visitor.annotations.get(qn)
        # Integrar annotations del parser si no están ya presentes (Fix 5)
        ann_desc = None
        ann_unit = None
        ann_range = None
        ann_category = None
        ann_reference = None
        if annotations and hasattr(annotations, 'description'):
            ann_desc = annotations.description
            ann_unit = annotations.unit
            ann_range = annotations.valid_range
            ann_category = annotations.category
            ann_reference = annotations.reference
        elif HAS_ANNOTATION_PARSER and extract_annotations_for_symbol and location.line > 0:
            try:
                ann_data = extract_annotations_for_symbol(
                    visitor.source_code,
                    qn.split('.')[-1],
                    location.line,
                    apply_heuristics=True
                )
                if ann_data and not ann_data.is_empty():
                    ann_desc = ann_data.description
                    ann_unit = ann_data.unit
                    ann_range = ann_data.valid_range
                    ann_category = ann_data.category
                    ann_reference = ann_data.reference
            except Exception:
                pass
        
        # Check metadata
        check_meta = visitor.checks.get(qn)
        is_check = node_type == NodeType.CHECK
        check_msg = check_meta['message'] if check_meta else None
        
        # Container info
        c_meta = visitor.container_metadata.get(qn)
        is_container = c_meta is not None
        container_type = c_meta.get("type") if c_meta else None

        node = DependencyNode(
            id=node_id,
            name=name.split('.')[-1] if '.' in name else name,
            node_type=node_type,
            location=location,
            value_preview=value_preview,
            full_name=full_name,
            is_external=is_external,
            description=ann_desc,
            unit=ann_unit,
            valid_range=ann_range,
            category=ann_category,
            reference=ann_reference,
            scope_path=qn,
            is_container=is_container,
            container_type=container_type,
            is_check=is_check,
            check_message=check_msg
        )
        return node

    def analyze_symbol(
        self,
        symbol_name: str,
        source_code: str,
        line: Optional[int],
        column: Optional[int],
        file_path: str = "",
        notebook_context: Optional[List[str]] = None,
        workspace_path: Optional[str] = None,
        max_depth: int = MAX_DEPTH
    ) -> DependencyGraph:
        """
        Analiza un símbolo y retorna su grafo de dependencias jerárquico.
        """
        graph = DependencyGraph()
        graph.analysis_mode = "dependencies"

        visited: Set[str] = set()
        global_visitors, all_symbols, current_cell_index, parse_messages, scan_meta = self._collect_visitors_and_symbols(
            symbol_name=symbol_name,
            source_code=source_code,
            notebook_context=notebook_context,
            file_path=file_path,
            workspace_path=workspace_path,
        )
        interprocedural_dependencies = self._build_interprocedural_dependencies(global_visitors, all_symbols)
        graph.warnings.extend(parse_messages)
        graph.parse_errors.extend(parse_messages)
        graph.meta.update(scan_meta)

        current_visitor = next(
            (visitor for visitor in global_visitors if (visitor.cell_index or 0) == current_cell_index),
            None,
        )
        root_qn, resolution_strategy, ambiguous_candidates, unresolved_count = self._resolve_requested_root_qn(
            symbol_name=symbol_name,
            source_code=source_code,
            line=line,
            column=column,
            current_cell_index=current_cell_index,
            all_symbols=all_symbols,
            current_visitor=current_visitor,
        )
        graph.meta["resolution_strategy"] = resolution_strategy
        graph.meta["ambiguous_symbol_candidates"] = ambiguous_candidates
        graph.meta["unresolved_symbol_count"] = unresolved_count

        if not root_qn:
            if resolution_strategy == "ambiguous":
                graph.warnings.append(
                    f"Símbolo '{symbol_name}' ambiguo en {line}:{column}. "
                    f"Candidatos: {', '.join(ambiguous_candidates[:4])}"
                )
            else:
                graph.warnings.append(f"Símbolo '{symbol_name}' no encontrado en ubicación {line}:{column}")
            return graph

        # Función recursiva para construir el grafo
        unresolved_dependencies: Set[str] = set()

        def build_graph(qn: str, depth: int = 0) -> Optional[str]:
            if depth > max_depth or len(graph.nodes) >= MAX_NODES:
                graph.analysis_complete = False
                return None

            if qn in visited:
                # Buscar ID existente
                for n in graph.nodes:
                    if n.scope_path == qn:
                        return n.id
                return None

            visited.add(qn)
            
            node = self._create_node_from_symbol(qn, qn, all_symbols)
            if not node:
                if self._is_builtin(qn): return None
                graph.warnings.append(f"Definición no encontrada para '{qn}'")
                return None
                
            graph.add_node(node)
            
            # Obtener dependencias (nombres simples) y resolverlas
            visitor, _ = all_symbols[qn]
            deps, dep_relations = self._get_symbol_dependencies(
                qn,
                visitor,
                interprocedural_dependencies,
            )
            exact_interprocedural_deps = interprocedural_dependencies.get(qn, {})
            
            for dep_name in deps:
                # Context scope es el scope path del nodo actual (QN del nodo)
                # Si el nodo es una función/clase, su scope interno es node.qn
                # Si el nodo es una variable 'A.x', su scope de definición es 'A'.
                # PERO las dependencias de 'A.x' se resuelven desde 'A'.
                
                # Para resolución: si qn='A.method.var', scope='A.method'.
                # Si qn='A.method', scope='A' ?? No, dentro de la definición de A.method usamos cosas.
                # Si definimos `def method(): x = 1`, `method` depende de... nada. `x` está dentro.
                # Las dependencias registradas en `visitor.dependencies[qn]` son los nombres usados en la definición.
                # Para una variable: `x = y + 1`. Deps: `{y}`. Scope: donde vive x.
                
                scope_context = visitor.dependency_scopes.get(qn) or ".".join(qn.split('.')[:-1])
                
                if dep_name in exact_interprocedural_deps and dep_name in all_symbols:
                    resolved_dep = dep_name
                else:
                    resolved_dep = self._resolve_dependency_reference(
                        dep_name,
                        scope_context,
                        all_symbols,
                        context_visitor=visitor,
                    )

                if not resolved_dep:
                    unresolved_dependencies.add(dep_name)
                    continue
                if resolved_dep == qn:
                    continue

                dep_id = build_graph(resolved_dep, depth + 1)
                if dep_id:
                    relation = (
                        dep_relations.get(dep_name)
                        or dep_relations.get(resolved_dep)
                        or dep_relations.get(resolved_dep.split('.')[-1])
                    )
                    if relation is None and dep_name.startswith("self.") and "." in dep_name:
                        relation = dep_relations.get(dep_name.split(".", 1)[1])
                    if relation is None:
                        relation = RelationType.USES
                    resolved_meta = all_symbols.get(resolved_dep)
                    resolved_type = resolved_meta[0].node_types.get(resolved_dep) if resolved_meta else None
                    if resolved_type == NodeType.IMPORT and relation in (RelationType.USES, RelationType.ASSIGNS):
                        relation = RelationType.IMPORTS
                    edge = DependencyEdge(
                        source_id=dep_id,
                        target_id=node.id,
                        relation=relation
                    )
                    graph.add_edge(edge)
            
            return node.id

        # Iniciar graph build
        root_id = build_graph(root_qn)
        if root_id:
            graph.root_id = root_id
            
            # Construir jerarquía (post-proceso)
            self._build_hierarchy(graph, all_symbols)
            
            # Clasificar
            self._classify_nodes(graph, mode="dependencies")
            reportable_unresolved_dependencies = self._filter_reportable_unresolved_dependencies(
                unresolved_dependencies
            )
            graph.meta["unresolved_symbol_count"] = (
                int(graph.meta.get("unresolved_symbol_count", 0)) + len(reportable_unresolved_dependencies)
            )
            if reportable_unresolved_dependencies:
                graph.warnings.append(
                    f"Dependencias no resueltas (top): {', '.join(sorted(reportable_unresolved_dependencies)[:6])}"
                )
            
        else:
             graph.warnings.append(f"No se pudo iniciar el grafo para '{root_qn}'")

        return graph

    def _classify_nodes(self, graph: DependencyGraph, mode: str = "dependencies") -> None:
        """
        Clasifica nodos del grafo como inputs, outputs o checks.
        
        - Inputs: nodos sin aristas entrantes (no dependen de otros)
        - Outputs: nodos sin aristas salientes (no son usados por otros)
        - Checks: nodos marcados como verificación
        """
        if not graph.nodes:
            return

        graph.input_node_ids = []
        graph.output_node_ids = []
        graph.check_node_ids = []

        # Obtener conjuntos de nodos con aristas entrantes/salientes
        nodes_with_incoming = {e.target_id for e in graph.edges}
        nodes_with_outgoing = {e.source_id for e in graph.edges}
        include_root_as_output = mode != "impact"

        for node in graph.nodes:
            # Checks: nodos marcados explícitamente
            if node.is_check:
                graph.check_node_ids.append(node.id)
            
            # Inputs: sin aristas entrantes (leaf nodes en dirección inversa)
            if node.id not in nodes_with_incoming:
                graph.input_node_ids.append(node.id)
            
            # Outputs: sin aristas salientes (leaf nodes en dirección normal)
            is_leaf_output = node.id not in nodes_with_outgoing
            is_root_output = include_root_as_output and node.id == graph.root_id
            if is_leaf_output or is_root_output:
                if node.id not in graph.check_node_ids:  # No duplicar checks
                    graph.output_node_ids.append(node.id)

    async def analyze_symbol_async(
        self,
        symbol_name: str,
        source_code: str,
        line: int,
        column: int,
        **kwargs
    ) -> DependencyGraph:
        """Versión async del análisis (wrapper para uso con FastAPI)."""
        import asyncio
        return await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: self.analyze_symbol(symbol_name, source_code, line, column, **kwargs)
        )

    def analyze_impact(
        self,
        symbol_name: str,
        source_code: str,
        notebook_context: Optional[List[str]] = None,
        line: Optional[int] = None,
        column: Optional[int] = None,
        file_path: str = "",
        max_depth: int = MAX_DEPTH,
        workspace_path: Optional[str] = None,
    ) -> DependencyGraph:
        """
        Análisis de impacto: ¿qué otras variables dependen de este símbolo?
        
        Es el inverso del árbol de dependencias, implementado de manera recursiva.
        """
        graph = DependencyGraph()
        graph.analysis_mode = "impact"

        global_visitors, all_symbols, current_cell_index, parse_messages, scan_meta = self._collect_visitors_and_symbols(
            symbol_name=symbol_name,
            source_code=source_code,
            notebook_context=notebook_context,
            file_path=file_path,
            workspace_path=workspace_path,
            include_workspace_consumers=True,
        )
        interprocedural_dependencies = self._build_interprocedural_dependencies(global_visitors, all_symbols)
        graph.warnings.extend(parse_messages)
        graph.parse_errors.extend(parse_messages)
        graph.meta.update(scan_meta)
        if scan_meta.get("workspace_scan_truncated"):
            graph.analysis_complete = False
            graph.warnings.append(
                f"Índice workspace truncado tras {scan_meta.get('workspace_scanned_files', 0)} archivos Python"
            )

        # Crear mapa de dependencias inverso (clave QN estricta -> dependientes)
        # y guardar metadata
        inverse_dependencies: Dict[str, Dict[str, RelationType]] = {}
        all_symbols_metadata: Dict[str, Tuple[int, Location]] = {}
        unresolved_dependencies: Set[str] = set()
        
        # Construir mapa de tipos de nodo para uso en build_impact_graph (Fix 3)
        all_node_types: Dict[str, NodeType] = {}
        for qn, (visitor, cell_idx) in all_symbols.items():
            loc = visitor.locations.get(qn, Location(file=file_path))
            all_symbols_metadata[qn] = (cell_idx, loc)
            all_node_types[qn] = visitor.node_types.get(qn, NodeType.VARIABLE)

            deps, dep_relations = self._get_symbol_dependencies(
                qn,
                visitor,
                interprocedural_dependencies,
            )
            exact_interprocedural_deps = interprocedural_dependencies.get(qn, {})
            scope_context = visitor.dependency_scopes.get(qn) or ".".join(qn.split('.')[:-1])
            for dep in deps:
                relation = dep_relations.get(dep, RelationType.USES)
                if dep in exact_interprocedural_deps and dep in all_symbols:
                    resolved_dep = dep
                else:
                    resolved_dep = self._resolve_dependency_reference(
                        dep,
                        scope_context,
                        all_symbols,
                        context_visitor=visitor,
                    )
                if not resolved_dep:
                    unresolved_dependencies.add(dep)
                    continue
                if resolved_dep == qn:
                    continue
                if resolved_dep and all_node_types.get(resolved_dep) == NodeType.IMPORT and relation in (RelationType.USES, RelationType.ASSIGNS):
                    relation = RelationType.IMPORTS
                if resolved_dep not in inverse_dependencies:
                    inverse_dependencies[resolved_dep] = {}
                existing = inverse_dependencies[resolved_dep].get(qn)
                inverse_dependencies[resolved_dep][qn] = (
                    _pick_stronger_relation(existing, relation) if existing else relation
                )

        current_visitor = next(
            (visitor for visitor in global_visitors if (visitor.cell_index or 0) == current_cell_index),
            None,
        )
        root_qn, resolution_strategy, ambiguous_candidates, unresolved_root = self._resolve_requested_root_qn(
            symbol_name=symbol_name,
            source_code=source_code,
            line=line,
            column=column,
            current_cell_index=current_cell_index,
            all_symbols=all_symbols,
            current_visitor=current_visitor,
        )
        reportable_unresolved_dependencies = self._filter_reportable_unresolved_dependencies(
            unresolved_dependencies
        )
        graph.meta["resolution_strategy"] = resolution_strategy
        graph.meta["ambiguous_symbol_candidates"] = ambiguous_candidates
        graph.meta["unresolved_symbol_count"] = unresolved_root + len(reportable_unresolved_dependencies)

        if not root_qn:
            if resolution_strategy == "ambiguous":
                graph.warnings.append(
                    f"Símbolo '{symbol_name}' ambiguo"
                    + (f". Candidatos: {', '.join(ambiguous_candidates[:4])}" if ambiguous_candidates else "")
                )
            else:
                if isinstance(line, int) and line > 0:
                    graph.warnings.append(
                        f"Símbolo '{symbol_name}' no resuelto de forma estricta en {line}:{column or 0}"
                    )
                else:
                    graph.warnings.append(f"Símbolo '{symbol_name}' no resuelto de forma estricta")

        # Extract root metadata if available
        root_key = root_qn or symbol_name
        root_meta = all_symbols_metadata.get(root_key)
        root_cell_idx, root_location = root_meta if root_meta else (0, Location(file=file_path))

        # Crear nodo raíz respetando su tipo real y metadata canónica si existe
        root_node: Optional[DependencyNode] = None
        if root_qn:
            root_node = self._create_node_from_symbol(root_qn, root_qn, all_symbols)
        if not root_node:
            root_type = all_node_types.get(root_key, NodeType.VARIABLE)
            root_node = DependencyNode(
                id=self._generate_node_id(root_key, file_path, root_location.line, root_cell_idx),
                name=symbol_name,
                node_type=root_type,
                location=root_location,
                scope_path=root_qn or symbol_name,
            )

        root_id = root_node.id
        graph.add_node(root_node)
        graph.root_id = root_id

        visited: Set[str] = set()

        def build_impact_graph(current_key: str, current_id: str, depth: int = 0):
            if depth > max_depth or len(graph.nodes) >= MAX_NODES:
                graph.analysis_complete = False
                return

            if current_key in visited:
                return
            visited.add(current_key)

            dependents = inverse_dependencies.get(current_key, {})
            for dep_qn, relation in dependents.items():
                if dep_qn == current_key:
                    continue

                dep_node = self._create_node_from_symbol(dep_qn, dep_qn, all_symbols)
                if dep_node:
                    node_id = dep_node.id
                    graph.add_node(dep_node)
                else:
                    meta = all_symbols_metadata.get(dep_qn)
                    cell_idx, location = (0, Location(file=file_path)) if not meta else meta
                    node_id = self._generate_node_id(dep_qn, file_path, location.line, cell_idx)
                    if not graph.has_node(node_id):
                        real_node_type = all_node_types.get(dep_qn, NodeType.VARIABLE)
                        dep_node = DependencyNode(
                            id=node_id,
                            name=dep_qn.split('.')[-1] if '.' in dep_qn else dep_qn,
                            node_type=real_node_type,
                            location=location,
                            scope_path=dep_qn,
                        )
                        graph.add_node(dep_node)

                edge = DependencyEdge(
                    source_id=current_id,
                    target_id=node_id,
                    relation=relation
                )
                graph.add_edge(edge)

                # Recursión
                build_impact_graph(dep_qn, node_id, depth + 1)

        # Traversal estricto por QN para evitar contaminación entre homónimos.
        start_keys = {root_qn} if root_qn else set()
        if root_qn and file_path:
            workspace_root = self._get_workspace_root(workspace_path, file_path=file_path)
            module_name = self._module_name_from_path(file_path, workspace_root)
            if module_name:
                module_root_qn = root_qn if root_qn.startswith(f"{module_name}.") else f"{module_name}.{root_qn}"
                if module_root_qn in all_symbols:
                    start_keys.add(module_root_qn)

        for start_key in start_keys:
            build_impact_graph(start_key, root_id)

        # Construir jerarquía si hay nodos con scope
        if all_symbols:
            self._build_hierarchy(graph, all_symbols)

        # Clasificar nodos
        self._classify_nodes(graph, mode="impact")

        if reportable_unresolved_dependencies:
            graph.warnings.append(
                f"Dependencias no resueltas (top): {', '.join(sorted(reportable_unresolved_dependencies)[:6])}"
            )

        if len(graph.nodes) == 1 and not graph.edges:
            # Señaliza casos donde no hubo dependientes reales encontrados
            graph.warnings.append(f"No se encontraron dependientes para '{root_qn or symbol_name}'")

        return graph

    def generate_trace(
        self,
        graph: DependencyGraph,
        runtime_values: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Genera un trace topológico del cálculo.
        
        Ordena los nodos desde las dependencias hasta el resultado final,
        mostrando paso a paso cómo se calcula cada variable.
        
        Args:
            graph: Grafo de dependencias
            runtime_values: Diccionario de valores de runtime por nombre de variable
            
        Returns:
            Lista de pasos: [{step, variable, formula, value, unit, description}]
        """
        if not graph.nodes:
            return []
        
        runtime_values = runtime_values or {}
        
        # Construir grafo de adjacencia inversa (de dependencia a dependiente)
        adjacency: Dict[str, List[str]] = {node.id: [] for node in graph.nodes}
        in_degree: Dict[str, int] = {node.id: 0 for node in graph.nodes}
        
        for edge in graph.edges:
            adjacency[edge.source_id].append(edge.target_id)
            in_degree[edge.target_id] += 1
        
        # Ordenamiento topológico (Kahn's algorithm)
        queue = [node_id for node_id, degree in in_degree.items() if degree == 0]
        sorted_nodes: List[str] = []
        
        while queue:
            node_id = queue.pop(0)
            sorted_nodes.append(node_id)
            
            for neighbor in adjacency[node_id]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)
        
        # Generar trace
        trace: List[Dict[str, Any]] = []
        node_map = {node.id: node for node in graph.nodes}
        
        for step, node_id in enumerate(sorted_nodes, 1):
            node = node_map.get(node_id)
            if not node:
                continue
            
            # Obtener valor de runtime si existe
            value = None
            if node.name in runtime_values:
                rv = runtime_values[node.name]
                if isinstance(rv, dict):
                    value = rv.get('value') or rv.get('repr')
                else:
                    value = str(rv)
            
            trace.append({
                'step': step,
                'variable': node.name,
                'formula': node.value_preview or '(entrada)',
                'value': value,
                'unit': node.unit,
                'description': node.description,
                'category': node.category,
                'is_check': node.is_check,
                'node_id': node.id,
            })
        
        return trace


# -----------------------------------------------------------------------------
# Instancia Global
# -----------------------------------------------------------------------------

dependency_analyzer = DependencyAnalyzer()


# -----------------------------------------------------------------------------
# Funciones de Conveniencia
# -----------------------------------------------------------------------------

def analyze_dependencies(
    symbol: str,
    code: str,
    line: Optional[int] = None,
    column: Optional[int] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Función de conveniencia para análisis de dependencias.
    
    Retorna diccionario serializable para JSON.
    """
    graph = dependency_analyzer.analyze_symbol(symbol, code, line, column, **kwargs)
    return graph.to_dict()


def analyze_impact(
    symbol: str,
    code: str,
    notebook_context: Optional[List[str]] = None,
    line: Optional[int] = None,
    column: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Función de conveniencia para análisis de impacto.
    
    Retorna diccionario serializable para JSON.
    """
    graph = dependency_analyzer.analyze_impact(
        symbol_name=symbol,
        source_code=code,
        line=line,
        column=column,
        notebook_context=notebook_context,
    )
    return graph.to_dict()
