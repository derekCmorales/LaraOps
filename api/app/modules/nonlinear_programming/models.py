from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class NonlinearProgrammingRequest(BaseModel):
    """Minimize/maximize f(x) with optional bounds. f given as polynomial coeffs for demo,
    or use built-in test functions."""

    sense: Literal["min", "max"] = "min"
    # Simple: f(x) = sum a_i * x_i^2 + b_i * x_i + cross terms optional
    quadratic_diag: list[float] = Field(description="coefficients of x_i^2")
    linear: list[float] = Field(description="coefficients of x_i")
    x0: list[float]
    bounds: list[tuple[float | None, float | None]] | None = None
    A_ub: list[list[float]] | None = None
    b_ub: list[float] | None = None
    variable_names: list[str] | None = None
