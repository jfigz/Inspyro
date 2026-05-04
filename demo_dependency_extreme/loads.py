"""Load definitions for the dependency stress scenario."""

from __future__ import annotations

from dataclasses import dataclass

from .geometry import span_length


dead_load_intensity = 42.0
live_load_intensity = 28.0
wind_load_intensity = 6.5
thermal_gradient = 18.0
dynamic_allowance = 1.18


class LoadCase:
    dead = 0.0
    live = 0.0
    wind = 0.0
    thermal = 0.0

    def __init__(self, dead: float, live: float, wind: float, thermal: float) -> None:
        self.dead = dead
        self.live = live
        self.wind = wind
        self.thermal = thermal

    @property
    def service_total(self) -> float:
        return self.dead + self.live + self.wind + self.thermal

    def factored_total(self, dead_factor: float, live_factor: float, wind_factor: float) -> float:
        factored_dead = self.dead * dead_factor
        factored_live = self.live * live_factor
        factored_wind = self.wind * wind_factor
        return factored_dead + factored_live + factored_wind + self.thermal


@dataclass(frozen=True)
class LoadCombination:
    name: str
    dead_factor: float
    live_factor: float
    wind_factor: float

    def apply(self, load_case: LoadCase) -> float:
        return load_case.factored_total(self.dead_factor, self.live_factor, self.wind_factor)


def build_load_case(span: float = span_length) -> LoadCase:
    dead = dead_load_intensity * span
    live = live_load_intensity * span * dynamic_allowance
    wind = wind_load_intensity * span
    thermal = thermal_gradient * 0.12
    return LoadCase(dead=dead, live=live, wind=wind, thermal=thermal)


def strength_combination() -> LoadCombination:
    return LoadCombination(name="ULS-1", dead_factor=1.25, live_factor=1.50, wind_factor=0.80)


def service_combination() -> LoadCombination:
    return LoadCombination(name="SLS-1", dead_factor=1.00, live_factor=1.00, wind_factor=0.60)


def envelope_load(load_case: LoadCase) -> float:
    uls = strength_combination().apply(load_case)
    sls = service_combination().apply(load_case) * 1.08
    return max(uls, sls)


def equivalent_line_load(load_case: LoadCase, span: float = span_length) -> float:
    envelope = envelope_load(load_case)
    return envelope / max(span, 1.0)


BASE_LOAD_CASE = build_load_case()

