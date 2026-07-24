from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.modules.goal_programming.models import GoalProgrammingRequest
from app.modules.goal_programming.solver import solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


def _solve_or_400(req: GoalProgrammingRequest) -> ModuleResult:
    try:
        return solve(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: GoalProgrammingRequest) -> ModuleResult:
    return _solve_or_400(req)


@router.post("/export.xlsx")
def export_xlsx(req: GoalProgrammingRequest) -> Response:
    return xlsx_attachment(_solve_or_400(req), "goal_programming_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: GoalProgrammingRequest) -> Response:
    return pdf_attachment(_solve_or_400(req), "goal_programming_result.pdf")
