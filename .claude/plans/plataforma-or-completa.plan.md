# Plan técnico (agent handoff): LaraOps (Plataforma OR)

**Status**: READY FOR IMPLEMENTATION after user `yes`/`proceed`  
**Source PRD**: `.claude/prds/plataforma-or.prd.md`  
**Context docs**: `investigacion_WinQSB_QM.md`, `planning_proyecto_OR_app.md`  
**Phase A slice**: `.claude/plans/fundamento-producto-resolutor.plan.md`  
**Complexity**: Large  
**Priority**: Backend > contracts > tests > stub UI. Do **not** polish frontend until Phase H.

---

## 0. Agent execution protocol

### 0.1 How to work
1. Implement **one phase at a time** (A → B → C → D → E). Stop at phase gate.
2. Within a phase: **TDD vertical slices** — one failing test → minimal code → green → next test. Do not batch all tests then all code.
3. Never invent alternate folder layouts; use §1 tree exactly.
4. Never change `ModuleResult` field names after Phase A gate without a migration note in this file.
5. Numeric tolerance: `abs(a-b) <= 1e-6` relative for floats unless fixture specifies otherwise; for LP objective use `atol=1e-4`.
6. No auth, no DB, no cloud. No modules outside current phase.
7. Language of code/comments/API: English identifiers; user-facing stub strings may be Spanish.
8. After each phase gate: run full `pytest -q` in `api/` and update PRD milestone status (`in-progress` → `complete`).

### 0.2 Done means
- All acceptance checkboxes for that phase are true.
- `pytest -q` exit 0.
- OpenAPI at `/docs` lists new routes.
- No secrets in repo.

### 0.3 Out of scope forever for MVP (A–E)
Auth, cloud deploy, SimPy, NLP/QP, job shop, aggregate planning, facility location, design-system UI, PDF (Excel only until someone asks).

---

## 1. Repository tree (CREATE exactly)

```
/
├── .gitignore
├── README.md
├── docker-compose.yml
├── api/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── common.py
│   │   │   └── result.py
│   │   ├── modules/
│   │   │   ├── __init__.py
│   │   │   ├── eoq/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py
│   │   │   │   └── solver.py
│   │   │   ├── lp/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py
│   │   │   │   ├── solver.py          # pedagogical simplex
│   │   │   │   ├── sensitivity.py
│   │   │   │   └── graph_2d.py
│   │   │   ├── ilp/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py
│   │   │   │   └── solver.py          # PuLP wrapper
│   │   │   ├── transport/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py
│   │   │   │   └── solver.py
│   │   │   ├── assignment/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py
│   │   │   │   └── solver.py
│   │   │   └── pert_cpm/
│   │   │       ├── __init__.py
│   │   │       ├── models.py
│   │   │       └── solver.py
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── health.py
│   │   │   ├── eoq.py
│   │   │   ├── lp.py
│   │   │   ├── ilp.py
│   │   │   ├── transport.py
│   │   │   ├── assignment.py
│   │   │   └── pert_cpm.py
│   │   └── services/
│   │       ├── __init__.py
│   │       └── export_excel.py
│   └── tests/
│       ├── conftest.py
│       ├── schemas/test_module_result.py
│       ├── modules/
│       │   ├── test_eoq.py
│       │   ├── test_lp.py
│       │   ├── test_ilp.py
│       │   ├── test_transport.py
│       │   ├── test_assignment.py
│       │   └── test_pert_cpm.py
│       ├── api/
│       │   ├── test_health.py
│       │   ├── test_eoq_endpoint.py
│       │   ├── test_lp_endpoint.py
│       │   └── ...
│       └── fixtures/
│           └── textbook/          # JSON fixtures only (numbers, no prose)
│               ├── eoq_01.json
│               ├── lp_01.json
│               ├── transport_01.json
│               └── pert_01.json
└── web/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/client.ts
        ├── pages/
        │   ├── EoqPage.tsx
        │   ├── LpPage.tsx
        │   ├── TransportPage.tsx
        │   ├── AssignmentPage.tsx
        │   └── PertCpmPage.tsx
        └── components/
            ├── ResultsTabs.tsx
            └── JsonTable.tsx
```

Post-MVP modules (`queues`, `forecasting`, …) follow the same `modules/<name>/{models,solver}.py` + `routers/<name>.py` pattern — do not create them before Phase F.

---

## 2. Dependencies (pin these)

### 2.1 `api/pyproject.toml` (runtime + dev)

