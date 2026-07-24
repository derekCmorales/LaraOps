# Sesión de validación con compañeros (Phase E / Plan I.4) — LaraOps

Objetivo: confirmar que **LaraOps** reemplaza la necesidad de VM para al menos un flujo de tarea, usando la **hoja editable** (no JSON) y export PDF/Excel.

## Guion de 15 minutos (para el anfitrión)

### 0. Arranque (2 min)

```bash
# Terminal 1
cd api && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2
cd web && npm run dev
```

Abrir: http://127.0.0.1:5173

### 1. Smoke rápido (1 min)

- Health: http://127.0.0.1:8000/health → `{"status":"ok"}`
- Docs: http://127.0.0.1:8000/docs

### 2. Tres ejercicios listos (≈3 min c/u)

| # | Módulo en UI | Qué hacer en la hoja | Qué verificar |
|---|---|---|---|
| 1 | LP | Abrir `/lp` — ya viene el ejemplo de mezcla; editar una celda si quieren | Z≈180, x1=20, x2=60 + pestaña Iteraciones; **Exportar PDF** |
| 2 | Transporte | Abrir `/transport` — matriz costos + Supply/Demand | costo óptimo 80 + matriz de envíos |
| 3 | PERT/CPM | Abrir `/pert-cpm` — actividades en filas | duración 12, ruta A-B-D |

**No pedirles que editen JSON.** El “Modo experto (JSON)” es opcional. Los mismos números están en `examples/lp_01.json`, `transport_01.json`, `pert_01.json`.

Alternativa curl (anfitrión):

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/solve \
  -H 'content-type: application/json' -d @examples/lp_01.json | python3 -m json.tool | head

curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/export.pdf \
  -H 'content-type: application/json' -d @examples/lp_01.json -o /tmp/lp.pdf
```

### 3. Preguntas (marcar Y/N)

| # | Pregunta | C1 | C2 | C3 |
|---|---|---|---|---|
| 1 | ¿Necesitaste una VM? | | | |
| 2 | ¿Pudiste resolver un problema tipo tarea? | | | |
| 3 | ¿Prefieres esto vs WinQSB/QM para esta tarea? | | | |

### 4. Notas libres

- Compañero 1:
- Compañero 2:
- Compañero 3:

## Criterio de cierre

Milestone 5 del PRD → `complete` solo cuando el builder confirme ≥3 respuestas con:

- Pregunta 1 = **N**
- Pregunta 2 = **Y**
- Pregunta 3 = **Y**

**Estado actual**: grilla + PDF + examples listos — **pendiente confirmación humana**.

Cuando tengas las 3 filas llenas, escribe en el chat: `Phase E ok` y se marca el PRD.
