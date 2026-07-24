# Investigación: WinQSB vs QM for Windows
## Módulos, métodos, características y outputs — base para planear tu propia app

---

## 1. Panorama general

| | **WinQSB** | **QM for Windows** |
|---|---|---|
| Autor | Dr. Yih-Long Chang | Howard J. Weiss (Pearson/Prentice Hall) |
| Módulos | 19 | 19 (también existe **POM-QM for Windows**, que añade módulos de Administración de Operaciones) |
| Interfaz | Cada módulo es un .exe independiente, se abre en ventana propia | Un solo ejecutable con selector de módulo; todos comparten el mismo editor de datos tipo hoja de cálculo |
| Plataforma | Win 95/98/2000/XP (32-bit, no corre nativo en Win7+) | Win 95 hasta Win 11 (sigue actualizándose, más longevo) |
| Enfoque | Investigación de Operaciones "pura" + algo de gestión de operaciones | Igual, pero **QM for Windows** es la versión "management science" y **POM-QM** agrega producción/operaciones |
| Fortaleza | Más módulos de simulación y detalle en PERT/CPM, colas y control de calidad | Interfaz más simple, mejor integración estadística, más usado en libros de texto (Render, Taylor) |

Ambos son, en esencia, **calculadoras especializadas de Investigación de Operaciones**: tomas un modelo (LP, transporte, colas, etc.), lo metes en una tabla de datos, y el programa te devuelve la solución óptima + varios reportes de análisis (sensibilidad, iteraciones, gráficos).

---

## 2. Los 19 módulos de WinQSB (detalle)

| # | Módulo | Sigla | Método(s) que usa | Qué resuelve |
|---|---|---|---|---|
| 1 | Linear & Integer Programming | LP/ILP | Simplex, método gráfico (2 var), Branch & Bound | Optimización lineal, PL entera |
| 2 | Linear & Integer Goal Programming | GP/IGP | Simplex modificado, gráfico, B&B | Programación multiobjetivo con metas priorizadas |
| 3 | Quadratic Programming | QP/IQP | Simplex modificado, B&B | Función objetivo cuadrática |
| 4 | Nonlinear Programming | NLP | Búsqueda directa (sin restricciones), función de penalización (con restricciones) | Modelos no lineales |
| 5 | Network Modeling | NET | Algoritmos de grafos | Flujo de red, transporte, asignación, ruta más corta, flujo máximo, árbol de expansión mínima, viajante (TSP) |
| 6 | Dynamic Programming | DP | Programación dinámica | Mochila, diligencia (stagecoach), planeación de producción/inventario |
| 7 | PERT/CPM | — | CPM, PERT, análisis de choque (crashing), costos, probabilidad, simulación | Programación de proyectos, ruta crítica |
| 8 | Queuing Analysis | QA | Fórmulas analíticas (M/M/1, M/M/s, etc.), aproximación, simulación | Rendimiento de colas de una sola etapa |
| 9 | Queuing System Simulation | QSS | Simulación de eventos discretos | Colas multietapa con componentes complejos |
| 10 | Inventory Theory & Systems | ITS | EOQ, descuentos por cantidad, periodo único probabilístico, lote dinámico; simulación de políticas (s,Q), (s,S), (R,S), (R,s,S) | Control de inventarios |
| 11 | Forecasting | FC | 11 métodos (promedios móviles, suavización exponencial, Winters, descomposición, etc.) + regresión múltiple | Pronósticos de series de tiempo |
| 12 | Decision Analysis | DA | Bayes, tablas de rentabilidad (payoff), árboles de decisión, juegos de suma cero | Toma de decisiones bajo incertidumbre/riesgo |
| 13 | Markov Process | MKP | Cadenas de Markov | Análisis de estados y transiciones a largo plazo |
| 14 | Quality Control Charts | QCC | Cartas X̄-R, p, c, u, etc. | Control estadístico de calidad |
| 15 | Acceptance Sampling Analysis | ASA | Planes de muestreo por atributos/variables | Aceptación de lotes |
| 16 | Job Scheduling | JOB | Heurísticas (SPT, EDD, etc.), generación aleatoria | Programación de talleres (job shop) y flujo de trabajo |
| 17 | Aggregate Planning | AP | Modelos de costos (nivelación, persecución, mixta) | Planeación agregada de producción |
| 18 | Facility Location & Layout | FLL | Centro de gravedad, modelos de asignación, balanceo de línea | Localización y distribución de planta |
| 19 | Material Requirements Planning | MRP | Explosión de materiales (BOM) | Planeación de requerimiento de materiales |

