"""Transporte con M simbólica (paridad con worker/src/modules/transport/solver.ts).

Cada costo es a·M + b, de modo que las rutas prohibidas nunca se confunden con
un costo grande pero finito. La base se mantiene como un árbol explícito de
m + n - 1 celdas, así MODI funciona también con soluciones degeneradas.
"""

from __future__ import annotations

import logging
import math
from collections import deque
from functools import cmp_to_key
from typing import Callable

from app.modules.transport.models import TransportRequest
from app.schemas.common import SolveStatus
from app.schemas.result import (
    GraphMatrix,
    IterationStep,
    ModuleResult,
    NamedTable,
    SensitivityBlock,
    SolutionBlock,
)

logger = logging.getLogger(__name__)

DUMMY_SOURCE = "Origen ficticio"
DUMMY_DEST = "Destino ficticio"
TRANSPORT_DIM = 20

METHOD_LABEL = {
    "northwest": "Esquina noroeste",
    "least_cost": "Costo mínimo",
    "vogel": "Vogel",
    "modi_auto": "Vogel + MODI",
}

MAX_PIVOTS = 500
BLAND_AFTER = 50
M_EPS = 1e-9

Cell = tuple[int, int]
MV = tuple[float, float]  # a·M + b


def _sub(x: MV, y: MV) -> MV:
    return (x[0] - y[0], x[1] - y[1])


def _add(x: MV, y: MV) -> MV:
    return (x[0] + y[0], x[1] + y[1])


def _scale(x: MV, k: float) -> MV:
    return (x[0] * k, x[1] * k)


def _cmp(x: MV, y: MV, eps: float) -> int:
    if abs(x[0] - y[0]) > M_EPS:
        return -1 if x[0] < y[0] else 1
    if abs(x[1] - y[1]) > eps:
        return -1 if x[1] < y[1] else 1
    return 0


def _has_m(x: MV) -> bool:
    return abs(x[0]) > M_EPS


def _clean(x: float) -> float:
    r = math.floor(x + 0.5)
    if abs(x - r) < 1e-9:
        return float(r) + 0.0
    return round(x, 9)


def _fmt_num(x: float) -> str:
    v = round(_clean(x), 4)
    if v == 0:
        return "0"
    if float(v).is_integer():
        return str(int(v))
    return f"{v:.4f}".rstrip("0").rstrip(".")


def _fmt_mv(x: MV) -> str:
    a = _clean(x[0])
    b = _clean(x[1])
    if abs(a) <= M_EPS:
        return _fmt_num(b)
    coef = "M" if a == 1 else "-M" if a == -1 else f"{_fmt_num(a)}M"
    if abs(b) < 1e-12:
        return coef
    return f"{coef} {'-' if b < 0 else '+'} {_fmt_num(abs(b))}"


def _out_mv(x: MV) -> float | str:
    return _fmt_mv(x) if _has_m(x) else _clean(x[1])


class _Problem:
    def __init__(self, req: TransportRequest, warnings: list[str]) -> None:
        self.sources = list(req.supply.keys())
        self.dests = list(req.demand.keys())
        self.supply = [float(req.supply[i]) for i in self.sources]
        self.demand = [float(req.demand[j]) for j in self.dests]
        total_s = sum(self.supply)
        total_d = sum(self.demand)
        self.tol_q = 1e-9 * max(1.0, total_s, total_d)
        self.dummy_row = False
        self.dummy_col = False
        if total_s > total_d + self.tol_q:
            self.dests.append(DUMMY_DEST)
            self.demand.append(total_s - total_d)
            self.dummy_col = True
            warnings.append(
                f"La oferta total ({_fmt_num(total_s)}) supera la demanda total ({_fmt_num(total_d)}): "
                "se agregó un destino ficticio con costo 0 que recibe las "
                f"{_fmt_num(total_s - total_d)} unidades que no se envían."
            )
        elif total_d > total_s + self.tol_q:
            self.sources.append(DUMMY_SOURCE)
            self.supply.append(total_d - total_s)
            self.dummy_row = True
            warnings.append(
                f"La demanda total ({_fmt_num(total_d)}) supera la oferta total ({_fmt_num(total_s)}): "
                f"se agregó un origen ficticio con costo 0; {_fmt_num(total_d - total_s)} unidades "
                "de demanda quedarán sin cubrir."
            )
        self.sign = -1 if req.objective == "maximize" else 1
        forbidden = {(i, j) for i, j in req.forbidden_routes}
        m, n = len(self.sources), len(self.dests)
        self.orig: list[list[float | None]] = []
        for r, i in enumerate(self.sources):
            row: list[float | None] = []
            for c, j in enumerate(self.dests):
                if (self.dummy_row and r == m - 1) or (self.dummy_col and c == n - 1):
                    row.append(0.0)
                elif (i, j) in forbidden:
                    row.append(None)
                else:
                    row.append(float(req.costs[i][j]))
            self.orig.append(row)
        self.cost: list[list[MV]] = [
            [(1.0, 0.0) if o is None else (0.0, self.sign * o) for o in row] for row in self.orig
        ]
        max_abs = max([1.0] + [abs(o) for row in self.orig for o in row if o is not None])
        self.tol_c = 1e-9 * max_abs

    @property
    def m(self) -> int:
        return len(self.sources)

    @property
    def n(self) -> int:
        return len(self.dests)


