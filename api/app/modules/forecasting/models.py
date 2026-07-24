from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ForecastMethod = Literal[
    "naive",
    "moving_average",
    "exponential",
    "holt",
    "holt_winters_additive",
    "holt_winters_multiplicative",
    "linear_trend",
]


class ForecastingRequest(BaseModel):
    series: list[float] = Field(min_length=2)
    period_labels: list[str] | None = None
    methods: list[ForecastMethod] = Field(
        default_factory=lambda: ["naive", "moving_average", "exponential"]
    )
    window: int = Field(default=3, ge=1)
    alpha: float = Field(default=0.3, gt=0, lt=1)
    beta: float = Field(default=0.2, gt=0, lt=1, description="Trend smoothing (Holt / Winters)")
    gamma: float = Field(
        default=0.2, gt=0, lt=1, description="Seasonal smoothing (Holt-Winters)"
    )
    seasonality: int = Field(
        default=4, ge=2, description="Seasonal period length (e.g. 4 quarterly, 12 monthly)"
    )
    horizon: int = Field(default=1, ge=1, le=24)
    optimize_alpha: bool = Field(
        default=False,
        description="Grid-search alpha in (0,1) to minimize MSE for exponential / Holt / Winters",
    )

    @model_validator(mode="after")
    def _check(self) -> ForecastingRequest:
        if self.period_labels is not None and len(self.period_labels) != len(self.series):
            raise ValueError("period_labels length must match series length")
        winter = {"holt_winters_additive", "holt_winters_multiplicative"}
        if winter & set(self.methods) and len(self.series) < 2 * self.seasonality:
            raise ValueError(
                f"Holt-Winters needs at least 2 full seasons "
                f"({2 * self.seasonality} points); got {len(self.series)}"
            )
        return self