**Tipo de output típico en WinQSB:**
- Tabla de solución óptima (valores de variables, función objetivo).
- Tablero Simplex paso a paso (todas las iteraciones, no solo el resultado final) — esto es algo que muchos profesores piden replicar.
- Reporte de análisis de sensibilidad: rangos de costos/coeficientes, precios sombra, rangos del lado derecho (RHS).
- Gráfico de la región factible (para problemas de 2 variables).
- En PERT/CPM: diagrama de red, tabla de tiempos (ES, EF, LS, LF, holgura), ruta crítica resaltada, gráfico de Gantt.
- En colas: tabla de medidas de desempeño (L, Lq, W, Wq, ρ, P0...).
- En pronósticos: tabla de errores (MAD, MSE, MAPE) comparando métodos, gráfico de la serie real vs. pronosticada.

---

## 3. Los 19 módulos de QM for Windows (detalle)

| # | Módulo | Qué resuelve |
|---|---|---|
| 1 | Assignment | Problema de asignación (método húngaro) |
| 2 | Breakeven/Cost-Volume Analysis | Punto de equilibrio, análisis costo-volumen-utilidad |
| 3 | Decision Analysis | Árboles de decisión, tablas de pagos, valor esperado, Bayes |
| 4 | Forecasting | Series de tiempo, suavización, regresión |
| 5 | Game Theory | Juegos de suma cero, estrategias puras/mixtas |
| 6 | Goal Programming | Programación por metas |
| 7 | Integer Programming | PL entera (Branch & Bound) |
| 8 | Inventory | EOQ y variantes, punto de reorden |
| 9 | Linear Programming | Simplex, método gráfico, sensibilidad ("Ranging") |
| 10 | Markov Analysis | Cadenas de Markov, estados estables |
| 11 | Material Requirements Planning | MRP, explosión de materiales |
| 12 | Mixed Integer Programming | PL con variables mixtas (continuas + enteras) |
| 13 | Networks | Ruta más corta, árbol de expansión mínima, flujo máximo |
| 14 | Project Management (PERT/CPM) | Ruta crítica, PERT probabilístico, Gantt |
| 15 | Quality Control | Cartas de control (X̄-R, p, c, u) |
| 16 | Simulation | Simulación Monte Carlo genérica |
| 17 | Statistics | Estadística descriptiva, regresión, pruebas básicas |
| 18 | Transportation | Método de transporte (esquina NO, Vogel, MODI) |
| 19 | Waiting Lines | Teoría de colas (M/M/1, M/M/s, con población finita, etc.) |

*(POM-QM for Windows añade además: Aggregate Planning, Facility Location, Job Shop Scheduling, Line Balancing, Learning Curves, Reliability, Forecasting avanzado — es decir, el mismo terreno que cubre WinQSB con AP/FLL/JOB.)*

**Tipo de output típico en QM for Windows:**
- Ventana "Solution": resultado final ordenado en tabla.
- Ventana **"Ranging"**: el equivalente al reporte de sensibilidad de Excel Solver — costos reducidos, precios sombra (dual values), rango de coeficientes de la función objetivo, rango del RHS.
- Ventana "Iterations"/"Simplex Tableau": todas las tablas intermedias del método simplex.
- Gráficos: región factible en 2D, diagrama de red (para Networks/Transportation), Gantt (Project Management), cartas de control con límites (Quality Control).
- Comparación de métodos lado a lado en Forecasting (varios métodos con sus errores en la misma tabla).

**Diferencia clave de output vs. WinQSB:** QM tiende a mostrar todo en ventanas ordenadas dentro de una sola app (Solution / Ranging / Graph / Iterations como pestañas), mientras WinQSB abre ventanas hijas más "sueltas" propias de cada módulo standalone.

---

## 4. Solapamiento entre ambos (para no duplicar trabajo)

Casi todo se solapa. La tabla de equivalencias:

| Tema | WinQSB | QM for Windows |
|---|---|---|
| Programación lineal / entera | LP/ILP | Linear Programming, Integer Programming, Mixed Integer Programming |
| Transporte / asignación / redes | NET | Transportation, Assignment, Networks |
| Programación por metas | GP/IGP | Goal Programming |
| PERT/CPM | PERT/CPM | Project Management |
| Colas | QA, QSS | Waiting Lines |
| Inventarios | ITS | Inventory |
| Pronósticos | FC | Forecasting |
| Decisiones/juegos | DA | Decision Analysis, Game Theory |
| Markov | MKP | Markov Analysis |
| Calidad | QCC, ASA | Quality Control |
| MRP | MRP | Material Requirements Planning |
| Programación dinámica | DP | *(no tiene módulo directo, se resuelve dentro de Inventory/Integer Programming)* |
| Programación no lineal/cuadrática | QP/IQP, NLP | *(no tiene módulos directos)* |
| Job shop / planeación agregada / layout | JOB, AP, FLL | *(están en POM-QM, no en QM base)* |
| Punto de equilibrio | *(no tiene módulo directo)* | Breakeven/Cost-Volume Analysis |
| Estadística general | *(no tiene módulo directo)* | Statistics |
| Simulación genérica | *(cada módulo simula lo suyo)* | Simulation (Monte Carlo genérico) |