```toml
[project]
name = "laraops-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115,<1",
  "uvicorn[standard]>=0.32,<1",
  "pydantic>=2.9,<3",
  "numpy>=2.0,<3",
  "scipy>=1.14,<2",
  "pulp>=2.9,<3",
  "openpyxl>=3.1,<4",
  "networkx>=3.3,<4",
]

[project.optional-dependencies]
dev = ["pytest>=8.3,<9", "httpx>=0.27,<1", "ruff>=0.6"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

### 2.2 `web/package.json` (stub only)

- `react`, `react-dom`, `react-router-dom` v6
- `vite`, `typescript`, `@vitejs/plugin-react`
- No AG Grid / Plotly / Tailwind required until Phase H (optional lightweight chart: native SVG or `recharts` only if needed for EOQ curve)

### 2.3 `docker-compose.yml`

- Service `api`: build `./api`, port `8000:8000`, cmd `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Service `web`: build `./web`, port `5173:5173`, env `VITE_API_URL=http://localhost:8000`
- No volumes required for MVP correctness

---

## 3. Frozen contracts (implement in Phase A; do not rename)

### 3.1 `app/schemas/common.py`

```python
from enum import Enum
from pydantic import BaseModel, Field

class SolveStatus(str, Enum):
    optimal = "optimal"       # optimization modules with proven optimum
    ok = "ok"                 # closed-form modules (EOQ, queues metrics)
    infeasible = "infeasible"
    unbounded = "unbounded"
    error = "error"

class ErrorBody(BaseModel):
    detail: str
    code: str | None = None
```

**Semantics**
- Use `optimal` for LP/ILP/transport/assignment when a feasible optimum exists.
- Use `ok` for EOQ and other closed-form calculators.
- Use `infeasible` / `unbounded` only for optimization.
- Use `error` for detected model defects after validation (e.g. cyclic PERT) that are not HTTP 422.

### 3.2 `app/schemas/result.py` — REQUIRED SHAPE

```python
from typing import Any, Literal
from pydantic import BaseModel, Field
from app.schemas.common import SolveStatus

class SolutionBlock(BaseModel):
    variables: dict[str, float] = Field(default_factory=dict)
    objective_value: float | None = None
    objective_sense: Literal["min", "max"] | None = None
    metrics: dict[str, float] = Field(default_factory=dict)  # module-specific scalars

class SensitivityBlock(BaseModel):
    shadow_prices: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"constraint_id": str, "shadow_price": float}
    reduced_costs: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"variable": str, "reduced_cost": float}
    objective_ranges: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"variable": str, "coeff": float, "allowable_increase": float, "allowable_decrease": float}
    rhs_ranges: list[dict[str, Any]] = Field(default_factory=list)
    # each: {"constraint_id": str, "rhs": float, "allowable_increase": float, "allowable_decrease": float}

class NamedTable(BaseModel):
    name: str
    columns: list[str]
    rows: list[list[Any]]

class GraphXY(BaseModel):
    type: Literal["xy"] = "xy"
    series: list[dict[str, Any]]
    # series item: {"name": str, "x": list[float], "y": list[float]}
    x_label: str = ""
    y_label: str = ""

class GraphNetwork(BaseModel):
    type: Literal["network"] = "network"
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    # edge may include "critical": bool

class GraphGantt(BaseModel):
    type: Literal["gantt"] = "gantt"
    bars: list[dict[str, Any]]
    # bar: {"id": str, "start": float, "end": float, "critical": bool}

class GraphMatrix(BaseModel):
    type: Literal["matrix"] = "matrix"
    row_labels: list[str]
    col_labels: list[str]
    values: list[list[float | None]]

GraphPayload = GraphXY | GraphNetwork | GraphGantt | GraphMatrix

class IterationStep(BaseModel):
    index: int
    method: str                 # e.g. "simplex", "vogel", "modi", "hungarian"
    title: str
    tableau: list[list[float | str]] | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

class ModuleResult(BaseModel):
    module: str
    status: SolveStatus
    solution: SolutionBlock
    iterations: list[IterationStep] | None = None
    sensitivity: SensitivityBlock | None = None
    graph: GraphPayload | None = None
    tables: list[NamedTable] | None = None
    warnings: list[str] = Field(default_factory=list)
```

### 3.3 Module IDs (string constants)

