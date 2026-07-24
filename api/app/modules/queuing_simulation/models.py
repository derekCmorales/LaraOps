from __future__ import annotations

from pydantic import BaseModel, Field


class QueuingSimulationRequest(BaseModel):
    arrival_rate: float = Field(gt=0, description="λ (Poisson / exponential interarrival)")
    service_rate: float = Field(gt=0, description="μ per server")
    num_servers: int = Field(default=1, ge=1)
    simulation_time: float = Field(default=1000.0, gt=0)
    warmup: float = Field(default=0.0, ge=0)
    seed: int = Field(default=42)
    capacity: int | None = Field(default=None, ge=1, description="System capacity K (optional)")
