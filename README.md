# LaraOps

App web local (sin VM) para resolver problemas de **Investigación de Operaciones**.
Nombre de producto: **LaraOps**. Prioridad: backend y contratos → tests → UI.

Documentos de producto/técnicos:
- PRD: `.claude/prds/plataforma-or.prd.md`
- Master plan: `.claude/plans/plataforma-or-completa.plan.md`
- Phase A: `.claude/plans/fundamento-producto-resolutor.plan.md`
- Paridad WinQSB/QM (post-MVP): `.claude/plans/paridad-winqsb-qm.plan.md`

## Pre-requisitos

Para poder correr el proyecto localmente, necesitas tener pre-instalado:

- **Node.js** (v18 o superior) y **npm**: Para manejar las dependencias y correr el entorno, además del frontend (React/Vite).
- **Python 3** (v3.9 o superior) y **pip**: Para el backend (FastAPI). El script de inicio creará automáticamente un entorno virtual (`.venv`) usando `python3` e instalará los requerimientos.

## Arranque (Recomendado)

Para levantar toda la aplicación (API + Web) de forma simultánea, solo tienes que ejecutar desde la raíz del proyecto:

```bash
npm install
npm run dev
```

Esto instalará las dependencias necesarias en la raíz y usará `concurrently` para lanzar el Worker (Wrangler en :8788) y el frontend Vite.

- **Web (Interfaz Gráfica)**: http://127.0.0.1:5173
- **API (Worker)**: http://127.0.0.1:8788/health

La API Python sigue disponible con `npm run dev:python` (tests y referencia). Producción usa el Worker.

### API

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8000
```

Health: http://127.0.0.1:8000/health  
Docs: http://127.0.0.1:8000/docs (título: **LaraOps API**)

Probar EOQ:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/eoq/solve \
  -H 'content-type: application/json' \
  -d '{"D":1000,"S":10,"H":0.5}'
```

### Web

```bash
cd web
npm install
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

Abre http://127.0.0.1:5173 — marca **LaraOps** en el rail.

### Docker Compose (opcional)

```bash
docker compose up --build
```

- API: http://localhost:8000
- Web: http://localhost:5173

## Datos y ejemplos

No hay base de datos. Los “datos” son:

1. **Fixtures de test** (`api/tests/fixtures/textbook/*.json`) — números esperados para pytest.
2. **Ejemplos listos** (`examples/*.json`) — payloads para curl o pegar en el stub.
3. **Defaults del UI** — JSON precargado en cada página del frontend.

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/eoq/solve \
  -H 'content-type: application/json' \
  -d @examples/eoq_01.json
```

## Módulos disponibles

MVP: EOQ, LP, ILP, transporte, asignación, PERT/CPM  
Phase F: colas, inventarios, pronósticos, decisiones, juegos  
Phase G: redes, Markov, calidad, goal programming, DP, MRP  
Phase J: breakeven, statistics, ASA, decision tree/Bayes, PERT crashing

Docs OpenAPI: http://127.0.0.1:8000/docs

## Primeros 15 minutos

1. Arranca la API (`uvicorn` arriba).
2. Corre `pytest -q` y confirma verde.
3. Arranca el web (`npm run dev`) y abre http://127.0.0.1:5173.
4. En la UI (hoja editable, sin JSON):
   - **EOQ** → Resolver (Q*=200) → Exportar PDF
   - **LP** → Resolver (Z≈180) → pestaña Iteraciones
   - **Transporte** → costo 80
   - **PERT/CPM** → duración 12, ruta A-B-D
5. Opcional curl / modo experto:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/solve \
  -H 'content-type: application/json' \
  -d @examples/lp_01.json

curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/export.pdf \
  -H 'content-type: application/json' \
  -d @examples/lp_01.json -o /tmp/lp.pdf
```

Validación con compañeros: ver `docs/validation-session.md` (no cerrar hito 5 sin ≥3 respuestas humanas).

## Despliegue (Cloudflare Pages + Workers, plan Free)

Frontend estático y API (Functions) en el mismo origen. Dominio: `https://laraops.larasolutions.dev`.

Guía: [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md). Config: `wrangler.toml`.

Fallback opcional en Render: [`docs/deploy-render.md`](docs/deploy-render.md) (`render.yaml`).
