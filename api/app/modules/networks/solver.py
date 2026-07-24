from __future__ import annotations

import itertools
import logging
from collections import defaultdict, deque

import networkx as nx
import pulp

from app.modules.networks.models import NetworksRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphNetwork, IterationStep, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: NetworksRequest) -> ModuleResult:
    if req.problem == "shortest_path":
        return _shortest(req)
    if req.problem == "mst":
        return _mst(req)
    if req.problem == "max_flow":
        return _max_flow(req)
    if req.problem == "transshipment":
        return _transshipment(req)
    return _tsp(req)


def _graph(req: NetworksRequest, *, capacity: bool = False) -> nx.Graph:
    if not req.edges:
        raise ValueError(f"edges are required for problem={req.problem}")
    G: nx.Graph = nx.DiGraph() if req.directed else nx.Graph()
    G.add_nodes_from(req.nodes)
    for e in req.edges:
        attrs: dict = {"weight": e.weight}
        if capacity or e.capacity is not None:
            attrs["capacity"] = e.capacity if e.capacity is not None else e.weight
        G.add_edge(e.source, e.target, **attrs)
    return G


def _shortest(req: NetworksRequest) -> ModuleResult:
    if not req.source or not req.sink:
        raise ValueError("source and sink required for shortest_path")
    G = _graph(req)
    try:
        path = nx.shortest_path(G, req.source, req.sink, weight="weight")
        length = nx.shortest_path_length(G, req.source, req.sink, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
        raise ValueError(str(exc)) from exc

    edge_set = set(zip(path, path[1:], strict=False))
    graph = GraphNetwork(
        type="network",
        nodes=[{"id": n, "critical": n in path} for n in req.nodes],
        edges=[
            {
                "source": e.source,
                "target": e.target,
                "weight": e.weight,
                "critical": (e.source, e.target) in edge_set
                or ((e.target, e.source) in edge_set and not req.directed),
            }
            for e in req.edges
        ],
        title="Ruta más corta",
        subtitle=f"Longitud = {length:.4g} · magenta = nodos/arcos de la ruta",
    )
    return _ok(
        "networks",
        variables={n: float(i) for i, n in enumerate(path)},
        metrics={"path_length": float(length)},
        tables=[
            NamedTable(name="ruta", columns=["orden", "nodo"], rows=[[i, n] for i, n in enumerate(path)])
        ],
        graph=graph,
        path_labels=path,
    )


def _mst(req: NetworksRequest) -> ModuleResult:
    G = _graph(NetworksRequest(**{**req.model_dump(), "directed": False}))
    T = nx.minimum_spanning_tree(G.to_undirected(), weight="weight")
    total = float(sum(d["weight"] for _, _, d in T.edges(data=True)))
    mst_edges = {(u, v) for u, v in T.edges()} | {(v, u) for u, v in T.edges()}
    rows = [[u, v, float(T[u][v]["weight"])] for u, v in T.edges()]
    graph = GraphNetwork(
        type="network",
        nodes=[{"id": n, "critical": True} for n in req.nodes],
        edges=[
            {
                "source": e.source,
                "target": e.target,
                "weight": e.weight,
                "critical": (e.source, e.target) in mst_edges,
            }
            for e in req.edges
        ],
    )
    return _ok(
        "networks",
        variables={f"{u}-{v}": float(T[u][v]["weight"]) for u, v in T.edges()},
        metrics={"mst_weight": total},
        tables=[NamedTable(name="aristas_mst", columns=["u", "v", "peso"], rows=rows)],
        graph=graph,
    )


def _max_flow(req: NetworksRequest) -> ModuleResult:
    if not req.source or not req.sink:
        raise ValueError("source and sink required for max_flow")
    if not req.edges:
        raise ValueError("edges are required for max_flow")
    if req.source not in req.nodes or req.sink not in req.nodes:
        raise ValueError("source and sink must be in nodes")

    capacities: dict[tuple[str, str], float] = {}
    for e in req.edges:
        cap = e.capacity if e.capacity is not None else e.weight
        capacities[(e.source, e.target)] = capacities.get((e.source, e.target), 0.0) + cap

    residual: dict[str, dict[str, float]] = defaultdict(dict)
    for (u, v), cap in capacities.items():
        residual[u][v] = residual[u].get(v, 0.0) + cap
        residual[v].setdefault(u, residual[v].get(u, 0.0))

    iterations: list[IterationStep] = []
    total_flow = 0.0
    step = 0
    while True:
        parent: dict[str, str | None] = {req.source: None}
        queue: deque[str] = deque([req.source])
        found = req.source == req.sink
        while queue and not found:
            u = queue.popleft()
            for v, cap in residual[u].items():
                if cap > 1e-9 and v not in parent:
                    parent[v] = u
                    if v == req.sink:
                        found = True
                        break
                    queue.append(v)
        if not found or req.sink not in parent:
            break

        path: list[str] = []
        v = req.sink
        bottleneck = float("inf")
        while v != req.source:
            u = parent[v]
            assert u is not None
            bottleneck = min(bottleneck, residual[u][v])
            path.append(v)
            v = u
        path.append(req.source)
        path.reverse()

        v = req.sink
        while v != req.source:
            u = parent[v]
            assert u is not None
            residual[u][v] -= bottleneck
            residual[v][u] = residual[v].get(u, 0.0) + bottleneck
            v = u

        total_flow += bottleneck
        step += 1
        iterations.append(
            IterationStep(
                index=step,
                method="edmonds_karp",
                title=f"Camino de aumento {' -> '.join(path)} (cuello de botella = {bottleneck:g})",
                meta={"path": path, "bottleneck": float(bottleneck), "cumulative_flow": float(total_flow)},
            )
        )

    # Min cut: nodes still reachable from source in the final residual graph.
    reachable = {req.source}
    queue = deque([req.source])
    while queue:
        u = queue.popleft()
        for v, cap in residual[u].items():
            if cap > 1e-9 and v not in reachable:
                reachable.add(v)
                queue.append(v)

    cut_rows = []
    cut_value = 0.0
    for (u, v), cap in capacities.items():
        if u in reachable and v not in reachable:
            cut_rows.append([u, v, cap])
            cut_value += cap

    rows = []
    variables: dict[str, float] = {}
    for u, targets in residual.items():
        for v, remaining in targets.items():
            if (u, v) in capacities:
                flow = capacities[(u, v)] - remaining
                if flow > 1e-9:
                    rows.append([u, v, float(flow)])
                    variables[f"{u}->{v}"] = float(flow)

    def _flow_of(u: str, v: str) -> float:
        cap = capacities.get((u, v))
        if cap is None:
            return 0.0
        return max(0.0, cap - residual.get(u, {}).get(v, cap))

    graph = GraphNetwork(
        type="network",
        nodes=[{"id": n, "critical": n in reachable} for n in req.nodes],
        edges=[
            {
                "source": e.source,
                "target": e.target,
                "capacity": e.capacity if e.capacity is not None else e.weight,
                "flow": _flow_of(e.source, e.target),
                "min_cut": e.source in reachable and e.target not in reachable,
            }
            for e in req.edges
        ],
    )
    return _ok(
        "networks",
        variables=variables,
        metrics={"max_flow": float(total_flow), "min_cut_value": float(cut_value)},
        tables=[
            NamedTable(name="flows", columns=["origen", "destino", "flujo"], rows=rows),
            NamedTable(name="min_cut", columns=["origen", "destino", "capacidad"], rows=cut_rows),
        ],
        graph=graph,
        iterations=iterations,
    )


def _transshipment(req: NetworksRequest) -> ModuleResult:
    if req.node_supply is None:
        raise ValueError("node_supply is required for transshipment (positive=supply, negative=demand)")
    if not req.edges:
        raise ValueError("edges are required for transshipment")
    if set(req.node_supply.keys()) != set(req.nodes):
        raise ValueError("node_supply keys must match nodes exactly")

    total = sum(req.node_supply.values())
    if abs(total) > 1e-6:
        raise ValueError(f"unbalanced network: total supply/demand = {total:g}, must sum to 0")

    prob = pulp.LpProblem("transshipment", pulp.LpMinimize)
    flow_vars = [
        pulp.LpVariable(f"f_{i}", lowBound=0, upBound=e.capacity) for i, e in enumerate(req.edges)
    ]
    prob += pulp.lpSum(flow_vars[i] * e.weight for i, e in enumerate(req.edges))
    for node in req.nodes:
        outflow = pulp.lpSum(flow_vars[i] for i, e in enumerate(req.edges) if e.source == node)
        inflow = pulp.lpSum(flow_vars[i] for i, e in enumerate(req.edges) if e.target == node)
        prob += (outflow - inflow == req.node_supply[node]), f"balance_{node}"

    status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
    lp_status = pulp.LpStatus[prob.status]
    if lp_status != "Optimal":
        raise ValueError(f"transshipment problem is {lp_status.lower()}")

    rows = []
    variables: dict[str, float] = {}
    for i, e in enumerate(req.edges):
        f = flow_vars[i].value() or 0.0
        if f > 1e-9:
            rows.append([e.source, e.target, float(f), e.weight, float(f) * e.weight])
            variables[f"{e.source}->{e.target}"] = float(f)

    total_cost = float(pulp.value(prob.objective) or 0.0)
    graph = GraphNetwork(
        type="network",
        nodes=[{"id": n, "supply_demand": req.node_supply[n]} for n in req.nodes],
        edges=[
            {
                "source": e.source,
                "target": e.target,
                "cost": e.weight,
                "capacity": e.capacity,
                "flow": float(flow_vars[i].value() or 0.0),
            }
            for i, e in enumerate(req.edges)
        ],
    )
    _ = status
    return _ok(
        "networks",
        variables=variables,
        metrics={"total_cost": total_cost},
        tables=[
            NamedTable(
                name="flows", columns=["origen", "destino", "flujo", "costo_unitario", "costo"], rows=rows
            )
        ],
        graph=graph,
    )


def _tsp(req: NetworksRequest) -> ModuleResult:
    if req.distance_matrix is None:
        raise ValueError("distance_matrix is required for tsp")
    n = len(req.distance_matrix)
    if n < 2 or any(len(row) != n for row in req.distance_matrix):
        raise ValueError("distance_matrix must be a square n x n matrix with n >= 2")

    labels = req.nodes if len(req.nodes) == n else [f"N{i}" for i in range(n)]
    warnings: list[str] = []
    method = req.tsp_method
    if method is None:
        method = "exact" if n <= 10 else "heuristic"
    if method == "exact" and n > 10:
        warnings.append(f"El TSP exacto está limitado a ≤10 nodos (tiene {n}); se usa heurística.")
        method = "heuristic"

    D = req.distance_matrix
    if method == "exact":
        tour_idx, total = _tsp_exact(D)
    else:
        tour_idx, total = _tsp_heuristic(D)

    tour = [labels[i] for i in tour_idx]
    tour_edges = set(zip(tour_idx, tour_idx[1:], strict=False)) | set(
        zip(tour_idx[1:], tour_idx[:-1], strict=False)
    )
    graph = GraphNetwork(
        type="network",
        nodes=[{"id": labels[i]} for i in range(n)],
        edges=[
            {"source": labels[i], "target": labels[j], "weight": D[i][j], "critical": True}
            for i in range(n)
            for j in range(n)
            if i != j and (i, j) in tour_edges
        ],
    )
    return _ok(
        "networks",
        variables={labels[idx]: float(i) for i, idx in enumerate(tour_idx)},
        metrics={"tour_length": float(total)},
        tables=[NamedTable(name="recorrido", columns=["orden", "nodo"], rows=[[i, n_] for i, n_ in enumerate(tour)])],
        graph=graph,
        warnings=warnings,
    )


def _tsp_exact(D: list[list[float]]) -> tuple[list[int], float]:
    """Held-Karp dynamic programming: exact optimum in O(2^n * n^2)."""
    n = len(D)
    if n == 2:
        return [0, 1, 0], D[0][1] + D[1][0]

    C: dict[tuple[int, int], tuple[float, int]] = {}
    for k in range(1, n):
        C[(1 << k, k)] = (D[0][k], 0)
    for subset_size in range(2, n):
        for subset in itertools.combinations(range(1, n), subset_size):
            bits = 0
            for b in subset:
                bits |= 1 << b
            for k in subset:
                prev = bits & ~(1 << k)
                best = min((C[(prev, m)][0] + D[m][k], m) for m in subset if m != k)
                C[(bits, k)] = best

    bits_full = (1 << n) - 2  # all of nodes 1..n-1 set
    total, last = min((C[(bits_full, k)][0] + D[k][0], k) for k in range(1, n))

    seq = []
    bits_r = bits_full
    k = last
    while k != 0:
        seq.append(k)
        _, prev_k = C[(bits_r, k)]
        bits_r &= ~(1 << k)
        k = prev_k
    path = [0, *reversed(seq), 0]
    return path, float(total)


def _tsp_heuristic(D: list[list[float]]) -> tuple[list[int], float]:
    n = len(D)
    unvisited = set(range(1, n))
    tour = [0]
    current = 0
    while unvisited:
        nxt = min(unvisited, key=lambda j: D[current][j])
        tour.append(nxt)
        unvisited.discard(nxt)
        current = nxt
    tour.append(0)
    tour = _two_opt(tour, D)
    total = sum(D[tour[i]][tour[i + 1]] for i in range(len(tour) - 1))
    return tour, float(total)


def _two_opt(tour: list[int], D: list[list[float]]) -> list[int]:
    n = len(tour)
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 2):
            for j in range(i + 1, n - 1):
                a, b, c, d = tour[i - 1], tour[i], tour[j], tour[j + 1]
                if D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9:
                    tour[i : j + 1] = tour[i : j + 1][::-1]
                    improved = True
    return tour


def _ok(
    module: str,
    *,
    variables: dict[str, float],
    metrics: dict[str, float],
    tables: list[NamedTable],
    graph: GraphNetwork,
    path_labels: list[str] | None = None,
    iterations: list[IterationStep] | None = None,
    warnings: list[str] | None = None,
) -> ModuleResult:
    if path_labels is not None:
        variables = {**variables, **{label: 1.0 for label in path_labels}}
    result = ModuleResult(
        module=module,
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics, objective_sense="min"),
        iterations=iterations or None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings or [],
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
