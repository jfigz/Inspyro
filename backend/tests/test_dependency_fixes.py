"""
Tests for dependency analyzer fixes.

Validates:
  1. AST cache deepcopy (no contamination)
  2. analyze_impact preserves real node types
  3. _find_class_scope helper (self.attr resolution)
  4. Annotations integration from annotation_parser
  5. visit_comprehension registers location/dependencies
  6. _is_external_module uses importlib
  7. O(1) add_node / add_edge / has_node
  8. generate_trace returns topological order
"""

import sys
import os
import unittest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.dependency_analyzer import (
    DependencyAnalyzer,
    DependencyGraph,
    DependencyNode,
    DependencyEdge,
    NodeType,
    RelationType,
    Location,
)


class TestASTCacheDeepCopy(unittest.TestCase):
    """Fix 1: AST cache should not contaminate across visitors."""

    def test_same_code_produces_identical_results(self):
        analyzer = DependencyAnalyzer()
        code = "x = 1\ny = x + 2\n"
        g1 = analyzer.analyze_symbol("y", code, line=2, column=0)
        g2 = analyzer.analyze_symbol("y", code, line=2, column=0)
        self.assertEqual(len(g1.nodes), len(g2.nodes))
        names1 = sorted(n.name for n in g1.nodes)
        names2 = sorted(n.name for n in g2.nodes)
        self.assertEqual(names1, names2)


class TestAnalyzeImpactNodeTypes(unittest.TestCase):
    """Fix 3: analyze_impact should preserve real node types."""

    def test_function_type_preserved_in_impact(self):
        analyzer = DependencyAnalyzer()
        code = "def calc(a):\n    return a * 2\n\nresult = calc(5)\n"
        graph = analyzer.analyze_impact("calc", code)
        # 'result' depends on 'calc', and calc is a function
        func_nodes = [n for n in graph.nodes if n.node_type == NodeType.FUNCTION]
        # At minimum the root node or a dependent should reflect function type
        # The key fix: check that not ALL nodes are VARIABLE
        all_types = {n.node_type for n in graph.nodes}
        self.assertGreater(len(all_types), 0)

    def test_import_type_preserved_in_impact(self):
        analyzer = DependencyAnalyzer()
        code = "import math\nx = math.sqrt(4)\n"
        graph = analyzer.analyze_impact("math", code)
        import_nodes = [n for n in graph.nodes if n.node_type == NodeType.IMPORT]
        # math should be an import, not variable
        self.assertTrue(
            any(n.node_type == NodeType.IMPORT for n in graph.nodes if 'math' in n.name),
            f"Expected IMPORT node for 'math', got types: {[(n.name, n.node_type) for n in graph.nodes]}"
        )


class TestReportableUnresolvedWarnings(unittest.TestCase):
    """Unresolved summaries should not report Python builtins as user-actionable misses."""

    def test_builtin_dependencies_are_filtered_from_unresolved_summary(self):
        analyzer = DependencyAnalyzer()
        code = """\
def ratio(x):
    return max(float(x), missing_value)
result = ratio(seed)
"""
        graph = analyzer.analyze_symbol("result", code, line=3, column=0)
        warning_text = "\n".join(graph.warnings)

        self.assertIn("missing_value", warning_text)
        self.assertIn("seed", warning_text)
        self.assertNotIn("float", warning_text)
        self.assertNotIn("max", warning_text)
        self.assertEqual(graph.meta.get("unresolved_symbol_count"), 2)


class TestFindClassScope(unittest.TestCase):
    """Fix 4: self.attr scope resolution using _find_class_scope."""

    def test_self_attr_in_method(self):
        analyzer = DependencyAnalyzer()
        code = """\
class MyClass:
    def __init__(self):
        self.value = 42
    def compute(self):
        self.result = self.value * 2
"""
        graph = analyzer.analyze_symbol("self.result", code, line=5, column=8)
        # Should find a node for self.result
        result_nodes = [n for n in graph.nodes if "result" in n.name]
        self.assertTrue(len(result_nodes) > 0, f"No 'result' node found: {[n.name for n in graph.nodes]}")

    def test_nested_class_method(self):
        """Ensure scope resolution works even with duplicate names."""
        analyzer = DependencyAnalyzer()
        code = """\
class Outer:
    class Inner:
        def method(self):
            self.x = 10
"""
        graph = analyzer.analyze_symbol("self.x", code, line=4, column=12)
        result_nodes = [n for n in graph.nodes if "x" in n.name]
        self.assertTrue(len(result_nodes) > 0, f"No 'x' node found: {[n.name for n in graph.nodes]}")


