# LaraOps — Investigación de Operaciones (alternativa a WinQSB / QM)

## Problem
Estudiantes de Investigación de Operaciones / Métodos Cuantitativos necesitan herramientas tipo WinQSB y QM for Windows para resolver y verificar tareas (LP, transporte, PERT/CPM, colas, etc.), pero esas apps clásicas obligan a usar una máquina virtual en Windows o Mac. El costo de no resolverlo es fricción antes de empezar: instalar VM, perder tiempo de clase/tarea, y depender de software antiguo, poco visual y poco interactivo — justo cuando el grupo quiere algo usable en clase y entre compañeros.

## Evidence
- Observation (grupo): aún sin haber probado a fondo WinQSB/QM en el curso, todos asumen o enfrentan la necesidad de una VM (Windows o Mac) para poder usarlas — el bloqueo es de acceso, no de “falta de módulos”.
- Assumption — needs validation via prototype local + feedback de 3–5 compañeros en una sesión de clase/tarea (¿prefieren web local sin VM vs. seguir con QM en VM?).
- Assumption — needs validation via comparación de 2–3 ejercicios de libro: si la app reproduce solución + reportes académicos (iteraciones/sensibilidad), el reemplazo es creíble para uso en clase.

## Users
- **Primary**: estudiantes del curso de IO / Métodos Cuantitativos (incluido el builder) que resuelven o verifican tareas y quieren mostrar pasos en clase — trigger: tarea, proyecto o explicación en aula que hoy pediría WinQSB/QM.
- **Secondary (mismo segmento)**: compañeros que consumen la herramienta sin mantenerla; priorizan “abre y resuelve” sin VM.
- **Not for**: empresas multi-tenant, profesores que necesitan LMS integrado, ni usuarios que solo quieren un solver “caja negra” sin reportes académicos (esas necesidades quedan fuera del MVP).

## Hypothesis
We believe **una app web usable en el sistema nativo (sin VM) que resuelva los problemas núcleo de IO y muestre los mismos reportes académicos que WinQSB/QM (solución, iteraciones, sensibilidad, gráficos)** will **eliminar la dependencia de VM y hacer viable el uso en clase/entre compañeros** for **estudiantes de IO del grupo**.
We'll know we're right when **al menos el núcleo MVP (LP + transporte/asignación + PERT/CPM) se usa en una tarea real sin VM y 3+ compañeros confirman que preferirían esto a montar WinQSB/QM**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Acceso sin VM | 100% del flujo MVP corre en el SO nativo del estudiante (macOS/Windows) sin virtualización | Prueba manual en Mac (Apple Silicon) y al menos un Windows nativo |
| Correctitud académica | ≥95% de casos de prueba contra ejemplos de libro (solución óptima / métricas esperadas) en módulos MVP | Suite de validación por módulo vs. ejemplos Taha / Hillier / Render |
| Reportes pedagógicos | Cada módulo MVP expone Solución + (Iteraciones o Sensibilidad o Gráfico según aplique) | Checklist de aceptación por módulo frente a outputs típicos de WinQSB/QM |
| Adopción temprana | ≥3 compañeros usan la app en una tarea/clase sin pedir ayuda para instalar VM | Encuesta corta / observación post-sesión |
| Prioridad de valor | Backend de cálculo y contratos de resultado estables antes de pulir UI | Hitos: “resuelve + valida” antes que “se ve premium” |

## Scope
**MVP** — Lo mínimo para probar la hipótesis:
- Experiencia web local (sin autenticación compleja) para entrar datos tipo hoja, resolver y ver reportes.
- Contrato único de resultado compartido entre módulos (solución, estado, iteraciones si aplica, sensibilidad si aplica, datos de gráfico, advertencias).
- Módulos núcleo de curso: **Programación lineal (con sensibilidad e iteraciones/simplex pedagógico)**, **entera/MIP básico**, **transporte y asignación (con pasos de método cuando aplique)**, **PERT/CPM (ruta crítica, tiempos, red/Gantt, PERT probabilístico básico)**.
- Validación contra ejemplos de libro (no solo “da un número”).
- Exportación básica de reporte (PDF y/o Excel) del resultado.
- Prioridad explícita: **correctitud y API/capa de resolución primero**; UI interactiva y visual se itera después (skills de frontend), sin bloquear el valor académico del backend.