| module field | router prefix |
|---|---|
| `eoq` | `/api/v1/modules/eoq` |
| `linear_programming` | `/api/v1/modules/lp` |
| `integer_programming` | `/api/v1/modules/ilp` |
| `transport` | `/api/v1/modules/transport` |
| `assignment` | `/api/v1/modules/assignment` |
| `pert_cpm` | `/api/v1/modules/pert_cpm` |

### 3.4 HTTP conventions

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | — | `{"status":"ok"}` |
| POST | `/api/v1/modules/{mod}/solve` | module request model | `ModuleResult` |
| POST | `/api/v1/modules/{mod}/export.xlsx` | same as solve | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |

- Validation errors → **422** (FastAPI default).
- Domain errors after parse (cycle, empty activities) → **400** with `{"detail": "..."}` OR `ModuleResult(status=error)` — **pick one and use consistently**: prefer **400** for HTTP, keep solvers raising `ValueError` translated in router.
- CORS: allow `http://localhost:5173`, `http://127.0.0.1:5173`.

### 3.5 Module pattern (mandatory)

```python
# modules/<name>/solver.py  — NO fastapi imports
def solve(req: XxxRequest) -> ModuleResult: ...

# routers/<name>.py
@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: XxxRequest) -> ModuleResult:
    return solve(req)
```

---

## 4. Phase A — Foundation + EOQ (PRD milestone 1)

**Detailed twin file**: `.claude/plans/fundamento-producto-resolutor.plan.md` (must stay in sync with this section).

### A.1 EOQ math (canonical)

Inputs (all `> 0`):
- `D` annual demand
- `S` order cost
- `H` holding cost per unit per year
- optional `C` unit cost (default 0; included in TC if provided)

\[
Q^* = \sqrt{\frac{2DS}{H}},\quad
N = \frac{D}{Q^*},\quad
TC_{ordering} = N\cdot S,\quad
TC_{holding} = \frac{Q^*}{2}\cdot H,\quad
TC = TC_{ordering}+TC_{holding}+C\cdot D
\]

### A.2 `EOQRequest`

```python
class EOQRequest(BaseModel):
    D: float = Field(gt=0)
    S: float = Field(gt=0)
    H: float = Field(gt=0)
    C: float = Field(default=0, ge=0)
    graph_points: int = Field(default=40, ge=5, le=200)
```

### A.3 Expected `ModuleResult` fields for EOQ

- `module="eoq"`, `status=ok`
- `solution.metrics`: `Q_star`, `orders_per_year`, `time_between_orders_years`, `TC`, `TC_ordering`, `TC_holding`
- `solution.variables`: `{"Q": Q_star}`
- `graph`: `GraphXY` with series `TC`, `ordering`, `holding` vs Q in `[0.2 Q*, 2.5 Q*]`
- `iterations=null`, `sensitivity=null`
- `tables`: optional single table `"summary"`

### A.4 Fixture `tests/fixtures/textbook/eoq_01.json`

```json
{
  "request": {"D": 1000, "S": 10, "H": 0.5, "C": 0},
  "expect": {
    "status": "ok",
    "Q_star": 200.0,
    "TC": 100.0,
    "orders_per_year": 5.0
  }
}
```

Second fixture `eoq_02.json`: `D=2400,S=100,H=3` → `Q_star≈400`, assert with `atol=1e-6` on Q after rounding to 6 decimals or exact `sqrt(2*2400*100/3)=400`.

Invalid: `D=0` → HTTP 422.

### A.5 Tasks (order)

| ID | Action | Validate |
|---|---|---|
| A1 | Scaffold tree §1 + pyproject + `main.py` + CORS + `GET /health` | `pytest tests/api/test_health.py` |
| A2 | Implement §3 schemas + `test_module_result.py` roundtrip | pytest schemas |
| A3 | EOQ solver TDD with eoq_01/02 | `pytest tests/modules/test_eoq.py` |
| A4 | Router solve + export.xlsx via `export_excel.py` | `pytest tests/api/test_eoq_endpoint.py` |
| A5 | Web stub `EoqPage` → solve + tabs + download | manual smoke |
| A6 | README + docker-compose | follow README cold start |

**Gate A command**

```bash
cd api && pytest -q
curl -s localhost:8000/health
curl -s -X POST localhost:8000/api/v1/modules/eoq/solve \
  -H 'content-type: application/json' \
  -d '{"D":1000,"S":10,"H":0.5}'
```

---

## 5. Phase B — LP + ILP (PRD milestone 2) — CRITICAL PATH

