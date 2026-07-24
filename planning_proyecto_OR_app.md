# Project Brief: Plataforma de Investigación de Operaciones (reemplazo de WinQSB + QM for Windows)

> Este documento es el brief de arranque para un agente de desarrollo (Claude Code). El objetivo es que el agente tome esto y genere su propio plan de ejecución detallado (arquitectura de carpetas, tickets, orden de construcción), no que ejecute ciegamente — se espera que cuestione, valide supuestos y proponga ajustes de stack si tiene mejor criterio.

---

## 1. Objetivo del proyecto

Construir una aplicación web que reemplace y mejore las funciones de **WinQSB** y **QM for Windows**, dos programas clásicos (años 90-2000) de Investigación de Operaciones / Ciencias Administrativas usados en cursos universitarios. La app debe:

- Resolver los mismos tipos de problemas (LP, transporte, PERT/CPM, colas, inventarios, pronósticos, etc.).
- Generar los mismos reportes académicos que dichos programas (tablero simplex paso a paso, análisis de sensibilidad, diagramas de red, cartas de control) — no solo la respuesta final.
- Tener mejor UX que las herramientas originales (visualización moderna, exportable a PDF/Excel).
- Correr nativamente en macOS (Apple Silicon) sin necesidad de VM.

## 2. Usuario objetivo y contexto de uso

- Uso principal: resolver tareas y proyectos de cursos de Investigación de Operaciones / Métodos Cuantitativos / Administración de Operaciones.
- El usuario (yo) es quien construye Y usa la herramienta — no hace falta pensar en multiusuario, roles ni autenticación compleja en el MVP. Sí conviene dejar la puerta abierta por si más adelante se comparte con compañeros de clase.
- Debe poder usarse para **verificar tareas hechas a mano** (comparar contra el tablero simplex manual) y para **resolver problemas completos rápido**.

## 3. Alcance por fases (no construir todo de una vez)

### Fase 0 — Fundacional (antes de cualquier módulo)
- Definir el "contrato" de datos y de reporte que todos los módulos van a compartir (ver sección 6).
- Armar el esqueleto de proyecto (backend + frontend + testing) con UN módulo de prueba end-to-end.

### Fase 1 — Núcleo (los módulos que más se usan en cursos)
1. **Programación Lineal (LP)** — simplex, método gráfico (2 variables), sensibilidad/ranging, tablero paso a paso.
2. **Programación Entera (ILP/MIP)** — branch and bound.
3. **Transporte y Asignación** — esquina noroeste, Vogel, MODI, método húngaro.
4. **PERT/CPM** — ruta crítica, diagrama de red, Gantt, análisis probabilístico (PERT).

### Fase 2 — Alta demanda académica
5. **Teoría de colas (Waiting Lines/QA)** — M/M/1, M/M/s, poblaciones finitas.
6. **Inventarios (EOQ y variantes)**.
7. **Pronósticos (Forecasting)** — promedios móviles, suavización exponencial, regresión, comparación de errores.
8. **Análisis de decisiones y teoría de juegos**.

### Fase 3 — Complementarios
9. **Redes** (ruta más corta, árbol de expansión mínima, flujo máximo) — separado de transporte.
10. **Cadenas de Markov**.
11. **Control de calidad (cartas X̄-R, p, c, u)** + muestreo de aceptación.
12. **Programación por metas (Goal Programming)**.
13. **Programación dinámica** (mochila, planeación de inventario).
14. **MRP**.

### Fase 4 (opcional, solo si se necesita)
15. NLP/QP, Job shop scheduling, Aggregate Planning, Facility Location.

**Instrucción para el agente:** confirmar conmigo el orden antes de empezar cada fase; no asumir que hay que construir los 19 módulos para que la app sea útil — con la Fase 1 completa ya es un reemplazo funcional de lo más usado.

## 4. Stack técnico propuesto (a validar/ajustar por el agente)

