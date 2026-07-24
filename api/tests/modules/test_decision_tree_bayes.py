from __future__ import annotations

from app.modules.decision_analysis.models import (
    BayesBlock,
    DecisionAnalysisRequest,
    TreeEdge,
    TreeNode,
)
from app.modules.decision_analysis.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_decision_tree_simple():
    # Root decision: A -> 100, B -> chance 0.5*40 + 0.5*200 = 120 -> choose B
    req = DecisionAnalysisRequest(
        mode="decision_tree",
        root_id="D1",
        tree=[
            TreeNode(
                id="D1",
                kind="decision",
                children=[TreeEdge(to="T_A", label="A"), TreeEdge(to="C1", label="B")],
            ),
            TreeNode(id="T_A", kind="terminal", value=100),
            TreeNode(
                id="C1",
                kind="chance",
                children=[
                    TreeEdge(to="T_low", label="low", probability=0.5),
                    TreeEdge(to="T_high", label="high", probability=0.5),
                ],
            ),
            TreeNode(id="T_low", kind="terminal", value=40),
            TreeNode(id="T_high", kind="terminal", value=200),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["EV_root"], 120.0)
    fold = next(t for t in result.tables if t.name == "tree_fold")
    d1 = next(r for r in fold.rows if r[0] == "D1")
    assert d1[3] == "C1"


def test_bayes_evsi_nonnegative():
    req = DecisionAnalysisRequest(
        mode="bayes",
        bayes=BayesBlock(
            actions=["build", "no"],
            states=["high", "low"],
            prior=[0.4, 0.6],
            payoff=[[100, -20], [0, 0]],
            signals=["good", "bad"],
            likelihood=[[0.7, 0.2], [0.3, 0.8]],
        ),
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["EVSI"] >= -1e-9
    assert result.solution.metrics["EVPI"] >= -1e-9
