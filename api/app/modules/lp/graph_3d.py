from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations

import numpy as np

from app.modules.lp.graph_2d import _clean, _fmt_num, _nice_ceil
from app.modules.lp.models import ConstraintSense, LPRequest
from app.schemas.result import GraphXY

EPS = 1e-9
FEAS_TOL = 1e-7
RANK_TOL = 1e-8
MAX_TRIPLES = 8000
VIEW_PREFIX = "_vista_"


@dataclass(frozen=True)
class Plane3:
    a: float
    b: float
    c: float
    rhs: float
    source: str
    view_clip: bool = False
    # Boundary as the student writes it (before flipping a ≥ into ≤).
    display: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class Vertex3:
    x: float
    y: float
    z: float
    sources: tuple[str, ...]
    tight: tuple[int, ...]


def build_3d_graph(
    req: LPRequest,
    x_star: dict[str, float],
    z_star: float,
    z_offset: float = 0.0,
    fixed: dict[str, float] | None = None,
) -> GraphXY | None:
    """Feasible polyhedron for three decision variables.

    ``z_star`` is the level of the objective in these three variables
    (without ``z_offset``). ``fixed`` names variables held at the optimum
    when the picture is a slice of a larger model.
    """
    names = _decision_names(req)
    if len(names) != 3:
        return None
    x_name, y_name, z_name = names
    ox = float(x_star.get(x_name, 0.0))
    oy = float(x_star.get(y_name, 0.0))
    oz = float(x_star.get(z_name, 0.0))
    c1 = float(req.objective.get(x_name, 0.0))
    c2 = float(req.objective.get(y_name, 0.0))
    c3 = float(req.objective.get(z_name, 0.0))

    planes, equalities = _model_planes(req, x_name, y_name, z_name)
    if _too_many(len(planes) + len(equalities) + 6):
        return None

    seed = _enumerate(planes, equalities)
    (x_min, x_max), (y_min, y_max), (z_min, z_max) = _view_box(
        planes + equalities, seed, ox, oy, oz
    )
    view = _view_planes(x_min, x_max, y_min, y_max, z_min, z_max)
    if _too_many(len(planes) + len(view) + len(equalities)):
        return None
    closed = _enumerate(planes + view, equalities)
    full_z = z_star + z_offset

    series: list[dict] = []
    series.extend(_face_series(closed, planes + view + equalities, x_name, y_name, z_name))
    edges = _edge_series(closed, planes + view + equalities)
    if edges is not None:
        series.append(edges)

    objective = _objective_face(
        c1, c2, c3, z_star, x_min, x_max, y_min, y_max, z_min, z_max, x_name, y_name, z_name
    )
    if objective is not None:
        series.append(objective)

    labeled = [v for v in seed if len(v.sources) >= 3]
    if labeled:
        series.append(
            {
                "name": "vertices",
                "role": "vertices",
                "x": [_clean(v.x) for v in labeled],
                "y": [_clean(v.y) for v in labeled],
                "z": [_clean(v.z) for v in labeled],
                "meta": [
                    {
                        "x": _clean(v.x),
                        "y": _clean(v.y),
                        "z": _clean(v.z),
                        "objective": _clean(c1 * v.x + c2 * v.y + c3 * v.z + z_offset),
                        "sources": list(v.sources),
                    }
                    for v in labeled
                ],
            }
        )

    series.append(
        {
            "name": "optimum",
            "role": "point",
            "x": [_clean(ox)],
            "y": [_clean(oy)],
            "z": [_clean(oz)],
            "meta": [
                {
                    "x": _clean(ox),
                    "y": _clean(oy),
                    "z": _clean(oz),
                    "objective": _clean(full_z),
                    "sources": ["óptimo"],
                }
            ],
        }
    )

    sliced = bool(fixed)
    title = "Corte 3D por el óptimo" if sliced else "Región factible y punto óptimo"
    subtitle = (
        f"Óptimo: {x_name} = {_fmt_num(ox)}, {y_name} = {_fmt_num(oy)}, "
        f"{z_name} = {_fmt_num(oz)}, Z = {_fmt_num(full_z)}"
    )
    if fixed:
        held = ", ".join(f"{name} = {_fmt_num(value)}" for name, value in fixed.items())
        subtitle += f". Fijas en el óptimo: {held}"

    return GraphXY(
        type="xy",
        kind="lp3d",
        series=series,
        x_label=x_name,
        y_label=y_name,
        z_label=z_name,
        title=title,
        subtitle=subtitle,
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


def _model_planes(
    req: LPRequest, x_name: str, y_name: str, z_name: str
) -> tuple[list[Plane3], list[Plane3]]:
    planes: list[Plane3] = []
    equalities: list[Plane3] = []
    axes = {x_name: (1.0, 0.0, 0.0), y_name: (0.0, 1.0, 0.0), z_name: (0.0, 0.0, 1.0)}
    for name in (x_name, y_name, z_name):
        lo, hi = _var_bounds(req, name)
        ax, ay, az = axes[name]
        if lo is not None:
            label = f"eje {name}" if abs(lo) < EPS else f"cota inf {name}"
            planes.append(
                Plane3(-ax, -ay, -az, -float(lo), label, display=(ax, ay, az, float(lo)))
            )
        if hi is not None:
            planes.append(
                Plane3(ax, ay, az, float(hi), f"cota {name}", display=(ax, ay, az, float(hi)))
            )
    for c in req.constraints:
        ax = float(c.coeffs.get(x_name, 0.0))
        ay = float(c.coeffs.get(y_name, 0.0))
        az = float(c.coeffs.get(z_name, 0.0))
        if abs(ax) < EPS and abs(ay) < EPS and abs(az) < EPS:
            continue
        shown = (ax, ay, az, float(c.rhs))
        if c.sense == ConstraintSense.eq:
            equalities.append(Plane3(ax, ay, az, float(c.rhs), c.id, display=shown))
        elif c.sense == ConstraintSense.ge:
            planes.append(Plane3(-ax, -ay, -az, -float(c.rhs), c.id, display=shown))
        else:
            planes.append(Plane3(ax, ay, az, float(c.rhs), c.id, display=shown))
    return planes, equalities


def _too_many(n_boundaries: int) -> bool:
    if n_boundaries < 3:
        return False
    triples = n_boundaries * (n_boundaries - 1) * (n_boundaries - 2) / 6
    return triples > MAX_TRIPLES


def _enumerate(planes: list[Plane3], equalities: list[Plane3]) -> list[Vertex3]:
    boundaries = planes + equalities
    found: dict[tuple[float, float, float], Vertex3] = {}
    for i, j, k in combinations(range(len(boundaries)), 3):
        hit = _intersect3(boundaries[i], boundaries[j], boundaries[k])
        if hit is None:
            continue
        x, y, z = hit
        if abs(x) > 1e8 or abs(y) > 1e8 or abs(z) > 1e8:
            continue
        if not _feasible(x, y, z, planes, equalities):
            continue
        key = (round(x, 8), round(y, 8), round(z, 8))
        sources, tight = _classify(x, y, z, boundaries)
        found[key] = Vertex3(x=x, y=y, z=z, sources=sources, tight=tight)
    return list(found.values())


def _intersect3(p: Plane3, q: Plane3, r: Plane3) -> tuple[float, float, float] | None:
    matrix = np.array(
        [[p.a, p.b, p.c], [q.a, q.b, q.c], [r.a, r.b, r.c]],
        dtype=float,
    )
    if np.linalg.matrix_rank(matrix, tol=RANK_TOL) < 3:
        return None
    rhs = np.array([p.rhs, q.rhs, r.rhs], dtype=float)
    try:
        sol = np.linalg.solve(matrix, rhs)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(sol)):
        return None
    return float(sol[0]), float(sol[1]), float(sol[2])


