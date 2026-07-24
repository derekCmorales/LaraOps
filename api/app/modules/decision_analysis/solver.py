from __future__ import annotations

import logging

from app.modules.decision_analysis.models import BayesBlock, DecisionAnalysisRequest, TreeNode
from app.schemas.common import SolveStatus
from app.schemas.result import GraphNetwork, ModuleResult, NamedTable, SensitivityBlock, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: DecisionAnalysisRequest) -> ModuleResult:
    if req.mode == "decision_tree":
        result = _solve_tree(req)
    elif req.mode == "bayes":
        result = _solve_bayes(req)
    else:
        result = _solve_payoff(req)
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _solve_payoff(req: DecisionAnalysisRequest) -> ModuleResult:
    if not req.alternatives or not req.states or req.payoff is None:
        raise ValueError("payoff_table mode requires alternatives, states, payoff")
    m = len(req.alternatives)
    n = len(req.states)
    if len(req.payoff) != m or any(len(row) != n for row in req.payoff):
        raise ValueError("payoff must be alternatives x states")

    warnings: list[str] = []
    metrics: dict[str, float] = {}
    variables: dict[str, float] = {}
    rows: list[list[float | str]] = []

    row_max = [max(row) for row in req.payoff]
    row_min = [min(row) for row in req.payoff]
    maximax_idx = max(range(m), key=lambda i: row_max[i])
    maximin_idx = max(range(m), key=lambda i: row_min[i])

    col_best = [max(req.payoff[i][j] for i in range(m)) for j in range(n)]
    regret = [[col_best[j] - req.payoff[i][j] for j in range(n)] for i in range(m)]
    max_regret = [max(regret[i]) for i in range(m)]
    minimax_reg_idx = min(range(m), key=lambda i: max_regret[i])

    hurwicz_values = [
        req.hurwicz_alpha * row_max[i] + (1.0 - req.hurwicz_alpha) * row_min[i] for i in range(m)
    ]
    hurwicz_idx = max(range(m), key=lambda i: hurwicz_values[i])

    laplace_probs = [1.0 / n] * n
    laplace_values = [sum(req.payoff[i][j] * laplace_probs[j] for j in range(n)) for i in range(m)]
    laplace_idx = max(range(m), key=lambda i: laplace_values[i])

    if req.criterion in ("maximax", "all"):
        variables["maximax"] = float(maximax_idx)
        metrics["maximax_payoff"] = float(row_max[maximax_idx])
        rows.append(["maximax", req.alternatives[maximax_idx], row_max[maximax_idx]])
    if req.criterion in ("maximin", "all"):
        variables["maximin"] = float(maximin_idx)
        metrics["maximin_payoff"] = float(row_min[maximin_idx])
        rows.append(["maximin", req.alternatives[maximin_idx], row_min[maximin_idx]])
    if req.criterion in ("minimax_regret", "all"):
        variables["minimax_regret"] = float(minimax_reg_idx)
        metrics["minimax_regret"] = float(max_regret[minimax_reg_idx])
        rows.append(["minimax_regret", req.alternatives[minimax_reg_idx], max_regret[minimax_reg_idx]])
    if req.criterion in ("hurwicz", "all"):
        variables["hurwicz"] = float(hurwicz_idx)
        metrics["hurwicz_alpha"] = float(req.hurwicz_alpha)
        metrics["hurwicz_payoff"] = float(hurwicz_values[hurwicz_idx])
        rows.append(["hurwicz", req.alternatives[hurwicz_idx], hurwicz_values[hurwicz_idx]])
        for i, alt in enumerate(req.alternatives):
            rows.append([f"hurwicz:{alt}", alt, hurwicz_values[i]])
    if req.criterion in ("laplace", "all"):
        variables["laplace"] = float(laplace_idx)
        metrics["laplace_payoff"] = float(laplace_values[laplace_idx])
        rows.append(["laplace", req.alternatives[laplace_idx], laplace_values[laplace_idx]])
        for i, alt in enumerate(req.alternatives):
            rows.append([f"laplace:{alt}", alt, laplace_values[i]])

    sensitivity = None
    if req.probabilities is not None:
        if len(req.probabilities) != n:
            raise ValueError("probabilities length must match states")
        if abs(sum(req.probabilities) - 1.0) > 1e-6:
            warnings.append("Las probabilidades no suman 1; se normalizaron")
            s = sum(req.probabilities)
            probs = [p / s for p in req.probabilities]
        else:
            probs = list(req.probabilities)

        evs = [sum(req.payoff[i][j] * probs[j] for j in range(n)) for i in range(m)]
        best_ev_idx = max(range(m), key=lambda i: evs[i])
        ev_best = evs[best_ev_idx]
        evwpi = sum(col_best[j] * probs[j] for j in range(n))
        evpi = evwpi - ev_best
        eols = [sum(regret[i][j] * probs[j] for j in range(n)) for i in range(m)]
        best_eol_idx = min(range(m), key=lambda i: eols[i])

        if req.criterion in ("expected_value", "all"):
            variables["expected_value"] = float(best_ev_idx)
            metrics["EV"] = float(ev_best)
            metrics["EVwPI"] = float(evwpi)
            metrics["EVPI"] = float(evpi)
            metrics["EOL"] = float(eols[best_eol_idx])
            rows.append(["expected_value", req.alternatives[best_ev_idx], ev_best])
            rows.append(["EOL_choice", req.alternatives[best_eol_idx], eols[best_eol_idx]])

        for i, alt in enumerate(req.alternatives):
            rows.append([f"EV:{alt}", alt, evs[i]])

        if n == 2:
            crossings = _probability_breakeven_points(req.payoff, req.alternatives, best_ev_idx)
            if crossings:
                sensitivity = SensitivityBlock(objective_ranges=crossings)
    elif req.criterion == "expected_value":
        raise ValueError("probabilities required for expected_value criterion")

    return ModuleResult(
        module="decision_analysis",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics, objective_sense="max"),
        iterations=None,
        sensitivity=sensitivity,
        graph=None,
        tables=[
            NamedTable(name="decisions", columns=["criterio", "alternativa", "valor"], rows=rows),
            NamedTable(
                name="payoff",
                columns=["alternativa", *req.states],
                rows=[[req.alternatives[i], *req.payoff[i]] for i in range(m)],
            ),
        ],
        warnings=warnings,
    )


