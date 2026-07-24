# Plan: Paridad WinQSB + QM (post-MVP → app usable por compañeros)

**Source PRD**: `.claude/prds/plataforma-or.prd.md`  
**Selected Milestone**: 9 — Paridad académica WinQSB/QM  
**Complexity**: Large  
**Context docs**: `investigacion_WinQSB_QM.md`, `planning_proyecto_OR_app.md`, master `.claude/plans/plataforma-or-completa.plan.md`  
**Status**: Phase I+J IMPLEMENTED (code) — Gate I humano pendiente; Phases K–M waiting

---

## Summary

LaraOps ya cubre el **núcleo académico fuerte** (~17 módulos: LP/ILP, transporte, asignación, PERT/CPM, colas, inventarios, pronósticos, decisiones/juegos, redes, Markov, calidad, GP, DP, MRP, EOQ). Para **igualar el mapa de `investigacion_WinQSB_QM.md` (~95% WinQSB+QM)** faltan ~8–12 módulos nuevos, profundizar 6–8 existentes, y cerrar UX de clase (editor tipo hoja, PDF, redes/Gantt interactivos) más la **validación con compañeros** (PRD hito 5).

Este plan convierte el MVP en una app que **simula ambas herramientas** en capacidad académica y reportes, priorizando primero lo que desbloquea uso en clase (inserción de datos + módulos QM de alto valor).

---

## Requirements Restatement

1. **Paridad de catálogo** (~20–22 módulos útiles): cubrir uniones WinQSB + QM (+ POM-QM esencial) sin clonar UI de los 90s.
2. **Profundidad académica**: mismos outputs que piden profesores (simplex/iteraciones, ranging, crashing PERT, Winters, árboles de decisión, B&B visible, etc.).
3. **Inserción de datos usable por compañeros**: reemplazar JSON crudo por grilla tipo hoja (AG Grid / Handsontable) en módulos de matriz/tabla.
4. **Reportes de clase**: PDF además de Excel; pestañas Solution / Iterations / Ranging / Graph consistentes.
5. **Adopción**: sesión con ≥3 compañeros sin VM (hito 5 PRD) en paralelo o justo después del bloque UX mínimo.

**Fuera de alcance (explícito):**
- Auth multiusuario / LMS / cloud como requisito.
- Paridad pixel-perfect con WinQSB/QM.
- NLP/QP “industrial” (CVXPY/scipy basta para ejercicios de libro).

---

## Estado actual (baseline)

| Área | Hoy | Gap vs investigación |
|---|---|---|
| Módulos API | 17 routers en `api/app/main.py` | Faltan QP, NLP, QSS, JOB, AP, FLL, ASA, TSP, Breakeven, Statistics, Simulation (+ POM opcional) |
| Contrato | `ModuleResult` estable (`schemas/result.py`) | Extender `graph` types si hace falta (decision tree); no renombrar campos |
| UI entrada | JSON textarea (`JsonModulePage`) + forms EOQ/LP/… | Sin AG Grid / Handsontable |
| Export | Solo Excel (`export_excel.py`) | Sin PDF |
| PERT | CPM + PERT básico | Sin crashing / costos / simulación proyecto |
| Forecasting | naive / MA / exponential | Sin Winters, descomposición, regresión múltiple |
| Decision | payoff + criterios | Sin árboles / Bayes completo |
| Game | mixtas 2×2 | Sin n×m vía LP |
| Networks | shortest / MST / max flow | Sin TSP |
| ILP / GP | PuLP CBC; GP weighted | Sin log B&B; sin preemptive / IGP |
| Adopción | Phase E pendiente | Sin `docs/validation-session.md` formal |

---

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Naming | `api/app/modules/lp/solver.py:27` | `solve(req) -> ModuleResult`; carpeta `modules/<name>/{models,solver}.py` |
| HTTP | `api/app/routers/eoq.py:16-28` | `POST /solve` + `POST /export.xlsx`; registrar en `main.py` |
| Errors | routers + Pydantic | 422 en input inválido; ciclos/reglas de dominio → 400 con mensaje claro |
| Logging | `lp/solver.py:15` | `logging.getLogger(__name__)`; INFO al resolver |
| Result contract | `api/app/schemas/result.py:71-79` | `ModuleResult` con `solution` / `iterations` / `sensitivity` / `graph` / `tables` / `warnings` |
| Tests | `api/tests/modules/test_lp.py` | fixtures JSON en `tests/fixtures/textbook/`; `assert_allclose`; call `solve()` directo |
| Frontend stub | `web/src/components/JsonModulePage.tsx` | página módulo + `ResultsTabs` + client pair en `api/client.ts` |
| Web pages F/G | `web/src/pages/PhaseFGPages.tsx` | thin wrappers sobre componente compartido |

