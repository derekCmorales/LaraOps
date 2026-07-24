from pydantic import BaseModel, Field


class EOQRequest(BaseModel):
    D: float = Field(gt=0)
    S: float = Field(gt=0)
    H: float = Field(gt=0)
    C: float = Field(default=0, ge=0)
    graph_points: int = Field(default=40, ge=5, le=200)
