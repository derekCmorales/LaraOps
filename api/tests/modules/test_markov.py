from __future__ import annotations

import json
from pathlib import Path

from app.modules.markov.models import MarkovRequest
from app.modules.markov.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_markov_steady():
    req = MarkovRequest(
        states=["A", "B"],
        transition=[[0.9, 0.1], [0.5, 0.5]],
        initial=[1, 0],
        steps=5,
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    # Steady: pi = [5/6, 1/6]
    assert_allclose(result.solution.variables["A"], 5 / 6, atol=1e-6)
    assert_allclose(result.solution.variables["B"], 1 / 6, atol=1e-6)


def test_markov_transient_table():
    req = MarkovRequest(
        states=["X", "Y"],
        transition=[[0.0, 1.0], [1.0, 0.0]],
        initial=[1, 0],
        steps=3,
    )
    result = solve(req)
    assert result.tables is not None
    assert any(t.name == "transient" for t in result.tables)


def test_markov_rows_must_sum_to_one():
    req = MarkovRequest(states=["A", "B"], transition=[[0.5, 0.4], [0.5, 0.5]])
    try:
        solve(req)
        raise AssertionError("expected ValueError for invalid transition matrix")
    except ValueError as exc:
        assert "sum to 1" in str(exc)


def test_markov_land_of_oz_steady_state():
    data = json.loads((FIXTURES / "markov_01.json").read_text(encoding="utf-8"))
    result = solve(MarkovRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    for state, prob in data["expect"]["steady_state"].items():
        assert_allclose(result.solution.variables[state], prob, atol=1e-6)
    assert any(t.name == "transition_power_n" for t in result.tables or [])
    assert result.graph is not None and result.graph.type == "network"


def test_markov_absorbing_gamblers_ruin():
    data = json.loads((FIXTURES / "markov_02.json").read_text(encoding="utf-8"))
    result = solve(MarkovRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["is_absorbing_chain"] == 1.0
    assert_allclose(result.solution.metrics["num_absorbing_states"], 2.0)
    assert_allclose(result.solution.metrics["expected_steps_2"], data["expect"]["expected_steps_from_2"])

    absorption_table = next(t for t in result.tables if t.name == "absorption_probabilities")
    row = next(r for r in absorption_table.rows if r[0] == "2")
    probs = dict(zip(absorption_table.columns[1:], row[1:], strict=False))
    for state, prob in data["expect"]["absorption_from_2"].items():
        assert_allclose(probs[state], prob, atol=1e-6)


def test_markov_rewards_long_run():
    req = MarkovRequest(
        states=["A", "B"],
        transition=[[0.9, 0.1], [0.5, 0.5]],
        initial=[1, 0],
        steps=5,
        rewards=[10.0, 0.0],
    )
    result = solve(req)
    # steady = [5/6, 1/6] -> long-run reward = 10 * 5/6 + 0 * 1/6
    assert_allclose(result.solution.metrics["long_run_expected_reward"], 10 * (5 / 6), atol=1e-6)
