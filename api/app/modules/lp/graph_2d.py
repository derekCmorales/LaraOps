from __future__ import annotations

import math
from dataclasses import dataclass

from app.modules.lp.models import ConstraintSense, LPRequest
from app.schemas.result import GraphXY, NamedTable

EPS = 1e-9
FEAS_TOL = 1e-7
BOX_TOL = 1e-8
VIEW_X = "_vista_x"
VIEW_Y = "_vista_y"
NICE_MANTISSAS = (1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0)


@dataclass(frozen=True)
class Plane:
    a: float
    b: float
    rhs: float
    source: str
    view_clip: bool = False


@dataclass(frozen=True)
class Vertex:
    x: float
    y: float
    sources: tuple[str, ...]


def build_2d_graph(
    req: LPRequest,
    x_star: dict[str, float],
    z_star: float,
    z_offset: float = 0.0,
) -> GraphXY | None:
    """Feasible-region polygon and clipped constraint lines for two variables."""
    names = _decision_names(req)
    if len(names) != 2:
        return None

    x_name, y_name = names
    ox = float(x_star.get(x_name, 0.0))
    oy = float(x_star.get(y_name, 0.0))
    c1 = float(req.objective.get(x_name, 0.0))
    c2 = float(req.objective.get(y_name, 0.0))

    planes, equalities = _model_planes(req, x_name, y_name)
    seed_vertices = _enumerate_vertices(planes, equalities)
    x_max, y_max = _view_box(planes + equalities, seed_vertices, ox, oy)

    view_planes = [
        Plane(1.0, 0.0, x_max, VIEW_X, view_clip=True),
        Plane(0.0, 1.0, y_max, VIEW_Y, view_clip=True),
    ]
    closed_vertices = _enumerate_vertices(planes + view_planes, equalities)
    fill_poly = _sort_ccw(closed_vertices)
    labeled = [v for v in seed_vertices if len(v.sources) >= 2]

    series: list[dict] = []
    if fill_poly and len(fill_poly) >= 3 and not equalities:
        xs = [_clean(v.x) for v in fill_poly] + [_clean(fill_poly[0].x)]
        ys = [_clean(v.y) for v in fill_poly] + [_clean(fill_poly[0].y)]
        series.append({"name": "feasible_region", "x": xs, "y": ys, "role": "fill"})

    for c in req.constraints:
        ax = float(c.coeffs.get(x_name, 0.0))
        ay = float(c.coeffs.get(y_name, 0.0))
        clipped = _clip_line_to_box(ax, ay, float(c.rhs), 0.0, 0.0, x_max, y_max)
        if len(clipped) < 2:
            continue
        series.append(
            {
                "name": f"constraint:{c.id}",
                "x": [_clean(p[0]) for p in clipped],
                "y": [_clean(p[1]) for p in clipped],
                "role": "line",
                "equation": _fmt_equation(ax, ay, float(c.rhs), x_name, y_name),
            }
        )
    for plane in planes:
        if not plane.source.startswith("cota "):
            continue
        clipped = _clip_line_to_box(plane.a, plane.b, plane.rhs, 0.0, 0.0, x_max, y_max)
        if len(clipped) < 2:
            continue
        series.append(
            {
                "name": f"constraint:{plane.source}",
                "x": [_clean(p[0]) for p in clipped],
                "y": [_clean(p[1]) for p in clipped],
                "role": "line",
                "equation": _fmt_equation(plane.a, plane.b, plane.rhs, x_name, y_name),
            }
        )

    z_line = _clip_line_to_box(c1, c2, z_star, 0.0, 0.0, x_max, y_max)
    if len(z_line) >= 2:
        series.append(
            {
                "name": "objective_level",
                "x": [_clean(p[0]) for p in z_line],
                "y": [_clean(p[1]) for p in z_line],
                "role": "line",
                "equation": _fmt_equation(c1, c2, z_star, x_name, y_name),
            }
        )

    if labeled:
        series.append(
            {
                "name": "vertices",
                "x": [_clean(v.x) for v in labeled],
                "y": [_clean(v.y) for v in labeled],
                "role": "vertices",
                "meta": [
                    {
                        "x": _clean(v.x),
                        "y": _clean(v.y),
                        "z": _clean(c1 * v.x + c2 * v.y + z_offset),
                        "sources": list(v.sources),
                    }
                    for v in labeled
                ],
            }
        )

    series.append(
        {
            "name": "optimum",
            "x": [_clean(ox)],
            "y": [_clean(oy)],
            "role": "point",
            "meta": [
                {
                    "x": _clean(ox),
                    "y": _clean(oy),
                    "z": _clean(z_star + z_offset),
                    "sources": ["óptimo"],
                }
            ],
        }
    )

    return GraphXY(
        type="xy",
        kind="lp2d",
        series=series,
        x_label=x_name,
        y_label=y_name,
        title="Región factible y punto óptimo",
        subtitle=(
            f"Óptimo: {x_name} = {_fmt_num(ox)}, "
            f"{y_name} = {_fmt_num(oy)}, Z = {_fmt_num(z_star + z_offset)}"
        ),
    )


