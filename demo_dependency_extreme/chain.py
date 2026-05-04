"""Long static call chain for max-depth and transitive dependency testing."""

from __future__ import annotations

from .geometry import base_width, compute_camber
from .materials import steel_fy


chain_seed = base_width * steel_fy + compute_camber()
stage_alias_factor = 1.003


def _blend(value: float, index: int) -> float:
    width_term = base_width * (1.0 + index * 0.001)
    strength_term = steel_fy / (900.0 + index)
    return value * (1.0 + width_term * 0.01) + strength_term


def stage_00(seed: float = chain_seed) -> float:
    return _blend(seed, 0)


def stage_01(seed: float = chain_seed) -> float:
    return _blend(stage_00(seed), 1)


def stage_02(seed: float = chain_seed) -> float:
    return _blend(stage_01(seed), 2)


def stage_03(seed: float = chain_seed) -> float:
    return _blend(stage_02(seed), 3)


def stage_04(seed: float = chain_seed) -> float:
    return _blend(stage_03(seed), 4)


def stage_05(seed: float = chain_seed) -> float:
    return _blend(stage_04(seed), 5)


def stage_06(seed: float = chain_seed) -> float:
    return _blend(stage_05(seed), 6)


def stage_07(seed: float = chain_seed) -> float:
    return _blend(stage_06(seed), 7)


def stage_08(seed: float = chain_seed) -> float:
    return _blend(stage_07(seed), 8)


def stage_09(seed: float = chain_seed) -> float:
    return _blend(stage_08(seed), 9)


def stage_10(seed: float = chain_seed) -> float:
    return _blend(stage_09(seed), 10)


def stage_11(seed: float = chain_seed) -> float:
    return _blend(stage_10(seed), 11)


def stage_12(seed: float = chain_seed) -> float:
    return _blend(stage_11(seed), 12)


def stage_13(seed: float = chain_seed) -> float:
    return _blend(stage_12(seed), 13)


def stage_14(seed: float = chain_seed) -> float:
    return _blend(stage_13(seed), 14)


def stage_15(seed: float = chain_seed) -> float:
    return _blend(stage_14(seed), 15)


def stage_16(seed: float = chain_seed) -> float:
    return _blend(stage_15(seed), 16)


def stage_17(seed: float = chain_seed) -> float:
    return _blend(stage_16(seed), 17)


def stage_18(seed: float = chain_seed) -> float:
    return _blend(stage_17(seed), 18)


def stage_19(seed: float = chain_seed) -> float:
    return _blend(stage_18(seed), 19)


def stage_20(seed: float = chain_seed) -> float:
    return _blend(stage_19(seed), 20)


def stage_21(seed: float = chain_seed) -> float:
    return _blend(stage_20(seed), 21)


def stage_22(seed: float = chain_seed) -> float:
    return _blend(stage_21(seed), 22)


def stage_23(seed: float = chain_seed) -> float:
    return _blend(stage_22(seed), 23)


def stage_24(seed: float = chain_seed) -> float:
    return _blend(stage_23(seed), 24)


def stage_25(seed: float = chain_seed) -> float:
    return _blend(stage_24(seed), 25)


def stage_26(seed: float = chain_seed) -> float:
    return _blend(stage_25(seed), 26)


def stage_27(seed: float = chain_seed) -> float:
    return _blend(stage_26(seed), 27)


def stage_28(seed: float = chain_seed) -> float:
    return _blend(stage_27(seed), 28)


def stage_29(seed: float = chain_seed) -> float:
    return _blend(stage_28(seed), 29)


def stage_30(seed: float = chain_seed) -> float:
    return _blend(stage_29(seed), 30)


def stage_31(seed: float = chain_seed) -> float:
    return _blend(stage_30(seed), 31)


def stage_32(seed: float = chain_seed) -> float:
    return _blend(stage_31(seed), 32)


def stage_33(seed: float = chain_seed) -> float:
    return _blend(stage_32(seed), 33)


def stage_34(seed: float = chain_seed) -> float:
    return _blend(stage_33(seed), 34)


def stage_35(seed: float = chain_seed) -> float:
    return _blend(stage_34(seed), 35)


def stage_36(seed: float = chain_seed) -> float:
    return _blend(stage_35(seed), 36)


def stage_37(seed: float = chain_seed) -> float:
    return _blend(stage_36(seed), 37)


def stage_38(seed: float = chain_seed) -> float:
    return _blend(stage_37(seed), 38)


def stage_39(seed: float = chain_seed) -> float:
    return _blend(stage_38(seed), 39)


def stage_40(seed: float = chain_seed) -> float:
    return _blend(stage_39(seed), 40)


def stage_41(seed: float = chain_seed) -> float:
    return _blend(stage_40(seed), 41)


def stage_42(seed: float = chain_seed) -> float:
    return _blend(stage_41(seed), 42)


def stage_43(seed: float = chain_seed) -> float:
    return _blend(stage_42(seed), 43)


def stage_44(seed: float = chain_seed) -> float:
    return _blend(stage_43(seed), 44)


def stage_45(seed: float = chain_seed) -> float:
    return _blend(stage_44(seed), 45) * stage_alias_factor


ultimate_stage = stage_45


def chain_summary(seed: float = chain_seed) -> dict[str, float]:
    early = stage_05(seed)
    middle = stage_25(seed)
    final = ultimate_stage(seed)
    return {"stage_05": early, "stage_25": middle, "stage_45": final}

