# -*- coding: utf-8 -*-
"""
Constantes globales de unidades de ingeniería.

Todas las unidades comunes se exponen como constantes de módulo para que
el usuario escriba expresiones naturales: ``F = 14.5*kN``, ``sigma = 25*MPa``.
"""

from .registry import _ureg, Q_

# ═══════════════════════════════════════════
# LONGITUD
# ═══════════════════════════════════════════
mm = _ureg.millimeter
cm = _ureg.centimeter
m = _ureg.meter
km = _ureg.kilometer
inch = _ureg.inch       # pulgada
ft = _ureg.foot         # pie

# ═══════════════════════════════════════════
# MASA
# ═══════════════════════════════════════════
g = _ureg.gram
kg = _ureg.kilogram
ton = _ureg.metric_ton   # tonelada métrica
lb = _ureg.pound         # libra

# ═══════════════════════════════════════════
# TIEMPO
# ═══════════════════════════════════════════
s = _ureg.second
minute = _ureg.minute
hr = _ureg.hour

# ═══════════════════════════════════════════
# FUERZA
# ═══════════════════════════════════════════
N = _ureg.newton
kN = _ureg.kilonewton
MN = _ureg.meganewton
lbf = _ureg.force_pound
kgf = _ureg.kilogram_force
tonf = _ureg.metric_ton_force   # 1000 kgf

# ═══════════════════════════════════════════
# PRESIÓN / ESFUERZO
# ═══════════════════════════════════════════
Pa = _ureg.pascal
kPa = _ureg.kilopascal
MPa = _ureg.megapascal
GPa = _ureg.gigapascal
bar = _ureg.bar
atm = _ureg.atmosphere
psi = _ureg.psi

# ═══════════════════════════════════════════
# ENERGÍA / TRABAJO
# ═══════════════════════════════════════════
J = _ureg.joule
kJ = _ureg.kilojoule
MJ = _ureg.megajoule
cal = _ureg.calorie
kcal = _ureg.kilocalorie
Wh = _ureg.watt_hour
kWh = _ureg.kilowatt_hour

# ═══════════════════════════════════════════
# POTENCIA
# ═══════════════════════════════════════════
W = _ureg.watt
kW = _ureg.kilowatt
MW = _ureg.megawatt
hp = _ureg.horsepower

# ═══════════════════════════════════════════
# TEMPERATURA
# ═══════════════════════════════════════════
K = _ureg.kelvin
degC = _ureg.degC           # grado Celsius
degF = _ureg.degF           # grado Fahrenheit

# ═══════════════════════════════════════════
# ÁNGULO
# ═══════════════════════════════════════════
rad = _ureg.radian
deg = _ureg.degree

# ═══════════════════════════════════════════
# VELOCIDAD (composiciones comunes)
# ═══════════════════════════════════════════
# Se crean naturalmente: 5*m/s, 120*km/hr, etc.

# ═══════════════════════════════════════════
# MOMENTO / TORQUE
# ═══════════════════════════════════════════
Nm = _ureg.newton * _ureg.meter       # newton-metro
kNm = _ureg.kilonewton * _ureg.meter

# ═══════════════════════════════════════════
# ÁREA / VOLUMEN (composiciones comunes)
# ═══════════════════════════════════════════
# Se crean naturalmente: 5*m**2, 3*cm**3, etc.

# ═══════════════════════════════════════════
# DENSIDAD, VISCOSIDAD (composiciones comunes)
# ═══════════════════════════════════════════
# Se crean naturalmente: 7850*kg/m**3, etc.

# ═══════════════════════════════════════════
# ELECTRICIDAD
# ═══════════════════════════════════════════
A = _ureg.ampere
V = _ureg.volt
ohm = _ureg.ohm
F_ = _ureg.farad    # F colisiona con variable de fuerza
Hz = _ureg.hertz

# ═══════════════════════════════════════════
# FRECUENCIA
# ═══════════════════════════════════════════
# Hz ya definido arriba
rpm = _ureg.revolution / _ureg.minute
