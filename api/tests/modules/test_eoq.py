from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.eoq.models import EOQRequest
from app.modules.eoq.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_eoq_01_textbook():
    data = _load("eoq_01.json")
    result = solve(EOQRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.ok
    assert result.module == "eoq"
    assert result.iterations is None
    assert result.sensitivity is None
    assert_allclose(result.solution.metrics["Q_star"], expect["Q_star"])
    assert_allclose(result.solution.metrics["TC"], expect["TC"])
    assert_allclose(result.solution.metrics["orders_per_year"], expect["orders_per_year"])
    assert_allclose(result.solution.metrics["TC_ordering"], expect["TC_ordering"])
    assert_allclose(result.solution.metrics["TC_holding"], expect["TC_holding"])
    assert_allclose(result.solution.variables["Q"], expect["Q_star"])
    assert result.graph is not None
    assert result.graph.type == "xy"
    names = {s["name"] for s in result.graph.series}
    assert names == {"TC", "ordering", "holding"}


def test_eoq_02_textbook():
    data = _load("eoq_02.json")
    result = solve(EOQRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["Q_star"], expect["Q_star"])
    assert_allclose(result.solution.metrics["TC"], expect["TC"])
    assert_allclose(result.solution.metrics["orders_per_year"], expect["orders_per_year"])


def test_eoq_invalid_d_zero():
    with pytest.raises(ValidationError):
        EOQRequest(D=0, S=10, H=0.5)