class _State:
    def __init__(self, alloc: list[list[float]], basis: list[Cell]) -> None:
        self.alloc = alloc
        self.basis = basis

    def copy(self) -> _State:
        return _State([list(row) for row in self.alloc], list(self.basis))


def _parse(req: TransportRequest) -> None:
    for kind, who, data in (("oferta", "origen", req.supply), ("demanda", "destino", req.demand)):
        if not data:
            raise ValueError(f"Agrega al menos un {who} con su {kind}.")
        for name, value in data.items():
            if not name.strip():
                raise ValueError(f"Hay un {who} sin nombre.")
            if name.strip().lower() in (DUMMY_SOURCE.lower(), DUMMY_DEST.lower()):
                raise ValueError(f"«{name}» es un nombre reservado; usa otro nombre de {who}.")
            if not math.isfinite(value):
                raise ValueError(f"La {kind} de «{name}» debe ser un número.")
            if value < 0:
                raise ValueError(f"La {kind} de «{name}» no puede ser negativa.")
    if len(req.supply) > TRANSPORT_DIM or len(req.demand) > TRANSPORT_DIM:
        raise ValueError(f"Transporte limitado a {TRANSPORT_DIM}×{TRANSPORT_DIM} en el plan Free")
    unique: list[tuple[str, str]] = []
    for src, dst in req.forbidden_routes:
        if src not in req.supply or dst not in req.demand:
            raise ValueError(
                f"La ruta prohibida {src} -> {dst} no corresponde a un origen y un destino del modelo."
            )
        if (src, dst) not in unique:
            unique.append((src, dst))
    req.forbidden_routes = unique
    forbidden = set(unique)
    for i in req.supply:
        for j in req.demand:
            if (i, j) in forbidden:
                continue
            value = req.costs.get(i, {}).get(j)
            if value is None:
                raise ValueError(
                    f"Falta el costo de la ruta {i} -> {j}. Escribe un número o márcala como prohibida."
                )
            if not math.isfinite(value):
                raise ValueError(f"El costo de {i} -> {j} debe ser un número.")
    if sum(req.supply.values()) <= 0:
        raise ValueError("La oferta total es 0: no hay nada que enviar.")
    if sum(req.demand.values()) <= 0:
        raise ValueError("La demanda total es 0: ningún destino necesita unidades.")


def _route_name(p: _Problem, cell: Cell) -> str:
    return f"{p.sources[cell[0]]}->{p.dests[cell[1]]}"


def _route_label(p: _Problem, cell: Cell) -> str:
    return f"{p.sources[cell[0]]} -> {p.dests[cell[1]]}"


def _cost_label(p: _Problem, cell: Cell) -> str:
    o = p.orig[cell[0]][cell[1]]
    return "M" if o is None else _fmt_num(o)


def _is_dummy(p: _Problem, cell: Cell) -> bool:
    return (p.dummy_row and cell[0] == p.m - 1) or (p.dummy_col and cell[1] == p.n - 1)


def _alloc_cost(p: _Problem, alloc: list[list[float]]) -> MV:
    total: MV = (0.0, 0.0)
    for r, row in enumerate(alloc):
        for c, q in enumerate(row):
            if q != 0:
                total = _add(total, _scale(p.cost[r][c], q))
    return total


def _objective_value(p: _Problem, alloc: list[list[float]]) -> float:
    total = 0.0
    for r, row in enumerate(alloc):
        for c, q in enumerate(row):
            o = p.orig[r][c]
            if o is not None and q > p.tol_q:
                total += q * o
    return _clean(total)


