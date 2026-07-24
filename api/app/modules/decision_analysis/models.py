from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TreeEdge(BaseModel):
    to: str
    label: str = ""
    probability: float | None = None


class TreeNode(BaseModel):
    id: str
    kind: Literal["decision", "chance", "terminal"]
    value: float | None = None  # terminal payoff
    children: list[TreeEdge] = Field(default_factory=list)


class BayesBlock(BaseModel):
    actions: list[str] = Field(min_length=1)
    states: list[str] = Field(min_length=1)
    prior: list[float]
    payoff: list[list[float]]  # actions x states
    signals: list[str] = Field(min_length=1)
    likelihood: list[list[float]]  # signals x states = P(signal|state)


class DecisionAnalysisRequest(BaseModel):
    mode: Literal["payoff_table", "decision_tree", "bayes"] = "payoff_table"
    # payoff table (default / backward compatible)
    alternatives: list[str] | None = None
    states: list[str] | None = None
    payoff: list[list[float]] | None = None
    probabilities: list[float] | None = None
    criterion: Literal[
        "expected_value", "maximax", "maximin", "minimax_regret", "hurwicz", "laplace", "all"
    ] = "all"
    hurwicz_alpha: float = Field(default=0.5, ge=0.0, le=1.0)
    # decision tree
    tree: list[TreeNode] | None = None
    root_id: str | None = None
    # Bayes / EVSI
    bayes: BayesBlock | None = None