**Módulos únicos de WinQSB:** DP, QP/IQP, NLP, JOB, AP, FLL (6 módulos que QM base no cubre, aunque POM-QM sí cubre JOB/AP/FLL).
**Módulos únicos de QM:** Breakeven, Statistics, Simulation genérica.

Esto confirma lo que hablamos antes: **una sola app con ~20-22 módulos** cubre el 95% de ambos programas.

---

## 5. Recomendaciones de librerías Python por módulo

| Módulo | Librería sugerida |
|---|---|
| LP / ILP / MIP / Goal Programming | `pulp`, `scipy.optimize.linprog`, `Pyomo` |
| QP | `cvxpy`, `scipy.optimize.minimize` |
| NLP | `scipy.optimize` (minimize, con restricciones) |
| Transporte / Asignación | `scipy.optimize.linprog` (formulado como LP) o `scipy.optimize.linear_sum_assignment` (asignación) |
| Redes (ruta corta, flujo máx, árbol mínimo) | `networkx` |
| Programación dinámica | Implementación propia (recursión + memoización) |
| PERT/CPM | `networkx` (grafo dirigido) + lógica propia de ES/EF/LS/LF |
| Colas (Waiting Lines / QA) | Fórmulas cerradas (implementación propia con `math`/`numpy`) |
| Simulación de colas / eventos discretos | `simpy` |
| Inventarios (EOQ y variantes) | Fórmulas cerradas propias |
| Pronósticos | `statsmodels`, `numpy`, `scikit-learn` (regresión) |
| Decisión / juegos | Implementación propia (árboles, minimax, LP para juegos de suma cero) |
| Markov | `numpy` (multiplicación de matrices, resolver sistema para estado estable) |
| Control de calidad | Fórmulas propias + `matplotlib`/`plotly` para las cartas |
| Muestreo de aceptación | Distribución binomial/hipergeométrica (`scipy.stats`) |
| MRP | Lógica propia (explosión de BOM, tabla de periodos) |
| Estadística general | `scipy.stats`, `statsmodels` |
| Punto de equilibrio | Fórmulas propias (trivial) |

---

## 6. Notas sobre "outputs" que vale la pena replicar (lo que suelen pedir los profesores)

1. **Tablero simplex completo** (no solo la respuesta final) — muchos cursos piden ver cada iteración.
2. **Reporte de sensibilidad / Ranging**: rango de coeficientes de la función objetivo sin cambiar la base óptima, rango del RHS sin cambiar la base, precios sombra, costos reducidos.
3. **Gráfico de región factible** para problemas de 2 variables (línea de nivel de la función objetivo incluida).
4. **Diagrama de red con ruta crítica resaltada** en PERT/CPM, más tabla ES/EF/LS/LF/holgura y el gráfico de Gantt.
5. **Tabla comparativa de métodos de pronóstico** con MAD/MSE/MAPE para elegir el mejor.
6. **Cartas de control con límites LCS/LC/LCI** marcados y puntos fuera de control resaltados.
7. **Tabla de iteraciones del método húngaro / transporte** (esquina noroeste, Vogel, MODI paso a paso).

Si tu app genera estos mismos reportes (aunque con mejor diseño visual), cumple perfectamente el propósito académico de reemplazar a WinQSB/QM, y de hecho puede quedar mejor documentada.

---

## 7. Siguiente paso sugerido

Con esta tabla de equivalencias y librerías, el plan de trabajo natural sería:

1. Elegir 3-4 módulos "núcleo" para la primera versión (los que más se usan en cursos: **LP/Sensibilidad, Transporte/Asignación, PERT-CPM, Colas**).
2. Definir el formato de "reporte" estándar de tu app (qué pestañas o secciones tendrá cada resultado: Solución, Sensibilidad/Ranging, Gráfico, Iteraciones).
3. Construir el backend con esos 4 módulos y validar contra ejemplos conocidos de libros de texto.
4. Ir agregando módulos en el mismo patrón.

Cuando quieras, armamos ese planning con tiempos y el esqueleto de carpetas/backend para arrancar.