def _feasible(x: float, y: float, z: float, planes: list[Plane3], equalities: list[Plane3]) -> bool:
    for p in planes:
        if p.a * x + p.b * y + p.c * z > p.rhs + FEAS_TOL:
            return False
    for eq in equalities:
        if abs(eq.a * x + eq.b * y + eq.c * z - eq.rhs) > FEAS_TOL:
            return False
    return True


def _classify(
    x: float, y: float, z: float, boundaries: list[Plane3]
) -> tuple[tuple[str, ...], tuple[int, ...]]:
    sources: list[str] = []
    tight: list[int] = []
    for i, p in enumerate(boundaries):
        if abs(p.a * x + p.b * y + p.c * z - p.rhs) <= FEAS_TOL:
            tight.append(i)
            if not p.view_clip:
                sources.append(p.source)
    return tuple(sources), tuple(tight)


def _view_box(
    lines: list[Plane3],
    vertices: list[Vertex3],
    ox: float,
    oy: float,
    oz: float,
) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
    xs = [0.0, ox]
    ys = [0.0, oy]
    zs = [0.0, oz]
    for v in vertices:
        xs.append(v.x)
        ys.append(v.y)
        zs.append(v.z)
    scale = max([1.0, abs(ox), abs(oy), abs(oz)] + [abs(v) for v in xs + ys + zs])
    limit = scale * 4
    for line in lines:
        for coef, bucket in ((line.a, xs), (line.b, ys), (line.c, zs)):
            if abs(coef) <= EPS:
                continue
            intercept = line.rhs / coef
            if not math.isfinite(intercept) or intercept <= EPS or intercept > limit:
                continue
            bucket.append(intercept)
    return _window(xs), _window(ys), _window(zs)