def _probability_breakeven_points(
    payoff: list[list[float]], alternatives: list[str], best_idx: int
) -> list[dict]:
    """Basic sensitivity for the 2-state case: for each competing alternative, find the
    breakeven probability p = P(state1) at which its expected value ties the current best
    alternative (EV is linear in p, so there is at most one crossing in [0,1])."""
    a_best, b_best = payoff[best_idx]
    crossings: list[dict] = []
    for i, alt in enumerate(alternatives):
        if i == best_idx:
            continue
        a_i, b_i = payoff[i]
        denom = (a_best - b_best) - (a_i - b_i)
        if abs(denom) < 1e-12:
            continue
        p_cross = (b_i - b_best) / denom
        if 0.0 <= p_cross <= 1.0:
            crossings.append(
                {
                    "current_best": alternatives[best_idx],
                    "competitor": alt,
                    "breakeven_probability_state1": float(p_cross),
                }
            )
    return crossings


def _solve_tree(req: DecisionAnalysisRequest) -> ModuleResult:
    if not req.tree:
        raise ValueError("decision_tree mode requires tree nodes")
    nodes = {n.id: n for n in req.tree}
    if len(nodes) != len(req.tree):
        raise ValueError("duplicate tree node ids")
    root = req.root_id or req.tree[0].id
    if root not in nodes:
        raise ValueError(f"unknown root_id {root}")

    values: dict[str, float] = {}
    choice: dict[str, str] = {}

    def eval_node(nid: str, stack: set[str]) -> float:
        if nid in stack:
            raise ValueError(f"cycle in decision tree at {nid}")
        if nid in values:
            return values[nid]
        node = nodes[nid]
        if node.kind == "terminal":
            if node.value is None:
                raise ValueError(f"terminal {nid} requires value")
            values[nid] = float(node.value)
            return values[nid]
        if not node.children:
            raise ValueError(f"non-terminal {nid} has no children")
        stack = {*stack, nid}
        if node.kind == "decision":
            best_to = None
            best_val = None
            for edge in node.children:
                if edge.to not in nodes:
                    raise ValueError(f"unknown child {edge.to}")
                v = eval_node(edge.to, stack)
                if best_val is None or v > best_val:
                    best_val = v
                    best_to = edge.to
            assert best_val is not None and best_to is not None
            values[nid] = best_val
            choice[nid] = best_to
            return best_val
        # chance
        total_p = 0.0
        ev = 0.0
        for edge in node.children:
            if edge.probability is None:
                raise ValueError(f"chance edge {nid}->{edge.to} requires probability")
            if edge.to not in nodes:
                raise ValueError(f"unknown child {edge.to}")
            total_p += edge.probability
            ev += edge.probability * eval_node(edge.to, stack)
        if abs(total_p - 1.0) > 1e-6:
            raise ValueError(f"chance node {nid} probabilities must sum to 1 (got {total_p})")
        values[nid] = ev
        return ev

    root_ev = eval_node(root, set())
    rows = [[nid, nodes[nid].kind, values.get(nid, ""), choice.get(nid, "")] for nid in nodes]

    graph_nodes = [
        {"id": nid, "kind": nodes[nid].kind, "value": values.get(nid), "root": nid == root}
        for nid in nodes
    ]
    graph_edges = []
    for nid, node in nodes.items():
        for edge in node.children:
            is_optimal = node.kind == "decision" and choice.get(nid) == edge.to
            graph_edges.append(
                {
                    "source": nid,
                    "target": edge.to,
                    "label": edge.label,
                    "probability": edge.probability,
                    "critical": is_optimal,
                }
            )

    return ModuleResult(
        module="decision_analysis",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"root": root_ev},
            objective_value=root_ev,
            objective_sense="max",
            metrics={"EV_root": root_ev, "best_child_count": float(len(choice))},
        ),
        tables=[
            NamedTable(
                name="tree_fold",
                columns=["id", "tipo", "valor", "mejor_hijo"],
                rows=rows,
            )
        ],
        graph=GraphNetwork(
            nodes=graph_nodes,
            edges=graph_edges,
            title="Árbol de decisión",
            subtitle="Arcos óptimos resaltados · etiquetas con probabilidad o decisión",
        ),
        warnings=[],
    )