def _tableau(
    p: _Problem,
    st: _State,
    supply_left: list[float] | None = None,
    demand_left: list[float] | None = None,
    u: list[MV] | None = None,
    v: list[MV] | None = None,
    reduced: list[list[MV | None]] | None = None,
) -> list[list[float | str]]:
    with_rem = supply_left is not None
    basis = set(st.basis)
    header: list[float | str] = ["", *p.dests]
    if with_rem:
        header.append("Oferta")
    if u is not None:
        header.append("u")
    rows: list[list[float | str]] = [header]
    for r, name in enumerate(p.sources):
        row: list[float | str] = [name]
        for c in range(p.n):
            cost = _cost_label(p, (r, c))
            if (r, c) in basis:
                row.append(f"{_fmt_num(st.alloc[r][c])} ({cost})")
            else:
                d = reduced[r][c] if reduced is not None else None
                row.append(f"({cost}) d={_fmt_mv(d)}" if d is not None else f"({cost})")
        if with_rem:
            row.append(_clean(supply_left[r]))  # type: ignore[index]
        if u is not None:
            row.append(_fmt_mv(u[r]))
        rows.append(row)
    if demand_left is not None:
        dem: list[float | str] = ["Demanda", *[_clean(x) for x in demand_left]]
        if with_rem:
            dem.append("")
        rows.append(dem)
    if v is not None:
        vrow: list[float | str] = ["v", *[_fmt_mv(x) for x in v]]
        if u is not None:
            vrow.append("")
        rows.append(vrow)
    return rows


def _snapshot(st: _State) -> tuple[list[list[float]], list[list[int]]]:
    return [[_clean(q) for q in row] for row in st.alloc], [[r, c] for r, c in st.basis]


Pick = Callable[[list[float], list[float], set[int], set[int]], dict]


def _run_initial(p: _Problem, method: str, pick: Pick) -> tuple[_State, list[IterationStep]]:
    s = list(p.supply)
    d = list(p.demand)
    st = _State([[0.0] * p.n for _ in range(p.m)], [])
    rows = set(range(p.m))
    cols = set(range(p.n))
    steps: list[IterationStep] = []
    while rows and cols:
        choice = pick(s, d, rows, cols)
        r, c = choice["cell"]
        qty = min(s[r], d[c])
        st.alloc[r][c] += qty
        if (r, c) not in st.basis:
            st.basis.append((r, c))
        s[r] -= qty
        d[c] -= qty
        row_done = s[r] <= p.tol_q
        col_done = d[c] <= p.tol_q
        if row_done:
            s[r] = 0.0
        if col_done:
            d[c] = 0.0
        # Si se agotan fila y columna a la vez, solo se tacha una: la otra queda
        # con 0 y recibirá una asignación básica de 0 (degeneración controlada).
        if len(rows) == 1 and len(cols) == 1:
            crossed = "both"
        elif row_done and (not col_done or len(rows) > 1):
            crossed = "row"
        else:
            crossed = "col"
        if crossed != "col":
            rows.discard(r)
        if crossed != "row":
            cols.discard(c)

        label = _route_label(p, (r, c))
        if crossed == "both":
            crossed_text = "Se completan la última fila y la última columna."
        elif crossed == "row":
            crossed_text = f"Se agota la oferta de {p.sources[r]}; se tacha su fila."
        else:
            crossed_text = f"Se cubre la demanda de {p.dests[c]}; se tacha su columna."
        reason = (
            f"{choice['reason']} Se asignan min({_fmt_num(s[r] + qty)}, {_fmt_num(d[c] + qty)}) = "
            f"{_fmt_num(qty)} unidades. {crossed_text}"
        )
        if qty <= p.tol_q:
            reason += " Es una asignación de 0: la celda queda en la base para completar m + n - 1 celdas básicas."
        alloc_snap, basis_snap = _snapshot(st)
        orig = p.orig[r][c]
        meta: dict = {
            "phase": "initial",
            "cell": [r, c],
            "route": _route_name(p, (r, c)),
            "qty": _clean(qty),
            "cost": "M" if orig is None else orig,
            "reason": reason,
            "crossed": crossed,
        }
        if choice.get("row_pen") is not None:
            meta["row_penalties"] = [None if x is None else _out_mv(x) for x in choice["row_pen"]]
            meta["col_penalties"] = [None if x is None else _out_mv(x) for x in choice["col_pen"]]
        meta.update(
            {
                "supply_left": [_clean(x) for x in s],
                "demand_left": [_clean(x) for x in d],
                "alloc": alloc_snap,
                "basis": basis_snap,
                "sources": p.sources,
                "dests": p.dests,
            }
        )
        steps.append(
            IterationStep(
                index=0,
                method=method,
                title=f"{METHOD_LABEL[method]}: {_fmt_num(qty)} unidades a {label} (costo {_cost_label(p, (r, c))})",
                tableau=_tableau(p, st, supply_left=s, demand_left=d),
                meta=meta,
            )
        )
    return st, steps


def _northwest(p: _Problem) -> tuple[_State, list[IterationStep]]:
    def pick(_s: list[float], _d: list[float], rows: set[int], cols: set[int]) -> dict:
        cell = (min(rows), min(cols))
        return {"cell": cell, "reason": f"La esquina superior izquierda disponible es {_route_label(p, cell)}."}

    return _run_initial(p, "northwest", pick)


