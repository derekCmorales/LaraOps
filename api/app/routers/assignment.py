from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.modules.assignment.models import AssignmentRequest
from app.modules.assignment.solver import AssignmentError, solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


def _solve_or_400(req: AssignmentRequest) -> ModuleResult:
    try:
        return solve(req)
    except AssignmentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: AssignmentRequest) -> ModuleResult:
    return _solve_or_400(req)


@router.post("/export.xlsx")
def export_xlsx(req: AssignmentRequest) -> Response:
    return xlsx_attachment(_solve_or_400(req), "assignment_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: AssignmentRequest) -> Response:
    return pdf_attachment(_solve_or_400(req), "assignment_result.pdf")