def vertices_named_table(
    graph: GraphXY,
    ox: float,
    oy: float,
    *,
    maximize: bool,
    oz: float | None = None,
) -> NamedTable | None:
    """Corner-point table for the graphical method (evaluate Z at each vertex)."""
    if graph.kind == "lp3d":
        return _vertices_table_3d(graph, ox, oy, 0.0 if oz is None else oz, maximize=maximize)
    verts = next((s for s in graph.series if s.get("name") == "vertices"), None)
    meta = verts.get("meta") if verts else None
    if not meta:
        return None
    x_name = graph.x_label or "x"
    y_name = graph.y_label or "y"
    rows: list[list[float | str]] = []
    for item in meta:
        x = _clean(float(item["x"]))
        y = _clean(float(item["y"]))
        z = _clean(float(item.get("z", 0.0)))
        origen = " ∩ ".join(str(s) for s in item.get("sources") or [])
        is_opt = abs(x - ox) <= FEAS_TOL and abs(y - oy) <= FEAS_TOL
        rows.append([x, y, z, origen, "sí" if is_opt else ""])
    rows.sort(key=lambda r: float(r[2]), reverse=maximize)
    return NamedTable(
        name="vertices_feasible",
        columns=[x_name, y_name, "Z", "origen", "optimo"],
        rows=rows,
    )


def _vertices_table_3d(
    graph: GraphXY,
    ox: float,
    oy: float,
    oz: float,
    *,
    maximize: bool,
) -> NamedTable | None:
    verts = next((s for s in graph.series if s.get("name") == "vertices"), None)
    meta = verts.get("meta") if verts else None
    if not meta:
        return None
    x_name = graph.x_label or "x"
    y_name = graph.y_label or "y"
    z_name = graph.z_label or "z"
    rows: list[list[float | str]] = []
    for item in meta:
        x = _clean(float(item["x"]))
        y = _clean(float(item["y"]))
        zc = _clean(float(item.get("z", 0.0)))
        obj = _clean(float(item.get("objective", 0.0)))
        origen = " ∩ ".join(str(s) for s in item.get("sources") or [])
        is_opt = (
            abs(x - ox) <= FEAS_TOL and abs(y - oy) <= FEAS_TOL and abs(zc - oz) <= FEAS_TOL
        )
        rows.append([x, y, zc, obj, origen, "sí" if is_opt else ""])
    rows.sort(key=lambda r: float(r[3]), reverse=maximize)
    return NamedTable(
        name="vertices_feasible",
        columns=[x_name, y_name, z_name, "Z", "origen", "optimo"],
        rows=rows,
    )


def _decision_names(req: LPRequest) -> list[str]:
    if req.variable_names:
        return list(req.variable_names)
    names: set[str] = set(req.objective)
    for c in req.constraints:
        names.update(c.coeffs)
    return sorted(names)


def _var_bounds(req: LPRequest, name: str) -> tuple[float | None, float | None]:
    if req.bounds and name in req.bounds:
        lo, hi = req.bounds[name]
        return lo, hi
    return 0.0, None


def _model_planes(req: LPRequest, x_name: str, y_name: str) -> tuple[list[Plane], list[Plane]]:
    planes: list[Plane] = []
    equalities: list[Plane] = []
    for name in (x_name, y_name):
        lo, hi = _var_bounds(req, name)
        ax, ay = (1.0, 0.0) if name == x_name else (0.0, 1.0)
        if lo is not None:
            label = f"eje {name}" if abs(lo) < EPS else f"cota {name}"
            planes.append(Plane(-ax, -ay, -lo, label))
        if hi is not None:
            planes.append(Plane(ax, ay, hi, f"cota {name}"))

    for c in req.constraints:
        ax = float(c.coeffs.get(x_name, 0.0))
        ay = float(c.coeffs.get(y_name, 0.0))
        if abs(ax) < EPS and abs(ay) < EPS:
            continue
        if c.sense == ConstraintSense.eq:
            equalities.append(Plane(ax, ay, float(c.rhs), c.id))
            continue
        if c.sense == ConstraintSense.ge:
            planes.append(Plane(-ax, -ay, -float(c.rhs), c.id))
        else:
            planes.append(Plane(ax, ay, float(c.rhs), c.id))
    return planes, equalities


def _enumerate_vertices(planes: list[Plane], equalities: list[Plane]) -> list[Vertex]:
    boundaries = planes + equalities
    found: dict[tuple[float, float], Vertex] = {}
    for i, p in enumerate(boundaries):
        for q in boundaries[i + 1 :]:
            hit = _intersect(p, q)
            if hit is None:
                continue
            x, y = hit
            if not _feasible(x, y, planes, equalities):
                continue
            key = (round(x, 8), round(y, 8))
            sources = _sources_at(x, y, planes, equalities)
            found[key] = Vertex(x=x, y=y, sources=sources)
    return list(found.values())