def _window(values: list[float]) -> tuple[float, float]:
    finite = [v for v in values if math.isfinite(v)]
    if not finite:
        return 0.0, 1.0
    raw_min = min(finite)
    raw_max = max(finite)
    if raw_min < -EPS:
        lo = -_nice_ceil((-raw_min) * 1.12)
    else:
        lo = 0.0
    hi = _nice_ceil(max(raw_max, 0.0) * 1.12)
    if hi <= lo:
        hi = lo + 1.0
    return lo, max(hi, 1.0) if lo >= -EPS else hi


def _view_planes(
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    z_min: float,
    z_max: float,
) -> list[Plane3]:
    planes = [
        Plane3(1.0, 0.0, 0.0, x_max, f"{VIEW_PREFIX}x", view_clip=True),
        Plane3(0.0, 1.0, 0.0, y_max, f"{VIEW_PREFIX}y", view_clip=True),
        Plane3(0.0, 0.0, 1.0, z_max, f"{VIEW_PREFIX}z", view_clip=True),
    ]
    if x_min < -EPS:
        planes.append(Plane3(-1.0, 0.0, 0.0, -x_min, f"{VIEW_PREFIX}x0", view_clip=True))
    if y_min < -EPS:
        planes.append(Plane3(0.0, -1.0, 0.0, -y_min, f"{VIEW_PREFIX}y0", view_clip=True))
    if z_min < -EPS:
        planes.append(Plane3(0.0, 0.0, -1.0, -z_min, f"{VIEW_PREFIX}z0", view_clip=True))
    return planes


def _face_series(
    vertices: list[Vertex3],
    boundaries: list[Plane3],
    x_name: str,
    y_name: str,
    z_name: str,
) -> list[dict]:
    buckets: dict[str, dict] = {}
    for index, plane in enumerate(boundaries):
        pts = [(v.x, v.y, v.z) for v in vertices if index in v.tight]
        face = _polygon_mesh(pts, (plane.a, plane.b, plane.c))
        if face is None:
            continue
        key = "view_limit" if plane.view_clip else f"constraint:{plane.source}"
        shown = plane.display if plane.display is not None else (plane.a, plane.b, plane.c, plane.rhs)
        equation = "" if plane.view_clip else _fmt_terms(shown, x_name, y_name, z_name)
        _merge_face(buckets, key, face, equation)
    series: list[dict] = []
    for key, bucket in buckets.items():
        item = {
            "name": key,
            "role": "face",
            "x": bucket["x"],
            "y": bucket["y"],
            "z": bucket["z"],
            "i": bucket["i"],
            "j": bucket["j"],
            "k": bucket["k"],
        }
        if bucket["equation"]:
            item["equation"] = bucket["equation"]
        series.append(item)
    return series


def _merge_face(buckets: dict[str, dict], key: str, face: dict, equation: str) -> None:
    bucket = buckets.setdefault(
        key, {"x": [], "y": [], "z": [], "i": [], "j": [], "k": [], "equation": ""}
    )
    offset = len(bucket["x"])
    bucket["x"].extend(face["x"])
    bucket["y"].extend(face["y"])
    bucket["z"].extend(face["z"])
    bucket["i"].extend(i + offset for i in face["i"])
    bucket["j"].extend(j + offset for j in face["j"])
    bucket["k"].extend(k + offset for k in face["k"])
    if equation and equation not in bucket["equation"]:
        bucket["equation"] = f"{bucket['equation']} · {equation}".strip(" ·")


def _polygon_mesh(
    points: list[tuple[float, float, float]], normal: tuple[float, float, float]
) -> dict | None:
    unique = _unique_points(points)
    ordered = _order_polygon(unique, normal)
    if len(ordered) < 3:
        return None
    ii: list[int] = []
    jj: list[int] = []
    kk: list[int] = []
    for t in range(1, len(ordered) - 1):
        if _tri_area(ordered[0], ordered[t], ordered[t + 1]) < 1e-10:
            continue
        ii.append(0)
        jj.append(t)
        kk.append(t + 1)
    if not ii:
        return None
    return {
        "x": [_clean(p[0]) for p in ordered],
        "y": [_clean(p[1]) for p in ordered],
        "z": [_clean(p[2]) for p in ordered],
        "i": ii,
        "j": jj,
        "k": kk,
    }


