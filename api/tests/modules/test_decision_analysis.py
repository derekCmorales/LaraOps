from __future__ import annotations

import json
from pathlib import Path

from app.modules.decision_analysis.models import DecisionAnalysisRequest, TreeEdge, TreeNode
from app.modules.decision_analysis.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_decision_01_ev():
    data = json.loads((FIXTURES / "decision_01.json").read_text(encoding="utf-8"))
    # Fix expect: C has highest EV = 8.1
    result = solve(DecisionAnalysisRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "decision_analysis"
    assert_allclose(result.solution.metrics["EV"], 8.1, atol=1e-6)
    # index of C is 2
    assert_allclose(result.solution.variables["expected_value"], 2.0)


def test_decision_02_ev():
    data = json.loads((FIXTURES / "decision_02.json").read_text(encoding="utf-8"))
    result = solve(DecisionAnalysisRequest(**data["request"]))
    assert_allclose(result.solution.metrics["EV"], data["expect"]["EV"], atol=1e-6)
    assert "EVPI" in result.solution.metrics


def test_decision_03_hurwicz_laplace():
    data = json.loads((FIXTURES / "decision_03.json").read_text(encoding="utf-8"))
    result = solve(DecisionAnalysisRequest(**data["request"]))
    expect = data["expect"]
    assert_allclose(result.solution.metrics["hurwicz_payoff"], expect["hurwicz_payoff"])
    assert_allclose(result.solution.metrics["laplace_payoff"], expect["laplace_payoff"])
    hurwicz_idx = int(result.solution.variables["hurwicz"])
    laplace_idx = int(result.solution.variables["laplace"])
    assert data["request"]["alternatives"][hurwicz_idx] == expect["hurwicz_best"]
    assert data["request"]["alternatives"][laplace_idx] == expect["laplace_best"]


def test_decision_04_probability_sensitivity():
    data = json.loads((FIXTURES / "decision_04.json").read_text(encoding="utf-8"))
    result = solve(DecisionAnalysisRequest(**data["request"]))
    expect = data["expect"]
    assert_allclose(result.solution.metrics["EV"], expect["EV"])
    assert_allclose(result.solution.metrics["EVPI"], expect["EVPI"])
    best_idx = int(result.solution.variables["expected_value"])
    assert data["request"]["alternatives"][best_idx] == expect["best"]
    assert result.sensitivity is not None
    breakevens = {row["competitor"]: row["breakeven_probability_state1"] for row in result.sensitivity.objective_ranges}
    assert_allclose(breakevens["None"], expect["breakeven_vs_none"])


def test_decision_tree_rollback_and_graph():
    req = DecisionAnalysisRequest(
        mode="decision_tree",
        tree=[
            TreeNode(
                id="d1",
                kind="decision",
                children=[TreeEdge(to="c1", label="invest"), TreeEdge(to="t_none", label="do nothing")],
            ),
            TreeNode(
                id="c1",
                kind="chance",
                children=[
                    TreeEdge(to="t_good", label="good", probability=0.6),
                    TreeEdge(to="t_bad", label="bad", probability=0.4),
                ],
            ),
            TreeNode(id="t_good", kind="terminal", value=100.0),
            TreeNode(id="t_bad", kind="terminal", value=-20.0),
            TreeNode(id="t_none", kind="terminal", value=0.0),
        ],
        root_id="d1",
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    # EV(invest) = 0.6*100 + 0.4*-20 = 52 > 0, so decision node should pick "invest"
    assert_allclose(result.solution.variables["root"], 52.0)
    assert result.graph is not None
    assert result.graph.type == "network"
    critical_edges = [e for e in result.graph.edges if e.get("critical")]
    assert len(critical_edges) == 1
    assert critical_edges[0]["target"] == "c1"