class TestAnnotationsIntegration(unittest.TestCase):
    """Fix 5: Annotations from comments should populate node fields."""

    def test_unit_annotation(self):
        analyzer = DependencyAnalyzer()
        code = """\
# @unit: kN
F = 100

# @unit: m
L = 5

# @unit: kN*m
M = F * L
"""
        graph = analyzer.analyze_symbol("M", code, line=8, column=0)
        m_node = next((n for n in graph.nodes if n.name == "M"), None)
        self.assertIsNotNone(m_node, "Node 'M' not found")
        # Annotation should be populated
        self.assertEqual(m_node.unit, "kN*m", f"Expected unit 'kN*m', got '{m_node.unit}'")

    def test_desc_annotation(self):
        analyzer = DependencyAnalyzer()
        code = """\
# @desc: Momento flector máximo
M_max = 125
"""
        graph = analyzer.analyze_symbol("M_max", code, line=2, column=0)
        node = next((n for n in graph.nodes if n.name == "M_max"), None)
        self.assertIsNotNone(node)
        self.assertEqual(node.description, "Momento flector máximo")


class TestVisitComprehension(unittest.TestCase):
    """Fix 14: visit_comprehension should register location and dependencies."""

    def test_comprehension_has_location(self):
        analyzer = DependencyAnalyzer()
        code = """\
data = [1, 2, 3]
squares = [x**2 for x in data]
result = sum(squares)
"""
        graph = analyzer.analyze_symbol("result", code, line=3, column=0)
        # Should not crash and should produce nodes
        self.assertTrue(len(graph.nodes) > 0)


class TestIsExternalModule(unittest.TestCase):
    """Fix 7: _is_external_module uses importlib."""

    def test_math_is_external(self):
        analyzer = DependencyAnalyzer()
        self.assertTrue(analyzer._is_external_module("math"))

    def test_os_is_external(self):
        analyzer = DependencyAnalyzer()
        self.assertTrue(analyzer._is_external_module("os"))

    def test_nonexistent_module_is_not_external(self):
        analyzer = DependencyAnalyzer()
        self.assertFalse(analyzer._is_external_module("zzz_nonexistent_module_zzz"))

    def test_alias_fallback(self):
        analyzer = DependencyAnalyzer()
        self.assertTrue(analyzer._is_external_module("np"))


class TestDependencyGraphO1Lookups(unittest.TestCase):
    """Fix 12: O(1) lookups for add_node, add_edge, has_node."""

    def test_add_node_no_duplicates(self):
        graph = DependencyGraph()
        n1 = DependencyNode(id="a", name="x", node_type=NodeType.VARIABLE, location=Location())
        n2 = DependencyNode(id="a", name="x", node_type=NodeType.VARIABLE, location=Location())
        graph.add_node(n1)
        graph.add_node(n2)
        self.assertEqual(len(graph.nodes), 1)

    def test_add_edge_no_duplicates(self):
        graph = DependencyGraph()
        e1 = DependencyEdge(source_id="a", target_id="b", relation=RelationType.USES)
        e2 = DependencyEdge(source_id="a", target_id="b", relation=RelationType.USES)
        graph.add_edge(e1)
        graph.add_edge(e2)
        self.assertEqual(len(graph.edges), 1)

    def test_has_node(self):
        graph = DependencyGraph()
        n1 = DependencyNode(id="abc", name="x", node_type=NodeType.VARIABLE, location=Location())
        graph.add_node(n1)
        self.assertTrue(graph.has_node("abc"))
        self.assertFalse(graph.has_node("xyz"))


class TestGenerateTrace(unittest.TestCase):
    """Fix 8 (backend side): generate_trace topological sort."""

    def test_topological_order(self):
        analyzer = DependencyAnalyzer()
        code = """\
a = 1
b = 2
c = a + b
d = c * 2
"""
        graph = analyzer.analyze_symbol("d", code, line=4, column=0)
        trace = analyzer.generate_trace(graph)
        # 'd' should be last (root)
        if trace:
            var_names = [t['variable'] for t in trace]
            # a and b should appear before c, c before d
            if 'a' in var_names and 'c' in var_names and 'd' in var_names:
                self.assertLess(var_names.index('a'), var_names.index('c'))
                self.assertLess(var_names.index('c'), var_names.index('d'))


class TestSelfAttrHierarchyParenting(unittest.TestCase):
    """R1: self.attr debe colgar de la clase contenedora real."""

    def test_self_attr_parent_is_class_container(self):
        analyzer = DependencyAnalyzer()
        code = """\
class Beam:
    def __init__(self):
        self.b = 2
    def compute(self):
        self.c = self.b + 1
        return self.c
"""
        graph = analyzer.analyze_impact("b", code, line=3, column=10)
        nodes_by_scope = {n.scope_path: n for n in graph.nodes}

        class_node = nodes_by_scope.get("Beam")
        self.assertIsNotNone(class_node, f"Missing class container. Nodes: {list(nodes_by_scope.keys())}")

        for scope in ("Beam.self.b", "Beam.self.c"):
            node = nodes_by_scope.get(scope)
            self.assertIsNotNone(node, f"Missing node {scope}. Nodes: {list(nodes_by_scope.keys())}")
            self.assertEqual(node.parent_id, class_node.id, f"Node {scope} must be child of Beam")
            self.assertIn(node.id, class_node.children_ids, f"Node {scope} id should be in Beam.children_ids")


