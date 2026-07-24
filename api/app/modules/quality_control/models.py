from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class QualityControlRequest(BaseModel):
    chart: Literal["xbar_r", "p", "c", "u"]
    samples: list[list[float]] | None = None  # xbar_r: each subgroup measurements
    defectives: list[int] | None = None  # p-chart
    sample_sizes: list[int] | None = None
    counts: list[int] | None = None  # c or u
    inspection_units: list[float] | None = None  # u-chart
    # Process capability (optional, for xbar_r)
    USL: float | None = None
    LSL: float | None = None
    sigma_level: float = Field(default=3.0, gt=0)
