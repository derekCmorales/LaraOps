from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader

from app.modules.eoq.models import EOQRequest
from app.modules.eoq.solver import solve as solve_eoq
from app.modules.lp.models import ConstraintSense, LPConstraint, LPRequest
from app.modules.lp.solver import solve as solve_lp
from app.services.export_pdf import module_result_to_pdf


def test_eoq_pdf_contains_module_title():
    result = solve_eoq(EOQRequest(D=1000, S=10, H=0.5))
    raw = module_result_to_pdf(result)
    reader = PdfReader(BytesIO(raw))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "LaraOps" in text
    assert "eoq" in text.lower()
    assert "Q_star" in text or "Q" in text


def test_lp_pdf_contains_objective():
    result = solve_lp(
        LPRequest(
            sense="max",
            objective={"x1": 3, "x2": 2},
            constraints=[
                LPConstraint(id="c1", coeffs={"x1": 2, "x2": 1}, sense=ConstraintSense.le, rhs=100),
                LPConstraint(id="c2", coeffs={"x1": 1, "x2": 1}, sense=ConstraintSense.le, rhs=80),
                LPConstraint(id="c3", coeffs={"x1": 1, "x2": 0}, sense=ConstraintSense.le, rhs=40),
            ],
        )
    )
    raw = module_result_to_pdf(result)
    reader = PdfReader(BytesIO(raw))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "linear_programming" in text or "Solución" in text
    assert "180" in text
