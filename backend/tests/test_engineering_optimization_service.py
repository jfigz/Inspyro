import os
import sys
import unittest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.engineering_optimization_service import EngineeringOptimizationService


class TestEngineeringOptimizationService(unittest.TestCase):
    def setUp(self):
        self.service = EngineeringOptimizationService()

    def test_optimize_design_returns_recommended_design(self):
        result = self.service.optimize_design(
            objective={"targets": [{"name": "weight", "goal": "min", "weight": 1.0}]},
            variables=[{"name": "b", "min": 0.2, "max": 1.0, "initial": 0.4}],
            constraints=[{"name": "stress_limit", "lhs": "stress", "op": "<=", "rhs": 10.0}],
            formulas={"weight": "b * 10", "stress": "8 / b"},
            current_values={},
            iterations=30,
            seed=7,
        )
        self.assertIn("recommended_design", result)
        self.assertIsNotNone(result["recommended_design"])
        self.assertIn("pareto_front", result)

    def test_load_envelope_reports_governing_combination(self):
        result = self.service.analyze_load_envelope(
            combinations=[
                {"name": "base", "factors": {"P": 1.0}},
                {"name": "high", "factors": {"P": 1.5}},
            ],
            outputs=["M"],
            formulas={"M": "P * L"},
            current_values={"P": 10.0, "L": 3.0},
        )
        self.assertIn("envelopes", result)
        self.assertEqual(result["envelopes"]["M"]["governing_max"], "high")

    def test_run_code_checks_returns_summary(self):
        result = self.service.run_code_checks(
            checks=[
                {"name": "check_sigma", "lhs": "sigma", "op": "<=", "rhs": 200.0},
                {"name": "check_dcr", "lhs": "DCR", "op": "<=", "rhs": 1.0},
            ],
            formulas={},
            current_values={"sigma": 180.0, "DCR": 1.2},
            code_profile="custom",
        )
        self.assertEqual(result["summary"]["total"], 2)
        self.assertEqual(result["summary"]["failed"], 1)
        self.assertTrue(result["active_constraints"])

    def test_compare_scenarios_includes_delta(self):
        result = self.service.compare_scenarios(
            baseline={"name": "base", "values": {"P": 10.0}},
            candidates=[{"name": "plus10", "values": {"P": 11.0}}],
            outputs=["M"],
            formulas={"M": "P * L"},
            current_values={"L": 2.0},
        )
        self.assertEqual(result["baseline"]["outputs"]["M"], 20.0)
        self.assertAlmostEqual(
            result["comparisons"][0]["delta_vs_baseline"]["M"]["absolute"],
            2.0,
        )


if __name__ == "__main__":
    unittest.main()
