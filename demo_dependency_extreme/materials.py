"""Material definitions used by the extreme dependency demo."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable


steel_fy = 355.0
steel_fu = 510.0
steel_E = 200_000.0
gamma_m0 = 1.05
gamma_m1 = 1.15
density_steel = 78.5
thermal_alpha = 1.2e-5


@dataclass(frozen=True)
class Material:
    name: str
    elastic_modulus: float
    yield_strength: float
    ultimate_strength: float
    density: float
    gamma_resistance: float

    @property
    def design_yield(self) -> float:
        return self.yield_strength / self.gamma_resistance

    @property
    def ductility_index(self) -> float:
        return self.ultimate_strength / self.yield_strength

    def stress_ratio(self, stress: float) -> float:
        return stress / self.design_yield


@dataclass(frozen=True)
class MaterialLibrary:
    primary: Material
    backup: Material
    aliases: Dict[str, Material]

    def get(self, key: str) -> Material:
        return self.aliases.get(key, self.primary)

    def governing_yield(self, keys: Iterable[str]) -> float:
        selected = [self.get(key).design_yield for key in keys]
        return min(selected)


def normalize_strength(value: float, unit_factor: float = 1.0) -> float:
    normalized = value * unit_factor
    return normalized


def derive_design_strength(yield_strength: float, gamma: float) -> float:
    normalized_yield = normalize_strength(yield_strength)
    design_strength = normalized_yield / gamma
    return design_strength


def build_primary_material() -> Material:
    design_anchor = derive_design_strength(steel_fy, gamma_m0)
    adjusted_ultimate = max(steel_fu, design_anchor * 1.35)
    material = Material(
        name="S355",
        elastic_modulus=steel_E,
        yield_strength=steel_fy,
        ultimate_strength=adjusted_ultimate,
        density=density_steel,
        gamma_resistance=gamma_m0,
    )
    return material


def build_backup_material() -> Material:
    backup_fy = steel_fy * 0.93
    backup_fu = steel_fu * 0.95
    material = Material(
        name="S355_backup",
        elastic_modulus=steel_E * 0.985,
        yield_strength=backup_fy,
        ultimate_strength=backup_fu,
        density=density_steel,
        gamma_resistance=gamma_m1,
    )
    return material


def build_material_library() -> MaterialLibrary:
    primary = build_primary_material()
    backup = build_backup_material()
    aliases = {
        "primary": primary,
        "web": primary,
        "flange": primary,
        "fallback": backup,
    }
    library = MaterialLibrary(primary=primary, backup=backup, aliases=aliases)
    return library


def material_strength_chain(library: MaterialLibrary, width_factor: float) -> float:
    base_strength = library.governing_yield(["web", "flange"])
    ductility_boost = library.primary.ductility_index * 0.015
    width_adjustment = 1.0 + width_factor * 0.002
    return base_strength * width_adjustment * (1.0 + ductility_boost)


def allowable_temperature_shift(length_m: float, delta_t: float) -> float:
    strain = thermal_alpha * delta_t
    stress = strain * steel_E
    return stress / max(length_m, 1.0)


def duplicate_name(value: float) -> float:
    """Controlled homonym: a function with the same name exists in geometry."""
    return value + steel_fy * 0.001


PRIMARY_MATERIAL = build_primary_material()
MATERIAL_LIBRARY = build_material_library()