Si un módulo nuevo no tiene patrón UI dedicado, **primero** solver+tests+router; luego page con grilla o JSON stub (mismo orden del master plan: backend > tests > UI).

---

## Strategy (orden de valor)

```mermaid
flowchart LR
  I[I UX datos + PDF + adopción] --> J[J Módulos QM alto valor]
  J --> K[K Profundizar existentes]
  K --> L[L WinQSB / POM]
  L --> M[M UX interactiva redes/Gantt]
```

**Por qué I primero:** sin grilla y con JSON, los compañeros no adoptan aunque el solver sea correcto.  
**Por qué J antes que L:** Breakeven/Statistics/ASA/árboles/crashing aparecen más en tareas QM/Render que QP/NLP/job shop.

---

## Files to Change (por fase — resumen)

| File / área | Action | Why |
|---|---|---|
| `.claude/prds/plataforma-or.prd.md` | UPDATE | Hito 9 paridad + status |
| `web/src/components/SpreadsheetEditor.tsx` | CREATE | Entrada tipo hoja compartida |
| `web/src/components/JsonModulePage.tsx` + páginas núcleo | UPDATE | Migrar matrices a grilla |
| `api/app/services/export_pdf.py` | CREATE | Reporte PDF académico |
| `api/app/modules/breakeven/` … `statistics/` … `acceptance_sampling/` … | CREATE | Módulos QM faltantes |
| `api/app/modules/pert_cpm/` | UPDATE | Crashing + costos |
| `api/app/modules/decision_analysis/` | UPDATE | Árboles + Bayes |
| `api/app/modules/forecasting/` `inventory/` `goal_programming/` `lp/` `game_theory/` `networks/` `dynamic_programming/` `mrp/` `queues/` `quality_control/` `ilp/` | UPDATE | Profundidad WinQSB/QM |
| `api/app/modules/{qp,nlp,queue_simulation,job_scheduling,aggregate_planning,facility_location,simulation}/` | CREATE | Catálogo restante |
| `web` react-flow / Gantt | UPDATE | Paridad visual Phase M |
| `docs/validation-session.md` + `examples/` | CREATE | Hito 5 adopción |
| `api/pyproject.toml` / `web/package.json` | UPDATE | deps: `cvxpy`?, `simpy`, `reportlab`/`weasyprint`, AG Grid, `@xyflow/react` |

---

## Tasks

### Phase I — Usable por compañeros (UX entrada + PDF + adopción)

**Goal:** un compañero abre la app, pega/edita una tabla, resuelve LP/transporte/PERT y exporta PDF/Excel sin tocar JSON.

#### Task I.1 — SpreadsheetEditor compartido
- **Action**: Componente React (AG Grid Community preferido; Handsontable si AG Grid complica matrices raras) que edite `string[][]` / matrices numéricas; adapters por módulo (LP constraints, transport costs, assignment, PERT activities).
- **Mirror**: patrón de páginas actuales + `ResultsTabs`.
- **Validate**: smoke manual en LP + Transport + Assignment; unit test de adapter TS si hay util puro.

#### Task I.2 — Migrar entrada de módulos núcleo
- **Action**: Sustituir JSON-first en `LpPage`, `TransportPage`, `AssignmentPage`, `PertCpmPage`, `EoqPage`; dejar JSON avanzado como toggle “Modo experto”.
- **Validate**: flujo manual eoq_01 / lp_01 / transport_01 / pert_01.

#### Task I.3 — Export PDF
- **Action**: `services/export_pdf.py` + `POST .../export.pdf` por módulo (o endpoint genérico que reciba `ModuleResult`); secciones Solution / tables / warnings.
- **Validate**: pytest abre PDF bytes (pypdf) y encuentra título de módulo.

#### Task I.4 — Phase E adopción (PRD #5)
- **Action**: `examples/` con 3 payloads listos; `docs/validation-session.md`; README “Primeros 15 minutos”.
- **Validate**: checklist humano ≥3 compañeros; marcar hito 5 `complete` solo con confirmación del usuario.

