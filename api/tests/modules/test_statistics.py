from __future__ import annotations

from app.modules.statistics.models import StatisticsRequest
from app.modules.statistics.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_descriptive_mean():
    result = solve(StatisticsRequest(analysis="descriptive", data=[2, 4, 4, 4, 5, 5, 7, 9]))
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["mean"], 5.0)
    assert_allclose(result.solution.metrics["median"], 4.5)


def test_regression_perfect_line():
    result = solve(
        StatisticsRequest(
            analysis="regression",
            x=[1, 2, 3, 4],
            y=[2, 4, 6, 8],
        )
    )
    assert_allclose(result.solution.metrics["slope"], 2.0)
    assert_allclose(result.solution.metrics["intercept"], 0.0, atol=1e-8)
    assert_allclose(result.solution.metrics["r2"], 1.0, atol=1e-8)


def test_ttest_runs():
    result = solve(StatisticsRequest(analysis="ttest", data=[10, 12, 11, 13, 12], mu0=10, alpha=0.05))
    assert "t_stat" in result.solution.metrics
    assert "reject_H0" in result.solution.metrics


def test_ztest_runs():
    result = solve(
        StatisticsRequest(analysis="ztest", data=[10, 12, 11, 13, 12], mu0=10, sigma=2, alpha=0.05)
    )
    assert "z_stat" in result.solution.metrics
    assert result.solution.metrics["z_stat"] > 0