### B.1 `LPRequest`

```python
class ConstraintSense(str, Enum):
    le = "<="
    ge = ">="
    eq = "="

class LPConstraint(BaseModel):
    id: str
    coeffs: dict[str, float]   # var_name -> a_ij
    sense: ConstraintSense
    rhs: float

class LPRequest(BaseModel):
    sense: Literal["min", "max"]
    objective: dict[str, float]          # var_name -> c_j
    constraints: list[LPConstraint]
    variable_names: list[str] | None = None  # optional order; else sorted keys
    bounds: dict[str, tuple[float | None, float | None]] | None = None
    # default bounds: (0, None) for all vars appearing in objective/constraints
    include_iterations: bool = True
    include_sensitivity: bool = True
    include_graph: bool = True
```

### B.2 Pedagogical simplex requirements

Implement **revised or tabular simplex** in `lp/solver.py` (standard form: slacks/surplus/artificials as needed).

Each `IterationStep` MUST include:
- `index`, `method="simplex"`, `title` (e.g. `"Iteration 2"`)
- `tableau`: full numeric tableau (rows × cols) as nested lists
- `meta`: `{ "basic": [...], "nonbasic": [...], "pivot": {"row": i, "col": j} | null, "z": float }`

Termination:
- optimal → `status=optimal`
- no leaving variable with negative reduced cost direction → `unbounded`
- artificials remain positive (two-phase/Big-M) → `infeasible`

**Cross-check (mandatory test)**: after own solver, run `scipy.optimize.linprog` on equivalent form; assert objective within `atol=1e-4` when both optimal.

### B.3 Sensitivity (optimal only)

Populate `SensitivityBlock` from final tableau / basis inverse:
- shadow prices for each original constraint id
- reduced costs for each decision variable
- allowable increase/decrease for objective coeffs and RHS (standard ranging)

If ranging numerically unstable, still return shadow prices + reduced costs; add warning.

### B.4 Graph 2D

If exactly 2 decision variables: `graph_2d.py` returns `GraphXY` or custom polygon series:
- constraint boundary segments
- feasible region polygon as series
- one objective level line through optimum

Else `graph=null` (no warning required).

### B.5 Fixture `lp_01.json` (classic product mix)

```json
{
  "request": {
    "sense": "max",
    "objective": {"x1": 3, "x2": 2},
    "constraints": [
      {"id": "c1", "coeffs": {"x1": 2, "x2": 1}, "sense": "<=", "rhs": 100},
      {"id": "c2", "coeffs": {"x1": 1, "x2": 1}, "sense": "<=", "rhs": 80},
      {"id": "c3", "coeffs": {"x1": 1, "x2": 0}, "sense": "<=", "rhs": 40}
    ]
  },
  "expect": {
    "status": "optimal",
    "objective_value": 180.0,
    "variables": {"x1": 20.0, "x2": 60.0}
  }
}
```

Also required tests:
- `lp_infeasible`: constraints `x<=1`, `x>=2` → `infeasible`
- `lp_unbounded`: max `x` s.t. `x >= 0` only → `unbounded`
- assert `iterations` is non-empty list when optimal and `include_iterations=true`
- assert `sensitivity.shadow_prices` length == number of constraints when optimal

### B.6 ILP

```python
class ILPRequest(LPRequest):
    integer_vars: list[str] = Field(default_factory=list)
    binary_vars: list[str] = Field(default_factory=list)
```

- Solve with PuLP + default CBC.
- `module="integer_programming"`, `status=optimal|infeasible`
- `iterations`: optional list of B&B node summaries `{meta: {nodes, best_bound, incumbent}}` — if unavailable, `iterations=null` + warning `"Branch-and-bound node log not exposed by solver backend"`.
- `sensitivity=null` (standard).
- Fixture: max `y` s.t. `y <= 3.7`, `y` integer → `y=3`.

### B.7 Gate B

```bash
cd api && pytest tests/modules/test_lp.py tests/modules/test_ilp.py tests/api/test_lp_endpoint.py -q
```

---

## 6. Phase C — Transport + Assignment (PRD milestone 3)

### C.1 Transport request

```python
class TransportRequest(BaseModel):
    supply: dict[str, float]                 # source -> supply
    demand: dict[str, float]                 # dest -> demand
    costs: dict[str, dict[str, float]]       # costs[source][dest]
    method: Literal["northwest", "vogel", "modi_auto"] = "modi_auto"
    # modi_auto: start Vogel (or NW) then MODI to optimality
```

