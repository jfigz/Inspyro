from __future__ import annotations


def factored_uniform_load(dead_load_kN_m: float, live_load_kN_m: float) -> float:
    return 1.2 * dead_load_kN_m + 1.6 * live_load_kN_m


def max_moment_kNm(load_kN_m: float, span_m: float) -> float:
    return load_kN_m * span_m**2 / 8.0


def flexural_capacity_kNm(steel_yield_MPa: float, section_modulus_cm3: float) -> float:
    return steel_yield_MPa * section_modulus_cm3 / 1000.0


def demand_capacity_ratio(demand_kNm: float, capacity_kNm: float) -> float:
    if capacity_kNm <= 0:
        raise ValueError("capacity_kNm must be positive")
    return demand_kNm / capacity_kNm