**Gate I:** compañeros pueden resolver 1 ejercicio de tarea sin editar JSON ni VM.

---

### Phase J — Módulos QM / curso de alto valor (faltan del todo)

| Módulo | Path | Métodos / lib | Acceptance mínima |
|---|---|---|---|
| **Breakeven / CVP** | `modules/breakeven/` | fórmulas propias | BEP unidades/$, contribución, gráfico TC/TR |
| **Statistics** | `modules/statistics/` | `scipy.stats`, `numpy` | descriptiva, regresión simple, t/z básico |
| **ASA** | `modules/acceptance_sampling/` | `scipy.stats` binomial/hipergeom | OC curve, AOQ, plan atributos |
| **Decision trees + Bayes** | extender `decision_analysis/` | árbol propio + Bayes | EVSI/EVPI, nodos decisión/azar |
| **PERT crashing** | extender `pert_cpm/` | lógica propia | crash cost/time, schedule crashed |

#### Task J.1–J.5 — TDD por módulo
- **Action**: fixture libro → `solve` → router → page (grilla o form) → Excel/PDF.
- **Mirror**: `eoq` / `quality_control` (fórmulas + graph).
- **Validate**: `pytest tests/modules/test_<mod>.py -q` + endpoint.

**Gate J:** 5 capacidades nuevas verdes; OpenAPI las lista.

---

### Phase K — Profundizar módulos existentes (~nivel WinQSB/QM)

Orden sugerido (impacto curso):

| # | Módulo | Trabajo |
|---|---|---|
| K1 | **Forecasting** | Holt-Winters, descomposición clásica, regresión múltiple; tabla MAD/MSE/MAPE comparativa |
| K2 | **Inventory** | periodo único, lote dinámico (Wagner-Whitin básico), políticas (s,Q)/(s,S) |
| K3 | **LP graph / ranging** | polígono factible más rico; completar ranging cuando sea parcial |
| K4 | **GP** | preemptive por prioridades; IGP entero (PuLP) |
| K5 | **Game** | mixtas n×m vía LP (PuLP) |
| K6 | **Queues** | más variantes libro + aproximación; hook opcional a simulación (Phase L) |
| K7 | **Quality** | cartas faltantes; enlazar ASA (Phase J) |
| K8 | **DP** | planeación producción/inventario |
| K9 | **MRP** | lot sizing, calendarios, multi-nivel edge cases |
| K10 | **ILP** | log B&B propio o nodos CBC si se puede exponer; al menos árbol simplificado pedagógico en problemas pequeños |
| K11 | **Transport/Assignment UI** | pasos “de pizarra” más legibles en `iterations` + grilla |

- **Validate**: fixtures adicionales por módulo; no romper suites existentes (`pytest -q` full).

**Gate K:** warnings “not implemented” eliminados en los caminos de curso típicos listados arriba.

---

### Phase L — WinQSB puro / POM-QM (catálogo restante)

| Módulo | Sigla | Stack |
|---|---|---|
| Quadratic Programming | QP/IQP | `cvxpy` o `scipy.optimize` |
| Nonlinear Programming | NLP | `scipy.optimize.minimize` + penalización |
| Queue Simulation | QSS | `simpy` eventos discretos |
| Job Scheduling | JOB | SPT, EDD, FCFS, aleatorio |
| Aggregate Planning | AP | chase / level / mixed cost models |
| Facility Location & Layout | FLL | centro de gravedad + line balancing |
| TSP | en `networks` | heurística + PuLP pequeño / networkx |
| Simulation (QM) | Monte Carlo genérico | numpy RNG + histograma |
| POM extra (opcional) | Learning curves, Reliability | fórmulas propias |

Cada uno: `models.py` + `solver.py` + router + tests + page stub/grilla.

**Gate L:** checklist de `investigacion_WinQSB_QM.md` §2+§3 marcado ≥95% capacidad (no UI clone).

---

### Phase M — UX paridad visual QM

| Item | Acción |
|---|---|
| Redes / PERT | `@xyflow/react` (react-flow) con ruta crítica |
| Gantt | interactivo (zoom/pan) desde `GraphGantt` |
| ResultsTabs | unificar Solution / Iterations / Ranging / Graph / Export en todos los módulos |
| Home catálogo | selector tipo QM (un solo hub) agrupado por familia |

**Gate M:** PERT + Networks usables en proyección de clase sin JSON.

