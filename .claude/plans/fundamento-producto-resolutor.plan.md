# Plan técnico Phase A: Fundamento + EOQ

**Status**: READY FOR IMPLEMENTATION after user `yes`/`proceed`  
**Source PRD**: `.claude/prds/plataforma-or.prd.md`  
**Master plan (full app)**: `.claude/plans/plataforma-or-completa.plan.md`  
**Selected Milestone**: 1 — Fundamento de producto resolutor  
**Complexity**: Medium  
**Authority**: Schemas, tree, deps, and HTTP rules in the **master plan §§1–3 are canonical**. This file is the executable checklist for Phase A only.

---

## 0. Agent brief

You are implementing **only Phase A**. Do not create `lp/`, `transport/`, or `pert_cpm/` yet.

**Goal**: Greenfield monorepo where `POST /api/v1/modules/eoq/solve` returns a frozen `ModuleResult`, tests pass, Excel export works, and a React stub can call the API on macOS without a VM.

**Workflow**: TDD vertical slices (§5). One test → code → green → next.

---

## 1. Patterns (greenfield — establish these)

| Category | Pattern to create |
|---|---|
| Naming | `api/app/modules/<name>/solver.py::solve(req) -> ModuleResult` |
| Errors | Pydantic 422 for bad input; no bare `except:` |
| Logging | `logging.getLogger(__name__)`; log module + status at INFO on solve |
| Data | No DB |
| Tests | `tests/modules/test_*.py` call `solve()` directly; `tests/api/` use `TestClient` |

---

## 2. Files to CREATE (Phase A only)

| Path | Responsibility |
|---|---|
| `.gitignore` | `.venv/`, `node_modules/`, `__pycache__/`, `.env`, `dist/`, `.pytest_cache/` |
| `README.md` | Cold start Mac + test + docker |
| `docker-compose.yml` | `api:8000`, `web:5173` |
| `api/pyproject.toml` | deps per master §2.1 (Phase A needs fastapi, uvicorn, pydantic, numpy, openpyxl, pytest, httpx; scipy/pulp/networkx may be listed early but unused) |
| `api/app/main.py` | FastAPI app, CORS, include routers |
| `api/app/schemas/common.py` | `SolveStatus`, `ErrorBody` |
| `api/app/schemas/result.py` | Full `ModuleResult` stack (master §3.2) — **entire contract now** |
| `api/app/modules/eoq/models.py` | `EOQRequest` |
| `api/app/modules/eoq/solver.py` | pure `solve` |
| `api/app/routers/health.py` | `GET /health` |
| `api/app/routers/eoq.py` | `POST .../solve`, `POST .../export.xlsx` |
| `api/app/services/export_excel.py` | `module_result_to_xlsx` |
| `api/tests/conftest.py` | `client` fixture (`TestClient`), `assert_allclose` helper |
| `api/tests/schemas/test_module_result.py` | schema roundtrip |
| `api/tests/modules/test_eoq.py` | fixtures eoq_01/02 + invalid |
| `api/tests/api/test_health.py` | 200 |
| `api/tests/api/test_eoq_endpoint.py` | solve + export |
| `api/tests/fixtures/textbook/eoq_01.json` | see §4 |
| `api/tests/fixtures/textbook/eoq_02.json` | see §4 |
| `web/*` | Vite React TS stub — `EoqPage` only required |

---

## 3. Exact API

### 3.1 Health

```
GET /health → 200 {"status":"ok"}
```

### 3.2 Solve

```
POST /api/v1/modules/eoq/solve
Content-Type: application/json

{"D": 1000, "S": 10, "H": 0.5, "C": 0, "graph_points": 40}
```

Response 200 body MUST validate as `ModuleResult` with:

| Field | Value |
|---|---|
| `module` | `"eoq"` |
| `status` | `"ok"` |
| `solution.variables.Q` | `200` (±1e-6) |
| `solution.metrics.Q_star` | `200` |
| `solution.metrics.TC` | `100` |
| `solution.metrics.orders_per_year` | `5` |
| `solution.metrics.TC_ordering` | `50` |
| `solution.metrics.TC_holding` | `50` |
| `graph.type` | `"xy"` |
| `graph.series` | includes names `TC`, `ordering`, `holding` |
| `iterations` | `null` |
| `sensitivity` | `null` |
| `warnings` | `[]` (unless you add informative ones) |

### 3.3 Export

