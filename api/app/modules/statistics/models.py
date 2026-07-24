from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StatisticsRequest(BaseModel):
    analysis: Literal[
        "descriptive",
        "regression",
        "multiple_regression",
        "ttest",
        "ztest",
        "distribution",
    ] = "descriptive"
    data: list[float] = Field(default_factory=list, min_length=0)
    x: list[float] | None = None
    y: list[float] | None = None
    # multiple regression: columns of independent vars
    X: list[list[float]] | None = None
    mu0: float = 0.0
    sigma: float | None = Field(default=None, gt=0)
    alpha: float = Field(default=0.05, gt=0, lt=1)
    # distribution calculator
    dist: Literal["normal", "binomial", "poisson", "exponential"] | None = None
    dist_params: dict[str, float] = Field(default_factory=dict)
    dist_x: float | None = None  # P(X <= x) or density point
