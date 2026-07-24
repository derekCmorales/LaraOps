from __future__ import annotations

import logging

import numpy as np
from scipy import stats

from app.modules.statistics.models import StatisticsRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: StatisticsRequest) -> ModuleResult:
    if req.analysis == "descriptive":
        return _descriptive(req)
    if req.analysis == "regression":
        return _regression(req)
    if req.analysis == "multiple_regression":
        return _multiple_regression(req)
    if req.analysis == "ztest":
        return _ztest(req)
    if req.analysis == "distribution":
        return _distribution(req)
    return _ttest(req)


def _descriptive(req: StatisticsRequest) -> ModuleResult:
    if len(req.data) < 1:
        raise ValueError("data required for descriptive analysis")
    arr = np.asarray(req.data, dtype=float)
    q1, q2, q3 = np.percentile(arr, [25, 50, 75])
    # mode via bincount for near-integers else scipy
    try:
        mode_res = stats.mode(arr, keepdims=True)
        mode_val = float(mode_res.mode[0])
    except Exception:  # noqa: BLE001
        mode_val = float(arr[0])
    metrics = {
        "n": float(arr.size),
        "mean": float(arr.mean()),
        "median": float(np.median(arr)),
        "mode": mode_val,
        "std_sample": float(arr.std(ddof=1)) if arr.size > 1 else 0.0,
        "var_sample": float(arr.var(ddof=1)) if arr.size > 1 else 0.0,
        "min": float(arr.min()),
        "max": float(arr.max()),
        "sum": float(arr.sum()),
        "q1": float(q1),
        "q2": float(q2),
        "q3": float(q3),
        "iqr": float(q3 - q1),
        "skewness": float(stats.skew(arr)) if arr.size > 2 else 0.0,
        "kurtosis": float(stats.kurtosis(arr)) if arr.size > 3 else 0.0,
    }
    # Simple histogram (10 bins)
    counts, edges = np.histogram(arr, bins=min(10, max(3, arr.size // 2)))
    centers = ((edges[:-1] + edges[1:]) / 2).tolist()
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"mean": metrics["mean"]}, metrics=metrics),
        graph=GraphXY(
            type="xy",
            series=[{"name": "histogram", "x": centers, "y": counts.astype(float).tolist()}],
            x_label="Centro del intervalo",
            y_label="Frecuencia",
            title="Histograma de frecuencias",
            subtitle=f"n = {arr.size} · media = {metrics['mean']:.4g}",
            kind="bar",
        ),
        tables=[
            NamedTable(
                name="descriptive",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )


def _regression(req: StatisticsRequest) -> ModuleResult:
    if not req.x or not req.y or len(req.x) != len(req.y) or len(req.x) < 2:
        raise ValueError("regression requires x and y of equal length >= 2")
    x = np.asarray(req.x, dtype=float)
    y = np.asarray(req.y, dtype=float)
    slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
    y_hat = intercept + slope * x
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-15 else 1.0
    n = len(x)
    adj_r2 = 1.0 - (1.0 - r2) * (n - 1) / (n - 2) if n > 2 else r2
    metrics = {
        "slope": float(slope),
        "intercept": float(intercept),
        "r": float(r_value),
        "r2": float(r2),
        "adj_r2": float(adj_r2),
        "p_value": float(p_value),
        "std_err": float(std_err),
    }
    xs = x.tolist()
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"slope": float(slope), "intercept": float(intercept)},
            metrics=metrics,
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "data", "x": xs, "y": y.tolist()},
                {"name": "fit", "x": xs, "y": y_hat.tolist()},
            ],
            x_label="Variable independiente (X)",
            y_label="Variable dependiente (Y)",
            title="Regresión lineal",
            subtitle=f"Y = {intercept:.4g} + {slope:.4g}·X · R² = {r2:.4f}",
        ),
        tables=[
            NamedTable(
                name="regression",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )


def _multiple_regression(req: StatisticsRequest) -> ModuleResult:
    if not req.X or not req.y or len(req.X) != len(req.y) or len(req.y) < 2:
        raise ValueError("multiple_regression requires X (n×k) and y (n)")
    X = np.asarray(req.X, dtype=float)
    y = np.asarray(req.y, dtype=float)
    if X.ndim != 2:
        raise ValueError("X must be 2D")
    n, k = X.shape
    # Add intercept
    Xd = np.column_stack([np.ones(n), X])
    try:
        beta, residuals, rank, s = np.linalg.lstsq(Xd, y, rcond=None)
    except np.linalg.LinAlgError as exc:
        raise ValueError(f"regression failed: {exc}") from exc
    y_hat = Xd @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-15 else 1.0
    adj = 1.0 - (1.0 - r2) * (n - 1) / max(n - k - 1, 1)
    metrics = {"r2": float(r2), "adj_r2": float(adj), "n": float(n), "k": float(k)}
    variables = {f"beta_{i}": float(b) for i, b in enumerate(beta)}
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics),
        tables=[
            NamedTable(
                name="coefficients",
                columns=["término", "coeficiente"],
                rows=[["intercept", beta[0]], *[[f"x{i}", beta[i + 1]] for i in range(k)]],
            )
        ],
        warnings=[],
    )