Rules:
- If `sum(supply) != sum(demand)`, add dummy source/dest with 0 cost; push warning `"Balanced with dummy ..."`.
- `solution.variables` keys `"i->j"` → shipment.
- `solution.objective_value` = total cost; `sense=min`.
- `iterations`: NW or Vogel steps + each MODI improvement cycle (`method` field accordingly).
- `graph`: `GraphMatrix` of shipments.
- Cross-check optional: formulate as LP with PuLP; cost match `atol=1e-4`.

### C.2 Fixture `transport_01.json`

```json
{
  "request": {
    "supply": {"A": 20, "B": 30},
    "demand": {"X": 10, "Y": 40},
    "costs": {
      "A": {"X": 2, "Y": 3},
      "B": {"X": 4, "Y": 1}
    },
    "method": "modi_auto"
  },
  "expect": {
    "status": "optimal",
    "objective_value": 80.0,
    "shipments": {"A->X": 10, "A->Y": 10, "B->Y": 30}
  }
}
```

(Verify expected optimum by hand before locking fixture; if agent finds different optimal basis with same cost, assert **cost** + supply/demand satisfaction, not unique shipments.)

### C.3 Assignment request

```python
class AssignmentRequest(BaseModel):
    agents: list[str]
    tasks: list[str]
    costs: list[list[float]]   # len(agents) x len(tasks); must be square for v1
    sense: Literal["min", "max"] = "min"
```

- Non-square → 400 `"Assignment v1 requires square matrix; pad manually"`.
- Implement Hungarian with step log in `iterations` (`method="hungarian"`).
- Cross-check: `scipy.optimize.linear_sum_assignment`.
- `solution.variables`: `{"agent->task": 1.0, ...}`, objective = total cost/profit.

### C.4 Gate C

```bash
cd api && pytest tests/modules/test_transport.py tests/modules/test_assignment.py -q
```

---

## 7. Phase D — PERT/CPM (PRD milestone 4)

### D.1 Request

```python
class Activity(BaseModel):
    id: str
    predecessors: list[str] = Field(default_factory=list)
    duration: float | None = None          # CPM deterministic
    a: float | None = None                 # PERT optimistic
    m: float | None = None                 # most likely
    b: float | None = None                 # pessimistic

class PertCpmRequest(BaseModel):
    activities: list[Activity]
    mode: Literal["cpm", "pert"] = "cpm"
    target_time: float | None = None       # for PERT Prob(T<=target)
```

Rules:
- CPM: each activity must have `duration >= 0`.
- PERT: each activity must have `a,m,b` with `a<=m<=b`;  
  \( t_e=(a+4m+b)/6 \), \( \sigma^2=((b-a)/6)^2 \).
- Detect cycles → HTTP 400.
- Forward/backward pass → ES,EF,LS,LF,slack; critical if `slack <= 1e-9`.

### D.2 Result mapping

- `tables`:
  - `"schedule"`: columns `id,ES,EF,LS,LF,slack,critical,te,variance` (PERT cols empty in CPM)
  - `"critical_path"`: ordered ids (one primary path; if multiple, pick lexicographically smallest id sequence, warn)
- `graph`: prefer returning **both** via `tables` + pick primary `graph` as `GraphNetwork`; also include `GraphGantt` by placing gantt in `tables` meta OR add second graph — **v1 decision**: `graph` = `GraphNetwork`; gantt bars duplicated inside `tables` name `"gantt"` as rows `[id,start,end,critical]`.
- PERT: `metrics.project_te`, `metrics.project_variance`, `metrics.project_std`, `metrics.prob_meet_target` (if target provided) using standard normal CDF (`scipy.stats.norm.cdf`).

### D.3 Fixture `pert_01.json` (CPM)

Minimal diamond:

```json
{
  "request": {
    "mode": "cpm",
    "activities": [
      {"id": "A", "predecessors": [], "duration": 3},
      {"id": "B", "predecessors": ["A"], "duration": 4},
      {"id": "C", "predecessors": ["A"], "duration": 2},
      {"id": "D", "predecessors": ["B", "C"], "duration": 5}
    ]
  },
  "expect": {
    "project_duration": 12.0,
    "critical_path": ["A", "B", "D"]
  }
}
```

### D.4 Gate D

```bash
cd api && pytest tests/modules/test_pert_cpm.py -q
```

---

## 8. Phase E — Companion validation (PRD milestone 5)