def _solve_bayes(req: DecisionAnalysisRequest) -> ModuleResult:
    if req.bayes is None:
        raise ValueError("bayes mode requires bayes block")
    b = req.bayes
    return _bayes_evsi(b)


def _bayes_evsi(b: BayesBlock) -> ModuleResult:
    m = len(b.actions)
    n = len(b.states)
    s = len(b.signals)
    if len(b.prior) != n:
        raise ValueError("prior length must match states")
    if abs(sum(b.prior) - 1.0) > 1e-6:
        prior = [p / sum(b.prior) for p in b.prior]
        warnings = ["Las probabilidades previas se normalizaron para sumar 1"]
    else:
        prior = list(b.prior)
        warnings = []
    if len(b.payoff) != m or any(len(row) != n for row in b.payoff):
        raise ValueError("payoff must be actions x states")
    if len(b.likelihood) != s or any(len(row) != n for row in b.likelihood):
        raise ValueError("likelihood must be signals x states")

    # Column-normalize check: for each state, P(signal|state) should sum ~1
    for j in range(n):
        col = sum(b.likelihood[i][j] for i in range(s))
        if abs(col - 1.0) > 1e-5:
            warnings.append(f"La columna de verosimilitud del estado {b.states[j]} suma {col}; se usa tal cual")

    # EV without sample information
    evs = [sum(b.payoff[i][j] * prior[j] for j in range(n)) for i in range(m)]
    best_idx = max(range(m), key=lambda i: evs[i])
    ev = evs[best_idx]
    col_best = [max(b.payoff[i][j] for i in range(m)) for j in range(n)]
    evwpi = sum(col_best[j] * prior[j] for j in range(n))
    evpi = evwpi - ev

    # Marginal P(signal) and posteriors
    p_signal = []
    posteriors: list[list[float]] = []
    best_action_per_signal: list[str] = []
    ev_per_signal: list[float] = []
    for i in range(s):
        ps = sum(b.likelihood[i][j] * prior[j] for j in range(n))
        p_signal.append(ps)
        if ps <= 1e-15:
            post = [0.0] * n
            posteriors.append(post)
            best_action_per_signal.append(b.actions[best_idx])
            ev_per_signal.append(ev)
            continue
        post = [(b.likelihood[i][j] * prior[j]) / ps for j in range(n)]
        posteriors.append(post)
        evs_sig = [sum(b.payoff[a][j] * post[j] for j in range(n)) for a in range(m)]
        a_best = max(range(m), key=lambda a: evs_sig[a])
        best_action_per_signal.append(b.actions[a_best])
        ev_per_signal.append(evs_sig[a_best])

    evwsi = sum(p_signal[i] * ev_per_signal[i] for i in range(s))
    evsi = evwsi - ev

    rows = []
    for i, sig in enumerate(b.signals):
        rows.append(
            [
                sig,
                p_signal[i],
                best_action_per_signal[i],
                ev_per_signal[i],
                *[posteriors[i][j] for j in range(n)],
            ]
        )

    metrics = {
        "EV": float(ev),
        "EVwPI": float(evwpi),
        "EVPI": float(evpi),
        "EVwSI": float(evwsi),
        "EVSI": float(evsi),
    }
    return ModuleResult(
        module="decision_analysis",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"best_prior_action": float(best_idx)},
            objective_value=float(evwsi),
            objective_sense="max",
            metrics=metrics,
        ),
        tables=[
            NamedTable(
                name="bayes",
                columns=["signal", "P(signal)", "best_action", "EV|signal", *[f"P({st}|sig)" for st in b.states]],
                rows=rows,
            ),
            NamedTable(
                name="summary",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()]
                + [["best_prior_action", b.actions[best_idx]]],
            ),
        ],
        warnings=warnings,
    )
