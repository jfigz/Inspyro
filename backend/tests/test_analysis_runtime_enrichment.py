import asyncio
import os
import sys
import unittest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.routers import analysis as analysis_router


class _FakeManager:
    def __init__(self):
        self.messages = []

    async def send_personal_message(self, payload, websocket):
        self.messages.append(payload)


class _FakeDependencyService:
    def __init__(self):
        self.last_analyze_symbol_kwargs = None
        self.last_analyze_impact_kwargs = None

    def analyze_symbol(self, **kwargs):
        self.last_analyze_symbol_kwargs = kwargs
        return {
            "nodes": [
                {
                    "id": "n1",
                    "name": "sigma",
                    "scope_path": "Beam.sigma",
                    "location": {"line": 1, "cell_index": 0},
                    "type": "variable",
                    "node_type": "variable",
                }
            ],
            "edges": [],
            "root_id": "n1",
            "warnings": [],
            "input_node_ids": ["n1"],
            "output_node_ids": ["n1"],
            "check_node_ids": [],
            "analysis_mode": "dependencies",
            "parse_errors": [],
            "runtime_enriched": False,
        }

    def analyze_impact(self, **kwargs):
        self.last_analyze_impact_kwargs = kwargs
        return {
            "nodes": [
                {
                    "id": "n2",
                    "name": "sigma",
                    "scope_path": "Beam.sigma",
                    "location": {"line": 2, "cell_index": 0},
                    "type": "variable",
                    "node_type": "variable",
                }
            ],
            "edges": [],
            "root_id": "n2",
            "warnings": [],
            "input_node_ids": ["n2"],
            "output_node_ids": [],
            "check_node_ids": [],
            "analysis_mode": "impact",
            "parse_errors": [],
            "runtime_enriched": False,
        }


class _FakeKernelManager:
    async def capture_variables_now(self, kernel_id, timeout=2.0):
        return {
            "Beam.sigma": {
                "type": "Quantity",
                "repr": "120.0 MPa",
                "unit_display": "MPa",
                "category": "result",
                "metadata": {"description": "Maximum stress"},
            },
            "sigma": {"type": "float", "repr": "999.0"},
        }


class _AmbiguousKernelManager:
    async def capture_variables_now(self, kernel_id, timeout=2.0):
        return {
            "sigma": {
                "type": "Quantity",
                "repr": "300.0 MPa",
                "unit_display": "MPa",
                "category": "result",
            }
        }


class TestAnalysisRuntimeEnrichment(unittest.TestCase):
    def setUp(self):
        self.manager = _FakeManager()
        self.dep_service = _FakeDependencyService()
        self.kernel = _FakeKernelManager()
        analysis_router.init_analysis_handlers(
            manager=self.manager,
            dependency_service=self.dep_service,
            dependency_analyzer_available=True,
            jupyter_kernel_manager=self.kernel,
        )

    def test_dependency_analysis_runtime_enriched(self):
        msg = {
            "type": "analyze_dependencies",
            "symbol": "sigma",
            "source_code": "sigma = 120",
            "kernel_id": "k1",
            "request_id": "rid_dep",
        }
        asyncio.run(analysis_router.handle_analyze_dependencies(msg, websocket=None))
        self.assertTrue(self.manager.messages)
        response = self.manager.messages[-1]
        self.assertEqual(response["type"], "dependency_analysis_result")
        graph = response["graph"]
        self.assertEqual(graph.get("analysis_mode"), "dependencies")
        self.assertTrue(graph.get("runtime_enriched"))
        self.assertEqual(graph["nodes"][0]["runtime_value"]["unit_display"], "MPa")
        self.assertEqual(graph["nodes"][0]["unit"], "MPa")
        self.assertEqual(graph["nodes"][0]["category"], "result")

    def test_impact_analysis_runtime_enriched(self):
        msg = {
            "type": "analyze_impact",
            "symbol": "sigma",
            "source_code": "sigma = 120",
            "kernel_id": "k1",
            "request_id": "rid_impact",
        }
        asyncio.run(analysis_router.handle_analyze_impact(msg, websocket=None))
        self.assertTrue(self.manager.messages)
        response = self.manager.messages[-1]
        self.assertEqual(response["type"], "impact_analysis_result")
        graph = response["graph"]
        self.assertEqual(graph.get("analysis_mode"), "impact")
        self.assertTrue(graph.get("runtime_enriched"))
        self.assertEqual(graph["nodes"][0]["runtime_value"]["unit_display"], "MPa")

    def test_dependency_analysis_omits_forced_position_when_not_provided(self):
        msg = {
            "type": "analyze_dependencies",
            "symbol": "sigma",
            "source_code": "sigma = 120",
            "request_id": "rid_dep_none",
        }
        asyncio.run(analysis_router.handle_analyze_dependencies(msg, websocket=None))

        self.assertIsNotNone(self.dep_service.last_analyze_symbol_kwargs)
        self.assertIsNone(self.dep_service.last_analyze_symbol_kwargs["line"])
        self.assertIsNone(self.dep_service.last_analyze_symbol_kwargs["column"])

    def test_runtime_enrichment_avoids_homonym_scope_contamination(self):
        ambiguous_result = {
            "nodes": [
                {
                    "id": "n1",
                    "name": "sigma",
                    "scope_path": "BeamA.sigma",
                    "location": {"line": 1, "cell_index": 0},
                },
                {
                    "id": "n2",
                    "name": "sigma",
                    "scope_path": "BeamB.sigma",
                    "location": {"line": 2, "cell_index": 0},
                },
            ],
            "edges": [],
            "root_id": "n1",
        }

        analysis_router.init_analysis_handlers(
            manager=self.manager,
            dependency_service=self.dep_service,
            dependency_analyzer_available=True,
            jupyter_kernel_manager=_AmbiguousKernelManager(),
        )

        enriched = asyncio.run(
            analysis_router._enrich_graph_with_runtime_if_available(ambiguous_result, kernel_id="k1")
        )

        self.assertFalse(enriched)
        self.assertNotIn("runtime_value", ambiguous_result["nodes"][0])
        self.assertNotIn("runtime_value", ambiguous_result["nodes"][1])


if __name__ == "__main__":
    unittest.main()