def _intersect(p: Plane, q: Plane) -> tuple[float, float] | None:
    det = p.a * q.b - q.a * p.b
    if abs(det) < EPS:
        return None
    x = (p.rhs * q.b - q.rhs * p.b) / det
    y = (p.a * q.rhs - q.a * p.rhs) / det
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return x, y


def _feasible(x: float, y: float, planes: list[Plane], equalities: list[Plane]) -> bool:
    for p in planes:
        if p.a * x + p.b * y > p.rhs + FEAS_TOL:
            return False
    for eq in equalities:
        if abs(eq.a * x + eq.b * y - eq.rhs) > FEAS_TOL:
            return False
    return True


def _sources_at(x: float, y: float, planes: list[Plane], equalities: list[Plane]) -> tuple[str, ...]:
    hits: list[str] = []
    for p in planes + equalities:
        if p.view_clip:
            continue
        if abs(p.a * x + p.b * y - p.rhs) <= FEAS_TOL:
            hits.append(p.source)
    return tuple(hits)


def _view_box(
    lines: list[Plane],
    vertices: list[Vertex],
    ox: float,
    oy: float,
) -> tuple[float, float]:
    xs: list[float] = [0.0, max(ox, 0.0)]
    ys: list[float] = [0.0, max(oy, 0.0)]
    for v in vertices:
        if v.x >= -EPS:
            xs.append(v.x)
        if v.y >= -EPS:
            ys.append(v.y)
    for line in lines:
        if abs(line.b) < EPS and abs(line.a) > EPS:
            xv = line.rhs / line.a
            if xv > EPS:
                xs.append(xv)
        if abs(line.a) < EPS and abs(line.b) > EPS:
            yv = line.rhs / line.b
            if yv > EPS:
                ys.append(yv)
        if abs(line.a) > EPS and abs(line.b) > EPS:
            x_int = line.rhs / line.a
            y_int = line.rhs / line.b
            if x_int > EPS:
                xs.append(x_int)
            if y_int > EPS:
                ys.append(y_int)
    x_max = _nice_ceil(max(xs) * 1.12)
    y_max = _nice_ceil(max(ys) * 1.12)
    return max(x_max, 1.0), max(y_max, 1.0)


def _nice_ceil(value: float) -> float:
    if value <= 0:
        return 1.0
    exp = math.floor(math.log10(value))
    frac = value / (10**exp)
    for n in NICE_MANTISSAS:
        if frac <= n + 1e-12:
            return _clean(n * (10**exp))
    return _clean(10.0 * (10**exp))


def _sort_ccw(vertices: list[Vertex]) -> list[Vertex]:
    if len(vertices) < 3:
        return list(vertices)
    cx = sum(v.x for v in vertices) / len(vertices)
    cy = sum(v.y for v in vertices) / len(vertices)
    return sorted(vertices, key=lambda v: math.atan2(v.y - cy, v.x - cx))


def _clip_line_to_box(
    a: float,
    b: float,
    rhs: float,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
) -> list[tuple[float, float]]:
    if abs(a) < EPS and abs(b) < EPS:
        return []
    pts: list[tuple[float, float]] = []

    def add(x: float, y: float) -> None:
        if x_min - BOX_TOL <= x <= x_max + BOX_TOL and y_min - BOX_TOL <= y <= y_max + BOX_TOL:
            key = (round(x, 8), round(y, 8))
            if all(abs(key[0] - p[0]) > BOX_TOL or abs(key[1] - p[1]) > BOX_TOL for p in pts):
                pts.append((x, y))

    if abs(b) > EPS:
        add(x_min, (rhs - a * x_min) / b)
        add(x_max, (rhs - a * x_max) / b)
    if abs(a) > EPS:
        add((rhs - b * y_min) / a, y_min)
        add((rhs - b * y_max) / a, y_max)

    if len(pts) < 2:
        return pts
    pts.sort()
    return [pts[0], pts[-1]]


def _fmt_equation(ax: float, ay: float, rhs: float, x_name: str, y_name: str) -> str:
    terms: list[str] = []
    for coef, name in ((ax, x_name), (ay, y_name)):
        if abs(coef) < EPS:
            continue
        mag = _fmt_num(abs(coef))
        body = name if mag == "1" else f"{mag} {name}"
        if not terms:
            terms.append(body if coef > 0 else f"-{body}")
        else:
            terms.append(f"+ {body}" if coef > 0 else f"- {body}")
    left = " ".join(terms) if terms else "0"
    return f"{left} = {_fmt_num(rhs)}"


def _fmt_num(value: float) -> str:
    if abs(value - round(value)) < BOX_TOL:
        return str(int(round(value)))
    return f"{value:.4g}"


def _clean(value: float) -> float:
    rounded = float(round(value, 10))
    if abs(rounded) < 1e-12:
        return 0.0
    return rounded