```
POST /api/v1/modules/eoq/export.xlsx
Content-Type: application/json
(same body as solve)
→ 200
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Bytes must open with `openpyxl.load_workbook(BytesIO(...))` and contain sheet `Solution`.

### 3.4 CORS

Allow origins: `http://localhost:5173`, `http://127.0.0.1:5173`.

---

## 4. Fixtures (lock these numbers)

### `eoq_01.json`

```json
{
  "request": {"D": 1000, "S": 10, "H": 0.5, "C": 0},
  "expect": {
    "status": "ok",
    "Q_star": 200.0,
    "TC": 100.0,
    "orders_per_year": 5.0,
    "TC_ordering": 50.0,
    "TC_holding": 50.0
  }
}
```

### `eoq_02.json`

```json
{
  "request": {"D": 2400, "S": 100, "H": 3, "C": 0},
  "expect": {
    "status": "ok",
    "Q_star": 400.0,
    "TC": 1200.0,
    "orders_per_year": 6.0
  }
}
```

### Invalid cases (endpoint)

| Body | Expect |
|---|---|
| `{"D":0,"S":10,"H":0.5}` | 422 |
| `{"D":1000,"S":-1,"H":0.5}` | 422 |
| missing `H` | 422 |

---

## 5. Tasks — TDD order (execute in sequence)

### Task A1 — Health scaffold
- **RED**: `tests/api/test_health.py` expects 200 `{"status":"ok"}`
- **GREEN**: minimal FastAPI `main` + `routers/health.py`
- **Validate**: `pytest tests/api/test_health.py -q`

### Task A2 — Freeze `ModuleResult`
- **RED**: construct `ModuleResult` with sample EOQ payload; `model_validate` roundtrip JSON
- **GREEN**: implement `schemas/common.py` + `schemas/result.py` **exactly** as master §3.2
- **Validate**: `pytest tests/schemas/test_module_result.py -q`

### Task A3 — EOQ solver
- **RED**: load `eoq_01.json` / `eoq_02.json`; call `solve(EOQRequest(**req))`; assert metrics
- **GREEN**: `modules/eoq/solver.py` formulas from master §4.1; build `GraphXY` over Q grid
- **Formulas**:
  - `Q = sqrt(2*D*S/H)`
  - `N = D/Q`
  - `TC_ord = N*S`
  - `TC_hold = (Q/2)*H`
  - `TC = TC_ord + TC_hold + C*D`
- **Validate**: `pytest tests/modules/test_eoq.py -q`

### Task A4 — Router + Excel
- **RED**: TestClient solve returns Q=200; export returns xlsx content-type; workbook has `Solution`
- **GREEN**: `routers/eoq.py` + `services/export_excel.py`
- **Validate**: `pytest tests/api/test_eoq_endpoint.py -q`

### Task A5 — Web stub
- **Action**: Vite React TS; page with inputs D,S,H,C; button calls solve; `ResultsTabs` shows Solution metrics + simple SVG for `graph.series`; Export button hits export.xlsx
- **Env**: `VITE_API_URL=http://127.0.0.1:8000`
- **Validate**: manual — browser shows Q=200 for eoq_01

### Task A6 — README + compose
- **Action**: document venv, pytest, uvicorn, npm, docker compose; link PRD + master plan
- **Validate**: commands in README copy-paste clean

---

## 6. `main.py` wiring (reference)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, eoq

app = FastAPI(title="LaraOps API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(eoq.router, prefix="/api/v1/modules/eoq", tags=["eoq"])
```

---

## 7. Gate A (must all pass)

```bash
cd api
pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --port 8000 &
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/eoq/solve \
  -H 'content-type: application/json' \
  -d '{"D":1000,"S":10,"H":0.5}'
# expect JSON status=ok, metrics.Q_star≈200
```

### Acceptance checklist
- [ ] `pytest -q` exit 0
- [ ] Health + EOQ solve + export tests green
- [ ] `ModuleResult` includes optional `iterations`/`sensitivity` fields (null for EOQ)
- [ ] Stub web solves EOQ without VM
- [ ] README cold-start documented
- [ ] No LP/transport/PERT code committed
- [ ] PRD milestone 1 → `complete` when user accepts

---

## 8. Explicit non-goals (Phase A)

- Simplex, PuLP usage, transport, PERT
- Auth, PDF, Tailwind design system, AG Grid
- Changing field names in `ModuleResult`

## 9. Handoff to Phase B

When Gate A is green, next agent opens master plan **§5 Phase B** and implements `modules/lp/` with pedagogical simplex + fixtures `lp_01`.

---

*Phase A technical slice. No code until user confirms with yes/proceed.*