def _cheapest(p: _Problem, rows: list[int], cols: list[int], s: list[float], d: list[float]) -> Cell:
    best: Cell | None = None
    best_qty = -1.0
    for r in rows:
        for c in cols:
            qty = min(s[r], d[c])
            if best is None:
                best, best_qty = (r, c), qty
                continue
            cmp = _cmp(p.cost[r][c], p.cost[best[0]][best[1]], p.tol_c)
            if cmp < 0 or (cmp == 0 and qty > best_qty + p.tol_q):
                best, best_qty = (r, c), qty
    assert best is not None
    return best


def _adjective(p: _Problem) -> str:
    return "barata" if p.sign == 1 else "rentable"


def _least_cost(p: _Problem) -> tuple[_State, list[IterationStep]]:
    def pick(s: list[float], d: list[float], rows: set[int], cols: set[int]) -> dict:
        cell = _cheapest(p, sorted(rows), sorted(cols), s, d)
        return {
            "cell": cell,
            "reason": f"{_route_label(p, cell)} es la ruta disponible más "
            f"{'barata' if p.sign == 1 else 'rentable'} (costo {_cost_label(p, cell)}).",
        }

    return _run_initial(p, "least_cost", pick)


def _sorted_mv(p: _Problem, values: list[MV]) -> list[MV]:
    return sorted(values, key=cmp_to_key(lambda a, b: _cmp(a, b, p.tol_c)))


def _vogel(p: _Problem) -> tuple[_State, list[IterationStep]]:
    def pick(s: list[float], d: list[float], rows: set[int], cols: set[int]) -> dict:
        R = sorted(rows)
        C = sorted(cols)
        if len(R) == 1 or len(C) == 1:
            cell = _cheapest(p, R, C, s, d)
            return {
                "cell": cell,
                "reason": f"Solo queda una {'fila' if len(R) == 1 else 'columna'}: se asigna en su celda más "
                f"{_adjective(p)}, {_route_label(p, cell)}.",
            }
        row_pen: list[MV | None] = [None] * p.m
        col_pen: list[MV | None] = [None] * p.n
        lines: list[tuple[str, int, MV, MV]] = []
        for r in R:
            vals = _sorted_mv(p, [p.cost[r][c] for c in C])
            row_pen[r] = _sub(vals[1], vals[0])
            lines.append(("row", r, row_pen[r], vals[0]))  # type: ignore[arg-type]
        for c in C:
            vals = _sorted_mv(p, [p.cost[r][c] for r in R])
            col_pen[c] = _sub(vals[1], vals[0])
            lines.append(("col", c, col_pen[c], vals[0]))  # type: ignore[arg-type]
        # Mayor penalización; empate → la línea con el costo mínimo más bajo; luego filas antes que columnas.
        best = lines[0]
        for line in lines[1:]:
            by_pen = _cmp(line[2], best[2], p.tol_c)
            if by_pen > 0 or (by_pen == 0 and _cmp(line[3], best[3], p.tol_c) < 0):
                best = line
        kind, idx, pen, _ = best
        cell = _cheapest(p, [idx], C, s, d) if kind == "row" else _cheapest(p, R, [idx], s, d)
        where = f"la fila {p.sources[idx]}" if kind == "row" else f"la columna {p.dests[idx]}"
        return {
            "cell": cell,
            "row_pen": row_pen,
            "col_pen": col_pen,
            "reason": f"La mayor penalización es {_fmt_mv(pen)}, en {where}. Se asigna en su celda más "
            f"{_adjective(p)}, {_route_label(p, cell)} (costo {_cost_label(p, cell)}).",
        }

    return _run_initial(p, "vogel", pick)


