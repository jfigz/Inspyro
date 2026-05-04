from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "stress_ws_mix.py"
    spec = importlib.util.spec_from_file_location("stress_ws_mix", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_operation_sequence_covers_all_ops():
    module = _load_module()
    seq = module.build_operation_sequence(12)
    assert len(seq) == 12
    assert set(module.OPS).issubset(set(seq))


def test_percentile_interpolation():
    module = _load_module()
    values = [10.0, 20.0, 30.0, 40.0]
    assert module.percentile(values, 0) == 10.0
    assert module.percentile(values, 100) == 40.0
    p50 = module.percentile(values, 50)
    assert p50 == 25.0


def test_summarize_events_shapes_stats():
    module = _load_module()
    events = [
        module.Event(op="notebook_execute_cell", latency_ms=100.0, ok=True, response_type="notebook_cell_executed"),
        module.Event(op="notebook_execute_cell", latency_ms=200.0, ok=False, response_type="notebook_cell_error"),
        module.Event(op="template_preview_style", latency_ms=80.0, ok=True, response_type="template_preview_ready"),
    ]

    report = module.summarize_events(events)
    assert report["totals"]["events"] == 3
    assert report["totals"]["ok"] == 2
    assert report["totals"]["errors"] == 1
    assert report["operations"]["notebook_execute_cell"]["count"] == 2
    assert report["operations"]["template_preview_style"]["p50_ms"] == 80.0
