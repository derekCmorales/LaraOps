from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import SolveStatus


class SolutionBlock(BaseModel):
    variables: dict[str, float] = Field(default_factory=dict)
    objective_value: float | None = None
    objective_sense: Literal["min", "max"] | None = None
    metrics: dict[str, float] = Field(default_factory=dict)  # module-specific scalars


class SensitivityBlock(BaseModel):
    shadow_prices: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"constraint_id": str, "shadow_price": float}
    reduced_costs: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"variable": str, "reduced_cost": float}
    objective_ranges: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"variable", "coeff", "allowable_increase", "allowable_decrease", "min_coef", "max_coef"}
    rhs_ranges: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"constraint_id": str, "rhs": float, "allowable_increase": float, "allowable_decrease": float}
    constraint_analysis: list[dict[str, Any]] = Field(default_factory=list)
    # each: constraint_id, lhs, sense, rhs, slack_or_surplus, shadow_price,
    #       allowable_min_rhs, allowable_max_rhs (float or "M")


class NamedTable(BaseModel):
    name: str
    columns: list[str]
    rows: list[list[Any]]


class GraphXY(BaseModel):
    type: Literal["xy"] = "xy"
    series: list[dict[str, Any]]
    # series item: {"name": str, "x": list[float], "y": list[float]}
    x_label: str = ""
    y_label: str = ""
    z_label: str = ""
    title: str = ""
    subtitle: str = ""
    # kind hint for UI: "line" | "bar" | "area" | "control" | "sawtooth" | "lp2d" | "lp3d" | ""
    kind: str = ""


class GraphNetwork(BaseModel):
    type: Literal["network"] = "network"
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    # edge may include "critical": bool
    title: str = ""
    subtitle: str = ""


class GraphGantt(BaseModel):
    type: Literal["gantt"] = "gantt"
    bars: list[dict[str, Any]]
    # bar: {"id": str, "start": float, "end": float, "critical": bool}
    title: str = ""
    subtitle: str = ""
    x_label: str = "Tiempo"


class GraphMatrix(BaseModel):
    type: Literal["matrix"] = "matrix"
    row_labels: list[str]
    col_labels: list[str]
    values: list[list[float | None]]
    title: str = ""
    subtitle: str = ""
    value_label: str = ""


GraphPayload = GraphXY | GraphNetwork | GraphGantt | GraphMatrix


class IterationStep(BaseModel):
    index: int
    method: str  # e.g. "simplex", "vogel", "modi", "hungarian"
    title: str
    tableau: list[list[float | str]] | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ModuleResult(BaseModel):
    module: str
    status: SolveStatus
    solution: SolutionBlock
    iterations: list[IterationStep] | None = None
    sensitivity: SensitivityBlock | None = None
    graph: GraphPayload | None = None
    tables: list[NamedTable] | None = None
    warnings: list[str] = Field(default_factory=list)
