import unittest
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.dependency_analyzer import DependencyAnalyzer


def _sample_class_code() -> str:
    return """
class Beam:
    def __init__(self):
        self.b = 2

    def compute(self):
        self.c = self.b + 1
        return self.c
"""


def _ambiguous_symbol_code() -> str:
    return (
        "b = 10\n"
        "x = b + 1\n\n"
        "class Beam:\n"
        "    def __init__(self):\n"
        "        self.b = 2\n\n"
        "    def compute(self):\n"
        "        self.c = self.b + 1\n"
        "        return self.c\n"
    )


class TestDependencyImpactResolution(unittest.TestCase):
    def test_analyze_impact_resolves_simple_symbol_to_scoped_attribute(self):
        analyzer = DependencyAnalyzer()
        graph = analyzer.analyze_impact("b", _sample_class_code())

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("Beam.self.b", scoped_paths)
        self.assertIn("Beam.self.c", scoped_paths)
        self.assertGreaterEqual(len(graph.edges), 1)

    def test_analyze_impact_keeps_self_attr_query_working(self):
        analyzer = DependencyAnalyzer()
        graph = analyzer.analyze_impact("self.b", _sample_class_code())

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("Beam.self.b", scoped_paths)
        self.assertIn("Beam.self.c", scoped_paths)
        self.assertGreaterEqual(len(graph.edges), 1)

    def test_analyze_impact_uses_line_scope_to_avoid_homonym_contamination(self):
        analyzer = DependencyAnalyzer()
        graph = analyzer.analyze_impact(
            "b",
            _ambiguous_symbol_code(),
            line=6,
            column=14,
        )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("Beam.self.b", scoped_paths)
        self.assertIn("Beam.self.c", scoped_paths)
        self.assertNotIn("x", scoped_paths)


class TestDependencyReliabilityHardening(unittest.TestCase):
    def test_analyze_symbol_line_column_uses_clicked_token_not_lhs(self):
        analyzer = DependencyAnalyzer()
        code = "a = 1\nb = a + 1\n"

        graph = analyzer.analyze_symbol("b", code, line=2, column=4)
        nodes_by_id = {node.id: node for node in graph.nodes}
        root = nodes_by_id.get(graph.root_id)

        self.assertIsNotNone(root)
        self.assertEqual(root.scope_path, "a")
        self.assertEqual(graph.meta.get("resolution_strategy"), "token_scope_strict")

    def test_analyze_symbol_resolves_inner_scope_token(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "def foo():\n"
            "    a = 2\n"
            "    b = a + 1\n"
            "    return b\n"
            "x = foo()\n"
        )

        graph = analyzer.analyze_symbol("b", code, line=4, column=8)
        nodes_by_id = {node.id: node for node in graph.nodes}
        root = nodes_by_id.get(graph.root_id)

        self.assertIsNotNone(root)
        self.assertEqual(root.scope_path, "foo.a")

    def test_impact_includes_return_chain(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "def f():\n"
            "    return a + 1\n"
            "x = f()\n"
        )

        graph = analyzer.analyze_impact("a", code, line=1, column=0)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("f", scoped_paths)
        self.assertIn("x", scoped_paths)

    def test_impact_includes_default_argument_dependencies(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "def f(v=a):\n"
            "    return v\n"
            "x = f()\n"
        )

        graph = analyzer.analyze_impact("a", code, line=1, column=0)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("f", scoped_paths)
        self.assertIn("x", scoped_paths)

    def test_reassignments_merge_dependencies_across_branches(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "b = 2\n"
            "cond = True\n"
            "if cond:\n"
            "    x = a\n"
            "else:\n"
            "    x = b\n"
            "y = x + 1\n"
        )

        impact_a = analyzer.analyze_impact("a", code, line=1, column=0)
        impact_b = analyzer.analyze_impact("b", code, line=2, column=0)
        paths_a = {node.scope_path or node.name for node in impact_a.nodes}
        paths_b = {node.scope_path or node.name for node in impact_b.nodes}

        self.assertIn("x", paths_a)
        self.assertIn("y", paths_a)
        self.assertIn("x", paths_b)
        self.assertIn("y", paths_b)

    def test_impact_strict_qn_avoids_homonym_cross_scope_contamination(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "x = a + 1\n"
            "def foo():\n"
            "    a = 2\n"
            "    y = a + 1\n"
            "    return y\n"
            "z = foo()\n"
        )

        graph = analyzer.analyze_impact("a", code, line=5, column=8)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        nodes_by_id = {node.id: node for node in graph.nodes}
        root = nodes_by_id.get(graph.root_id)

        self.assertIsNotNone(root)
        self.assertEqual(root.scope_path, "foo.a")
        self.assertIn("foo.y", scoped_paths)
        self.assertNotIn("x", scoped_paths)

    def test_impact_without_line_requires_unique_fallback(self):
        analyzer = DependencyAnalyzer()
        graph = analyzer.analyze_impact("b", _ambiguous_symbol_code())

        self.assertEqual(graph.meta.get("resolution_strategy"), "ambiguous")
        self.assertTrue(graph.meta.get("ambiguous_symbol_candidates"))
        self.assertEqual(len(graph.edges), 0)

    def test_control_dependency_is_included_in_impact(self):
        analyzer = DependencyAnalyzer()
        code = (
            "a = 1\n"
            "if a > 0:\n"
            "    b = 2\n"
            "c = b + 1\n"
        )

        graph = analyzer.analyze_impact("a", code, line=1, column=0)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("b", scoped_paths)
        self.assertIn("c", scoped_paths)


