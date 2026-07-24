from __future__ import annotations

import logging
import math
from typing import Callable

from app.modules.forecasting.models import ForecastingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

FitFn = Callable[..., tuple[list[float | None], list[float]]]


def solve(req: ForecastingRequest) -> ModuleResult:
    y = list(req.series)
    n = len(y)
    labels = req.period_labels or [str(i + 1) for i in range(n)]
    warnings: list[str] = []

    method_rows: list[list[float | str]] = []
    forecast_rows: list[list[float | str]] = []
    detail_tables: list[NamedTable] = []
    series_plot: list[dict] = [{"name": "real", "x": list(range(1, n + 1)), "y": y}]

    best_name = ""
    best_mad = float("inf")
    best_next = 0.0
    best_params: dict[str, float] = {}

    for method in req.methods:
        alpha, beta, gamma = req.alpha, req.beta, req.gamma
        if req.optimize_alpha and method in (
            "exponential",
            "holt",
            "holt_winters_additive",
            "holt_winters_multiplicative",
        ):
            alpha, beta, gamma, opt_note = _optimize_params(method, y, req)
            warnings.append(opt_note)

        fitted, next_fc = _fit(
            method,
            y,
            window=req.window,
            alpha=alpha,
            beta=beta,
            gamma=gamma,
            seasonality=req.seasonality,
            horizon=req.horizon,
        )
        stats = _error_stats(y, fitted)
        method_rows.append(
            [
                method,
                stats["MAD"],
                stats["MSE"],
                stats["MAPE"],
                stats["Bias"],
                stats["CFE"],
                stats["tracking_signal"],
                next_fc[0] if next_fc else None,
                alpha,
                beta if method.startswith("holt") else None,
                gamma if "winters" in method else None,
            ]
        )
        for h, val in enumerate(next_fc, start=1):
            forecast_rows.append([method, n + h, val])

        detail_tables.append(
            NamedTable(
                name=f"detail_{method}",
                columns=[
                    "periodo",
                    "etiqueta",
                    "real",
                    "pronóstico",
                    "error",
                    "error_abs",
                    "error_cuad",
                    "error_pct",
                ],
                rows=_period_rows(labels, y, fitted),
            )
        )

        xs = [i + 1 for i, f in enumerate(fitted) if f is not None]
        ys = [float(f) for f in fitted if f is not None]
        if next_fc:
            xs.extend(range(n + 1, n + 1 + len(next_fc)))
            ys.extend(next_fc)
        series_plot.append({"name": method, "x": xs, "y": ys})

        if stats["MAD"] < best_mad:
            best_mad = stats["MAD"]
            best_name = method
            best_next = next_fc[0] if next_fc else 0.0
            best_params = {"alpha": alpha, "beta": beta, "gamma": gamma}

    tables: list[NamedTable] = [
        NamedTable(
            name="error_comparison",
            columns=[
                "método",
                "MAD",
                "MSE",
                "MAPE",
                "sesgo",
                "CFE",
                "señal_seguimiento",
                "próximo_pronóstico",
                "alfa",
                "beta",
                "gamma",
            ],
            rows=method_rows,
        ),
        NamedTable(
            name="forecasts",
            columns=["método", "periodo", "valor"],
            rows=forecast_rows,
        ),
        NamedTable(name="best_method", columns=["método"], rows=[[best_name]]),
        *detail_tables,
    ]

    metrics = {
        "best_MAD": float(best_mad) if math.isfinite(best_mad) else float("inf"),
        "next_forecast": float(best_next),
        **{f"best_{k}": float(v) for k, v in best_params.items()},
    }

    result = ModuleResult(
        module="forecasting",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"next_forecast": float(best_next)},
            metrics=metrics,
            objective_value=float(best_mad) if math.isfinite(best_mad) else None,
            objective_sense="min",
        ),
        iterations=None,
        sensitivity=None,
        graph=GraphXY(
            type="xy",
            series=series_plot,
            x_label="Periodo",
            y_label="Valor",
            title="Serie histórica y pronósticos",
            subtitle=f"Mejor método: {best_name} (MAD = {best_mad:.4g})"
            if math.isfinite(best_mad)
            else f"Mejor método: {best_name}",
        ),
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s best=%s", result.module, result.status.value, best_name)
    return result


