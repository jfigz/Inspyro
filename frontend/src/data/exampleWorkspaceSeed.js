export const EXAMPLE_WORKSPACE_NAME = 'inspyro-structural-report-demo';
export const EXAMPLE_WORKSPACE_PRIMARY_NOTEBOOK = 'beam_report.ipynb';

const exampleNotebook = {
  cells: [
    {
      cell_type: 'markdown',
      id: 'intro',
      metadata: {},
      source: '# Structural Report Demo\n\nThis example shows how Inspyro can work as an AI-native engineering workspace.\n\nRun the notebook, inspect the calculations, and open the generated document artifact.',
    },
    {
      cell_type: 'markdown',
      id: 'steps',
      metadata: {},
      source: '## Suggested flow\n\n1. Review `inputs/beam_case.json`\n2. Inspect `beam_design.py`\n3. Run all cells\n4. Open the `Document` view',
    },
    {
      cell_type: 'code',
      execution_count: null,
      id: 'load-inputs',
      metadata: {},
      outputs: [],
      source: 'import json\nfrom pathlib import Path\n\nimport matplotlib.pyplot as plt\nimport pandas as pd\n\nfrom beam_design import (\n    build_diagram_points,\n    build_result_table,\n    compute_beam_response,\n)\n\nproject_root = Path.cwd()\ninputs_path = project_root / "inputs" / "beam_case.json"\ninputs = json.loads(inputs_path.read_text(encoding="utf-8"))\n\ninputs',
    },
    {
      cell_type: 'code',
      execution_count: null,
      id: 'run-checks',
      metadata: {},
      outputs: [],
      source: 'results = compute_beam_response(inputs)\nsummary_df = build_result_table(inputs, results)\nsummary_df',
    },
    {
      cell_type: 'code',
      execution_count: null,
      id: 'plot-response',
      metadata: {},
      outputs: [],
      source: 'x_values, shear_values, moment_values = build_diagram_points(inputs, samples=33)\n\nfig, axes = plt.subplots(2, 1, figsize=(8, 5), sharex=True)\naxes[0].plot(x_values, shear_values, color="#2563eb", linewidth=2)\naxes[0].set_ylabel("Shear (kN)")\naxes[0].grid(True, alpha=0.3)\n\naxes[1].plot(x_values, moment_values, color="#d97706", linewidth=2)\naxes[1].set_ylabel("Moment (kN m)")\naxes[1].set_xlabel("Span position (m)")\naxes[1].grid(True, alpha=0.3)\n\nfig.suptitle("Simply supported beam response")\nfig.tight_layout()\nfig',
    },
    {
      cell_type: 'code',
      execution_count: null,
      id: 'build-report',
      metadata: {},
      outputs: [],
      source: 'doc_reset(hard=True)\n\nwith build_doc(block_id="cover", order=10) as builder:\n    builder.metadata(\n        title="Structural report demo",\n        subject="AI-native engineering workspace example",\n        keywords=["inspyro", "structural", "report", "agent"],\n    )\n    builder.heading("Structural Report Demo", level=1)\n    builder.text("AI-native engineering workspace for calculations, notebooks and report generation.")\n    builder.text("Agents can inspect a project, edit notebooks, run calculations and deliver DOCX/PDF reports.")\n    builder.text(f"Project: {inputs[\'project_name\']}")\n    builder.page_break()\n\nwith build_doc(block_id="inputs", order=20) as builder:\n    builder.heading("Input data", level=2)\n    builder.table(\n        [\n            ["Span", f"{inputs[\'span_m\']:.2f} m"],\n            ["Uniform load", f"{inputs[\'uniform_load_kn_m\']:.2f} kN/m"],\n            ["Elastic modulus", f"{inputs[\'elastic_modulus_mpa\']:.0f} MPa"],\n            ["Moment of inertia", f"{inputs[\'moment_inertia_cm4\']:.0f} cm^4"],\n            ["Section modulus", f"{inputs[\'section_modulus_cm3\']:.0f} cm^3"],\n            ["Allowable stress", f"{inputs[\'allowable_stress_mpa\']:.1f} MPa"],\n        ],\n        headers=["Parameter", "Value"],\n        caption="Beam model used in the demo",\n        label="tbl:beam-inputs",\n    )\n\nwith build_doc(block_id="checks", order=30) as builder:\n    builder.heading("Main checks", level=2)\n    builder.math_latex(r"M_{max} = \\\\frac{wL^2}{8}", label="eq:mmax", number=True)\n    builder.math_latex(r"V_{max} = \\\\frac{wL}{2}", label="eq:vmax", number=True)\n    builder.math_latex(r"\\\\delta_{max} = \\\\frac{5 w L^4}{384 E I}", label="eq:dmax", number=True)\n    builder.dataframe(\n        summary_df,\n        index=False,\n        caption="Demand and acceptance ratios",\n        label="tbl:beam-results",\n    )\n\nwith build_doc(block_id="figure", order=40) as builder:\n    builder.heading("Response diagrams", level=2)\n    builder.figure(\n        fig,\n        caption="Shear and moment response along the span",\n        label="fig:beam-response",\n        width=6.5,\n    )\n\nprint("Example report updated. Open the Document view to inspect the DOCX/PDF artifact.")',
    },
  ],
  metadata: {
    kernelspec: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      name: 'python',
      version: '3.12',
    },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

const exampleFiles = [
  {
    path: 'README.md',
    content: `# Structural Report Demo

This is the canonical Inspyro demo workspace for the open source launch.

It is intentionally small, but it shows the full story:

1. inspect a real workspace
2. review engineering inputs
3. run a notebook
4. generate a DOCX/PDF report
5. repeat the same flow from an external agent through MCP

## Workspace Contents

- beam_report.ipynb: notebook that loads inputs, runs the beam checks, plots diagrams, and generates the report artifact
- beam_design.py: small engineering helper module with reusable beam formulas
- inputs/beam_case.json: project data used by the notebook
`,
  },
  {
    path: 'beam_design.py',
    content: `from __future__ import annotations

from typing import Dict, Tuple

import pandas as pd


def compute_beam_response(inputs: Dict[str, float]) -> Dict[str, float]:
    span_m = float(inputs["span_m"])
    uniform_load_kn_m = float(inputs["uniform_load_kn_m"])
    elastic_modulus_mpa = float(inputs["elastic_modulus_mpa"])
    moment_inertia_cm4 = float(inputs["moment_inertia_cm4"])
    section_modulus_cm3 = float(inputs["section_modulus_cm3"])
    allowable_stress_mpa = float(inputs["allowable_stress_mpa"])

    max_shear_kn = uniform_load_kn_m * span_m / 2.0
    max_moment_kn_m = uniform_load_kn_m * span_m ** 2 / 8.0

    load_n_per_mm = uniform_load_kn_m
    span_mm = span_m * 1000.0
    inertia_mm4 = moment_inertia_cm4 * 10_000.0
    section_modulus_mm3 = section_modulus_cm3 * 1_000.0

    max_deflection_mm = (
        5.0 * load_n_per_mm * span_mm ** 4 / (384.0 * elastic_modulus_mpa * inertia_mm4)
    )
    max_moment_n_mm = max_moment_kn_m * 1_000_000.0
    bending_stress_mpa = max_moment_n_mm / section_modulus_mm3
    stress_ratio = bending_stress_mpa / allowable_stress_mpa

    return {
        "max_shear_kn": max_shear_kn,
        "max_moment_kn_m": max_moment_kn_m,
        "max_deflection_mm": max_deflection_mm,
        "bending_stress_mpa": bending_stress_mpa,
        "allowable_stress_mpa": allowable_stress_mpa,
        "stress_ratio": stress_ratio,
    }


def build_result_table(inputs: Dict[str, float], results: Dict[str, float]) -> pd.DataFrame:
    allowable_deflection_mm = float(inputs["span_m"]) * 1000.0 / 360.0

    rows = [
        {
            "metric": "Maximum shear",
            "value": results["max_shear_kn"],
            "unit": "kN",
            "limit": None,
            "ratio": None,
        },
        {
            "metric": "Maximum moment",
            "value": results["max_moment_kn_m"],
            "unit": "kN m",
            "limit": None,
            "ratio": None,
        },
        {
            "metric": "Maximum deflection",
            "value": results["max_deflection_mm"],
            "unit": "mm",
            "limit": allowable_deflection_mm,
            "ratio": results["max_deflection_mm"] / allowable_deflection_mm,
        },
        {
            "metric": "Bending stress",
            "value": results["bending_stress_mpa"],
            "unit": "MPa",
            "limit": results["allowable_stress_mpa"],
            "ratio": results["stress_ratio"],
        },
    ]
    return pd.DataFrame(rows)


def build_diagram_points(inputs: Dict[str, float], samples: int = 33) -> Tuple[list[float], list[float], list[float]]:
    span_m = float(inputs["span_m"])
    uniform_load_kn_m = float(inputs["uniform_load_kn_m"])
    sample_count = max(3, int(samples))
    step = span_m / (sample_count - 1)

    x_values = [index * step for index in range(sample_count)]
    shear_values = [uniform_load_kn_m * (span_m / 2.0 - x) for x in x_values]
    moment_values = [uniform_load_kn_m * x * (span_m - x) / 2.0 for x in x_values]
    return x_values, shear_values, moment_values
`,
  },
  {
    path: 'inputs/beam_case.json',
    content: `{
  "project_name": "Demo Simply Supported Beam",
  "span_m": 7.2,
  "uniform_load_kn_m": 18.5,
  "elastic_modulus_mpa": 200000.0,
  "moment_inertia_cm4": 84500.0,
  "section_modulus_cm3": 2350.0,
  "allowable_stress_mpa": 165.0
}
`,
  },
  {
    path: EXAMPLE_WORKSPACE_PRIMARY_NOTEBOOK,
    content: JSON.stringify(exampleNotebook, null, 2),
  },
];

export const createExampleWorkspaceFiles = () => exampleFiles.map((entry) => ({
  ...entry,
}));
