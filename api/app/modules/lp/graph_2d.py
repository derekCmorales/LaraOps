from __future__ import annotations

from app.modules.lp.models import LPRequest
from app.schemas.result import GraphXY


def build_2d_graph(req: LPRequest, x_star: dict[str, float], z_star: float) -> GraphXY | None:
    """Feasible-region sketch for exactly two decision variables."""
    names = _decision_names(req)
    if len(names) != 2:
        return None

    x_name, y_name = names
    # Sample bounding box from RHS-ish ranges
    xs_pts: list[float] = [0.0, x_star.get(x_name, 0.0)]
    ys_pts: list[float] = [0.0, x_star.get(y_name, 0.0)]
    for c in req.constraints:
        ax = c.coeffs.get(x_name, 0.0)
        ay = c.coeffs.get(y_name, 0.0)
        if abs(ax) > 1e-12:
            xs_pts.append(c.rhs / ax)
        if abs(ay) > 1e-12:
            ys_pts.append(c.rhs / ay)

    x_max = max(xs_pts + [1.0]) * 1.15
    y_max = max(ys_pts + [1.0]) * 1.15

    series: list[dict] = []
    # Constraint boundary segments (axis intercepts)
    for c in req.constraints:
        ax = c.coeffs.get(x_name, 0.0)
        ay = c.coeffs.get(y_name, 0.0)
        pts_x: list[float] = []
        pts_y: list[float] = []
        if abs(ax) > 1e-12 and abs(ay) > 1e-12:
            # intercepts
            pts_x = [c.rhs / ax, 0.0]
            pts_y = [0.0, c.rhs / ay]
        elif abs(ax) > 1e-12:
            xv = c.rhs / ax
            pts_x = [xv, xv]
            pts_y = [0.0, y_max]
        elif abs(ay) > 1e-12:
            yv = c.rhs / ay
            pts_x = [0.0, x_max]
            pts_y = [yv, yv]
        if pts_x:
            series.append({"name": f"constraint:{c.id}", "x": pts_x, "y": pts_y})

    # Objective level line through optimum: c1 x + c2 y = z*
    c1 = req.objective.get(x_name, 0.0)
    c2 = req.objective.get(y_name, 0.0)
    if abs(c2) > 1e-12:
        ox = [0.0, x_max]
        oy = [(z_star - c1 * x) / c2 for x in ox]
        series.append({"name": "objective_level", "x": ox, "y": oy})
    elif abs(c1) > 1e-12:
        xv = z_star / c1
        series.append({"name": "objective_level", "x": [xv, xv], "y": [0.0, y_max]})

    series.append(
        {
            "name": "optimum",
            "x": [x_star.get(x_name, 0.0)],
            "y": [x_star.get(y_name, 0.0)],
        }
    )

    return GraphXY(
        type="xy",
        series=series,
        x_label=x_name,
        y_label=y_name,
        title="Región factible y punto óptimo",
        subtitle=(
            f"Óptimo: {x_name} = {x_star.get(x_name, 0.0):.4g}, "
            f"{y_name} = {x_star.get(y_name, 0.0):.4g}, Z = {z_star:.4g}"
        ),
    )


def _decision_names(req: LPRequest) -> list[str]:
    if req.variable_names:
        return list(req.variable_names)
    names = set(req.objective)
    for c in req.constraints:
        names.update(c.coeffs)
    return sorted(names)