def _unique_points(points: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    found: dict[tuple[float, float, float], tuple[float, float, float]] = {}
    for x, y, z in points:
        found[(round(x, 8), round(y, 8), round(z, 8))] = (x, y, z)
    return list(found.values())


def _order_polygon(
    points: list[tuple[float, float, float]], normal: tuple[float, float, float]
) -> list[tuple[float, float, float]]:
    if len(points) < 3:
        return list(points)
    nrm = _unit(normal)
    if nrm is None:
        return list(points)
    helper = (1.0, 0.0, 0.0) if abs(nrm[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _unit(_cross(nrm, helper))
    if u is None:
        return list(points)
    v = _cross(nrm, u)
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    cz = sum(p[2] for p in points) / len(points)

    def angle(p: tuple[float, float, float]) -> float:
        d = (p[0] - cx, p[1] - cy, p[2] - cz)
        return math.atan2(_dot(d, v), _dot(d, u))

    return sorted(points, key=angle)


def _edge_series(vertices: list[Vertex3], boundaries: list[Plane3]) -> dict | None:
    xs: list[float | None] = []
    ys: list[float | None] = []
    zs: list[float | None] = []
    seen: set[tuple[tuple[float, float, float], tuple[float, float, float]]] = set()
    for a, b in combinations(vertices, 2):
        if not _is_edge(a, b, boundaries):
            continue
        key = _segment_key(a, b)
        if key in seen or key[0] == key[1]:
            continue
        seen.add(key)
        if xs:
            xs.append(None)
            ys.append(None)
            zs.append(None)
        xs.extend([_clean(a.x), _clean(b.x)])
        ys.extend([_clean(a.y), _clean(b.y)])
        zs.extend([_clean(a.z), _clean(b.z)])
    if len(xs) < 2:
        return None
    return {"name": "edges", "role": "edges", "x": xs, "y": ys, "z": zs}


def _is_edge(a: Vertex3, b: Vertex3, boundaries: list[Plane3]) -> bool:
    common = set(a.tight) & set(b.tight)
    if len(common) < 2:
        return False
    rows = np.array([[boundaries[i].a, boundaries[i].b, boundaries[i].c] for i in common], dtype=float)
    return int(np.linalg.matrix_rank(rows, tol=RANK_TOL)) == 2


def _segment_key(
    a: Vertex3, b: Vertex3
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    pa = (round(a.x, 8), round(a.y, 8), round(a.z, 8))
    pb = (round(b.x, 8), round(b.y, 8), round(b.z, 8))
    return (pa, pb) if pa <= pb else (pb, pa)


def _objective_face(
    c1: float,
    c2: float,
    c3: float,
    rhs: float,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    z_min: float,
    z_max: float,
    x_name: str,
    y_name: str,
    z_name: str,
) -> dict | None:
    if abs(c1) < EPS and abs(c2) < EPS and abs(c3) < EPS:
        return None
    hits = _plane_box_hits(c1, c2, c3, rhs, x_min, x_max, y_min, y_max, z_min, z_max)
    face = _polygon_mesh(hits, (c1, c2, c3))
    if face is None:
        return None
    return {
        "name": "objective_plane",
        "role": "face",
        "equation": _fmt_terms((c1, c2, c3, rhs), x_name, y_name, z_name),
        **face,
    }


def _plane_box_hits(
    a: float,
    b: float,
    c: float,
    rhs: float,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    z_min: float,
    z_max: float,
) -> list[tuple[float, float, float]]:
    corners = [
        (x_min, y_min, z_min),
        (x_max, y_min, z_min),
        (x_min, y_max, z_min),
        (x_max, y_max, z_min),
        (x_min, y_min, z_max),
        (x_max, y_min, z_max),
        (x_min, y_max, z_max),
        (x_max, y_max, z_max),
    ]
    edges = [
        (0, 1),
        (0, 2),
        (0, 4),
        (1, 3),
        (1, 5),
        (2, 3),
        (2, 6),
        (3, 7),
        (4, 5),
        (4, 6),
        (5, 7),
        (6, 7),
    ]
    hits: list[tuple[float, float, float]] = []
    normal = (a, b, c)
    for i, j in edges:
        p0 = corners[i]
        p1 = corners[j]
        direction = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
        denom = _dot(normal, direction)
        if abs(denom) < EPS:
            continue
        t = (rhs - _dot(normal, p0)) / denom
        if t < -1e-8 or t > 1 + 1e-8:
            continue
        t = min(1.0, max(0.0, t))
        hits.append((p0[0] + t * direction[0], p0[1] + t * direction[1], p0[2] + t * direction[2]))
    return hits


def _fmt_terms(
    shown: tuple[float, float, float, float], x_name: str, y_name: str, z_name: str
) -> str:
    ax, ay, az, rhs = shown
    terms: list[str] = []
    for coef, name in ((ax, x_name), (ay, y_name), (az, z_name)):
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


def _tri_area(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    c: tuple[float, float, float],
) -> float:
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    return 0.5 * _norm(_cross(ab, ac))


def _cross(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: tuple[float, float, float]) -> float:
    return math.sqrt(_dot(a, a))


def _unit(a: tuple[float, float, float]) -> tuple[float, float, float] | None:
    n = _norm(a)
    if n < EPS:
        return None
    return (a[0] / n, a[1] / n, a[2] / n)
