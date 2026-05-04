"""
Type stubs for inspyro_units.

These stubs expose engineering unit globals injected at runtime in Inspyro
notebooks so Monaco + pylsp can provide completion and hover information.
"""

from typing import Any

from pint import Quantity, Unit, UnitRegistry


def get_registry() -> UnitRegistry: ...
def Q_(magnitude: Any, unit: Unit | str) -> Quantity: ...


# Length
mm: Unit
"""Millimeter (mm) - 0.001 meters."""
cm: Unit
"""Centimeter (cm) - 0.01 meters."""
m: Unit
"""Meter (m) - SI base unit of length."""
km: Unit
"""Kilometer (km) - 1000 meters."""
inch: Unit
"""Inch (in) - imperial unit of length."""
ft: Unit
"""Foot (ft) - imperial unit of length."""

# Mass
g: Unit
"""Gram (g) - 0.001 kilograms."""
kg: Unit
"""Kilogram (kg) - SI base unit of mass."""
ton: Unit
"""Metric ton (t) - 1000 kilograms."""
lb: Unit
"""Pound (lb) - imperial unit of mass."""

# Time
s: Unit
"""Second (s) - SI base unit of time."""
minute: Unit
"""Minute (min) - 60 seconds."""
hr: Unit
"""Hour (h) - 3600 seconds."""

# Force
N: Unit
"""Newton (N) - SI unit of force."""
kN: Unit
"""Kilonewton (kN) - 1000 newtons."""
MN: Unit
"""Meganewton (MN) - one million newtons."""
lbf: Unit
"""Pound-force (lbf)."""
kgf: Unit
"""Kilogram-force (kgf)."""
tonf: Unit
"""Metric ton-force (tonf)."""

# Pressure / Stress
Pa: Unit
"""Pascal (Pa) - SI unit of pressure."""
kPa: Unit
"""Kilopascal (kPa) - 1000 pascals."""
MPa: Unit
"""Megapascal (MPa) - one million pascals."""
GPa: Unit
"""Gigapascal (GPa) - one billion pascals."""
bar: Unit
"""Bar - 100 kilopascals."""
atm: Unit
"""Standard atmosphere."""
psi: Unit
"""Pound per square inch (psi)."""

# Energy / Work
J: Unit
"""Joule (J) - SI unit of energy."""
kJ: Unit
"""Kilojoule (kJ) - 1000 joules."""
MJ: Unit
"""Megajoule (MJ) - one million joules."""
cal: Unit
"""Calorie (cal)."""
kcal: Unit
"""Kilocalorie (kcal)."""
Wh: Unit
"""Watt-hour (Wh)."""
kWh: Unit
"""Kilowatt-hour (kWh)."""

# Power
W: Unit
"""Watt (W) - SI unit of power."""
kW: Unit
"""Kilowatt (kW) - 1000 watts."""
MW: Unit
"""Megawatt (MW) - one million watts."""
hp: Unit
"""Horsepower (hp)."""

# Temperature
K: Unit
"""Kelvin (K) - SI base unit of temperature."""
degC: Unit
"""Degree Celsius (degC)."""
degF: Unit
"""Degree Fahrenheit (degF)."""

# Angle
rad: Unit
"""Radian (rad) - SI unit of plane angle."""
deg: Unit
"""Degree (deg) - 1/360 turn."""

# Torque
Nm: Unit
"""Newton-meter (N*m)."""
kNm: Unit
"""Kilonewton-meter (kN*m)."""

# Electricity / Frequency
A: Unit
"""Ampere (A) - SI base unit of electric current."""
V: Unit
"""Volt (V)."""
ohm: Unit
"""Ohm."""
F_: Unit
"""Farad (F)."""
Hz: Unit
"""Hertz (Hz)."""
rpm: Unit
"""Revolutions per minute."""


def serialize_quantity(q: Quantity) -> dict[str, Any]: ...

def normalize_unit_expression(raw_unit: str) -> str: ...
def validate_unit_expression(raw_unit: str) -> tuple[bool, str]: ...
def get_unit_identity(unit: Any) -> dict[str, Any]: ...
def get_unit_aliases(unit: Any) -> list[str]: ...
def get_units_catalog() -> list[dict[str, Any]]: ...
def get_compatible_units(unit: Any) -> dict[str, Any]: ...
def format_unit_for_style(unit: Any, style: str = "engineering") -> str: ...

def format_quantity_latex(q: Quantity) -> str: ...
def format_quantity_unicode(q: Quantity) -> str: ...
def format_quantity_html(q: Quantity) -> str: ...
def format_quantity_docx(q: Quantity) -> dict[str, Any]: ...

UNIT_METADATA: dict[str, dict[str, Any]]
def get_metadata_for_unit(unit: Any) -> dict[str, Any] | None: ...
def get_category_for_unit(unit: Any) -> str: ...

class UncertainQuantity:
    value: float
    sigma: float
    unit: str
    def to(self, to_unit: str) -> "UncertainQuantity": ...

def quantity_with_uncertainty(value: float, sigma: float, unit: str) -> UncertainQuantity: ...
def assert_dimensionally_compatible(lhs: Any, rhs: Any, *, context: str = "") -> None: ...
def assert_dimension(unit_or_quantity: Any, expected_unit: str, *, context: str = "") -> None: ...

def is_quantity(obj: Any) -> bool: ...
