# Extreme Dependency Analyzer Demo

This package supports `demo_dependency_analyzer_extreme.ipynb`.

It is intentionally verbose and static so the analyzer can see a wide graph:
module imports, relative imports, reexports, class methods, constructors,
instance attributes, dataclass fields, properties, aliases, star imports, and a
46-stage call chain from `stage_00` to `stage_45`.

## Main Files

- `materials.py`: material constants, dataclasses, module-level `steel_fy`.
- `geometry.py`: geometric constants, module-level `base_width`, plate geometry.
- `loads.py`: `LoadCase` class with class and instance attributes, including `dead`.
- `sections.py`: `Section` and `CompositeSection` with `self` attributes and properties.
- `chain.py`: explicit transitive functions `stage_00` through `stage_45`.
- `model.py`: `BeamModel`, demand state, capacity ratios, model orchestration.
- `checks.py`: check results and `final_utilization`.
- `reporting.py`: table rows and public summaries.
- `facade.py`: deliberate aliases, star import, and reexports for consumer scanning.

## Analyzer Targets

Backward dependency targets:

- `final_utilization`
- `BeamModel.capacity_ratio`
- `Section.area`
- `stage_45`

Forward impact targets:

- `base_width`
- `steel_fy`
- `LoadCase.dead`
- `stage_00`

Expected stress behavior:

- High `max_depth` should traverse across notebook, package facade, model,
  checks, sections, materials, loads, geometry, and the long chain.
- Low `max_depth` should truncate and expose incomplete-analysis metadata.
- Homonyms exist through `duplicate_name` in `materials.py` and `geometry.py`;
  they are intentional ambiguity probes.
- The main calculation avoids dynamic imports and reflection so static analysis
  has a fair path. Any dynamic usage in the notebook is documented as an
  expected unresolved case, not part of the main graph.

