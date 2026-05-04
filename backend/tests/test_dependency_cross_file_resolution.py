import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.dependency_analyzer import DependencyAnalyzer


class TestDependencyCrossFileResolution(unittest.TestCase):
    def _write(self, root: Path, relative_path: str, content: str) -> str:
        target = root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")
        return str(target)

    def test_from_import_expands_local_workspace_dependencies(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                from helpers import B
                C = B + 1
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("C", scoped_paths)
        self.assertIn("B", scoped_paths)
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("helpers.A", scoped_paths)

    def test_import_alias_resolves_member_into_imported_module(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                import helpers as h
                C = h.B + 1
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("helpers.A", scoped_paths)
        self.assertIn("h", scoped_paths)

    def test_relative_import_resolves_using_file_path_context(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(root, "pkg/__init__.py", "")
            self._write(
                root,
                "pkg/helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "pkg/main.py",
                """
                from .helpers import B
                C = B + 1
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("pkg.helpers.B", scoped_paths)
        self.assertIn("pkg.helpers.A", scoped_paths)

    def test_impact_from_imported_member_reaches_local_consumers(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                import helpers as h
                C = h.B + 1
                D = C + 2
                """,
            )

            graph = analyzer.analyze_impact(
                "h.B",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=4,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("C", scoped_paths)
        self.assertIn("D", scoped_paths)

    def test_impact_from_source_file_scans_workspace_consumers(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            helpers_path = self._write(
                root,
                "helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            self._write(
                root,
                "main.py",
                """
                from helpers import B
                C = B + 1
                D = C + 1
                """,
            )

            graph = analyzer.analyze_impact(
                "A",
                Path(helpers_path).read_text(encoding="utf-8"),
                line=1,
                column=0,
                file_path=helpers_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("main.C", scoped_paths)
        self.assertIn("main.D", scoped_paths)
        self.assertTrue(graph.meta.get("workspace_reverse_index_used"))
        self.assertGreaterEqual(graph.meta.get("workspace_scanned_files", 0), 1)

    def test_class_instance_flow_links_constructor_self_attr_method_and_result(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "lib.py",
                """
                width = 999

                class Section:
                    def __init__(self, width):
                        self.width = width

                    def area(self):
                        return self.width * 2
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                from lib import Section
                width = 5
                sec = Section(width)
                A = sec.area()
                """,
            )

            graph = analyzer.analyze_impact(
                "width",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("lib.Section.__init__.width", scoped_paths)
        self.assertIn("lib.Section.self.width", scoped_paths)
        self.assertIn("lib.Section.area", scoped_paths)
        self.assertIn("A", scoped_paths)
        self.assertNotIn("lib.width", scoped_paths)

        nodes = {node.id: node for node in graph.nodes}
        edge_scopes = {
            (
                nodes[edge.source_id].scope_path or nodes[edge.source_id].name,
                nodes[edge.target_id].scope_path or nodes[edge.target_id].name,
            )
            for edge in graph.edges
        }
        self.assertIn(("width", "lib.Section.__init__.width"), edge_scopes)
        self.assertIn(("lib.Section.__init__.width", "lib.Section.self.width"), edge_scopes)
        self.assertIn(("lib.Section.self.width", "lib.Section.area"), edge_scopes)
        self.assertIn(("lib.Section.area", "A"), edge_scopes)

    def test_impact_respects_max_depth(self):
        analyzer = DependencyAnalyzer()
        code = textwrap.dedent(
            """
            a = 1
            b = a + 1
            c = b + 1
            d = c + 1
            e = d + 1
            """
        ).lstrip("\n")

        graph = analyzer.analyze_impact("a", code, line=1, column=0, max_depth=1)
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("a", scoped_paths)
        self.assertIn("b", scoped_paths)
        self.assertIn("c", scoped_paths)
        self.assertNotIn("d", scoped_paths)
        self.assertNotIn("e", scoped_paths)
        self.assertFalse(graph.analysis_complete)

    def test_star_import_resolves_workspace_symbol_without_suffix_fallback(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                from helpers import *
                C = B + 1
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("helpers.A", scoped_paths)

    def test_package_init_reexport_resolves_workspace_symbol(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(root, "pkg/__init__.py", "from .helpers import B\n")
            self._write(
                root,
                "pkg/helpers.py",
                """
                A = 1
                B = A + 1
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                from pkg import B
                C = B + 1
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=2,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("pkg.B", scoped_paths)
        self.assertIn("pkg.helpers.B", scoped_paths)
        self.assertIn("pkg.helpers.A", scoped_paths)

    def test_unresolved_external_imports_remain_terminal(self):
        analyzer = DependencyAnalyzer()
        code = textwrap.dedent(
            """
            from math import sin
            x = sin(0.2)
            """
        ).lstrip("\n")

        graph = analyzer.analyze_symbol("x", code, line=2, column=0, file_path="main.py")
        scoped_paths = {node.scope_path or node.name for node in graph.nodes}

        self.assertIn("sin", scoped_paths)
        self.assertIn("x", scoped_paths)
        self.assertNotIn("math.sin", scoped_paths)

    def test_same_symbol_name_in_different_modules_stays_isolated(self):
        analyzer = DependencyAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write(
                root,
                "helpers.py",
                """
                B = 2
                """,
            )
            self._write(
                root,
                "other.py",
                """
                B = 3
                """,
            )
            main_path = self._write(
                root,
                "main.py",
                """
                import helpers as h
                import other as o
                C = h.B + o.B
                """,
            )

            graph = analyzer.analyze_symbol(
                "C",
                Path(main_path).read_text(encoding="utf-8"),
                line=3,
                column=0,
                file_path=main_path,
                workspace_path=tmpdir,
            )

        scoped_paths = {node.scope_path or node.name for node in graph.nodes}
        self.assertIn("helpers.B", scoped_paths)
        self.assertIn("other.B", scoped_paths)


if __name__ == "__main__":
    unittest.main()
