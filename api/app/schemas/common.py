from enum import Enum

from pydantic import BaseModel


class SolveStatus(str, Enum):
    optimal = "optimal"  # optimization modules with proven optimum
    ok = "ok"  # closed-form modules (EOQ, queues metrics)
    infeasible = "infeasible"
    unbounded = "unbounded"
    error = "error"


class ErrorBody(BaseModel):
    detail: str
    code: str | None = None