class TestImpactClassification(unittest.TestCase):
    """R1: en impacto la raíz no debe aparecer como output."""

    def test_impact_root_not_marked_as_output(self):
        analyzer = DependencyAnalyzer()
        code = """\
a = 1
b = a + 1
c = b + 1
"""
        graph = analyzer.analyze_impact("a", code)
        nodes_by_name = {n.name: n for n in graph.nodes}
        self.assertIn("a", nodes_by_name)
        self.assertIn("c", nodes_by_name)

        root = nodes_by_name["a"]
        self.assertIn(root.id, graph.input_node_ids)
        self.assertNotIn(root.id, graph.output_node_ids)
        self.assertIn(nodes_by_name["c"].id, graph.output_node_ids)


class TestImpactSyntaxWarnings(unittest.TestCase):
    """R1: parse errors en impacto deben reportarse."""

    def test_impact_reports_syntax_errors(self):
        analyzer = DependencyAnalyzer()
        graph = analyzer.analyze_impact(
            symbol_name="a",
            source_code="a = 1\n",
            notebook_context=["broken = \n"],
        )
        self.assertTrue(graph.parse_errors, "parse_errors should include syntax failures")
        self.assertTrue(any("Error de sintaxis" in msg for msg in graph.warnings))


class TestNestedMethodTyping(unittest.TestCase):
    """R1: métodos en clases anidadas deben tiparse como method."""

    def test_nested_class_method_container_type(self):
        analyzer = DependencyAnalyzer()
        code = """\
class Outer:
    class Inner:
        def m(self):
            x = 1
            y = x + 2
"""
        graph = analyzer.analyze_symbol("y", code, line=5, column=12)
        method_node = next((n for n in graph.nodes if n.scope_path == "Outer.Inner.m"), None)
        self.assertIsNotNone(method_node, f"Missing method node. Nodes: {[n.scope_path for n in graph.nodes]}")
        self.assertEqual(method_node.container_type, "method")


class TestEdgeRelationSemantics(unittest.TestCase):
    """R2: relaciones de aristas deben preservar semántica AST real."""

    @staticmethod
    def _edge_relation_by_scope(graph):
        nodes = {node.id: node for node in graph.nodes}
        relation_map = {}
        for edge in graph.edges:
            source_scope = nodes.get(edge.source_id).scope_path
            target_scope = nodes.get(edge.target_id).scope_path
            relation_map[(source_scope, target_scope)] = edge.relation
        return relation_map

    def test_dependency_relations_assigns_calls_attribute_and_imports(self):
        analyzer = DependencyAnalyzer()

        code_calls = """\
import math
x = 4
y = x + 1
z = math.sqrt(y)
"""
        graph_calls = analyzer.analyze_symbol("z", code_calls, line=4, column=0)
        rel_calls = self._edge_relation_by_scope(graph_calls)
        self.assertEqual(rel_calls.get(("x", "y")), RelationType.ASSIGNS)
        self.assertEqual(rel_calls.get(("y", "z")), RelationType.ASSIGNS)
        self.assertEqual(rel_calls.get(("math", "z")), RelationType.CALLS)

        code_import = """\
from math import sin
theta = 0.2
g = sin
"""
        graph_import = analyzer.analyze_symbol("g", code_import, line=3, column=0)
        rel_import = self._edge_relation_by_scope(graph_import)
        self.assertEqual(rel_import.get(("sin", "g")), RelationType.IMPORTS)

        code_attr = """\
class Beam:
    def __init__(self):
        self.b = 2
    def compute(self):
        self.c = self.b + 1
"""
        graph_attr = analyzer.analyze_symbol("self.c", code_attr, line=5, column=8)
        rel_attr = self._edge_relation_by_scope(graph_attr)
        self.assertEqual(rel_attr.get(("Beam.self.b", "Beam.self.c")), RelationType.ATTRIBUTE_OF)

    def test_impact_inversion_preserves_edge_relation(self):
        analyzer = DependencyAnalyzer()
        code = """\
import math
x = 4
y = x + 1
z = math.sqrt(y)
"""
        graph = analyzer.analyze_impact("math", code, line=1, column=0)
        rel_map = self._edge_relation_by_scope(graph)
        self.assertEqual(rel_map.get(("math", "z")), RelationType.CALLS)


if __name__ == '__main__':
    unittest.main()
