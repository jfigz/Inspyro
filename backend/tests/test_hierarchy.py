import unittest
import sys
import os

# Adjust path to include backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.dependency_analyzer import DependencyAnalyzer, NodeType

class TestHierarchy(unittest.TestCase):
    def setUp(self):
        self.analyzer = DependencyAnalyzer()

    def test_class_hierarchy_structure(self):
        code = """
class Calculator:
    def add(self, a, b):
        result = a + b
        return result
"""
        # Analyze 'result' at line 4
        # Note: indentation 8 spaces = column 8
        graph = self.analyzer.analyze_symbol("result", code, line=4, column=8)
        
        print("\nNodes in graph:", [n.scope_path for n in graph.nodes])
        
        # Check if we have the variable node
        var_node = next((n for n in graph.nodes if n.name == "result"), None)
        self.assertIsNotNone(var_node, "Variable node 'result' not found")
        self.assertTrue(var_node.scope_path.endswith("Calculator.add.result"))
        
        # Check immediate parent (Method)
        method_node = next((n for n in graph.nodes if n.id == var_node.parent_id), None)
        self.assertIsNotNone(method_node, "Parent method node not found")
        self.assertEqual(method_node.name, "add")
        self.assertTrue(method_node.is_container)
        self.assertEqual(method_node.container_type, "method")
        
        # Check class parent
        class_node = next((n for n in graph.nodes if n.id == method_node.parent_id), None)
        self.assertIsNotNone(class_node, "Parent class node not found")
        self.assertEqual(class_node.name, "Calculator")
        self.assertTrue(class_node.is_container)
        self.assertEqual(class_node.container_type, "class")

    def test_nested_functions(self):
        code = """
def outer():
    x = 1
    def inner():
        y = x + 1
        return y
    return inner
"""
        # Analyze 'y' inside inner at line 5
        graph = self.analyzer.analyze_symbol("y", code, line=5, column=8)
        
        y_node = next((n for n in graph.nodes if n.name == "y"), None)
        self.assertIsNotNone(y_node)
        
        inner_node = next((n for n in graph.nodes if n.id == y_node.parent_id), None)
        self.assertEqual(inner_node.name, "inner")
        
        outer_node = next((n for n in graph.nodes if n.id == inner_node.parent_id), None)
        self.assertEqual(outer_node.name, "outer")

    def test_resolution_local_enclosing(self):
        code = """
GLOBAL_VAR = 100

class Processor:
    def process(self):
        local_var = GLOBAL_VAR + 1
"""
        # Analyze 'local_var' at line 6
        graph = self.analyzer.analyze_symbol("local_var", code, line=6, column=8)
        
        local_node = next((n for n in graph.nodes if n.name == "local_var"), None)
        self.assertIsNotNone(local_node)
        
        # Verify dependency on GLOBAL_VAR
        # We need to find the edge
        global_node = next((n for n in graph.nodes if n.name == "GLOBAL_VAR"), None)
        self.assertIsNotNone(global_node)
        
        # Check edge: global -> local
        edge = next((e for e in graph.edges if e.source_id == global_node.id and e.target_id == local_node.id), None)
        self.assertIsNotNone(edge, "Dependency edge GLOBAL_VAR -> local_var not found")

if __name__ == '__main__':
    unittest.main()
