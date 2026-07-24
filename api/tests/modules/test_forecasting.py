from __future__ import annotations

import json
from pathlib import Path

from app.modules.forecasting.models import ForecastingRequest
from app.modules.forecasting.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_forecasting_comparison_table():
    data = json.loads((FIXTURES / "forecasting_01.json").read_text(encoding="utf-8"))
    result = solve(ForecastingRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "forecasting"
    assert result.tables is not None
    names = {t.name for t in result.tables}
    assert "error_comparison" in names
    assert result.graph is not None


def test_forecasting_naive_next():
    data = json.loads((FIXTURES / "forecasting_02.json").read_text(encoding="utf-8"))
    result = solve(ForecastingRequest(**data["request"]))
    err = next(t for t in result.tables or [] if t.name == "error_comparison")
    # columns: method, MAD, MSE, MAPE, Bias, CFE, tracking_signal, next_forecast, ...
    next_fc = err.rows[0][7]
    assert_allclose(float(next_fc), data["expect"]["next_naive"])


def test_forecasting_holt_and_linear_trend():
    data = json.loads((FIXTURES / "forecasting_03.json").read_text(encoding="utf-8"))
    result = solve(ForecastingRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    err = next(t for t in result.tables or [] if t.name == "error_comparison")
    assert "sesgo" in err.columns
    assert "CFE" in err.columns
    assert "señal_seguimiento" in err.columns
    methods = {row[0] for row in err.rows}
    assert "holt" in methods
    assert "linear_trend" in methods
    assert any(t.name.startswith("detail_") for t in result.tables or [])
    assert result.graph is not None


def test_forecasting_holt_winters_additive():
    data = json.loads((FIXTURES / "forecasting_04.json").read_text(encoding="utf-8"))
    result = solve(ForecastingRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    fc = next(t for t in result.tables or [] if t.name == "forecasts")
    assert len(fc.rows) == data["expect"]["horizon"]
    assert all(row[0] == "holt_winters_additive" for row in fc.rows)


def test_forecasting_optimize_alpha():
    result = solve(
        ForecastingRequest.model_validate(
            {
                "series": [10, 12, 13, 12, 14, 16, 15, 17],
                "methods": ["exponential"],
                "alpha": 0.3,
                "optimize_alpha": True,
                "horizon": 1,
            }
        )
    )
    assert result.status == SolveStatus.ok
    assert any("optimización de alfa" in w for w in result.warnings)
    assert "best_alpha" in result.solution.metrics
