from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.modules.dynamic_programming.models import DynamicProgrammingRequest
from app.modules.dynamic_programming.solver import solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


def _solve_or_400(req: DynamicProgrammingRequest) -> ModuleResult:
    try:
        return solve(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: DynamicProgrammingRequest) -> ModuleResult:
    return _solve_or_400(req)


@router.post("/export.xlsx")
def export_xlsx(req: DynamicProgrammingRequest) -> Response:
    return xlsx_attachment(_solve_or_400(req), "dynamic_programming_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: DynamicProgrammingRequest) -> Response:
    return pdf_attachment(_solve_or_400(req), "dynamic_programming_result.pdf")
