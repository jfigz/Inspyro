"""Geometry definitions with module-level inputs for impact analysis."""

from __future__ import annotations

from dataclasses import dataclass


base_width = 0.32
base_height = 0.72
web_thickness = 0.018
flange_thickness = 0.026
stiffener_spacing = 1.25
span_length = 18.0
camber_ratio = 650.0


@dataclass(frozen=True)
class Plate:
    width: float
    thickness: float
    count: int = 1

    @property
    def area(self) -> float:
        return self.width * self.thickness * self.count

    @property
    def local_inertia(self) -> float:
        return self.count * self.width * self.thickness**3 / 12.0


@dataclass(frozen=True)
class GeometryInputs:
    width: float
    height: float
    web: Plate
    flange: Plate
    stiffener_spacing: float
    span: float

    @property
    def clear_web_height(self) -> float:
        return self.height - 2.0 * self.flange.thickness

    @property
    def slenderness_seed(self) -> float:
        return self.clear_web_height / max(self.web.thickness, 1.0e-6)


def build_web_plate() -> Plate:
    web = Plate(width=base_height - 2.0 * flange_thickness, thickness=web_thickness, count=1)
    return web


def build_flange_plate() -> Plate:
    flange = Plate(width=base_width, thickness=flange_thickness, count=2)
    return flange


def build_geometry_inputs() -> GeometryInputs:
    web = build_web_plate()
    flange = build_flange_plate()
    geometry = GeometryInputs(
        width=base_width,
        height=base_height,
        web=web,
        flange=flange,
        stiffener_spacing=stiffener_spacing,
        span=span_length,
    )
    return geometry


def compute_camber(span: float = span_length) -> float:
    return span / camber_ratio


def section_depth_factor(geometry: GeometryInputs) -> float:
    clear_ratio = geometry.clear_web_height / geometry.height
    stiffener_ratio = geometry.stiffener_spacing / geometry.span
    return clear_ratio * (1.0 - stiffener_ratio)


def duplicate_name(value: float) -> float:
    """Controlled homonym: same public name as in materials."""
    return value * base_width


GEOMETRY_INPUTS = build_geometry_inputs()