- **Backend:** Python 3.11+, **FastAPI** (async, tipado con Pydantic, docs automáticas en `/docs`).
- **Solvers/librerías matemáticas:**
  - `scipy.optimize.linprog` y/o `PuLP` para LP/ILP/MIP (decidir cuál da mejor acceso a tablero simplex e info de sensibilidad — puede que haga falta implementar el simplex "a mano" para exponer las iteraciones, ya que scipy no expone tableros intermedios).
  - `networkx` para redes, rutas, árboles, flujo máximo.
  - `scipy.optimize.linear_sum_assignment` para asignación (o formulación LP si se quiere mostrar iteraciones tipo húngaro paso a paso).
  - `numpy` para Markov, cálculos matriciales.
  - `statsmodels` para pronósticos avanzados (Holt-Winters).
  - `simpy` si se implementa simulación de colas por eventos discretos (opcional, fórmulas cerradas cubren el 90% de los casos de curso).
  - Fórmulas propias (sin librería) para: colas M/M/*, EOQ, control de calidad, PERT/CPM.
- **Frontend:** React + TypeScript, Vite como bundler.
  - **Tailwind CSS** para estilos.
  - **Plotly.js** o **Recharts** para gráficos (región factible, cartas de control, series de tiempo).
  - **react-flow** o **vis-network** para diagramas de red / PERT-CPM interactivos.
  - Tablas editables tipo hoja de cálculo: **AG Grid** (community) o **Handsontable** para la entrada de datos (simula el "editor de datos" de WinQSB/QM).
- **Exportación:** generación de PDF (reporte de resultados) y export a Excel (openpyxl en backend, o xlsx.js en frontend).
- **Testing:** `pytest` en backend con casos de validación contra ejemplos conocidos de libros de texto (Taha, Hillier & Lieberman, Render/Stair/Hanna).
- **Despliegue local:** todo corre en Docker Compose (backend + frontend) para portabilidad; no requiere nube para el MVP.

**Pregunta abierta para el agente:** ¿conviene monorepo (backend + frontend en un solo repo con carpetas `/api` y `/web`) o repos separados? Recomendación: monorepo para este tamaño de proyecto.

## 5. Arquitectura general

```
┌─────────────────────┐        ┌──────────────────────┐
│   Frontend (React)  │  HTTP  │   Backend (FastAPI)   │
│  - Selector módulo   │◄──────►│  - Endpoint por módulo │
│  - Editor de datos    │        │  - Solvers (scipy,     │
│  - Visualización      │        │    networkx, custom)   │
│  - Export PDF/Excel   │        │  - Validación Pydantic │
└─────────────────────┘        └──────────────────────┘
```

- Cada módulo matemático vive en su propio archivo/servicio en el backend (`app/modules/lp.py`, `app/modules/transport.py`, etc.) con una función `solve()` que recibe un modelo de datos Pydantic y devuelve un modelo de resultado Pydantic estandarizado (ver sección 6).
- El frontend tiene una ruta por módulo (`/lp`, `/transporte`, `/pert-cpm`, ...) pero reutiliza componentes comunes: `DataEditor`, `ResultsTabs`, `SensitivityTable`, `IterationsViewer`, `NetworkDiagram`.

## 6. Contrato de output estándar (CRÍTICO — definir esto primero)

Para que todos los módulos se sientan parte de una misma app, cada resultado debe devolver una estructura común, por ejemplo:

```json
{
  "module": "linear_programming",
  "status": "optimal | infeasible | unbounded",
  "solution": {
    "variables": {"x1": 40, "x2": 20},
    "objective_value": 1400
  },
  "iterations": [ /* tablero simplex paso a paso, si aplica */ ],
  "sensitivity": {
    "objective_ranges": [...],
    "rhs_ranges": [...],
    "shadow_prices": [...],
    "reduced_costs": [...]
  },
  "graph": { /* datos para graficar región factible, red, gantt, etc. */ },
  "warnings": []
}
```

Cada módulo llena las secciones que le apliquen (por ejemplo, Colas no tiene "iterations" tipo simplex, pero sí una tabla de métricas L, Lq, W, Wq).

**Pestañas de resultado en el frontend (estándar tipo QM for Windows):**
1. **Solución** — resultado final en tabla clara.
2. **Iteraciones** — pasos del algoritmo (cuando aplica: simplex, húngaro, Vogel/MODI).
3. **Sensibilidad/Ranging** — cuando aplica (LP, transporte).
4. **Gráfico** — región factible / red / Gantt / carta de control / serie de tiempo, según el módulo.
5. **Exportar** — botón para PDF/Excel del reporte completo.

## 7. Validación de correctitud (no negociable)

Cada módulo debe tener tests automatizados que comparen contra:
- Ejemplos resueltos en libros de texto reconocidos (Hillier & Lieberman "Introduction to Operations Research", Taha "Operations Research: An Introduction", Render/Stair/Hanna "Quantitative Analysis for Management").
- Casos límite: infactible, no acotado, múltiples óptimos, empates en el método húngaro, etc.
- Idealmente, capturas de pantalla o valores conocidos de salidas reales de WinQSB/QM para contrastar formato de reporte.

## 8. Entregable esperado de esta primera interacción con el agente

Pido al agente que, antes de escribir código:
1. Proponga la estructura de carpetas final del monorepo.
2. Confirme o ajuste las librerías de la sección 4 (especialmente la decisión LP: ¿scipy, PuLP, o simplex propio para poder mostrar iteraciones y sensibilidad?).
3. Defina el esquema Pydantic exacto del contrato de output (sección 6) antes de tocar el módulo 1.
4. Proponga un plan de tickets/commits para la Fase 1 completa (4 módulos), con criterios de aceptación por módulo (qué test debe pasar para considerarlo "listo").
5. Construya primero un **esqueleto end-to-end mínimo** (un módulo simple, por ejemplo Breakeven o EOQ) que atraviese todo el stack (input → solve → output → gráfico → export), para validar que la arquitectura funciona antes de invertir en los módulos más complejos (LP con sensibilidad, que es el más costoso de construir bien).

## 9. Referencia de contenido (para no repetir investigación)

Adjuntar al agente el documento previo **`investigacion_WinQSB_QM.md`**, que contiene:
- Los 19 módulos de WinQSB y sus métodos.
- Los 19 módulos de QM for Windows y sus métodos.
- Tabla de equivalencias entre ambos.
- Librerías Python sugeridas por módulo.
- Qué outputs específicos suelen exigir los profesores (tableau simplex, ranging, diagramas PERT con ruta crítica, cartas de control, etc.).

## 10. Fuera de alcance (para el MVP)

- Autenticación multiusuario / roles.
- Despliegue en la nube (queda para después de validar localmente).
- Módulos de Fase 4 (NLP, QP, Job shop, Aggregate Planning, Facility Location) — solo si sobra tiempo.
- Simulación de eventos discretos compleja (SimPy) — las fórmulas cerradas de colas cubren la mayoría de tareas de curso.
