from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ConstraintSense(str, Enum):
    le = "<="
    ge = ">="
    eq = "="


class LPConstraint(BaseModel):
    id: str
    coeffs: dict[str, float]  # var_name -> a_ij
    sense: ConstraintSense
    rhs: float


class LPRequest(BaseModel):
    sense: Literal["min", "max"]
    objective: dict[str, float]  # var_name -> c_j
    constraints: list[LPConstraint]
    variable_names: list[str] | None = None  # optional order; else sorted keys
    bounds: dict[str, tuple[float | None, float | None]] | None = None
    # default bounds: (0, None) for all vars appearing in objective/constraints
    include_iterations: bool = True
    include_sensitivity: bool = True
    include_graph: bool = True
