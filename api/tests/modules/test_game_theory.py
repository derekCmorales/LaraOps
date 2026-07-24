from __future__ import annotations

import json
from pathlib import Path

from app.modules.game_theory.models import GameTheoryRequest
from app.modules.game_theory.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_game_mixed_2x2():
    data = json.loads((FIXTURES / "game_01.json").read_text(encoding="utf-8"))
    result = solve(GameTheoryRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "game_theory"
    assert any(t.name == "estrategia_mixta" for t in result.tables or [])
    assert "game_value" in result.solution.metrics


def test_game_pure_saddle():
    data = json.loads((FIXTURES / "game_02.json").read_text(encoding="utf-8"))
    result = solve(GameTheoryRequest(**data["request"]))
    assert_allclose(result.solution.metrics["game_value"], data["expect"]["game_value"])
    assert any(k.startswith("pure:") for k in result.solution.variables)


def test_game_lp_mxn_rock_paper_scissors():
    data = json.loads((FIXTURES / "game_03.json").read_text(encoding="utf-8"))
    result = solve(GameTheoryRequest(**data["request"]))
    assert_allclose(result.solution.metrics["game_value"], data["expect"]["game_value"], atol=1e-4)
    for strategy, prob in data["expect"]["p"].items():
        assert_allclose(result.solution.variables[f"p:{strategy}"], prob, atol=1e-4)


def test_game_dominance_elimination_steps():
    data = json.loads((FIXTURES / "game_04.json").read_text(encoding="utf-8"))
    result = solve(GameTheoryRequest(**data["request"]))
    assert_allclose(result.solution.metrics["game_value"], data["expect"]["game_value"], atol=1e-4)
    assert result.iterations, "expected dominance elimination steps to be recorded"
    eliminated = [step.meta["strategy"] for step in result.iterations if step.method == "dominance"]
    assert data["expect"]["eliminated_row"] in eliminated


def test_game_2xn_graph():
    req = GameTheoryRequest(
        row_strategies=["R1", "R2"],
        col_strategies=["C1", "C2", "C3"],
        payoff=[[4, 2, 6], [1, 5, 3]],
    )
    result = solve(req)
    assert result.graph is not None
    assert result.graph.type == "xy"
    assert len(result.graph.series) == 2  # C3 is dominated by C1 and dropped
