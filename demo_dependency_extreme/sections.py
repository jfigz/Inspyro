"""Section classes used to test constructors, methods, and self attributes."""

from __future__ import annotations

from dataclasses import dataclass

from .geometry import GeometryInputs, Plate, build_geometry_inputs, section_depth_factor
from .materials import Material, material_strength_chain


@dataclass
class Section:
    width: float
    height: float
    web: Plate
    flange: Plate
    material: Material

    def __post_init__(self) -> None:
        self.web_area = self.web.area
        self.flange_area = self.flange.area
        self.gross_area = self.web_area + self.flange_area
        self.centroid = self.height / 2.0

    @property
    def area(self) -> float:
        return self.gross_area

    @property
    def inertia(self) -> float:
        web_inertia = self.web.thickness * self.web.width**3 / 12.0
        flange_offset = (self.height - self.flange.thickness) / 2.0
        flange_inertia = self.flange.local_inertia + self.flange.area * flange_offset**2
        return web_inertia + flange_inertia

    @property
    def section_modulus(self) -> float:
        return self.inertia / max(self.height / 2.0, 1.0e-9)

    def plastic_modulus(self) -> float:
        flange_term = self.flange.area * (self.height - self.flange.thickness) / 2.0
        web_term = self.web.area * self.web.width / 4.0
        return flange_term + web_term

    def flexural_capacity(self) -> float:
        return self.material.design_yield * self.plastic_modulus() * 2_000.0

    def shear_capacity(self) -> float:
        shear_area = self.web.area
        return 0.58 * self.material.design_yield * shear_area * 2_000.0

    def area_chain_probe(self) -> float:
        area = self.area
        inertia = self.inertia
        return area + inertia * 0.001


class CompositeSection(Section):
    def __init__(
        self,
        geometry: GeometryInputs,
        material: Material,
        slab_width: float,
        slab_thickness: float,
    ) -> None:
        super().__init__(
            width=geometry.width,
            height=geometry.height,
            web=geometry.web,
            flange=geometry.flange,
            material=material,
        )
        self.geometry = geometry
        self.slab_width = slab_width
        self.slab_thickness = slab_thickness
        self.composite_area = self.area + self.slab_width * self.slab_thickness

    @property
    def transformed_area(self) -> float:
        modular_ratio = self.material.elastic_modulus / 30_000.0
        return self.area + self.slab_width * self.slab_thickness * modular_ratio

    def composite_capacity(self) -> float:
        depth_factor = section_depth_factor(self.geometry)
        steel_capacity = self.flexural_capacity()
        slab_bonus = self.transformed_area * self.material.design_yield * 0.015
        return (steel_capacity + slab_bonus) * depth_factor


def build_section(material: Material) -> Section:
    geometry = build_geometry_inputs()
    return Section(
        width=geometry.width,
        height=geometry.height,
        web=geometry.web,
        flange=geometry.flange,
        material=material,
    )


def build_composite_section(material: Material) -> CompositeSection:
    geometry = build_geometry_inputs()
    slab_width = geometry.width * 2.8
    slab_thickness = geometry.flange.thickness * 4.0
    return CompositeSection(geometry, material, slab_width, slab_thickness)


def section_strength_index(section: Section, width_factor: float) -> float:
    chain_strength = material_strength_chain.__call__  # alias-like callable usage
    synthetic_library = type("SyntheticLibrary", (), {"governing_yield": lambda self, keys: section.material.design_yield, "primary": section.material})()
    strength = chain_strength(synthetic_library, width_factor)
    capacity = section.flexural_capacity()
    return capacity * strength / max(section.area, 1.0e-9)