**Out of scope**
- Auth multiusuario / roles / cuentas — no necesario para probar adopción en clase.
- Despliegue en la nube como requisito del MVP — primero validar en local.
- Módulos de “alta demanda” y complementarios (colas, inventarios, pronósticos, decisiones/juegos, redes avanzadas, Markov, calidad, GP, DP, MRP) — diferidos a hitos post-MVP aunque estén en la investigación.
- NLP/QP, job shop, planeación agregada, facility location — solo si sobra tiempo tras adopción.
- Simulación de eventos discretos compleja de colas — las fórmulas cerradas cubren la mayoría de tareas de curso cuando llegue ese módulo.
- Paridad pixel-perfect con WinQSB/QM — se busca paridad de **capacidad académica y reportes**, no clonar la UI de los 90s.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->
<!-- Master plan (A–H): `.claude/plans/plataforma-or-completa.plan.md` -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Fundamento de producto resolutor | Existe un flujo end-to-end mínimo (entrada → resolución → reporte estándar) que demuestra el contrato compartido, sin VM | complete | `.claude/plans/fundamento-producto-resolutor.plan.md` (slice) · master: `plataforma-or-completa.plan.md` Phase A |
| 2 | Núcleo LP académico | El estudiante puede resolver LP/ILP-MIP básico y ver solución, iteraciones pedagógicas y sensibilidad/ranging confiables frente a libro | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase B |
| 3 | Transporte y asignación | El estudiante puede resolver transporte/asignación con pasos de método visibles cuando aplique, usable en tarea sin VM | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase C |
| 4 | PERT/CPM de clase | El estudiante obtiene ruta crítica, tabla de tiempos, vista de red/Gantt y PERT probabilístico básico para proyectos de curso | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase D |
| 5 | Validación con compañeros | Al menos 3 compañeros completan un ejercicio real con la app y confirman que reemplaza la necesidad de VM para ese flujo | pending | `.claude/plans/paridad-winqsb-qm.plan.md` Phase I.4 (antes: `plataforma-or-completa.plan.md` Phase E) |
| 6 | Expansión alta demanda (post-MVP) | Colas, inventarios, pronósticos y decisiones/juegos disponibles con el mismo contrato de reporte | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase F |
| 7 | Complementarios (post-MVP) | Redes, Markov, control de calidad, goal programming, DP, MRP según demanda del curso | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase G |
| 8 | Pulido interactivo frontend | UX visual e interactiva reforzada (después de estabilizar backend) para uso cómodo en clase | complete | `.claude/plans/plataforma-or-completa.plan.md` Phase H |
| 9 | Paridad académica WinQSB/QM | Catálogo ~20–22 módulos + profundidad de reportes + editor tipo hoja + PDF; ≥95% del mapa en `investigacion_WinQSB_QM.md` usable en clase sin VM | in-progress | `.claude/plans/paridad-winqsb-qm.plan.md` |

## Open Questions
- [ ] ¿El profesor acepta/valora reportes generados por la app como apoyo, o exige formato idéntico a WinQSB/QM?
- [ ] ¿El MVP debe incluir solo LP “completo” antes de transporte/PERT, o los 4 módulos núcleo en paralelo por hitos?
- [ ] ¿La adopción se mide solo en el grupo cercano o también como material compartible al resto del semestre?
- [ ] ¿Export PDF es obligatorio en el primer hito usable, o basta pantalla + Excel?
- [ ] ¿Hay restricciones de licencia/uso de ejemplos de libro en tests (solo valores numéricos vs. enunciados completos)?

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Solvers “caja negra” no exponen tableros/iteraciones que piden los profesores | High | High | Tratar reportes pedagógicos (iteraciones/sensibilidad) como requisito de producto del núcleo LP; validar con un ejercicio de clase temprano |
| Alcance de ~20 módulos diluye el MVP | High | High | Congelar MVP en 4 módulos núcleo; resto solo tras hito de adopción con compañeros |
| Correctitud incorrecta erosiona confianza en clase | Medium | High | Tests contra ejemplos de libro como gate de “módulo listo”; no publicar módulo sin suite mínima |
| UI atractiva retrasa el valor real (resolver sin VM) | Medium | Medium | Priorizar backend/contratos/correctitud; diferir pulido visual al hito 8 |
| Evidencia de dolor aún es asumida (herramientas poco probadas en el grupo) | High | Medium | Prototipo usable + sesión con compañeros en hito 5; ajustar alcance si el dolor real es otro (p. ej. solo gráficos) |

---
*Status: ACTIVE — hitos 1–4 y 6–8 complete; hito 5 pending (adopción); hito 9 in-progress (paridad WinQSB/QM).*
*Nota de prioridad acordada: correctitud y contratos primero; para hito 9 la inserción de datos (grilla) y PDF van antes de módulos WinQSB puros (QP/NLP/JOB).*