---

## Dependency map

```
I.1 Spreadsheet ──► I.2 páginas núcleo ──► I.4 adopción
I.3 PDF ─────────────────────────────────► I.4 / J+
J.x módulos nuevos ──► K profundización (puede solapar tras J1–J2)
K11 UI pizarra ──► M interactivo
L puede empezar tras J Gate si hay demanda de job shop / QP
```

**Deps nuevas (aprobar al implementar):**
- API: `reportlab` o `fpdf2` (PDF), `simpy` (QSS), `cvxpy` (QP, opcional), `pypdf` (tests PDF)
- Web: `ag-grid-react` + `ag-grid-community`, `@xyflow/react`

---

## Validation

```bash
# Backend full
cd api && pip install -e ".[dev]" && pytest -q

# OpenAPI smoke
uvicorn app.main:app --port 8000
# /docs debe listar módulos nuevos

# Frontend
cd web && npm run build && npm run dev

# Adopción
# Seguir docs/validation-session.md con ≥3 compañeros
```

Criterios globales:
- [ ] Correctitud ≥95% fixtures libro en módulos tocados
- [ ] Cada módulo nuevo expone Solution + (Iterations|Graph|tables según aplique)
- [ ] Entrada principal **no** es JSON para LP/Transporte/Asignación/PERT/EOQ
- [ ] PDF + Excel en módulos núcleo como mínimo
- [ ] Checklist investigación §2+§3 ≥95%
- [ ] Hito 5 PRD complete tras sesión real

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Alcance ~20 módulos diluye adopción | High | Congelar Gate I antes de L; no empezar QP/NLP sin Gate J |
| AG Grid / PDF consumen sprint | Medium | Spreadsheet solo en 4–5 módulos núcleo primero; PDF genérico desde `ModuleResult` |
| Crashing PERT / Winters / B&B mal implementados erosionan confianza | Medium | Fixtures libro obligatorios; warning explícito si aproximación |
| `simpy` / `cvxpy` complican install en Mac compañeros | Medium | Extras opcionales en `pyproject` `[qss]` / `[qp]`; módulos degradan con mensaje claro |
| Renombrar `ModuleResult` rompe web | Low | Solo extender; never rename fields sin nota de migración |
| Sesión de adopción descubre que el dolor era otro (solo gráficos) | Medium | Hito 5 temprano (tras I); ajustar K/M según feedback |

---

## Estimación de complejidad

| Fase | Esfuerzo relativo | Complejidad |
|---|---|---|
| I UX + PDF + adopción | 3–5 días | Medium |
| J 5 capacidades nuevas | 5–8 días | Medium–Large |
| K profundización | 8–12 días | Large |
| L WinQSB/POM | 8–14 días | Large |
| M UX interactiva | 3–5 días | Medium |
| **Total** | **~5–8 semanas** part-time curso | **Large** |

---

## Acceptance (milestone 9)

- [ ] Phase I gate: compañeros usan grilla + PDF/Excel sin VM
- [ ] Phase J gate: Breakeven, Statistics, ASA, decision trees/Bayes, PERT crashing
- [ ] Phase K gate: Forecasting/Inventory/GP/Game/LP/DP/MRP/ILP al nivel doc
- [ ] Phase L gate: QP/NLP/QSS/JOB/AP/FLL/TSP/Simulation (POM extra opcional)
- [ ] Phase M gate: redes/Gantt interactivos + hub tipo QM
- [ ] `pytest -q` verde; patterns mirrored
- [ ] PRD hitos 5 y 9 → `complete` cuando el usuario confirme

---

## Explicit non-goals (este plan)

- Reescribir solvers LP/transporte que ya pasan tests (solo extender).
- Auth, multi-tenant, deploy cloud obligatorio.
- Clonar look & feel Win95 de WinQSB.
- Implementar L y M antes de Gate I/J sin acuerdo explícito “modify: …”.

---

## Handoff de implementación

1. Confirmar este plan (`yes` / `proceed` / Approve en Plan Canvas).
2. Ejecutar **solo Phase I** hasta Gate I; parar y reportar.
3. Luego J → K; L y M bajo demanda o tras feedback de adopción.
4. Por slice: TDD (`test` → `solve` → router → UI).
5. Tras código: code-review del diff de la fase.

---

*No code until user confirms. Master histórico A–H: `plataforma-or-completa.plan.md`.*
