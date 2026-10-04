from pydantic import BaseModel, Field


class EOQRequest(BaseModel):
    D: float = Field(gt=0)
    S: float = Field(gt=0)
    H: float = Field(gt=0)
    C: float = Field(default=0, ge=0)
    lead_time: float = Field(default=0, ge=0, description="Tiempo de entrega en días")
    working_days: float = Field(default=365, gt=0, le=366, description="Días de operación por año")
    graph_points: int = Field(default=40, ge=5, le=200)