def _distribution(req: StatisticsRequest) -> ModuleResult:
    if req.dist is None or req.dist_x is None:
        raise ValueError("distribution requires dist and dist_x")
    x = float(req.dist_x)
    p = req.dist_params
    if req.dist == "normal":
        mu = p.get("mu", 0.0)
        sigma = p.get("sigma", 1.0)
        if sigma <= 0:
            raise ValueError("normal requires sigma > 0")
        metrics = {
            "pdf": float(stats.norm.pdf(x, mu, sigma)),
            "cdf": float(stats.norm.cdf(x, mu, sigma)),
            "sf": float(stats.norm.sf(x, mu, sigma)),
        }
    elif req.dist == "binomial":
        n = int(p.get("n", 10))
        prob = p.get("p", 0.5)
        metrics = {
            "pmf": float(stats.binom.pmf(int(x), n, prob)),
            "cdf": float(stats.binom.cdf(int(x), n, prob)),
        }
    elif req.dist == "poisson":
        lam = p.get("lambda", 1.0)
        metrics = {
            "pmf": float(stats.poisson.pmf(int(x), lam)),
            "cdf": float(stats.poisson.cdf(int(x), lam)),
        }
    else:  # exponential
        rate = p.get("lambda", 1.0)
        if rate <= 0:
            raise ValueError("exponential requires lambda > 0")
        metrics = {
            "pdf": float(stats.expon.pdf(x, scale=1.0 / rate)),
            "cdf": float(stats.expon.cdf(x, scale=1.0 / rate)),
        }
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"x": x}, metrics=metrics),
        tables=[
            NamedTable(
                name="distribution",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )


def _ttest(req: StatisticsRequest) -> ModuleResult:
    if len(req.data) < 2:
        raise ValueError("ttest requires data with n >= 2")
    arr = np.asarray(req.data, dtype=float)
    t_stat, p_value = stats.ttest_1samp(arr, req.mu0)
    df = arr.size - 1
    crit = float(stats.t.ppf(1 - req.alpha / 2, df))
    reject = bool(abs(t_stat) > crit)
    metrics = {
        "t_stat": float(t_stat),
        "p_value": float(p_value),
        "df": float(df),
        "mu0": req.mu0,
        "alpha": req.alpha,
        "critical_value": crit,
        "reject_H0": 1.0 if reject else 0.0,
        "mean": float(arr.mean()),
    }
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"t_stat": float(t_stat)}, metrics=metrics),
        tables=[
            NamedTable(
                name="ttest",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )


def _ztest(req: StatisticsRequest) -> ModuleResult:
    if len(req.data) < 1:
        raise ValueError("ztest requires data")
    if req.sigma is None:
        raise ValueError("ztest requires known sigma > 0")
    arr = np.asarray(req.data, dtype=float)
    mean = float(arr.mean())
    n = arr.size
    z_stat = (mean - req.mu0) / (req.sigma / np.sqrt(n))
    p_value = float(2 * (1 - stats.norm.cdf(abs(z_stat))))
    crit = float(stats.norm.ppf(1 - req.alpha / 2))
    reject = bool(abs(z_stat) > crit)
    metrics = {
        "z_stat": float(z_stat),
        "p_value": p_value,
        "mu0": req.mu0,
        "sigma": float(req.sigma),
        "alpha": req.alpha,
        "critical_value": crit,
        "reject_H0": 1.0 if reject else 0.0,
        "mean": mean,
        "n": float(n),
    }
    return ModuleResult(
        module="statistics",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"z_stat": float(z_stat)}, metrics=metrics),
        tables=[
            NamedTable(
                name="ztest",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )
