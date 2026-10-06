from __future__ import annotations

import logging
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.modules.queues.models import QueuesRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

INF = float("inf")

QUEUES_S_MAX = 40
QUEUES_K_MAX = 500
QUEUES_N_MAX = 200

QUEUE_MODELS = ["M/M/1", "M/M/s", "M/M/1/K", "M/M/s/K", "M/M/s/N", "M/G/1", "M/D/1"]
MULTI_SERVER = ("M/M/s", "M/M/s/K", "M/M/s/N")
FINITE = ("M/M/1/K", "M/M/s/K", "M/M/s/N")

PN_TAIL = 1e-3
PN_MAX_ROWS = 200


@dataclass
class Params:
    model: str
    lam: float
    mu: float
    s: int
    K: int | None
    N: int | None
    sigma: float | None
    include_pn: bool
    cost_waiting: float | None
    cost_server: float | None
    waiting_cost_basis: str
    optimize_s: bool
    s_max: int | None
    wait_threshold: float | None
    time_unit: str | None


@dataclass
class Core:
    metrics: dict[str, float]
    pn: list[float] | None
    stable: bool
    wq_tail: Callable[[float], float] | None = None
    w_tail: Callable[[float], float] | None = None
    parts: dict[str, float] = field(default_factory=dict)


# ——— Validación ———


def _opt_number(value: Any) -> float | None:
    """None si falta; NaN si no es numérico (se reporta con el mensaje del campo)."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return math.nan
    try:
        n = float(value)
    except (TypeError, ValueError):
        return math.nan
    return n if math.isfinite(n) else math.nan


def _rate(value: Any, missing: str, positive: str) -> float:
    n = _opt_number(value)
    if n is None or math.isnan(n):
        raise ValueError(missing)
    if not n > 0:
        raise ValueError(positive)
    return n


def _integer(value: Any, missing: str, invalid: str, maximum: int, too_big: str) -> int:
    n = _opt_number(value)
    if n is None:
        raise ValueError(missing)
    if math.isnan(n) or not float(n).is_integer() or n < 1:
        raise ValueError(invalid)
    if n > maximum:
        raise ValueError(too_big)
    return int(n)


def _non_negative(value: Any, message: str) -> float | None:
    n = _opt_number(value)
    if n is None:
        return None
    if math.isnan(n) or n < 0:
        raise ValueError(message)
    return n


def parse_request(req: QueuesRequest) -> Params:
    model = req.model
    if model not in QUEUE_MODELS:
        raise ValueError(f"Modelo de colas no soportado. Usa uno de: {', '.join(QUEUE_MODELS)}.")
    lam = _rate(
        req.lambda_,
        "Ingresa la tasa de llegada λ (clientes por unidad de tiempo).",
        "La tasa de llegada λ debe ser mayor que 0.",
    )
    mu = _rate(
        req.mu,
        "Ingresa la tasa de servicio μ (clientes que atiende un servidor por unidad de tiempo).",
        "La tasa de servicio μ debe ser mayor que 0.",
    )

    s = 1
    if model in MULTI_SERVER:
        s = _integer(
            req.s,
            "Indica el número de servidores s.",
            "El número de servidores s debe ser un entero mayor o igual que 1.",
            QUEUES_S_MAX,
            f"s no puede superar {QUEUES_S_MAX}",
        )

    K = None
    if model in ("M/M/1/K", "M/M/s/K"):
        K = _integer(
            req.K,
            "Indica la capacidad máxima K (clientes en la fila más los que se atienden).",
            "La capacidad K debe ser un entero mayor o igual que 1.",
            QUEUES_K_MAX,
            f"K no puede superar {QUEUES_K_MAX}",
        )
        if K < s:
            raise ValueError(
                f"La capacidad K ({K}) debe ser al menos igual al número de servidores s ({s})."
            )

    N = None
    if model == "M/M/s/N":
        N = _integer(
            req.N,
            "Indica el tamaño de la población N (clientes potenciales).",
            "La población N debe ser un entero mayor o igual que 1.",
            QUEUES_N_MAX,
            f"N no puede superar {QUEUES_N_MAX}",
        )

    sigma = None
    if model == "M/G/1":
        sigma = _non_negative(
            req.service_std_dev, "La desviación estándar σ del servicio no puede ser negativa."
        )
        if sigma is None:
            raise ValueError("Indica la desviación estándar σ del tiempo de servicio.")

    basis = req.waiting_cost_basis if req.waiting_cost_basis is not None else "system"
    if basis not in ("system", "queue"):
        raise ValueError("waiting_cost_basis debe ser «system» (L) o «queue» (Lq).")

    s_max = None
    if _opt_number(req.s_max) is not None:
        s_max = _integer(
            req.s_max,
            "",
            "El máximo de servidores a comparar debe ser un entero mayor o igual que 1.",
            QUEUES_S_MAX,
            f"s_max no puede superar {QUEUES_S_MAX}",
        )

    time_unit = None
    if isinstance(req.time_unit, str) and req.time_unit.strip():
        time_unit = req.time_unit.strip()[:24]

    return Params(
        model=model,
        lam=lam,
        mu=mu,
        s=s,
        K=K,
        N=N,
        sigma=sigma,
        include_pn=req.include_pn is not False,
        cost_waiting=_non_negative(
            req.cost_waiting_per_unit_time, "El costo de espera no puede ser negativo."
        ),
        cost_server=_non_negative(
            req.cost_server_per_unit_time, "El costo por servidor no puede ser negativo."
        ),
        waiting_cost_basis=basis,
        optimize_s=bool(req.optimize_s),
        s_max=s_max,
        wait_threshold=_non_negative(
            req.wait_threshold,
            "El tiempo t para la probabilidad de espera no puede ser negativo.",
        ),
        time_unit=time_unit,
    )


# ——— Núcleo de cálculo ———


def _prob(x: float) -> float:
    """Recorta el ruido de punto flotante en probabilidades (p. ej. 1.0000000000000018)."""
    return min(1.0, max(0.0, x))


def _birth_death(max_n: int, ratio: Callable[[int], float]) -> list[float]:
    """Probabilidades de nacimiento y muerte normalizadas en escala logarítmica (sin desbordes)."""
    log_w = [0.0]
    for n in range(1, max_n + 1):
        r = ratio(n)
        log_w.append(log_w[-1] + math.log(r) if r > 0 else -INF)
    top = max(log_w)
    w = [math.exp(x - top) for x in log_w]
    total = sum(w)
    return [x / total for x in w]


def _erlang_tails(m: int, x: float) -> list[float]:
    """tails[k] = P(Poisson(x) <= k - 1) = P(Erlang(k) > t), con x = tasa · t."""
    tails = [0.0]
    if x <= 0:
        return tails + [1.0] * m
    log_term = -x
    cum = 0.0
    for k in range(1, m + 1):
        if k > 1:
            log_term += math.log(x) - math.log(k - 1)
        cum += math.exp(log_term)
        tails.append(min(1.0, cum))
    return tails


def _finite_wq_tail(arrival: list[float], s: int, mu: float) -> Callable[[float], float]:
    """P(Wq > t) en modelos finitos: mezcla de Erlang según lo que ve el cliente al llegar."""
    max_k = len(arrival) - s

    def tail(t: float) -> float:
        if max_k <= 0:
            return 0.0
        tails = _erlang_tails(max_k, s * mu * t)
        total = sum(arrival[n] * tails[n - s + 1] for n in range(s, len(arrival)))
        return _prob(total)

    return tail


def _integrate_w_tail(wq: Callable[[float], float], mu: float) -> Callable[[float], float]:
    """P(W > t) = P(S > t) + ∫₀ᵗ μe^{-μy} P(Wq > t − y) dy (Simpson)."""

    def tail(t: float) -> float:
        if t <= 0:
            return 1.0
        steps = 200
        h = t / steps
        acc = 0.0
        for i in range(steps + 1):
            y = i * h
            weight = 1 if i in (0, steps) else (4 if i % 2 else 2)
            acc += weight * mu * math.exp(-mu * y) * wq(t - y)
        return _prob(math.exp(-mu * t) + acc * h / 3)

    return tail


def _unstable(lam: float, mu: float, s: int, suggest_servers: bool) -> Core:
    r = lam / mu
    metrics: dict[str, float] = {
        "L": INF,
        "Lq": INF,
        "W": INF,
        "Wq": INF,
        "rho": lam / (s * mu),
        "P0": 0.0,
        "Pw": 1.0,
        "r": r,
        "servers": float(s),
        "busy_servers": float(s),
        "idle_servers": 0.0,
    }
    # Con varios servidores en paralelo bastaría con s > λ/μ.
    if suggest_servers:
        metrics["s_min_stable"] = float(math.floor(r) + 1)
    return Core(metrics=metrics, pn=None, stable=False)


def _mms(lam: float, mu: float, s: int, include_pn: bool) -> Core:
    """M/M/s con capacidad infinita (s = 1 es M/M/1)."""
    r = lam / mu
    rho = r / s
    if rho >= 1:
        return _unstable(lam, mu, s, True)
    w = 1.0
    below = 0.0
    for n in range(s):
        below += w
        w = w * r / (n + 1)
    # w = r^s / s!
    tail_sum = w / (1 - rho)
    p0 = 1 / (below + tail_sum)
    pw = tail_sum * p0
    lq = pw * rho / (1 - rho)
    L = lq + r
    wq = lq / lam
    W = wq + 1 / mu

    pn = None
    if include_pn:
        pn = []
        p = p0
        cum = 0.0
        for n in range(PN_MAX_ROWS):
            if n > 0:
                p = p * r / min(n, s)
            pn.append(p)
            cum += p
            if n >= max(s + 1, 5) and 1 - cum < PN_TAIL:
                break

    decay = s * mu - lam
    gap = s - 1 - r

    def wq_tail(t: float) -> float:
        return pw * math.exp(-decay * t)

    # P(W > t) = e^{-μt}·[1 + Pw·(1 − e^{-μt(s−1−r)}) / (s−1−r)], escrito sin desbordes cuando s−1−r < 0.
    def w_tail(t: float) -> float:
        if t <= 0:
            return 1.0
        a1 = math.exp(-mu * t)
        if abs(gap) < 1e-12:
            value = a1 * (1 + pw * mu * t)
        elif gap > 0:
            value = a1 * (1 - pw * math.expm1(-mu * t * gap) / gap)
        else:
            value = a1 + pw * (math.exp(-mu * t * (s - r)) - a1) / -gap
        return _prob(value)

    return Core(
        metrics={
            "L": L,
            "Lq": lq,
            "W": W,
            "Wq": wq,
            "rho": rho,
            "P0": p0,
            "Pw": pw,
            "r": r,
            "servers": float(s),
            "busy_servers": r,
            "idle_servers": s - r,
        },
        pn=pn,
        stable=True,
        wq_tail=wq_tail,
        w_tail=w_tail,
        parts={"below": below, "tail": tail_sum},
    )


def _mmsk(lam: float, mu: float, s: int, K: int) -> Core:
    """M/M/s/K: capacidad finita K (s = 1 es M/M/1/K)."""
    r = lam / mu
    pn = _birth_death(K, lambda n: r / min(n, s))
    p0 = pn[0]
    pk = pn[K]
    lam_eff = lam * (1 - pk)
    L = sum(n * pn[n] for n in range(K + 1))
    lq = sum((n - s) * pn[n] for n in range(s + 1, K + 1))
    busy = L - lq
    W = L / lam_eff if lam_eff > 0 else INF
    wq = lq / lam_eff if lam_eff > 0 else INF
    accepted = 1 - pk
    arrival = [p / accepted if accepted > 0 else 0.0 for p in pn[:K]]
    pw = sum(arrival[n] for n in range(s, K))
    wq_tail = _finite_wq_tail(arrival, s, mu)
    return Core(
        metrics={
            "L": L,
            "Lq": lq,
            "W": W,
            "Wq": wq,
            "rho": _prob(busy / s),
            "P0": p0,
            "Pw": _prob(pw),
            "r": r,
            "servers": float(s),
            "busy_servers": min(float(s), busy),
            "idle_servers": max(0.0, s - busy),
            "lambda_eff": lam_eff,
            "P_block": pk,
            "lambda_lost": lam * pk,
        },
        pn=pn,
        stable=True,
        wq_tail=wq_tail,
        w_tail=_integrate_w_tail(wq_tail, mu),
    )


def _mmsn(lam: float, mu: float, s: int, N: int) -> Core:
    """M/M/s//N: población finita de N clientes; λ es la tasa de cada cliente fuera del sistema."""
    pn = _birth_death(N, lambda n: (N - n + 1) * lam / (min(n, s) * mu))
    p0 = pn[0]
    L = sum(n * pn[n] for n in range(N + 1))
    lq = sum((n - s) * pn[n] for n in range(s + 1, N + 1))
    lam_eff = lam * (N - L)
    busy = L - lq
    W = L / lam_eff if lam_eff > 0 else INF
    wq = lq / lam_eff if lam_eff > 0 else INF
    outside = N - L
    arrival = [(N - n) * p / outside if outside > 0 else 0.0 for n, p in enumerate(pn[:N])]
    pw = sum(arrival[n] for n in range(s, N))
    wq_tail = _finite_wq_tail(arrival, s, mu)
    return Core(
        metrics={
            "L": L,
            "Lq": lq,
            "W": W,
            "Wq": wq,
            "rho": _prob(busy / s),
            "P0": p0,
            "Pw": _prob(pw),
            "r": lam / mu,
            "servers": float(s),
            "busy_servers": min(float(s), busy),
            "idle_servers": max(0.0, s - busy),
            "lambda_eff": lam_eff,
            "customers_outside": outside,
        },
        pn=pn,
        stable=True,
        wq_tail=wq_tail,
        w_tail=_integrate_w_tail(wq_tail, mu),
    )


def _mg1(lam: float, mu: float, sigma: float) -> Core:
    """M/G/1 con Pollaczek-Khinchine; M/D/1 es el caso σ = 0."""
    rho = lam / mu
    if rho >= 1:
        return _unstable(lam, mu, 1, False)
    lq = (lam**2 * sigma**2 + rho**2) / (2 * (1 - rho))
    L = lq + rho
    wq = lq / lam
    W = wq + 1 / mu
    return Core(
        metrics={
            "L": L,
            "Lq": lq,
            "W": W,
            "Wq": wq,
            "rho": rho,
            "P0": 1 - rho,
            "Pw": rho,
            "r": rho,
            "servers": 1.0,
            "busy_servers": rho,
            "idle_servers": 1 - rho,
            "cv_service": sigma * mu,
        },
        pn=None,
        stable=True,
    )


def _evaluate(p: Params, lam: float, s: int, include_pn: bool) -> Core:
    mu = p.mu
    if p.model == "M/M/1":
        return _mms(lam, mu, 1, include_pn)
    if p.model == "M/M/s":
        return _mms(lam, mu, s, include_pn)
    if p.model == "M/M/1/K":
        return _mmsk(lam, mu, 1, int(p.K or 0))
    if p.model == "M/M/s/K":
        return _mmsk(lam, mu, s, int(p.K or 0))
    if p.model == "M/M/s/N":
        return _mmsn(lam, mu, s, int(p.N or 0))
    if p.model == "M/G/1":
        return _mg1(lam, mu, float(p.sigma or 0.0))
    return _mg1(lam, mu, 0.0)


# ——— Presentación ———


def fmt(x: float) -> str:
    """Número corto para las sustituciones: hasta 4 decimales, sin ceros de sobra."""
    if not math.isfinite(x):
        return "∞" if x > 0 else "-∞"
    r = round(x, 4) + 0.0
    if r == 0:
        return "0"
    if float(r).is_integer() and abs(r) < 1e15:
        return str(int(r))
    return f"{r:.4f}".rstrip("0").rstrip(".")


FormulaRow = list[Any]


def _formula_rows(p: Params, core: Core) -> list[FormulaRow]:
    m = core.metrics
    lam = p.lam
    mu = p.mu
    s = p.s
    t = p.time_unit or "unidad de tiempo"
    cl = "clientes"
    rows: list[FormulaRow] = []

    def push(label: str, formula: str, subst: str, value: float | None, unit: str = "") -> None:
        val = value if value is not None and math.isfinite(value) else None
        rows.append([label, formula, subst, val, unit])

    if not core.stable:
        multi = p.model == "M/M/s"
        sm = "s·μ" if multi else "μ"
        push(
            "Utilización ρ",
            "ρ = λ / (s·μ)" if multi else "ρ = λ / μ",
            f"{fmt(lam)} / ({s} · {fmt(mu)})" if multi else f"{fmt(lam)} / {fmt(mu)}",
            m["rho"],
        )
        push("Condición de estabilidad", f"ρ < 1  ⇔  λ < {sm}", f"{fmt(m['rho'])} ≥ 1", None)
        return rows

    if p.model == "M/M/1":
        push("Utilización ρ", "ρ = λ / μ", f"{fmt(lam)} / {fmt(mu)}", m["rho"])
        push("Prob. de sistema vacío P0", "P0 = 1 - ρ", f"1 - {fmt(m['rho'])}", m["P0"])
        push("Clientes en el sistema L", "L = ρ / (1 - ρ)", f"{fmt(m['rho'])} / (1 - {fmt(m['rho'])})", m["L"], cl)
        push("Clientes en la fila Lq", "Lq = ρ² / (1 - ρ)", f"{fmt(m['rho'])}² / (1 - {fmt(m['rho'])})", m["Lq"], cl)
        push("Tiempo en el sistema W", "W = 1 / (μ - λ)", f"1 / ({fmt(mu)} - {fmt(lam)})", m["W"], t)
        push(
            "Tiempo en la fila Wq",
            "Wq = λ / (μ·(μ - λ))",
            f"{fmt(lam)} / ({fmt(mu)} · ({fmt(mu)} - {fmt(lam)}))",
            m["Wq"],
            t,
        )
        push("Prob. de esperar Pw", "Pw = ρ", fmt(m["rho"]), m["Pw"])
        push("Prob. de n clientes Pn", "Pn = (1 - ρ)·ρ^n", "ver tabla Pn", None)
    elif p.model == "M/M/s":
        parts = core.parts
        push("Utilización ρ", "ρ = λ / (s·μ)", f"{fmt(lam)} / ({s} · {fmt(mu)})", m["rho"])
        push(
            "Prob. de sistema vacío P0",
            "P0 = [Σ(n=0..s-1) (λ/μ)^n / n! + (λ/μ)^s / (s!·(1 - ρ))]^-1",
            f"[{fmt(parts['below'])} + {fmt(parts['tail'])}]^-1",
            m["P0"],
        )
        push(
            "Prob. de esperar Pw (Erlang C)",
            "Pw = (λ/μ)^s · P0 / (s!·(1 - ρ))",
            f"{fmt(m['r'])}^{s} · {fmt(m['P0'])} / ({s}! · (1 - {fmt(m['rho'])}))",
            m["Pw"],
        )
        push(
            "Clientes en la fila Lq",
            "Lq = Pw · ρ / (1 - ρ)",
            f"{fmt(m['Pw'])} · {fmt(m['rho'])} / (1 - {fmt(m['rho'])})",
            m["Lq"],
            cl,
        )
        push("Clientes en el sistema L", "L = Lq + λ/μ", f"{fmt(m['Lq'])} + {fmt(m['r'])}", m["L"], cl)
        push("Tiempo en la fila Wq", "Wq = Lq / λ", f"{fmt(m['Lq'])} / {fmt(lam)}", m["Wq"], t)
        push("Tiempo en el sistema W", "W = Wq + 1/μ", f"{fmt(m['Wq'])} + 1 / {fmt(mu)}", m["W"], t)
        push(
            "Prob. de n clientes Pn",
            "Pn = P0·(λ/μ)^n / n!  (n ≤ s);  P0·(λ/μ)^n / (s!·s^(n-s))  (n > s)",
            "ver tabla Pn",
            None,
        )
    elif p.model in ("M/M/1/K", "M/M/s/K"):
        K = int(p.K or 0)
        single = p.model == "M/M/1/K"
        push(
            "Prob. de n clientes Pn",
            "Pn = P0·(λ/μ)^n,  n = 0..K"
            if single
            else "Pn = P0·(λ/μ)^n / n!  (n ≤ s);  P0·(λ/μ)^n / (s!·s^(n-s))  (s < n ≤ K)",
            "ver tabla Pn",
            None,
        )
        push("Prob. de sistema vacío P0", "P0 = 1 / Σ(n=0..K) (términos de Pn sin P0)", f"K = {K}", m["P0"])
        push("Prob. de sistema lleno PK", "PK = Pn con n = K", f"n = {K}", m["P_block"])
        push(
            "Tasa efectiva λeff",
            "λeff = λ·(1 - PK)",
            f"{fmt(lam)} · (1 - {fmt(m['P_block'])})",
            m["lambda_eff"],
            f"{cl}/{t}",
        )
        push(
            "Clientes rechazados",
            "λ·PK",
            f"{fmt(lam)} · {fmt(m['P_block'])}",
            m["lambda_lost"],
            f"{cl}/{t}",
        )
        push("Clientes en el sistema L", "L = Σ n·Pn", "ver tabla Pn", m["L"], cl)
        push(
            "Clientes en la fila Lq",
            "Lq = L - (1 - P0)" if single else "Lq = Σ(n>s) (n - s)·Pn",
            f"{fmt(m['L'])} - (1 - {fmt(m['P0'])})" if single else "ver tabla Pn",
            m["Lq"],
            cl,
        )
        push("Tiempo en el sistema W", "W = L / λeff", f"{fmt(m['L'])} / {fmt(m['lambda_eff'])}", m["W"], t)
        push("Tiempo en la fila Wq", "Wq = Lq / λeff", f"{fmt(m['Lq'])} / {fmt(m['lambda_eff'])}", m["Wq"], t)
        push(
            "Utilización ρ",
            "ρ = λeff / μ = 1 - P0" if single else "ρ = λeff / (s·μ)",
            f"{fmt(m['lambda_eff'])} / {fmt(mu)}"
            if single
            else f"{fmt(m['lambda_eff'])} / ({s} · {fmt(mu)})",
            m["rho"],
        )
        push("Prob. de esperar Pw", "Pw = Σ(s ≤ n < K) Pn / (1 - PK)", "ver tabla Pn", m["Pw"])
    elif p.model == "M/M/s/N":
        N = int(p.N or 0)
        push(
            "Prob. de n clientes Pn",
            "Pn = P0·N!/((N-n)!·n!)·(λ/μ)^n  (n ≤ s);  P0·N!/((N-n)!·s!·s^(n-s))·(λ/μ)^n  (s < n ≤ N)",
            "ver tabla Pn",
            None,
        )
        push("Prob. de sistema vacío P0", "P0 = 1 / Σ(n=0..N) (términos de Pn sin P0)", f"N = {N}", m["P0"])
        push("Clientes en el sistema L", "L = Σ n·Pn", "ver tabla Pn", m["L"], cl)
        push("Clientes en la fila Lq", "Lq = Σ(n>s) (n - s)·Pn", "ver tabla Pn", m["Lq"], cl)
        push("Clientes fuera del sistema", "N - L", f"{N} - {fmt(m['L'])}", m["customers_outside"], cl)
        push(
            "Tasa efectiva λeff",
            "λeff = λ·(N - L)",
            f"{fmt(lam)} · ({N} - {fmt(m['L'])})",
            m["lambda_eff"],
            f"{cl}/{t}",
        )
        push("Tiempo en el sistema W", "W = L / λeff", f"{fmt(m['L'])} / {fmt(m['lambda_eff'])}", m["W"], t)
        push("Tiempo en la fila Wq", "Wq = Lq / λeff", f"{fmt(m['Lq'])} / {fmt(m['lambda_eff'])}", m["Wq"], t)
        push("Utilización ρ", "ρ = λeff / (s·μ)", f"{fmt(m['lambda_eff'])} / ({s} · {fmt(mu)})", m["rho"])
        push("Prob. de esperar Pw", "Pw = Σ(n ≥ s) (N - n)·Pn / (N - L)", "ver tabla Pn", m["Pw"])
    else:
        det = p.model == "M/D/1"
        sigma = 0.0 if det else float(p.sigma or 0.0)
        push("Utilización ρ", "ρ = λ / μ", f"{fmt(lam)} / {fmt(mu)}", m["rho"])
        push("Prob. de sistema vacío P0", "P0 = 1 - ρ", f"1 - {fmt(m['rho'])}", m["P0"])
        if det:
            push(
                "Clientes en la fila Lq",
                "Lq = ρ² / (2·(1 - ρ))",
                f"{fmt(m['rho'])}² / (2 · (1 - {fmt(m['rho'])}))",
                m["Lq"],
                cl,
            )
        else:
            push(
                "Clientes en la fila Lq (Pollaczek-Khinchine)",
                "Lq = (λ²σ² + ρ²) / (2·(1 - ρ))",
                f"({fmt(lam)}² · {fmt(sigma)}² + {fmt(m['rho'])}²) / (2 · (1 - {fmt(m['rho'])}))",
                m["Lq"],
                cl,
            )
        push("Clientes en el sistema L", "L = Lq + ρ", f"{fmt(m['Lq'])} + {fmt(m['rho'])}", m["L"], cl)
        push("Tiempo en la fila Wq", "Wq = Lq / λ", f"{fmt(m['Lq'])} / {fmt(lam)}", m["Wq"], t)
        push("Tiempo en el sistema W", "W = Wq + 1/μ", f"{fmt(m['Wq'])} + 1 / {fmt(mu)}", m["W"], t)
        push("Prob. de esperar Pw", "Pw = ρ", fmt(m["rho"]), m["Pw"])

    if m.get("t") is not None and m.get("P_wq_gt_t") is not None:
        tt = fmt(m["t"])
        if p.model in ("M/M/1", "M/M/s"):
            push(
                "Prob. de esperar en fila más de t",
                "P(Wq > t) = Pw · e^(-(s·μ - λ)·t)",
                f"{fmt(m['Pw'])} · e^(-({s} · {fmt(mu)} - {fmt(lam)}) · {tt})",
                m["P_wq_gt_t"],
            )
            push(
                "Prob. de estar en el sistema más de t",
                "P(W > t) = e^(-μ·(1 - ρ)·t)"
                if p.model == "M/M/1"
                else "P(W > t) = e^(-μ·t)·[1 + Pw·(1 - e^(-μ·t·(s - 1 - λ/μ))) / (s - 1 - λ/μ)]",
                f"t = {tt}",
                m["P_w_gt_t"],
            )
        else:
            push(
                "Prob. de esperar en fila más de t",
                "P(Wq > t) = Σ πn · P(Erlang(n - s + 1, s·μ) > t)",
                f"t = {tt}",
                m["P_wq_gt_t"],
            )
            push(
                "Prob. de estar en el sistema más de t",
                "P(W > t) = P(S > t) + ∫ μe^(-μy)·P(Wq > t - y) dy",
                f"t = {tt}",
                m["P_w_gt_t"],
            )

    if m.get("cost_total") is not None:
        queue = p.waiting_cost_basis == "queue"
        base = "Lq" if queue else "L"
        cw = p.cost_waiting or 0.0
        cs = p.cost_server or 0.0
        push("Costo de espera", f"Cw · {base}", f"{fmt(cw)} · {fmt(m['Lq'] if queue else m['L'])}", m["cost_waiting"], f"$/{t}")
        push("Costo de servicio", "Cs · s", f"{fmt(cs)} · {p.s}", m["cost_server"], f"$/{t}")
        push(
            "Costo total",
            f"Cw·{base} + Cs·s",
            f"{fmt(m['cost_waiting'])} + {fmt(m['cost_server'])}",
            m["cost_total"],
            f"$/{t}",
        )
    return rows


def _waiting_base(p: Params, m: dict[str, float]) -> float:
    return m["Lq"] if p.waiting_cost_basis == "queue" else m["L"]


def _apply_costs(p: Params, core: Core, warnings: list[str]) -> None:
    if p.cost_waiting is None and p.cost_server is None:
        return
    if not core.stable:
        warnings.append("No se calculan costos: el sistema es inestable (la fila crece sin límite).")
        return
    m = core.metrics
    cw = p.cost_waiting or 0.0
    cs = p.cost_server or 0.0
    m["cost_waiting"] = cw * _waiting_base(p, m)
    m["cost_server"] = cs * p.s
    m["cost_total"] = m["cost_waiting"] + m["cost_server"]


def _optimize_servers(p: Params, metrics: dict[str, float], warnings: list[str]) -> NamedTable | None:
    if p.model not in MULTI_SERVER:
        warnings.append(
            "La comparación de servidores solo aplica a modelos con varios servidores (M/M/s, M/M/s/K, M/M/s//N)."
        )
        return None
    if p.cost_waiting is None or p.cost_server is None:
        warnings.append(
            "Para comparar el número de servidores captura el costo de espera y el costo por servidor."
        )
        return None
    cw = p.cost_waiting
    cs = p.cost_server
    r = p.lam / p.mu
    if p.model == "M/M/s/K":
        capacity = int(p.K or 0)
    elif p.model == "M/M/s/N":
        capacity = int(p.N or 0)
    else:
        capacity = QUEUES_S_MAX
    min_stable = math.floor(r) + 1 if p.model == "M/M/s" else 1
    default_upper = max(min_stable + 8, p.s + 5)
    upper = min(p.s_max if p.s_max is not None else default_upper, QUEUES_S_MAX, capacity)

    rows: list[list[Any]] = []
    best_s: int | None = None
    best_cost = INF
    for s_try in range(1, upper + 1):
        core = _evaluate(p, p.lam, s_try, False)
        if not core.stable:
            continue
        m = core.metrics
        cost_waiting = cw * _waiting_base(p, m)
        cost_server = cs * s_try
        cost_total = cost_waiting + cost_server
        rows.append(
            [s_try, m["L"], m["Lq"], m["W"], m["Wq"], m["rho"], m["Pw"], cost_waiting, cost_server, cost_total, False]
        )
        if cost_total < best_cost - 1e-12:
            best_cost = cost_total
            best_s = s_try
    # Con s ≤ λ/μ la fila crece sin límite: esos valores de s no aparecen en la tabla.
    if best_s is None:
        warnings.append(
            f"No hay un número de servidores estable hasta s = {upper}; aumenta el máximo a comparar."
        )
        return None
    for row in rows:
        row[-1] = row[0] == best_s
    metrics["s_optimal"] = float(best_s)
    metrics["cost_total_optimal"] = best_cost
    return NamedTable(
        name="cost_by_s",
        columns=[
            "servidores",
            "L",
            "Lq",
            "W",
            "Wq",
            "rho",
            "Pw",
            "costo_espera",
            "costo_servidor",
            "costo_total",
            "óptimo",
        ],
        rows=rows,
    )


def _input_table(p: Params) -> NamedTable:
    """Datos del problema: los usa la interfaz y aparecen al inicio del PDF y del Excel."""
    rows: list[list[Any]] = [["Modelo", p.model, "model"]]
    rows.append(
        ["Tasa de llegada por cliente λ" if p.model == "M/M/s/N" else "Tasa de llegada λ", p.lam, "lambda"]
    )
    rows.append(["Tasa de servicio por servidor μ", p.mu, "mu"])
    rows.append(["Servidores s", p.s, "s"])
    if p.K is not None:
        rows.append(["Capacidad del sistema K", p.K, "K"])
    if p.N is not None:
        rows.append(["Población N", p.N, "N"])
    if p.model == "M/G/1":
        rows.append(["Desv. estándar del servicio σ", p.sigma, "sigma"])
    if p.time_unit:
        rows.append(["Unidad de tiempo", p.time_unit, "time_unit"])
    if p.cost_waiting is not None or p.cost_server is not None:
        rows.append(["Costo de espera por cliente", p.cost_waiting or 0.0, "cost_waiting"])
        rows.append(["Costo por servidor", p.cost_server or 0.0, "cost_server"])
        rows.append(
            [
                "Costo de espera sobre",
                "Lq (clientes en la fila)" if p.waiting_cost_basis == "queue" else "L (clientes en el sistema)",
                "waiting_cost_basis",
            ]
        )
    if p.wait_threshold is not None:
        rows.append(["Tiempo t", p.wait_threshold, "wait_threshold"])
    return NamedTable(name="datos", columns=["parametro", "valor", "clave"], rows=rows)


def _congestion_curve(p: Params) -> NamedTable:
    """Curva de congestión: cómo cambian L y W cuando sube la tasa de llegada con todo lo demás fijo."""
    lambdas: list[float] = []
    if p.model in FINITE:
        lambdas = [p.lam * i / 10 for i in range(1, 21)]
    else:
        capacity = p.s * p.mu
        grid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97]
        lambdas = [g * capacity for g in grid]
        if p.lam < capacity:
            lambdas.append(p.lam)
    unique = sorted({float(f"{x:.12g}") for x in lambdas})
    rows: list[list[Any]] = []
    for lam in unique:
        m = _evaluate(p, lam, p.s, False).metrics
        rows.append([lam, m["rho"], m["L"], m["Lq"], m["W"], m["Wq"]])
    return NamedTable(name="curva_congestion", columns=["lambda", "rho", "L", "Lq", "W", "Wq"], rows=rows)


def solve(req: QueuesRequest) -> ModuleResult:
    p = parse_request(req)
    warnings: list[str] = []
    core = _evaluate(p, p.lam, p.s, p.include_pn)
    m = core.metrics

    if not core.stable:
        capacity = "s·μ" if p.model == "M/M/s" else "μ"
        warnings.append(
            f"Sistema inestable: ρ = {fmt(m['rho'])} ≥ 1. Llegan más clientes (λ = {fmt(p.lam)}) "
            f"de los que se pueden atender ({capacity} = {fmt(p.s * p.mu)}), así que la fila crece "
            "sin límite; L, Lq, W y Wq tienden a infinito."
        )
    elif m["rho"] >= 0.9 and "P_block" not in m and "customers_outside" not in m:
        warnings.append(
            f"Sistema muy cargado (ρ = {fmt(m['rho'])}): un pequeño aumento en las llegadas "
            "hace crecer mucho la espera."
        )
    if p.model == "M/M/s/N" and int(p.N or 0) <= p.s:
        warnings.append(
            "Con N ≤ s nunca se forma fila: siempre hay un servidor libre para cada cliente (Lq = 0)."
        )

    if p.wait_threshold is not None:
        if core.wq_tail is not None and core.stable:
            t = p.wait_threshold
            m["t"] = t
            m["P_wq_gt_t"] = core.wq_tail(t)
            w_tail = core.w_tail or _integrate_w_tail(core.wq_tail, p.mu)
            m["P_w_gt_t"] = w_tail(t)
        elif core.stable:
            warnings.append(
                "La probabilidad de esperar más de t solo se calcula en modelos exponenciales (M/M/…); "
                "en M/G/1 y M/D/1 no hay fórmula cerrada."
            )

    _apply_costs(p, core, warnings)

    tables: list[NamedTable] = [_input_table(p)]
    graph = None
    if core.pn is not None and p.include_pn:
        rows: list[list[Any]] = []
        cum = 0.0
        for n, prob in enumerate(core.pn):
            cum += prob
            rows.append([n, float(prob), min(1.0, cum)])
        tables.append(NamedTable(name="Pn", columns=["n", "Pn", "acumulada"], rows=rows))
        if "lambda_eff" not in m and 1 - cum > PN_TAIL:
            warnings.append(
                f"La tabla Pn se muestra hasta n = {len(core.pn) - 1}; "
                f"los valores mayores suman {fmt(1 - cum)} de probabilidad."
            )
        graph = GraphXY(
            type="xy",
            series=[{"name": "Pn", "x": list(range(len(core.pn))), "y": [float(x) for x in core.pn]}],
            x_label="n (clientes en el sistema)",
            y_label="Probabilidad Pn",
            title="Distribución de probabilidad del número de clientes",
            subtitle=f"Modelo {p.model}",
            kind="bar",
        )

    if p.optimize_s:
        cost_table = _optimize_servers(p, m, warnings)
        if cost_table is not None:
            tables.append(cost_table)

    tables.append(
        NamedTable(
            name="formulas",
            columns=["medida", "formula", "sustitucion", "valor", "unidad"],
            rows=_formula_rows(p, core),
        )
    )
    tables.append(_congestion_curve(p))

    variables = {k: float(v) for k, v in m.items() if isinstance(v, (int, float)) and math.isfinite(float(v))}

    result = ModuleResult(
        module="queues",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=m),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
