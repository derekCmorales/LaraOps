from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AcceptanceSamplingRequest(BaseModel):
    plan: Literal["attributes_single", "design"] = "attributes_single"
    N: int = Field(gt=0, description="Lot size")
    n: int | None = Field(default=None, gt=0, description="Sample size")
    c: int | None = Field(default=None, ge=0, description="Acceptance number")
    # Design from AQL/LTPD
    AQL: float | None = Field(default=None, gt=0, lt=1)
    LTPD: float | None = Field(default=None, gt=0, lt=1)
    producer_risk: float = Field(default=0.05, gt=0, lt=1)  # alpha
    consumer_risk: float = Field(default=0.10, gt=0, lt=1)  # beta
    # Incoming quality levels for OC / AOQ curves
    p_points: list[float] | None = None
    p_max: float = Field(default=0.2, gt=0, le=1)
    n_curve: int = Field(default=25, ge=5, le=100)

    @model_validator(mode="after")
    def _check(self) -> AcceptanceSamplingRequest:
        if self.plan == "attributes_single":
            if self.n is None or self.c is None:
                raise ValueError("attributes_single requires n and c")
        if self.plan == "design":
            if self.AQL is None or self.LTPD is None:
                raise ValueError("design requires AQL and LTPD")
            if self.LTPD <= self.AQL:
                raise ValueError("LTPD must be greater than AQL")
        return self