def _error_stats(y: list[float], fitted: list[float | None]) -> dict[str, float]:
    signed: list[float] = []
    abs_err: list[float] = []
    sq: list[float] = []
    abs_pct: list[float] = []
    for i, f in enumerate(fitted):
        if f is None:
            continue
        e = y[i] - f
        signed.append(e)
        abs_err.append(abs(e))
        sq.append(e * e)
        if abs(y[i]) > 1e-12:
            abs_pct.append(abs(e / y[i]) * 100.0)
    if not abs_err:
        inf = float("inf")
        return {"MAD": inf, "MSE": inf, "MAPE": inf, "Bias": 0.0, "CFE": 0.0, "tracking_signal": 0.0}
    mad = sum(abs_err) / len(abs_err)
    mse = sum(sq) / len(sq)
    mape = sum(abs_pct) / len(abs_pct) if abs_pct else float("inf")
    bias = sum(signed) / len(signed)
    cfe = sum(signed)
    tracking = cfe / mad if mad > 1e-12 else 0.0
    return {
        "MAD": mad,
        "MSE": mse,
        "MAPE": mape,
        "Bias": bias,
        "CFE": cfe,
        "tracking_signal": tracking,
    }


def _period_rows(
    labels: list[str], y: list[float], fitted: list[float | None]
) -> list[list[float | str | None]]:
    rows: list[list[float | str | None]] = []
    for i, (lab, actual, f) in enumerate(zip(labels, y, fitted, strict=True)):
        if f is None:
            rows.append([i + 1, lab, actual, None, None, None, None, None])
            continue
        err = actual - f
        pct = abs(err / actual) * 100.0 if abs(actual) > 1e-12 else None
        rows.append([i + 1, lab, actual, f, err, abs(err), err * err, pct])
    return rows


def _optimize_params(
    method: str, y: list[float], req: ForecastingRequest
) -> tuple[float, float, float, str]:
    """Coarse grid search on alpha (and beta/gamma when relevant) minimizing MSE."""
    best = (req.alpha, req.beta, req.gamma)
    best_mse = float("inf")
    grid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    for a in grid:
        betas = [req.beta] if method == "exponential" else grid
        gammas = [req.gamma] if "winters" not in method else grid
        for b in betas:
            for g in gammas:
                fitted, _ = _fit(
                    method,
                    y,
                    window=req.window,
                    alpha=a,
                    beta=b,
                    gamma=g,
                    seasonality=req.seasonality,
                    horizon=1,
                )
                mse = _error_stats(y, fitted)["MSE"]
                if mse < best_mse:
                    best_mse = mse
                    best = (a, b, g)
    note = (
        f"optimización de alfa ({method}): mejor alfa={best[0]}"
        + (f", beta={best[1]}" if method != "exponential" else "")
        + (f", gamma={best[2]}" if "winters" in method else "")
        + f" (MSE={best_mse:.4g})"
    )
    return best[0], best[1], best[2], note


def _fit(
    method: str,
    y: list[float],
    *,
    window: int,
    alpha: float,
    beta: float,
    gamma: float,
    seasonality: int,
    horizon: int,
) -> tuple[list[float | None], list[float]]:
    if method == "naive":
        return _naive(y, horizon)
    if method == "moving_average":
        return _moving_average(y, window, horizon)
    if method == "exponential":
        return _exponential(y, alpha, horizon)
    if method == "holt":
        return _holt(y, alpha, beta, horizon)
    if method == "holt_winters_additive":
        return _holt_winters(y, alpha, beta, gamma, seasonality, horizon, multiplicative=False)
    if method == "holt_winters_multiplicative":
        return _holt_winters(y, alpha, beta, gamma, seasonality, horizon, multiplicative=True)
    if method == "linear_trend":
        return _linear_trend(y, horizon)
    raise ValueError(f"Unknown forecasting method: {method}")


