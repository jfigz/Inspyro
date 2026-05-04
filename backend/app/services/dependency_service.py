from typing import Any, Dict, List, Optional

from app.services.dependency_analyzer import DependencyAnalyzer


class DependencyService:
    """Facade for dependency analysis with cell-id enrichment."""

    def __init__(self):
        self.analyzer = DependencyAnalyzer()

    @staticmethod
    def _build_cells(
        source_code: str,
        notebook_context: Optional[List[str]],
        cell_id: Optional[str],
        context_cell_ids: Optional[List[str]],
    ) -> list[dict[str, str]]:
        cells: list[dict[str, str]] = []
        if notebook_context:
            for idx, code in enumerate(notebook_context):
                mapped_id = context_cell_ids[idx] if context_cell_ids and idx < len(context_cell_ids) else f"ctx_{idx}"
                cells.append({"id": mapped_id, "source": code})
        cells.append({"id": cell_id or "current", "source": source_code})
        return cells

    @staticmethod
    def _attach_cell_ids(result_dict: Dict[str, Any], cells: list[dict[str, str]]) -> Dict[str, Any]:
        for node in result_dict.get("nodes", []):
            loc = node.get("location", {})
            idx = loc.get("cell_index")
            if idx is not None and 0 <= idx < len(cells):
                loc["cell_id"] = cells[idx]["id"]
        return result_dict

    def analyze_symbol(
        self,
        symbol: str,
        source_code: str,
        line: Optional[int],
        column: Optional[int],
        notebook_context: Optional[List[str]] = None,
        cell_id: Optional[str] = None,
        context_cell_ids: Optional[List[str]] = None,
        file_path: str = "",
        max_depth: int = 10,
    ) -> Dict[str, Any]:
        cells = self._build_cells(source_code, notebook_context, cell_id, context_cell_ids)
        result_graph = self.analyzer.analyze_symbol(
            symbol_name=symbol,
            source_code=source_code,
            line=line,
            column=column,
            file_path=file_path,
            notebook_context=notebook_context,
            max_depth=max_depth,
        )
        return self._attach_cell_ids(result_graph.to_dict(), cells)

    def analyze_impact(
        self,
        symbol: str,
        source_code: str,
        notebook_context: Optional[List[str]] = None,
        line: Optional[int] = None,
        column: Optional[int] = None,
        cell_id: Optional[str] = None,
        context_cell_ids: Optional[List[str]] = None,
        file_path: str = "",
        max_depth: int = 10,
    ) -> Dict[str, Any]:
        cells = self._build_cells(source_code, notebook_context, cell_id, context_cell_ids)
        result_graph = self.analyzer.analyze_impact(
            symbol_name=symbol,
            source_code=source_code,
            line=line,
            column=column,
            notebook_context=notebook_context,
            file_path=file_path,
            max_depth=max_depth,
        )
        return self._attach_cell_ids(result_graph.to_dict(), cells)
