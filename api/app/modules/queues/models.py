from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class QueuesRequest(BaseModel):
    model: Literal[
        "M/M/1",
        "M/M/s",
        "M/M/1/K",
        "M/M/s/N",
        "M/M/s/K",
        "M/G/1",
        "M/D/1",
    ]
    lambda_: float = Field(alias="lambda", gt=0)
    mu: float = Field(gt=0)
    s: int | None = Field(default=None, ge=1)
    K: int | None = Field(default=None, ge=1)
    N: int | None = Field(default=None, ge=1)
    service_std_dev: float | None = Field(
        default=None, ge=0, description="Service time std. dev. (sigma), required for M/G/1"
    )
    include_pn: bool = True

    # Optional costs and s-sweep optimization
    cost_waiting_per_unit_time: float | None = Field(default=None, ge=0)
    cost_server_per_unit_time: float | None = Field(default=None, ge=0)
    optimize_s: bool = Field(
        default=False, description="Sweep number of servers to minimize total expected cost"
    )
    s_max: int | None = Field(default=None, ge=1, description="Upper bound for the s sweep")

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _check_params(self) -> QueuesRequest:
        if self.model in ("M/M/s", "M/M/s/N", "M/M/s/K") and self.s is None:
            raise ValueError("s is required for multi-server models")
        if self.model == "M/M/1/K" and self.K is None:
            raise ValueError("K is required for M/M/1/K")
        if self.model == "M/M/s/K" and self.K is None:
            raise ValueError("K is required for M/M/s/K")
        if self.model == "M/M/s/N" and self.N is None:
            raise ValueError("N is required for M/M/s/N")
        if self.model == "M/G/1" and self.service_std_dev is None:
            raise ValueError("service_std_dev is required for M/G/1")
        return self