def _naive(y: list[float], horizon: int) -> tuple[list[float | None], list[float]]:
    n = len(y)
    fitted: list[float | None] = [None] * n
    for t in range(1, n):
        fitted[t] = y[t - 1]
    return fitted, [y[-1]] * horizon


def _moving_average(
    y: list[float], window: int, horizon: int
) -> tuple[list[float | None], list[float]]:
    n = len(y)
    fitted: list[float | None] = [None] * n
    for t in range(window, n):
        fitted[t] = sum(y[t - window : t]) / window
    level = sum(y[-window:]) / min(window, n)
    return fitted, [level] * horizon


def _exponential(
    y: list[float], alpha: float, horizon: int
) -> tuple[list[float | None], list[float]]:
    n = len(y)
    fitted: list[float | None] = [None] * n
    level = y[0]
    fitted[0] = level
    for t in range(1, n):
        # one-step-ahead using level before observing y[t]
        fitted[t] = level
        level = alpha * y[t] + (1 - alpha) * level
    return fitted, [level] * horizon


def _holt(
    y: list[float], alpha: float, beta: float, horizon: int
) -> tuple[list[float | None], list[float]]:
    n = len(y)
    fitted: list[float | None] = [None] * n
    level = y[0]
    trend = y[1] - y[0] if n > 1 else 0.0
    fitted[0] = level
    for t in range(1, n):
        fitted[t] = level + trend
        prev_level = level
        level = alpha * y[t] + (1 - alpha) * (prev_level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
    nxt = [level + h * trend for h in range(1, horizon + 1)]
    return fitted, nxt


def _holt_winters(
    y: list[float],
    alpha: float,
    beta: float,
    gamma: float,
    m: int,
    horizon: int,
    *,
    multiplicative: bool,
) -> tuple[list[float | None], list[float]]:
    n = len(y)
    fitted: list[float | None] = [None] * n
    # Initialize seasonal factors from first season
    season_avg = sum(y[:m]) / m
    if multiplicative:
        season = [y[i] / season_avg if abs(season_avg) > 1e-12 else 1.0 for i in range(m)]
    else:
        season = [y[i] - season_avg for i in range(m)]

    level = season_avg
    trend = (sum(y[m : 2 * m]) / m - season_avg) / m if n >= 2 * m else 0.0

    for t in range(n):
        s_idx = t % m
        if multiplicative:
            s = season[s_idx] if abs(season[s_idx]) > 1e-12 else 1.0
            fitted[t] = (level + trend) * s if t >= m else None
            if t >= m:
                prev_level = level
                level = alpha * (y[t] / s) + (1 - alpha) * (prev_level + trend)
                trend = beta * (level - prev_level) + (1 - beta) * trend
                season[s_idx] = gamma * (y[t] / level) + (1 - gamma) * s
        else:
            fitted[t] = level + trend + season[s_idx] if t >= m else None
            if t >= m:
                prev_level = level
                level = alpha * (y[t] - season[s_idx]) + (1 - alpha) * (prev_level + trend)
                trend = beta * (level - prev_level) + (1 - beta) * trend
                season[s_idx] = gamma * (y[t] - level) + (1 - gamma) * season[s_idx]

    nxt: list[float] = []
    for h in range(1, horizon + 1):
        s = season[(n + h - 1) % m]
        if multiplicative:
            nxt.append((level + h * trend) * s)
        else:
            nxt.append(level + h * trend + s)
    return fitted, nxt


def _linear_trend(y: list[float], horizon: int) -> tuple[list[float | None], list[float]]:
    n = len(y)
    xs = list(range(1, n + 1))
    x_bar = sum(xs) / n
    y_bar = sum(y) / n
    num = sum((xs[i] - x_bar) * (y[i] - y_bar) for i in range(n))
    den = sum((xs[i] - x_bar) ** 2 for i in range(n))
    slope = num / den if den > 1e-12 else 0.0
    intercept = y_bar - slope * x_bar
    fitted: list[float | None] = [intercept + slope * x for x in xs]
    nxt = [intercept + slope * (n + h) for h in range(1, horizon + 1)]
    return fitted, nxt
