from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class QuadraticProgrammingRequest(BaseModel):
    """Minimize 0.5 x'Qx + c'x  s.t. Ax <= b, bounds."""

    sense: Literal["min", "max"] = "min"
    Q: list[list[float]]  # symmetric Hessian
    c: list[float]
    A_ub: list[list[float]] | None = None
    b_ub: list[float] | None = None
    bounds: list[tuple[float | None, float | None]] | None = None
    variable_names: list[str] | None = None
    include_graph: bool = False
