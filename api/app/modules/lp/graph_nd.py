"""Dispatch the LP picture: plane (2 vars), polyhedron (3), or a slice."""

from __future__ import annotations

from app.modules.lp.graph_2d import _clean, _fmt_num, build_2d_graph
from app.modules.lp.graph_3d import build_3d_graph
from app.modules.lp.models import LPConstraint, LPRequest
from app.schemas.result import GraphXY

EPS = 1e-9


def build_lp_graph(
    req: LPRequest, x_star: dict[str, float], z_star: float
) -> tuple[GraphXY | None, list[str]]:
    names = _decision_names(req)
    warnings: list[str] = []
    if len(names) < 2:
        return None, warnings

    free, unknown = _free_names(req, names)
    if unknown:
        warnings.append(
            "Variables de gráfico ignoradas porque no están en el modelo: " + ", ".join(unknown)
        )
    if len(free) < 2:
        return None, warnings

    sliced = set(free) != set(names)
    if not sliced and len(free) == 2:
        return build_2d_graph(req, x_star, z_star), warnings

    reduced, z_offset, fixed = _reduce(req, x_star, free)
    z_free = z_star - z_offset
    if len(free) == 2:
        graph = build_2d_graph(reduced, x_star, z_free, z_offset)
    else:
        graph = build_3d_graph(reduced, x_star, z_free, z_offset, fixed if sliced else None)
        if graph is None and sliced:
            warnings.append(
                "No se pudo construir el poliedro 3D. Elige otras tres variables o un corte de dos."
            )
    if graph is None:
        return None, warnings
    if sliced and len(free) == 2:
        held = ", ".join(f"{name} = {_fmt_num(value)}" for name, value in fixed.items())
        graph = graph.model_copy(
            update={
                "title": "Corte por el óptimo",
                "subtitle": f"{graph.subtitle}. Fijas en el óptimo: {held}",
            }
        )
    return graph, warnings


def _decision_names(req: LPRequest) -> list[str]:
    if req.variable_names:
        return list(req.variable_names)
    names: set[str] = set(req.objective)
    for c in req.constraints:
        names.update(c.coeffs)
    return sorted(names)


def _free_names(req: LPRequest, names: list[str]) -> tuple[list[str], list[str]]:
    requested = _dedupe(list(req.graph_variables or []))
    if not requested:
        if len(names) <= 3:
            return list(names), []
        return list(names[:3]), []
    known = [n for n in requested if n in names]
    unknown = [n for n in requested if n not in names]
    if len(known) >= 2:
        return known[:3], unknown
    if len(names) <= 3:
        return list(names), unknown
    return list(names[:3]), unknown


def _dedupe(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def _reduce(
    req: LPRequest, x_star: dict[str, float], free: list[str]
) -> tuple[LPRequest, float, dict[str, float]]:
    names = _decision_names(req)
    fixed = {name: float(x_star.get(name, 0.0)) for name in names if name not in free}
    z_offset = sum(float(req.objective.get(name, 0.0)) * value for name, value in fixed.items())
    constraints: list[LPConstraint] = []
    for c in req.constraints:
        shift = sum(float(c.coeffs.get(name, 0.0)) * value for name, value in fixed.items())
        coeffs = {name: float(c.coeffs.get(name, 0.0)) for name in free}
        if all(abs(coeffs[name]) < EPS for name in free):
            continue
        constraints.append(
            LPConstraint(id=c.id, coeffs=coeffs, sense=c.sense, rhs=_clean(float(c.rhs) - shift))
        )
    bounds = None
    if req.bounds:
        bounds = {name: req.bounds[name] for name in free if name in req.bounds}
    reduced = LPRequest(
        sense=req.sense,
        objective={name: float(req.objective.get(name, 0.0)) for name in free},
        constraints=constraints,
        variable_names=list(free),
        bounds=bounds,
        include_iterations=False,
        include_sensitivity=False,
        include_graph=True,
    )
    return reduced, z_offset, fixed