Not code-heavy. Agent must prepare:

1. `examples/` folder with 3 ready JSON payloads: `lp_01`, `transport_01`, `pert_01`.
2. README section **"Primeros 15 minutos"** with exact commands.
3. Checklist file `docs/validation-session.md` with questions:
   - Did you need a VM? (Y/N)
   - Could you solve one homework-like problem? (Y/N)
   - Prefer this vs WinQSB/QM for this task? (Y/N)
4. Human collects ≥3 responses; agent marks milestone complete only when user confirms.

---

## 9. Phase F — High demand (post-MVP) — contract stubs only until E done

| Module id | Path | Input (min) | Output metrics |
|---|---|---|---|
| `queues` | `/modules/queues` | `model: M/M/1\|M/M/s\|M/M/1/K\|M/M/s/N`, `lambda`, `mu`, `s?`, `K?`, `N?` | `L,Lq,W,Wq,rho,P0` + optional `Pn` table |
| `inventory` | `/modules/inventory` | EOQ variants, quantity discount breaks | `Q*,TC,ROP` |
| `forecasting` | `/modules/forecasting` | series + methods list | forecasts + MAD/MSE/MAPE comparison table |
| `decision_analysis` | `/modules/decision_analysis` | payoff + probs | EV, EOL, EVPI, optional tree JSON |
| `game_theory` | `/modules/game_theory` | payoff matrix | pure/mixed strategies |

Each: ≥2 numeric fixtures + same `ModuleResult`.

---

## 10. Phase G — Complementary (on demand)

Implement only if user names the module. Same pattern. Suggested libs: `networkx` (already), `numpy`, own DP, own MRP explosion.

---

## 11. Phase H — Frontend polish (after backend MVP)

Allowed then:
- AG Grid / Handsontable data entry
- Plotly or Recharts for `GraphXY`
- react-flow for `GraphNetwork`
- Apply frontend design skills
- Do **not** change API contracts; only consume them

---

## 12. Export Excel (`services/export_excel.py`)

Function signature:

```python
def module_result_to_xlsx(result: ModuleResult) -> bytes: ...
```

Workbook sheets:
1. `Solution` — variables + objective + metrics
2. `Iterations` — if present (flatten meta)
3. `Sensitivity` — if present
4. `Tables` — each NamedTable stacked or separate sheets truncated to 31 chars

---

## 13. Stub web requirements (MVP)

- `VITE_API_URL` default `http://127.0.0.1:8000`
- Router paths: `/`, `/eoq`, `/lp`, `/transport`, `/assignment`, `/pert-cpm`
- `ResultsTabs` shows panes only if data non-null
- Display raw tables; chart: simple SVG polyline for `GraphXY` only
- Export button calls `export.xlsx` and downloads blob

---

## 14. Global validation commands

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8000

cd ../web && npm install && npm run dev
# root:
docker compose up --build
```

CI-less MVP: agent must leave `pytest -q` green before handoff.

---

## 15. Risks → concrete mitigations

| Risk | Mitigation in code/tests |
|---|---|
| Wrong simplex | Always compare to `linprog` on optimal fixtures |
| Ambiguous transport shipments | Assert cost + row/col sums, not unique matrix |
| Float noise | `atol` helpers in `tests/conftest.py`: `assert_allclose` |
| Scope creep | Refuse Phase F files until E signed off |
| Contract drift | `test_module_result.py` locks required fields |

---

## 16. Acceptance — Full MVP (A–E)

- [ ] Tree §1 exists; health 200
- [ ] `ModuleResult` matches §3.2
- [ ] EOQ fixture green + export xlsx
- [ ] LP: optimal/infeasible/unbounded + iterations + sensitivity + linprog check
- [ ] ILP: integer fixture green
- [ ] Transport MODI cost correct + iterations non-empty
- [ ] Assignment matches `linear_sum_assignment`
- [ ] PERT/CPM critical path + duration fixture
- [ ] Stub pages for all MVP modules
- [ ] README cold start <15 min
- [ ] User confirms ≥3 classmate validations (Phase E)

---

## 17. Implementation order for the executing agent

```
CONFIRM from user
→ Phase A (full)
→ Phase B (full)   # longest
→ Phase C
→ Phase D
→ Phase E (docs + examples; wait for human feedback)
STOP unless asked for F/G/H
```

---

*Technical master plan for agent execution. Do not write code until user confirms this revision with yes/proceed.*