def _complete_basis(p: _Problem, st: _State) -> None:
    """Completa la base a m+n-1 celdas sin formar ciclos (red de seguridad)."""
    m, n = p.m, p.n
    parent = list(range(m + n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    kept: list[Cell] = []
    for r, c in st.basis:
        a, b = find(r), find(m + c)
        if a != b:
            parent[a] = b
            kept.append((r, c))
    st.basis = kept
    if len(kept) >= m + n - 1:
        return
    candidates = [(r, c) for r in range(m) for c in range(n) if (r, c) not in kept]
    candidates.sort(key=cmp_to_key(lambda x, y: _cmp(p.cost[x[0]][x[1]], p.cost[y[0]][y[1]], p.tol_c)))
    for r, c in candidates:
        a, b = find(r), find(m + c)
        if a != b:
            parent[a] = b
            st.basis.append((r, c))
            if len(st.basis) >= m + n - 1:
                break


def _duals(p: _Problem, basis: list[Cell]) -> tuple[list[MV], list[MV]]:
    u: list[MV | None] = [None] * p.m
    v: list[MV | None] = [None] * p.n
    u[0] = (0.0, 0.0)
    changed = True
    while changed:
        changed = False
        for r, c in basis:
            if u[r] is not None and v[c] is None:
                v[c] = _sub(p.cost[r][c], u[r])  # type: ignore[arg-type]
                changed = True
            elif v[c] is not None and u[r] is None:
                u[r] = _sub(p.cost[r][c], v[c])  # type: ignore[arg-type]
                changed = True
    if any(x is None for x in u) or any(x is None for x in v):
        raise ValueError("No se pudieron calcular los multiplicadores uᵢ, vⱼ (base incompleta).")
    return u, v  # type: ignore[return-value]


def _reduced(p: _Problem, basis: list[Cell], u: list[MV], v: list[MV]) -> list[list[MV | None]]:
    bset = set(basis)
    return [
        [None if (r, c) in bset else _sub(_sub(p.cost[r][c], u[r]), v[c]) for c in range(p.n)]
        for r in range(p.m)
    ]


def _tree_path(p: _Problem, basis: list[Cell], r0: int, c0: int) -> list[Cell]:
    """Camino en el árbol de la base desde la fila r0 hasta la columna c0."""
    m = p.m
    target = m + c0
    prev: dict[int, tuple[int, Cell]] = {}
    seen = {r0}
    queue = deque([r0])
    while queue:
        node = queue.popleft()
        if node == target:
            break
        for r, c in basis:
            nxt = -1
            if node < m and r == node:
                nxt = m + c
            elif node >= m and c == node - m:
                nxt = r
            if nxt < 0 or nxt in seen:
                continue
            seen.add(nxt)
            prev[nxt] = (node, (r, c))
            queue.append(nxt)
    path: list[Cell] = []
    cur = target
    while cur != r0:
        if cur not in prev:
            raise ValueError("No se encontró el ciclo de mejora (base inválida).")
        node, cell = prev[cur]
        path.insert(0, cell)
        cur = node
    return path


def _modi(p: _Problem, start: _State, record: bool) -> tuple[_State, list[IterationStep], int, bool]:
    st = start.copy()
    steps: list[IterationStep] = []
    pivots = 0
    while True:
        u, v = _duals(p, st.basis)
        reduced = _reduced(p, st.basis, u, v)
        enter: Cell | None = None
        for r in range(p.m):
            for c in range(p.n):
                d = reduced[r][c]
                if d is None or _cmp(d, (0.0, 0.0), p.tol_c) >= 0:
                    continue
                if enter is None:
                    enter = (r, c)
                elif pivots < BLAND_AFTER and _cmp(d, reduced[enter[0]][enter[1]], p.tol_c) < 0:  # type: ignore[arg-type]
                    enter = (r, c)
        before = _alloc_cost(p, st.alloc)
        if enter is None or pivots >= MAX_PIVOTS:
            if record:
                steps.append(_modi_step(p, st, u, v, reduced, None, [], 0.0, None, pivots))
            return st, steps, pivots, enter is None
        path = _tree_path(p, st.basis, enter[0], enter[1])
        cycle: list[tuple[int, int, int]] = [(enter[0], enter[1], 1)]
        cycle += [(r, c, -1 if k % 2 == 0 else 1) for k, (r, c) in enumerate(path)]
        minus = [cell for cell in cycle if cell[2] == -1]
        theta = min(st.alloc[r][c] for r, c, _ in minus)
        # Sale la primera celda con signo - que llega a 0; con Bland, la de menor índice.
        ties = [cell for cell in minus if st.alloc[cell[0]][cell[1]] <= theta + p.tol_q]
        leave_cell = ties[0] if pivots < BLAND_AFTER else min(ties, key=lambda x: x[0] * p.n + x[1])
        leave: Cell = (leave_cell[0], leave_cell[1])
        if record:
            steps.append(_modi_step(p, st, u, v, reduced, enter, cycle, theta, leave, pivots, before))
        for r, c, sgn in cycle:
            st.alloc[r][c] += sgn * theta
            if abs(st.alloc[r][c]) <= p.tol_q:
                st.alloc[r][c] = 0.0
        st.alloc[leave[0]][leave[1]] = 0.0
        st.basis = [cell for cell in st.basis if cell != leave]
        st.basis.append(enter)
        pivots += 1


def _modi_step(
    p: _Problem,
    st: _State,
    u: list[MV],
    v: list[MV],
    reduced: list[list[MV | None]],
    enter: Cell | None,
    cycle: list[tuple[int, int, int]],
    theta: float,
    leave: Cell | None,
    pivot: int,
    before: MV | None = None,
) -> IterationStep:
    sign = p.sign

    def shown(x: MV) -> MV:
        return _scale(x, sign)

    alloc_snap, basis_snap = _snapshot(st)
    reduced_out = [
        [None if d is None or p.orig[r][c] is None else _out_mv(shown(d)) for c, d in enumerate(row)]
        for r, row in enumerate(reduced)
    ]
    cost_now = _objective_value(p, st.alloc)
    if enter is not None:
        assert leave is not None
        delta = shown(reduced[enter[0]][enter[1]])  # type: ignore[arg-type]
        change = _clean(theta * delta[1])
        title = (
            f"MODI {pivot + 1}: entra {_route_label(p, enter)}, sale {_route_label(p, leave)} "
            f"(theta = {_fmt_num(theta)})"
        )
        reason = (
            f"{_route_label(p, enter)} tiene el costo reducido "
            f"{'más negativo' if sign == 1 else 'más positivo'} ({_fmt_mv(delta)}): "
            f"cada unidad enviada por ahí {'baja el costo' if sign == 1 else 'sube la ganancia'} en "
            f"{_fmt_mv(_scale(delta, -sign))}. "
            f"En el ciclo, la menor cantidad de las celdas con signo - es theta = {_fmt_num(theta)}, "
            f"en {_route_label(p, leave)}, que sale de la base."
        )
        if theta <= p.tol_q:
            reason += " Como theta = 0 el cambio es degenerado: la base cambia pero el costo no."
        else:
            reason += (
                f" El {'costo' if sign == 1 else 'valor'} pasa de {_fmt_num(cost_now)} a "
                f"{_fmt_num(cost_now + change)}."
            )
    else:
        title = "MODI: todos los costos reducidos cumplen la condición de óptimo"
        reason = (
            "Ningún costo reducido es negativo: ninguna ruta sin usar puede bajar el costo total. La solución es óptima."
            if sign == 1
            else "Ningún costo reducido es positivo: ninguna ruta sin usar puede subir la ganancia total. "
            "La solución es óptima."
        )
    return IterationStep(
        index=0,
        method="modi",
        title=title,
        tableau=_tableau(p, st, u=u, v=v, reduced=reduced),
        meta={
            "phase": "modi",
            "u": [_out_mv(shown(x)) for x in u],
            "v": [_out_mv(shown(x)) for x in v],
            "reduced": reduced_out,
            "enter": list(enter) if enter is not None else None,
            "delta": _out_mv(shown(reduced[enter[0]][enter[1]])) if enter is not None else None,  # type: ignore[arg-type]
            "cycle": [list(cell) for cell in cycle],
            "theta": _clean(theta),
            "leave": list(leave) if leave is not None else None,
            "cost": _fmt_mv(shown(before)) if before is not None and _has_m(before) else cost_now,
            "reason": reason,
            "alloc": alloc_snap,
            "basis": basis_snap,
            "sources": p.sources,
            "dests": p.dests,
        },
    )


def _forbidden_used(p: _Problem, alloc: list[list[float]]) -> list[Cell]:
    return [
        (r, c)
        for r in range(p.m)
        for c in range(p.n)
        if p.orig[r][c] is None and alloc[r][c] > p.tol_q
    ]


def _modi_check_step(p: _Problem, st: _State, u: list[MV], v: list[MV]) -> IterationStep:
    reduced = _reduced(p, st.basis, u, v)
    step = _modi_step(p, st, u, v, reduced, None, [], 0.0, None, 0)
    worst: Cell | None = None
    for r in range(p.m):
        for c in range(p.n):
            d = reduced[r][c]
            if d is None or _cmp(d, (0.0, 0.0), p.tol_c) >= 0:
                continue
            if worst is None or _cmp(d, reduced[worst[0]][worst[1]], p.tol_c) < 0:  # type: ignore[arg-type]
                worst = (r, c)
    step.method = "modi_check"
    step.meta["phase"] = "check"
    if worst is not None:
        delta = _scale(reduced[worst[0]][worst[1]], p.sign)  # type: ignore[arg-type]
        step.title = f"Prueba de optimalidad: {_route_label(p, worst)} todavía puede mejorar"
        step.meta["enter"] = list(worst)
        step.meta["delta"] = _out_mv(delta)
        step.meta["reason"] = (
            f"Con los multiplicadores uᵢ + vⱼ = costo de cada celda básica, {_route_label(p, worst)} "
            f"tiene costo reducido {_fmt_mv(delta)}: "
            f"{'usarla bajaría el costo' if p.sign == 1 else 'usarla subiría la ganancia'}. "
            "La solución inicial no es óptima; elige «Vogel + MODI» para llegar al óptimo."
        )
    else:
        step.title = "Prueba de optimalidad: la solución inicial ya es óptima"
    return step


def _sensitivity(p: _Problem, u: list[MV], v: list[MV], reduced: list[list[MV | None]]) -> SensitivityBlock:
    sign = p.sign
    rows: list[dict] = []
    for r, row in enumerate(reduced):
        for c, d in enumerate(row):
            if d is None or p.orig[r][c] is None:
                continue
            rows.append(
                {
                    "variable": _route_name(p, (r, c)),
                    "origen": p.sources[r],
                    "destino": p.dests[c],
                    "costo_unitario": p.orig[r][c],
                    "reduced_cost": _out_mv(_scale(d, sign)),
                    "u_i": _out_mv(_scale(u[r], sign)),
                    "v_j": _out_mv(_scale(v[c], sign)),
                }
            )
    shadow = [
        {"restriccion": f"Oferta {name}", "tipo": "u", "nombre": name, "valor": _out_mv(_scale(u[r], sign))}
        for r, name in enumerate(p.sources)
    ] + [
        {"restriccion": f"Demanda {name}", "tipo": "v", "nombre": name, "valor": _out_mv(_scale(v[c], sign))}
        for c, name in enumerate(p.dests)
    ]
    return SensitivityBlock(reduced_costs=rows, shadow_prices=shadow)


def solve(req: TransportRequest) -> ModuleResult:
    req = req.model_copy(deep=True)
    _parse(req)
    warnings: list[str] = []
    p = _Problem(req, warnings)
    m, n = p.m, p.n
    initial_method = "vogel" if req.method == "modi_auto" else req.method

    if initial_method == "northwest":
        init_state, init_steps = _northwest(p)
    elif initial_method == "least_cost":
        init_state, init_steps = _least_cost(p)
    else:
        init_state, init_steps = _vogel(p)
    _complete_basis(p, init_state)
    iterations: list[IterationStep] = list(init_steps)

    converged = True
    pivots = 0
    optimal: _State | None = None
    if req.method == "modi_auto":
        final, modi_steps, pivots, converged = _modi(p, init_state, True)
        iterations.extend(modi_steps)
    else:
        final = init_state
        # Prueba de optimalidad sobre la solución inicial y óptimo de referencia.
        u0, v0 = _duals(p, final.basis)
        iterations.append(_modi_check_step(p, final, u0, v0))
        best, _, _, best_ok = _modi(p, final, False)
        if best_ok:
            optimal = best
    for k, step in enumerate(iterations):
        step.index = k

    alloc = final.alloc
    used = _forbidden_used(p, alloc)
    value = _objective_value(p, alloc)
    optimal_cost = (
        _objective_value(p, optimal.alloc)
        if optimal is not None and not _forbidden_used(p, optimal.alloc)
        else None
    )
    lead: list[str] = []
    status = SolveStatus.optimal
    if req.method == "modi_auto" or optimal is None:
        blocked, blocked_alloc = used, alloc
    else:
        blocked, blocked_alloc = _forbidden_used(p, optimal.alloc), optimal.alloc
    if blocked:
        status = SolveStatus.infeasible
        units = _fmt_num(sum(blocked_alloc[r][c] for r, c in blocked))
        srcs = {r for r, _ in blocked}
        dsts = {c for _, c in blocked}
        if len(dsts) == 1:
            detail = f"{units} unidades hacia {p.dests[blocked[0][1]]} solo podrían llegar por rutas prohibidas"
        elif len(srcs) == 1:
            detail = f"{units} unidades de {p.sources[blocked[0][0]]} solo podrían salir por rutas prohibidas"
        else:
            detail = "haría falta enviar " + ", ".join(
                f"{_fmt_num(blocked_alloc[r][c])} por {_route_label(p, (r, c))}" for r, c in blocked
            )
        lead.append(
            f"No hay forma de cubrir la demanda sin usar rutas prohibidas: {detail}. "
            "Habilita alguna ruta o revisa la oferta y la demanda."
        )
    elif req.method != "modi_auto":
        label = METHOD_LABEL[req.method]
        better = "el costo óptimo es" if p.sign == 1 else "el valor óptimo es"
        if used:
            status = SolveStatus.feasible
            routes = ", ".join(_route_label(p, cell) for cell in used)
            text = f"La solución inicial de {label} usa rutas prohibidas ({routes}), así que no es válida."
            if optimal_cost is not None:
                text += f" Con MODI se evitan y {better} {_fmt_num(optimal_cost)}."
            lead.append(text)
        elif optimal_cost is not None and abs(optimal_cost - value) > 1e-9 * max(
            1.0, abs(value), abs(optimal_cost)
        ):
            status = SolveStatus.feasible
            lead.append(
                f"Esta es la solución inicial de {label} y no es óptima: con MODI el "
                f"{'costo baja' if p.sign == 1 else 'valor sube'} de {_fmt_num(value)} a "
                f"{_fmt_num(optimal_cost)} ({_fmt_num(abs(value - optimal_cost))} de diferencia)."
            )
    elif not converged:
        status = SolveStatus.feasible
        lead.append(f"MODI se detuvo tras {MAX_PIVOTS} iteraciones sin confirmar el óptimo.")
    warnings[0:0] = lead

    positive = sum(1 for r, c in final.basis if alloc[r][c] > p.tol_q)
    if status != SolveStatus.infeasible and positive < m + n - 1:
        warnings.append(
            f"Solución degenerada: {positive} rutas con envío y m + n - 1 = {m + n - 1}. "
            "Se usaron celdas básicas con 0 para calcular los multiplicadores."
        )

    u, v = _duals(p, final.basis)
    reduced = _reduced(p, final.basis, u, v)
    sensitivity = _sensitivity(p, u, v, reduced)
    if status == SolveStatus.optimal:
        alt = [
            _route_label(p, (r, c))
            for r in range(m)
            for c in range(n)
            if reduced[r][c] is not None
            and p.orig[r][c] is not None
            and not _is_dummy(p, (r, c))
            and _cmp(reduced[r][c], (0.0, 0.0), p.tol_c) == 0  # type: ignore[arg-type]
        ]
        if alt:
            warnings.append(
                f"Hay óptimos alternativos: {', '.join(alt[:5])}{'…' if len(alt) > 5 else ''} "
                f"{'tiene' if len(alt) == 1 else 'tienen'} costo reducido 0; se pueden usar sin cambiar el "
                f"{'costo' if p.sign == 1 else 'valor'} total."
            )

    shipments: dict[str, float] = {}
    ship_rows: list[list] = []
    for r in range(m):
        for c in range(n):
            q = alloc[r][c]
            if q <= p.tol_q:
                continue
            shipments[_route_name(p, (r, c))] = _clean(q)
            unit = p.orig[r][c]
            ship_rows.append(
                [
                    p.sources[r],
                    p.dests[c],
                    _clean(q),
                    "M" if unit is None else unit,
                    "M" if unit is None else _clean(q * unit),
                ]
            )

    real_m = m - 1 if p.dummy_row else m
    real_n = n - 1 if p.dummy_col else n
    source_rows = []
    for r, name in enumerate(p.sources[:real_m]):
        sent = _clean(sum(alloc[r][:real_n]))
        source_rows.append([name, _clean(p.supply[r]), sent, _clean(p.supply[r] - sent)])
    dest_rows = []
    for c, name in enumerate(p.dests[:real_n]):
        got = _clean(sum(alloc[r][c] for r in range(real_m)))
        dest_rows.append([name, _clean(p.demand[c]), got, _clean(p.demand[c] - got)])
    cost_rows: list[list] = [
        [name, *["M" if o is None else o for o in p.orig[r]], _clean(p.supply[r])]
        for r, name in enumerate(p.sources)
    ]
    cost_rows.append(["Demanda", *[_clean(x) for x in p.demand], ""])
    tables = [
        NamedTable(name="costos", columns=["origen", *p.dests, "oferta"], rows=cost_rows),
        NamedTable(
            name="envios",
            columns=["origen", "destino", "cantidad", "costo_unitario", "subtotal"],
            rows=ship_rows,
        ),
        NamedTable(name="resumen_origenes", columns=["origen", "oferta", "enviado", "sin_enviar"], rows=source_rows),
        NamedTable(name="resumen_destinos", columns=["destino", "demanda", "recibido", "faltante"], rows=dest_rows),
    ]

    metrics: dict[str, float] = {
        "basic_cells": float(positive),
        "routes_used": float(
            sum(1 for row in ship_rows if row[0] != DUMMY_SOURCE and row[1] != DUMMY_DEST)
        ),
        "units_shipped": _clean(sum(row[2] for row in source_rows)),
        "unused_supply": _clean(sum(row[3] for row in source_rows)),
        "unmet_demand": _clean(sum(row[3] for row in dest_rows)),
    }
    if not used:
        metrics["total_cost"] = value
    if req.method == "modi_auto":
        metrics["modi_iterations"] = float(pivots)
    if optimal_cost is not None:
        metrics["optimal_cost"] = optimal_cost
        metrics["gap"] = _clean(abs(value - optimal_cost))

    graph = GraphMatrix(
        type="matrix",
        row_labels=p.sources,
        col_labels=p.dests,
        values=[[_clean(q) for q in row] for row in alloc],
        title="Matriz de envíos (transporte)",
        subtitle="Cantidad enviada de cada origen a cada destino",
        value_label="Cantidad enviada",
    )

    result = ModuleResult(
        module="transport",
        status=status,
        solution=SolutionBlock(
            variables=shipments,
            objective_value=None if status == SolveStatus.infeasible or used else value,
            objective_sense="min" if p.sign == 1 else "max",
            metrics=metrics,
        ),
        iterations=iterations,
        sensitivity=sensitivity,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