class TestInterproceduralCallsiteBridges(unittest.TestCase):
    @staticmethod
    def _edge_map(graph):
        nodes = {node.id: node for node in graph.nodes}
        return {
            (
                nodes[edge.source_id].scope_path or nodes[edge.source_id].name,
                nodes[edge.target_id].scope_path or nodes[edge.target_id].name,
            ): edge.relation
            for edge in graph.edges
        }

    def test_dependencies_bridge_unique_function_call_argument_into_parameter(self):
        analyzer = DependencyAnalyzer()
        code = (
            "def helper(v):\n"
            "    x = v + 1\n"
            "    return x\n\n"
            "a = 10\n"
            "b = helper(a)\n"
        )

        graph = analyzer.analyze_symbol("b", code, line=6, column=0)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        edge_map = self._edge_map(graph)

        self.assertIn("helper.v", scoped_paths)
        self.assertIn("helper.x", scoped_paths)
        self.assertEqual(edge_map.get(("a", "helper.v")).value, "assigns")
        self.assertEqual(edge_map.get(("helper.v", "helper.x")).value, "assigns")

    def test_impact_traverses_unique_method_call_parameter_chain(self):
        analyzer = DependencyAnalyzer()
        code = (
            "class Beam:\n"
            "    def helper(self, v):\n"
            "        x = v + 1\n"
            "        return x\n\n"
            "    def compute(self):\n"
            "        a = 10\n"
            "        self.result = self.helper(a)\n"
            "        return self.result\n"
        )

        graph = analyzer.analyze_impact("a", code, line=7, column=8)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        edge_map = self._edge_map(graph)

        self.assertIn("Beam.compute.a", scoped_paths)
        self.assertIn("Beam.helper.v", scoped_paths)
        self.assertIn("Beam.helper.x", scoped_paths)
        self.assertIn("Beam.helper", scoped_paths)
        self.assertIn("Beam.self.result", scoped_paths)
        self.assertEqual(edge_map.get(("Beam.compute.a", "Beam.helper.v")).value, "assigns")

    def test_dependencies_bridge_keyword_argument_into_parameter(self):
        analyzer = DependencyAnalyzer()
        code = (
            "def helper(v):\n"
            "    x = v + 1\n"
            "    return x\n\n"
            "a = 10\n"
            "b = helper(v=a)\n"
        )

        graph = analyzer.analyze_symbol("b", code, line=6, column=0)
        edge_map = self._edge_map(graph)

        self.assertEqual(edge_map.get(("a", "helper.v")).value, "assigns")

    def test_interprocedural_bridges_skip_ambiguous_multiple_callsites(self):
        analyzer = DependencyAnalyzer()
        code = (
            "def helper(v):\n"
            "    x = v + 1\n"
            "    return x\n\n"
            "a = 10\n"
            "z = 20\n"
            "b = helper(a)\n"
            "c = helper(z)\n"
        )

        graph = analyzer.analyze_impact("a", code, line=5, column=0)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("a", scoped_paths)
        self.assertIn("b", scoped_paths)
        self.assertNotIn("helper.v", scoped_paths)
        self.assertNotIn("helper.x", scoped_paths)
        self.assertNotIn("c", scoped_paths)

    def test_impact_keeps_structure_return_chain_after_bridge_injection(self):
        analyzer = DependencyAnalyzer()
        code = (
            "def source():\n"
            "    a = 10\n"
            "    return {\"k\": a}\n\n"
            "payload = source()\n"
            "x = payload[\"k\"]\n"
        )

        graph = analyzer.analyze_impact("a", code, line=2, column=4)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("source.a", scoped_paths)
        self.assertIn("source", scoped_paths)
        self.assertIn("payload", scoped_paths)
        self.assertIn("x", scoped_paths)


if __name__ == "__main__":
    unittest.main()
