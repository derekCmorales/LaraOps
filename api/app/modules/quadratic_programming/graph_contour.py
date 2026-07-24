from __future__ import annotations

import math

import numpy as np

from app.modules.quadratic_programming.models import QuadraticProgrammingRequest
from app.schemas.result import GraphXY


def build_qp_contour_graph(
    req: QuadraticProgrammingRequest,
    x_star: dict[str, float],
    obj_star: float,
) -> GraphXY | None:
    """Curvas de nivel de ½x′Qx + c′x para exactamente dos variables."""
    n = len(req.c)
    if n != 2:
        return None

    names = req.variable_names or ["x1", "x2"]
    x_name, y_name = names[0], names[1]
    Q = np.asarray(req.Q, dtype=float)
    c = np.asarray(req.c, dtype=float)

    bounds = req.bounds or [(-1.0, 1.0), (-1.0, 1.0)]
    x_lo, x_hi = bounds[0]
    y_lo, y_hi = bounds[1]
    x_lo = -1.0 if x_lo is None else float(x_lo)
    x_hi = 1.0 if x_hi is None else float(x_hi)
    y_lo = -1.0 if y_lo is None else float(y_lo)
    y_hi = 1.0 if y_hi is None else float(y_hi)

    pad = 0.15
    span_x = max(x_hi - x_lo, 1e-6)
    span_y = max(y_hi - y_lo, 1e-6)
    x_min = x_lo - pad * span_x
    x_max = x_hi + pad * span_x
    y_min = y_lo - pad * span_y
    y_max = y_hi + pad * span_y

    def f(xy: np.ndarray) -> float:
        return float(0.5 * xy @ Q @ xy + c @ xy)

    z_opt = f(np.array([x_star.get(x_name, 0.0), x_star.get(y_name, 0.0)]))
    z_hi = max(z_opt + abs(z_opt) * 0.5 + 1.0, z_opt + 2.0)
    levels = [z_opt + (z_hi - z_opt) * t for t in (0.0, 0.25, 0.5, 0.75, 1.0)]

    series: list[dict] = []
    xs = np.linspace(x_min, x_max, 120)

    for level in levels:
        pts_x: list[float] = []
        pts_y: list[float] = []
        for x in xs:
            # 0.5*q11 x² + (q12+q21)/2 * x y + 0.5*q22 y² + c1 x + c2 y = level
            a = 0.5 * Q[1, 1]
            b = Q[0, 1] * x + c[1]
            c_const = 0.5 * Q[0, 0] * x * x + c[0] * x - level
            if abs(a) < 1e-12:
                if abs(b) < 1e-12:
                    continue
                y = -c_const / b
                if y_min <= y <= y_max:
                    pts_x.append(float(x))
                    pts_y.append(float(y))
                continue
            disc = b * b - 4.0 * a * c_const
            if disc < 0:
                continue
            root = math.sqrt(disc)
            for y in ((-b + root) / (2 * a), (-b - root) / (2 * a)):
                if y_min <= y <= y_max:
                    pts_x.append(float(x))
                    pts_y.append(float(y))
        if len(pts_x) >= 2:
            series.append(
                {
                    "name": f"nivel {level:.4g}",
                    "x": pts_x,
                    "y": pts_y,
                }
            )

    series.append(
        {
            "name": "óptimo",
            "x": [x_star.get(x_name, 0.0)],
            "y": [x_star.get(y_name, 0.0)],
        }
    )

    return GraphXY(
        type="xy",
        series=series,
        x_label=x_name,
        y_label=y_name,
        title="Curvas de nivel (función objetivo cuadrática)",
        subtitle=f"Óptimo: {x_name}={x_star.get(x_name, 0.0):.4g}, {y_name}={x_star.get(y_name, 0.0):.4g}, f={obj_star:.4g}",
    )
