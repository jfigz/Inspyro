"""Model orchestration classes for the dependency stress scenario."""

from __future__ import annotations

from dataclasses import dataclass

from .chain import chain_summary, stage_45
from .loads import LoadCase, equivalent_line_load
from .materials import Material, allowable_temperature_shift
from .sections import CompositeSection, Section


@dataclass
class DemandState:
    moment: float
    shear: float
    temperature_stress: float
    chain_amplifier: float

    @property
    def combined_moment(self) -> float:
        return self.moment * self.chain_amplifier


class BeamModel:
    def __init__(self, section: Section, composite: CompositeSection, load_case: LoadCase, material: Material) -> None:
        self.section = section
        self.composite = composite
        self.load_case = load_case
        self.material = material
        self.span = 18.0
        self.line_load = equivalent_line_load(load_case, self.span)
        self.chain_value = stage_45()

    def demand_state(self) -> DemandState:
        moment = self.line_load * self.span**2 / 8.0
        shear = self.line_load * self.span / 2.0
        temperature_stress = allowable_temperature_shift(self.span, self.load_case.thermal)
        chain_amplifier = 1.0 + self.chain_value * 0.0001
        return DemandState(moment, shear, temperature_stress, chain_amplifier)

    def flexural_capacity(self) -> float:
        steel_capacity = self.section.flexural_capacity()
        composite_capacity = self.composite.composite_capacity()
        return max(steel_capacity, composite_capacity)

    def shear_capacity(self) -> float:
        return self.section.shear_capacity()

    def capacity_ratio(self) -> float:
        demand = self.demand_state()
        moment_ratio = demand.combined_moment / max(self.flexural_capacity(), 1.0e-9)
        shear_ratio = demand.shear / max(self.shear_capacity(), 1.0e-9)
        thermal_ratio = demand.temperature_stress / max(self.material.design_yield, 1.0e-9)
        return max(moment_ratio, shear_ratio, thermal_ratio)

    def dependency_audit(self) -> dict[str, float]:
        demand = self.demand_state()
        chain = chain_summary()
        return {
            "line_load": self.line_load,
            "moment": demand.moment,
            "combined_moment": demand.combined_moment,
            "capacity_ratio": self.capacity_ratio(),
            "chain_stage_25": chain["stage_25"],
            "chain_stage_45": chain["stage_45"],
        }


def build_beam_model(section: Section, composite: CompositeSection, load_case: LoadCase, material: Material) -> BeamModel:
    return BeamModel(section=section, composite=composite, load_case=load_case, material=material)

