# ESPECIFICACIÓN FUNCIONAL DETALLADA
## Módulos, campos, comportamiento y outputs de WinQSB + QM for Windows
### Base de referencia para replicarlas, reemplazarlas y mejorarlas

> Documento de referencia técnica para el equipo/agente de desarrollo. Para cada módulo: qué campos pide, qué hace internamente, qué devuelve, cómo se comporta en casos límite, y qué mejoras concretas puede aportar nuestra versión.
>
> **Nota de exactitud:** los detalles de campos y outputs aquí descritos están basados en la documentación pública de ambos programas y en el uso académico estándar de estos métodos. Antes de dar por cerrado cada módulo, se recomienda contrastar contra una captura real del programa original o contra el ejemplo del libro de texto del curso, ya que pueden existir variaciones menores de nomenclatura entre versiones.

---

# PARTE I — MAPA DE SOLAPAMIENTO

## I.1 Tabla maestra de equivalencias

| Tema | WinQSB | QM for Windows | ¿Solapan? | Módulo unificado propuesto |
|---|---|---|---|---|
| Programación lineal | LP/ILP | Linear Programming | ✅ Total | `linear_programming` |
| Programación entera | LP/ILP (B&B) | Integer Programming | ✅ Total | `integer_programming` |
| Programación entera mixta | LP/ILP | Mixed Integer Programming | ✅ Total | (mismo módulo, flag por variable) |
| Programación por metas | GP/IGP | Goal Programming | ✅ Total | `goal_programming` |
| Programación cuadrática | QP/IQP | ❌ | ⬅️ Solo WinQSB | `quadratic_programming` (Fase 4) |
| Programación no lineal | NLP | ❌ | ⬅️ Solo WinQSB | `nonlinear_programming` (Fase 4) |
| Transporte | NET | Transportation | ✅ Total | `transportation` |
| Asignación | NET | Assignment | ✅ Total | `assignment` |
| Redes (ruta, flujo, árbol) | NET | Networks | ✅ Total | `networks` |
| TSP (viajante) | NET | ❌ | ⬅️ Solo WinQSB | dentro de `networks` |
| Programación dinámica | DP | ❌ | ⬅️ Solo WinQSB | `dynamic_programming` |
| PERT/CPM | PERT/CPM | Project Management | ✅ Total | `pert_cpm` |
| Colas (analítico) | QA | Waiting Lines | ✅ Total | `queuing` |
| Colas (simulación) | QSS | Simulation (genérica) | 🔶 Parcial | `queuing_simulation` |
| Inventarios | ITS | Inventory | ✅ Total | `inventory` |
| Pronósticos | FC | Forecasting | ✅ Total | `forecasting` |
| Análisis de decisiones | DA | Decision Analysis | ✅ Total | `decision_analysis` |
| Teoría de juegos | DA (suma cero) | Game Theory | ✅ Total | `game_theory` |
| Markov | MKP | Markov Analysis | ✅ Total | `markov` |
| Control de calidad | QCC | Quality Control | ✅ Total | `quality_control` |
| Muestreo de aceptación | ASA | ❌ | ⬅️ Solo WinQSB | `acceptance_sampling` |
| MRP | MRP | Material Requirements Planning | ✅ Total | `mrp` |
| Job scheduling | JOB | ❌ (sí en POM-QM) | ⬅️ Solo WinQSB | `job_scheduling` (Fase 4) |
| Planeación agregada | AP | ❌ (sí en POM-QM) | ⬅️ Solo WinQSB | `aggregate_planning` (Fase 4) |
| Localización y layout | FLL | ❌ (sí en POM-QM) | ⬅️ Solo WinQSB | `facility_location` (Fase 4) |
| Punto de equilibrio | ❌ | Breakeven/Cost-Volume | ➡️ Solo QM | `breakeven` |
| Estadística general | ❌ | Statistics | ➡️ Solo QM | `statistics` |

### Resumen del solapamiento
- **Solapan totalmente (16 temas):** el núcleo de ambos programas es el mismo. Un solo solver por tema sirve para replicar los dos.
- **Solo WinQSB (8 temas):** DP, QP, NLP, TSP, ASA, JOB, AP, FLL.
- **Solo QM (2 temas):** Breakeven, Statistics.
- **Conclusión de arquitectura:** **una sola app con ~22 módulos** cubre el 100% de ambos programas. No tiene sentido construir dos apps.

## I.2 Diferencias de filosofía (importante para el diseño de la UI)

| Aspecto | WinQSB | QM for Windows | Qué hacemos nosotros |
|---|---|---|---|
| Estructura | 19 .exe independientes; abres el módulo que necesitas | 1 solo .exe con selector de módulo | Selector de módulo tipo QM (mejor UX) |
| Entrada de datos | Cuadrícula por módulo, con un diálogo previo de "especificación del problema" (número de variables, restricciones, etc.) | Cuadrícula tipo hoja de cálculo, también con diálogo previo de dimensiones | Cuadrícula editable **+ opción de entrada en texto libre / pegar desde Excel** (mejora) |
| Resultados | Ventanas hijas separadas por tipo de resultado | Ventanas "Solution", "Ranging", "Iterations", "Graph" | Pestañas dentro de una sola vista (mejor que ambos) |
| Nomenclatura | Más técnica ("Range of Optimality") | Más didáctica ("Ranging") | Ambas, con tooltips explicativos (mejora) |
| Profundidad | Más módulos y más opciones por módulo (ej. simulación de colas multietapa) | Más simple, más pulido, mejor integrado con libros de texto | Profundidad de WinQSB + pulido de QM |

---

# PARTE II — ESPECIFICACIÓN MÓDULO POR MÓDULO

Para cada módulo: **Campos de entrada → Comportamiento/algoritmo → Output → Casos límite → Mejoras propuestas**.

---

## 1. PROGRAMACIÓN LINEAL (`linear_programming`)
**WinQSB:** LP/ILP · **QM:** Linear Programming

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `problem_name` | string | Nombre del problema (para el reporte) |
| `objective` | enum | `maximize` \| `minimize` |
| `num_variables` | int | Número de variables de decisión |
| `num_constraints` | int | Número de restricciones |
| `variable_names` | string[] | Nombres (default: X1, X2, ...) |
| `objective_coefficients` | float[] | Coeficientes de la función objetivo |
| `constraints[]` | objeto[] | Cada una con: `coefficients: float[]`, `operator: "<=" \| ">=" \| "="`, `rhs: float` |
| `variable_bounds[]` | objeto[] | Por variable: `lower` (default 0), `upper` (default ∞) |
| `variable_types[]` | enum[] | `continuous` \| `integer` \| `binary` (si hay enteras → va a Branch & Bound) |
| `solve_method` | enum | `simplex` \| `graphical` (graphical solo si `num_variables == 2`) |

*(WinQSB y QM piden exactamente estos datos, en una cuadrícula donde las filas son restricciones y las columnas variables; la primera fila es la función objetivo y las últimas columnas son operador y RHS.)*

### Comportamiento
1. Normaliza el problema a forma estándar (agrega holguras, excesos, artificiales según el operador).
2. Si hay restricciones `≥` o `=` → método de las **dos fases** (o Gran M).
3. Ejecuta **simplex tabular**, guardando cada tabla intermedia.
4. Detecta: óptimo, infactible, no acotado, óptimos múltiples (variable no básica con costo reducido = 0), degeneración (variable básica = 0).
5. Calcula sensibilidad desde la tabla óptima (ver abajo).
6. Si `num_variables == 2` → genera datos para graficar la región factible.

### Output
**Pestaña "Solución":**
| Variable | Valor | Costo reducido | Coef. objetivo original |
|---|---|---|---|
| X1 | 40 | 0 | 40 |

- Valor de la función objetivo (Z).
- Por restricción: valor del lado izquierdo, holgura/exceso, precio sombra.

**Pestaña "Iteraciones":** cada tabla simplex completa, con la columna/fila pivote resaltada, variable que entra y que sale identificadas.

**Pestaña "Sensibilidad" (Ranging):**
- *Rangos de optimalidad* (coeficientes objetivo): por variable → `min`, `actual`, `max` (rango en el que el coeficiente puede variar sin cambiar la solución óptima).
- *Rangos de factibilidad* (RHS): por restricción → `min`, `actual`, `max` (rango en el que el RHS puede variar sin cambiar la base óptima, es decir, donde el precio sombra sigue siendo válido).
- *Precios sombra* (dual values): cuánto mejora Z por unidad adicional del recurso.
- *Costos reducidos:* cuánto tendría que mejorar el coeficiente de una variable no básica para que entre a la solución.

**Pestaña "Gráfico" (solo 2 variables):** región factible sombreada, restricciones como rectas etiquetadas, línea de nivel de Z, punto óptimo marcado con sus coordenadas, vértices identificados.

### Casos límite obligatorios
- **Infactible:** no existe región factible → status `infeasible`, indicar qué restricción(es) causan el conflicto.
- **No acotado:** Z crece indefinidamente → status `unbounded`, indicar la dirección de crecimiento.
- **Óptimos múltiples:** reportar que existen infinitas soluciones óptimas y listar los vértices óptimos alternativos.
- **Degeneración:** advertir (`warnings`) que una variable básica vale 0.
- Coeficientes negativos en RHS, variables libres (sin restricción de no negatividad).

### Mejoras sobre el original
- Entrada del modelo **en texto plano/LaTeX** (`Max 40x1 + 50x2 s.t. ...`) además de la cuadrícula — WinQSB y QM solo permiten cuadrícula.
- Pegar datos directamente desde Excel.
- Explicación en lenguaje natural de cada precio sombra ("un kilo más de arcilla aumenta la ganancia en $16").
- Gráfico interactivo (zoom, hover en vértices) vs. el gráfico estático de los originales.
- Exportar el modelo a formato LP estándar / código Python.

---

## 2. PROGRAMACIÓN ENTERA Y MIXTA (`integer_programming`)
**WinQSB:** LP/ILP (B&B) · **QM:** Integer Programming + Mixed Integer Programming

### Campos de entrada
Idénticos a LP, más:
| Campo | Tipo | Descripción |
|---|---|---|
| `variable_types[]` | enum[] | `continuous` \| `integer` \| `binary` — si al menos una es entera, se activa este módulo |

### Comportamiento
1. Resuelve la relajación lineal (LP) del problema.
2. Si la solución ya es entera → termina.
3. Si no, elige una variable fraccionaria y **ramifica** (branch): crea dos subproblemas (`xi ≤ ⌊v⌋` y `xi ≥ ⌈v⌉`).
4. **Acota** (bound): poda ramas cuya relajación sea peor que la mejor solución entera encontrada.
5. Repite hasta agotar el árbol.

### Output
- Solución entera óptima + Z.
- **Árbol de Branch & Bound:** nodos explorados, valor de la relajación en cada nodo, ramas podadas y razón de la poda (por cota, por infactibilidad, por integralidad).
- Comparación: valor de la relajación LP vs. valor entero óptimo (el "gap de integralidad").
- Número de nodos explorados.

### Casos límite
- Problema entero infactible aunque la relajación sea factible.
- Árboles muy grandes → poner límite de nodos configurable y advertir si se alcanza.

### Mejoras
- **Visualización del árbol B&B como diagrama interactivo** (los originales solo muestran texto o una lista) — esto es enorme para entender el método.
- Poder ver el tablero simplex de cualquier nodo del árbol haciendo clic.

---

## 3. TRANSPORTE (`transportation`)
**WinQSB:** NET · **QM:** Transportation

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `num_sources` | int | Número de orígenes (plantas, fábricas) |
| `num_destinations` | int | Número de destinos (bodegas, clientes) |
| `source_names` | string[] | Nombres de orígenes |
| `destination_names` | string[] | Nombres de destinos |
| `cost_matrix` | float[][] | Costo unitario de enviar de origen i a destino j |
| `supply[]` | float[] | Oferta de cada origen |
| `demand[]` | float[] | Demanda de cada destino |
| `objective` | enum | `minimize` (costo) \| `maximize` (utilidad) |
| `initial_method` | enum | `northwest` \| `least_cost` \| `vogel` (VAM) |
| `optimization_method` | enum | `modi` (u-v) \| `stepping_stone` |

### Comportamiento
1. **Balancea** el problema: si oferta ≠ demanda, agrega un origen o destino ficticio con costo 0.
2. Genera **solución inicial** con el método elegido (esquina noroeste / costo mínimo / Vogel).
3. **Optimiza** con MODI (multiplicadores u-v) o Stepping Stone, iterando hasta que todos los costos reducidos sean ≥ 0.
4. Detecta degeneración (menos de m+n-1 celdas ocupadas) y agrega un épsilon.

### Output
**Solución:** matriz de asignación (cuántas unidades de cada origen a cada destino), costo total, y para cada celda vacía su costo reducido.

**Iteraciones:** tabla en cada paso, con los valores u_i y v_j calculados, la celda que entra (más negativa), el ciclo de ajuste (stepping stone path) resaltado, y la cantidad que se mueve.

**Análisis adicional:**
- Ofertas/demandas no satisfechas (si hubo ficticios).
- Indicación de solución degenerada.
- Detección de soluciones óptimas alternativas (costo reducido = 0 en una celda vacía).

### Casos límite
- Desbalanceado (oferta > demanda y viceversa).
- Degeneración.
- Rutas prohibidas (costo = M muy grande / celda bloqueada) → **campo adicional propuesto:** `forbidden_routes: [[i,j]]`.
- Óptimos múltiples.

### Mejoras
- **Visualización de la red de flujo** (origen → destino con grosor de línea proporcional al flujo) — los originales solo muestran tablas.
- Animación del ciclo de stepping stone paso a paso.
- Poder marcar rutas prohibidas con un clic en vez de meter un costo gigante manual.

---

## 4. ASIGNACIÓN (`assignment`)
**WinQSB:** NET · **QM:** Assignment

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `num_agents` | int | Trabajadores/máquinas |
| `num_tasks` | int | Tareas |
| `agent_names` / `task_names` | string[] | Etiquetas |
| `cost_matrix` | float[][] | Costo/tiempo de asignar agente i a tarea j |
| `objective` | enum | `minimize` \| `maximize` |
| `forbidden_assignments` | [i,j][] | Asignaciones no permitidas |

### Comportamiento
1. Si la matriz no es cuadrada, la completa con filas/columnas ficticias de costo 0.
2. Si es maximización, convierte (restando de la matriz al valor máximo).
3. Ejecuta el **método húngaro**: reducción por filas → reducción por columnas → cubrir ceros con mínimo de líneas → si líneas < n, ajustar → repetir.

### Output
- Asignación óptima uno-a-uno (agente → tarea) y costo total.
- **Iteraciones del método húngaro:** matriz después de cada reducción, líneas de cobertura marcadas, valor mínimo no cubierto usado en el ajuste.
- Asignaciones alternativas si hay empates.

### Casos límite
- Matriz no cuadrada (más agentes que tareas o viceversa).
- Múltiples asignaciones óptimas.
- Asignaciones prohibidas.

### Mejoras
- Diagrama bipartito de la asignación final.
- Mostrar todas las soluciones óptimas cuando hay empate (los originales suelen mostrar solo una).

---

## 5. REDES (`networks`)
**WinQSB:** NET · **QM:** Networks

### Submodelos y sus campos

**5a. Ruta más corta (Shortest Path)**
| Campo | Tipo |
|---|---|
| `nodes` | string[] |
| `arcs[]` | `{from, to, cost, directed: bool}` |
| `source_node` / `target_node` | string |

→ Algoritmo: Dijkstra (costos no negativos) o Bellman-Ford (permite negativos).
→ Output: ruta óptima (secuencia de nodos), distancia total, tabla de distancias desde el origen a **todos** los nodos, etiquetas por iteración.

**5b. Árbol de expansión mínima (Minimum Spanning Tree)**
| Campo | Tipo |
|---|---|
| `nodes`, `arcs[]` (no dirigidos) | — |

→ Algoritmo: Kruskal o Prim.
→ Output: aristas seleccionadas, costo total, orden en que se agregaron (iteraciones).

**5c. Flujo máximo (Maximum Flow)**
| Campo | Tipo |
|---|---|
| `arcs[]` | `{from, to, capacity}` |
| `source` / `sink` | string |

→ Algoritmo: Ford-Fulkerson / Edmonds-Karp.
→ Output: flujo máximo total, flujo por arco, **corte mínimo** identificado, caminos de aumento usados en cada iteración.

**5d. Flujo de costo mínimo / Transbordo (Transshipment)**
| Campo | Tipo |
|---|---|
| `nodes[]` | `{name, supply_demand}` (positivo = oferta, negativo = demanda, 0 = transbordo) |
| `arcs[]` | `{from, to, cost, capacity}` |

→ Algoritmo: formulación LP / network simplex.
→ Output: flujo por arco, costo total.

**5e. Agente viajero (TSP)** *(solo WinQSB)*
| Campo | Tipo |
|---|---|
| `distance_matrix` | float[][] |
| `method` | `exact` (B&B, ≤12 nodos) \| `heuristic` (vecino más cercano + 2-opt) |

→ Output: tour óptimo/heurístico, distancia total, gráfico del recorrido.

### Mejoras generales de este módulo
- **Editor visual de grafos**: dibujar nodos y arcos arrastrando, en vez de llenar una tabla de arcos a mano (esto es la mayor debilidad de ambos programas).
- Animación del algoritmo (Dijkstra iluminando nodos visitados progresivamente).
- Importar grafo desde CSV.

---

## 6. PERT/CPM (`pert_cpm`)
**WinQSB:** PERT/CPM · **QM:** Project Management

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `project_name` | string | — |
| `time_type` | enum | `deterministic` (CPM: una duración) \| `probabilistic` (PERT: 3 tiempos) |
| `activities[]` | objeto[] | Ver abajo |
| `crashing_enabled` | bool | Si se hará análisis de compresión |

**Cada actividad:**
| Campo | Tipo | Descripción |
|---|---|---|
| `id` / `name` | string | Ej. "A", "Excavación" |
| `predecessors` | string[] | Actividades predecesoras inmediatas |
| `duration` | float | Si `deterministic` |
| `optimistic` / `most_likely` / `pessimistic` | float | Si `probabilistic` (a, m, b) |
| `normal_cost` | float | Para análisis de costos |
| `crash_time` / `crash_cost` | float | Para análisis de compresión |
| `resources` | dict | Opcional: recursos asignados |

### Comportamiento
1. Construye el grafo dirigido de precedencias; **valida que no haya ciclos**.
2. Si es PERT: calcula tiempo esperado `te = (a + 4m + b)/6` y varianza `σ² = ((b-a)/6)²` por actividad.
3. **Forward pass:** calcula ES (inicio temprano) y EF (fin temprano) de cada actividad.
4. **Backward pass:** calcula LS (inicio tardío) y LF (fin tardío).
5. **Holgura** = LS − ES (o LF − EF). Actividades con holgura 0 forman la **ruta crítica**.
6. Si PERT: duración esperada del proyecto = suma de te en la ruta crítica; varianza = suma de varianzas de la ruta crítica; permite calcular `P(proyecto ≤ X días)` vía normal.
7. Si crashing: identifica qué actividad crítica comprimir primero (menor costo de compresión por unidad de tiempo), iterando hasta el objetivo de tiempo.

### Output
**Tabla principal:**
| Actividad | Duración | ES | EF | LS | LF | Holgura | ¿Crítica? |
|---|---|---|---|---|---|---|---|
| A | 5 | 0 | 5 | 0 | 5 | 0 | ✅ |

- Duración total del proyecto.
- **Ruta(s) crítica(s)** listadas.
- Si PERT: varianza y desviación estándar del proyecto, probabilidad de terminar en fecha X, y fecha para una probabilidad dada (ej. "¿qué duración tiene 95% de probabilidad?").
- Si crashing: tabla de compresión (qué actividad, cuántos días, costo incremental, nueva duración, costo total acumulado), curva costo vs. tiempo.

**Gráficos:**
- **Diagrama de red** (nodos = actividades o eventos, según convención AON/AOA) con la ruta crítica resaltada en rojo.
- **Diagrama de Gantt** con barras, holgura sombreada y dependencias.

### Casos límite
- **Ciclos en las precedencias** → error explícito indicando el ciclo detectado.
- **Múltiples rutas críticas simultáneas** → listarlas todas.
- Actividades sin predecesoras ni sucesoras (huérfanas).
- PERT donde una ruta no crítica tiene alta varianza (advertir que puede volverse crítica).

### Mejoras
- Gantt **interactivo** (arrastrar para simular retrasos y ver el impacto en tiempo real).
- Simulación Monte Carlo del proyecto (distribución de la duración total, probabilidad de que cada ruta sea crítica) — WinQSB tiene simulación básica, se puede mejorar mucho.
- Detección automática de la convención AON vs AOA.
- Importar actividades desde CSV/Excel/MS Project.

---

## 7. TEORÍA DE COLAS (`queuing`)
**WinQSB:** QA (Queuing Analysis) · **QM:** Waiting Lines

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `model_type` | enum | `M/M/1`, `M/M/s`, `M/M/1/K`, `M/M/s/K`, `M/M/s/∞/N` (población finita), `M/G/1`, `M/D/1`, `G/G/s` (aproximación) |
| `arrival_rate` (λ) | float | Tasa de llegadas (clientes/unidad de tiempo) |
| `service_rate` (μ) | float | Tasa de servicio **por servidor** |
| `num_servers` (s) | int | Número de servidores |
| `system_capacity` (K) | int | Capacidad máxima del sistema (si es finita) |
| `population_size` (N) | int | Tamaño de la población (si es finita) |
| `service_std_dev` (σ) | float | Solo para M/G/1 |
| **Costos (opcional):** | | |
| `cost_waiting_per_unit_time` | float | Costo de que un cliente espere |
| `cost_server_per_unit_time` | float | Costo de operar un servidor |

### Comportamiento
1. Valida estabilidad: `ρ = λ/(s·μ) < 1` para sistemas de capacidad infinita. Si ρ ≥ 1 → advertir que el sistema es inestable (la cola crece sin límite).
2. Aplica las fórmulas cerradas del modelo elegido.
3. Si hay costos, calcula el costo total y **el número óptimo de servidores** (barriendo s hasta minimizar costo total).

### Output
**Tabla de medidas de desempeño:**
| Medida | Símbolo | Valor |
|---|---|---|
| Utilización del sistema | ρ | 0.75 |
| Prob. de sistema vacío | P0 | 0.25 |
| Número promedio en el sistema | L | 3.00 |
| Número promedio en la cola | Lq | 2.25 |
| Tiempo promedio en el sistema | W | 0.20 |
| Tiempo promedio en la cola | Wq | 0.15 |
| Prob. de tener que esperar | Pw | 0.75 |
| Tasa efectiva de llegada (si K finita) | λef | — |

- **Distribución de probabilidad Pn** (probabilidad de que haya n clientes en el sistema), tabulada y graficada.
- Si hay costos: costo de espera, costo de servicio, costo total; tabla comparativa para diferentes valores de s con el óptimo resaltado.

### Casos límite
- ρ ≥ 1 en sistemas infinitos → sistema inestable, no calcular L y W (o reportar ∞).
- s = 1 debe dar exactamente los mismos resultados que M/M/1.
- Población finita donde N ≤ s (nunca hay cola).

### Mejoras
- **Gráfico de sensibilidad:** cómo cambian Lq y Wq al variar λ o s (curva) — muy útil para decisiones y no lo tienen los originales de forma clara.
- Recomendación automática del número de servidores con explicación del trade-off.
- Simulación opcional para validar las fórmulas (y para modelos donde no hay fórmula cerrada).

---

## 8. SIMULACIÓN DE COLAS (`queuing_simulation`)
**WinQSB:** QSS (Queuing System Simulation) · **QM:** Simulation (genérica, más limitada)

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `components[]` | objeto[] | Poblaciones de clientes, colas, servidores, y su conexión |
| Por cada **población** | | `arrival_distribution` (exponencial, uniforme, normal, constante, empírica), parámetros, tamaño |
| Por cada **cola** | | capacidad, disciplina (FIFO, LIFO, prioridad, SPT) |
| Por cada **servidor** | | `service_distribution` + parámetros, número de unidades, costo |
| `simulation_time` | float | Duración de la corrida |
| `num_replications` | int | Número de repeticiones (para intervalos de confianza) |
| `warmup_period` | float | Periodo de calentamiento a descartar |
| `random_seed` | int | Para reproducibilidad |

### Comportamiento
Simulación de eventos discretos: reloj de simulación, lista de eventos futuros, recolección de estadísticas por entidad y por recurso. Multietapa: la salida de un servidor puede ser la entrada de otra cola.

### Output
- Estadísticas por componente: utilización de servidores, longitud promedio y máxima de cola, tiempo promedio de espera, número de clientes atendidos/rechazados.
- **Intervalos de confianza** sobre las réplicas.
- Gráfico de la evolución de la cola en el tiempo.
- Comparación con el resultado analítico (si el modelo tiene fórmula cerrada equivalente).

### Mejoras
- **Animación en vivo** de la simulación (ver clientes moviéndose por el sistema) — ninguno de los dos originales lo hace bien.
- Constructor visual del sistema (arrastrar componentes) en vez de llenar formularios.

---

## 9. INVENTARIOS (`inventory`)
**WinQSB:** ITS · **QM:** Inventory

### Submodelos y campos

**9a. EOQ básico (cantidad económica de pedido)**
| Campo | Símbolo | Descripción |
|---|---|---|
| `annual_demand` | D | Demanda anual |
| `order_cost` | S / Co | Costo por ordenar |
| `holding_cost` | H / Ch | Costo de mantener una unidad por año |
| `unit_cost` | C | Costo unitario (opcional, para costo total) |
| `lead_time` | L | Tiempo de entrega |
| `days_per_year` | — | Días laborales al año |

→ Output: **Q\*** (cantidad óptima), número de pedidos al año, tiempo entre pedidos, punto de reorden (ROP = d·L), costo anual de ordenar, de mantener, y total. **Gráfico de diente de sierra** del nivel de inventario, y **gráfico de costos** (costo de ordenar vs. mantener vs. total, mostrando dónde se cruzan en Q*).

**9b. EOQ con descuentos por cantidad**
Campos: EOQ básico + `price_breaks[]` = `{min_quantity, unit_price}`, y `holding_cost_is_percentage` (bool, si H = i% del precio).
→ Output: Q* factible por cada nivel de precio, costo total por nivel, **nivel ganador** resaltado, gráfico de costo total escalonado.

**9c. EPQ / Producción (POQ)**
Campos: EOQ + `production_rate` (p).
→ Output: tamaño de lote óptimo, inventario máximo, tiempo de producción, tiempo de ciclo.

**9d. EOQ con faltantes planeados (backorders)**
Campos: EOQ + `shortage_cost` (Cs).
→ Output: Q*, nivel máximo de faltante S*, costos desglosados.

**9e. Periodo único / Modelo del vendedor de periódicos (Newsvendor)**
Campos: `demand_distribution` (normal/discreta/empírica) + parámetros, `cost_understock` (Cu), `cost_overstock` (Co).
→ Output: nivel de servicio crítico `Cu/(Cu+Co)`, cantidad óptima Q*, utilidad esperada.

**9f. Lote dinámico (Dynamic Lot Sizing)**
Campos: demanda por periodo (vector), costo de ordenar, costo de mantener.
→ Algoritmos: Wagner-Whitin (óptimo), Silver-Meal, mínimo costo unitario, lote por lote.
→ Output: plan de pedidos por periodo, costo total, comparación entre heurísticas vs. óptimo.

**9g. Simulación de políticas (s,Q), (s,S), (R,S), (R,s,S)** *(fuerte en WinQSB)*
Campos: parámetros de la política, distribución de demanda, distribución de lead time, horizonte.
→ Output: nivel de servicio alcanzado, faltantes, costo total, gráfico del nivel de inventario simulado.

### Mejoras
- Análisis de sensibilidad automático: cómo cambia Q* y el costo si D, S o H varían ±20% (los originales exigen recalcular a mano).
- Comparación lado a lado de varias políticas.

---

## 10. PRONÓSTICOS (`forecasting`)
**WinQSB:** FC (11 métodos + regresión) · **QM:** Forecasting

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `time_series` | float[] | Datos históricos por periodo |
| `period_labels` | string[] | Ene, Feb... o 1,2,3... |
| `method` | enum | Ver lista abajo |
| `forecast_periods` | int | Cuántos periodos a futuro pronosticar |
| `seasonality` | int | Longitud del ciclo estacional (4 trimestral, 12 mensual) |

**Métodos (los 11 de WinQSB + regresión):**
1. Promedio simple
2. Promedio móvil simple (`n` periodos)
3. Promedio móvil ponderado (`weights[]`)
4. Promedio móvil doble
5. Suavización exponencial simple (`alpha`)
6. Suavización exponencial doble / Holt (`alpha`, `beta`)
7. Holt-Winters aditivo (`alpha`, `beta`, `gamma`)
8. Holt-Winters multiplicativo (`alpha`, `beta`, `gamma`)
9. Tendencia lineal (regresión sobre el tiempo)
10. Descomposición de series de tiempo (tendencia, estacionalidad, ciclo, irregular)
11. Suavización adaptativa
12. **Regresión lineal múltiple** (campos extra: `independent_variables: float[][]`)

### Comportamiento
1. Aplica el método sobre los datos históricos, generando el pronóstico "hacia atrás" (fitted values) para poder medir el error.
2. Calcula errores: **MAD** (desviación media absoluta), **MSE** (error cuadrático medio), **MAPE** (% error absoluto medio), **Bias/CFE** (error acumulado), **señal de rastreo** (tracking signal).
3. Proyecta hacia adelante `forecast_periods`.
4. Si se piden varios métodos, los compara.

### Output
**Tabla por periodo:** | Periodo | Real | Pronóstico | Error | |Error| | Error² | %Error |

**Tabla resumen de errores:** MAD, MSE, MAPE, Bias, señal de rastreo.

**Pronóstico futuro:** valores proyectados (idealmente con intervalo de confianza — **mejora**, los originales dan solo el punto).

**Gráfico:** serie real vs. pronosticada vs. proyección futura.

Si es regresión: coeficientes, R², R² ajustado, error estándar, estadísticos t, valor F, ANOVA.

### Mejoras
- **Comparador automático de todos los métodos a la vez**, rankeados por MAPE, con recomendación del mejor — WinQSB obliga a correr uno por uno.
- **Optimización automática de parámetros** (encontrar el alpha que minimiza MSE) — enorme mejora sobre el original donde uno tantea a mano.
- Intervalos de predicción.
- Detección automática de estacionalidad.

---

## 11. ANÁLISIS DE DECISIONES (`decision_analysis`)
**WinQSB:** DA · **QM:** Decision Analysis

### Submodelos y campos

**11a. Tabla de pagos (Payoff Table) bajo incertidumbre/riesgo**
| Campo | Tipo |
|---|---|
| `alternatives` | string[] |
| `states_of_nature` | string[] |
| `payoff_matrix` | float[][] (alternativa × estado) |
| `probabilities[]` | float[] (si es bajo riesgo; si no se dan → incertidumbre) |
| `objective` | `maximize` (utilidad) \| `minimize` (costo) |
| `hurwicz_alpha` | float (coeficiente de optimismo, 0-1) |

→ Output por criterio:
- **Bajo incertidumbre:** Maximax (optimista), Maximin (pesimista/Wald), Hurwicz (α), Laplace (igual probabilidad), Minimax Regret (con su tabla de arrepentimiento).
- **Bajo riesgo:** Valor Monetario Esperado (VME/EMV) por alternativa, alternativa óptima.
- **VEIP / EVPI** (valor esperado de la información perfecta).
- **VEIM / EVSI** (valor esperado de la información de muestra), si hay análisis bayesiano.

**11b. Árbol de decisión**
| Campo | Tipo |
|---|---|
| `nodes[]` | `{id, type: "decision"\|"chance"\|"terminal", label, parent, probability, payoff}` |

→ Comportamiento: **rollback** (resolver de derecha a izquierda, tomando el máximo en nodos de decisión y el valor esperado en nodos de azar).
→ Output: árbol con el valor de cada nodo calculado, **ramas óptimas resaltadas**, y la política de decisión recomendada.

**11c. Análisis bayesiano**
| Campo | Tipo |
|---|---|
| `prior_probabilities[]` | Probabilidades a priori de cada estado |
| `conditional_probabilities[][]` | P(indicador \| estado) |

→ Output: tabla de probabilidades conjuntas, marginales y **posteriores** (revisadas), VEIM.

### Mejoras
- **Árbol de decisión visual editable** (arrastrar y soltar nodos) — WinQSB lo tiene muy tosco.
- Análisis de sensibilidad sobre las probabilidades (a partir de qué probabilidad cambia la decisión óptima) con gráfico — muy pedido en cursos y muy débil en los originales.

---

## 12. TEORÍA DE JUEGOS (`game_theory`)
**WinQSB:** DA (juegos de suma cero) · **QM:** Game Theory

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `player1_strategies` | string[] | Filas |
| `player2_strategies` | string[] | Columnas |
| `payoff_matrix` | float[][] | Pagos para el jugador 1 (suma cero: el jugador 2 recibe lo negativo) |

### Comportamiento
1. Busca **punto silla** (maximin = minimax) → estrategias puras.
2. Si no hay punto silla, **elimina estrategias dominadas**.
3. Resuelve por **LP** (o método algebraico si es 2×2) → estrategias mixtas.

### Output
- Valor del juego.
- Estrategia óptima de cada jugador (pura o mixta con sus probabilidades).
- Maximin del jugador 1 y minimax del jugador 2.
- Estrategias dominadas eliminadas (con el paso a paso).
- Si es 2×n o m×2: **solución gráfica**.

### Mejoras
- Mostrar el proceso de eliminación de dominadas paso a paso.
- Gráfico de la solución para juegos 2×n.

---

## 13. CADENAS DE MARKOV (`markov`)
**WinQSB:** MKP · **QM:** Markov Analysis

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `states` | string[] | Nombres de los estados |
| `transition_matrix` | float[][] | P(i→j); cada fila debe sumar 1 |
| `initial_state_vector` | float[] | Distribución inicial |
| `num_periods` | int | Periodos a proyectar |
| `costs/rewards` | float[] | Opcional: costo o ganancia por estado |

### Comportamiento
1. **Valida que cada fila sume 1** (error si no).
2. Proyecta estado por estado: `π(n) = π(0) · Pⁿ`.
3. Calcula **estado estable** resolviendo `π = π·P` con `Σπ = 1`.
4. Identifica **estados absorbentes** (P(i→i)=1); si los hay, calcula la matriz fundamental `N = (I−Q)⁻¹`, probabilidades de absorción y tiempo esperado hasta la absorción.
5. Calcula tiempos de primera pasada y de recurrencia.

### Output
- Distribución de estados en cada periodo (tabla + gráfico de líneas).
- Vector de estado estable (probabilidades a largo plazo).
- Matriz `Pⁿ` para el n pedido.
- Si hay absorbentes: matriz fundamental, probabilidades de absorción, pasos esperados hasta absorción.
- Costo/ganancia esperado por periodo y a largo plazo (si se dieron costos).
- **Diagrama de transición de estados** (grafo con probabilidades en los arcos).

### Casos límite
- Filas que no suman 1 → error.
- Cadenas no ergódicas (no existe estado estable único) → advertir.
- Estados absorbentes → cambiar automáticamente al análisis de cadenas absorbentes.

### Mejoras
- **Diagrama de estados interactivo** — ninguno de los dos originales lo muestra bien.
- Animación de la evolución de la distribución.

---

## 14. CONTROL DE CALIDAD (`quality_control`)
**WinQSB:** QCC · **QM:** Quality Control

### Submodelos y campos

**14a. Cartas por variables (X̄-R, X̄-S, I-MR)**
| Campo | Tipo |
|---|---|
| `samples[][]` | Datos: cada fila es una muestra con n observaciones |
| `subgroup_size` | int (n) |
| `sigma_level` | float (default 3) |
| `known_mean` / `known_sigma` | float (opcional, si el proceso tiene valores objetivo) |

→ Output: **Carta X̄** (LCS, LC, LCI) + **Carta R** (o S), con los límites calculados usando las constantes A2, D3, D4 (o A3, B3, B4); puntos fuera de control resaltados; **reglas de Western Electric** (rachas, tendencias) — *mejora, los originales solo marcan puntos fuera de límites*.
→ **Capacidad del proceso:** Cp, Cpk, Pp, Ppk (requiere campos extra `USL`/`LSL`), con interpretación.

**14b. Cartas por atributos (p, np, c, u)**
| Campo | Tipo |
|---|---|
| `defectives[]` o `defects[]` | int[] |
| `sample_sizes[]` | int[] (puede ser variable para p y u) |

→ Output: carta con límites (que varían por muestra si n es variable), puntos fuera de control.

### Mejoras
- Cartas interactivas (hover para ver el dato).
- Aplicar automáticamente las 8 reglas de Nelson/Western Electric y explicar cuál se violó.
- Cálculo e interpretación automática de capacidad (Cp/Cpk) junto a la carta.

---

## 15. MUESTREO DE ACEPTACIÓN (`acceptance_sampling`)
**WinQSB:** ASA · *(QM no lo tiene)*

### Campos de entrada
| Campo | Símbolo | Descripción |
|---|---|---|
| `lot_size` | N | Tamaño del lote |
| `sample_size` | n | Tamaño de la muestra |
| `acceptance_number` | c | Número máximo de defectuosos para aceptar |
| `AQL` | — | Nivel de calidad aceptable |
| `LTPD` / `RQL` | — | Nivel de calidad rechazable |
| `producer_risk` (α) / `consumer_risk` (β) | — | Riesgos |
| `plan_type` | — | Simple, doble, múltiple, secuencial |

### Output
- **Curva CO (característica de operación):** probabilidad de aceptación vs. % defectuoso real.
- Riesgo del productor y del consumidor calculados.
- **AOQ** (calidad promedio de salida) y **AOQL** (máximo del AOQ), con gráfico.
- **ATI** (inspección total promedio).
- Diseño del plan: dado AQL/LTPD/α/β → recomienda n y c.

### Mejoras
- Diseño inverso automático del plan (los originales piden n y c, nosotros podemos calcularlos desde AQL/LTPD).
- Comparar varios planes en la misma curva CO.

---

## 16. PROGRAMACIÓN POR METAS (`goal_programming`)
**WinQSB:** GP/IGP · **QM:** Goal Programming

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `variables` | string[] | Variables de decisión |
| `goals[]` | objeto[] | Cada meta: `coefficients[]`, `operator`, `target_value`, `priority` (P1, P2...), `weight_under` (d⁻), `weight_over` (d⁺) |
| `hard_constraints[]` | objeto[] | Restricciones rígidas (que no se pueden violar) |

### Comportamiento
Simplex modificado / preemptive goal programming: optimiza la prioridad P1 primero, luego P2 sin empeorar P1, etc.

### Output
- Valores de las variables.
- **Por cada meta:** valor alcanzado, desviación por debajo (d⁻) y por encima (d⁺), si se cumplió o no.
- Nivel de logro por prioridad.
- Iteraciones del simplex modificado.

### Mejoras
- Visualización de "cumplimiento de metas" tipo dashboard (barras de logro por meta).
- Análisis de trade-off entre metas.

---

## 17. PROGRAMACIÓN DINÁMICA (`dynamic_programming`)
**WinQSB:** DP · *(QM no lo tiene como módulo)*

### Submodelos y campos

**17a. Problema de la diligencia (Stagecoach / Shortest route por etapas)**
Campos: etapas, nodos por etapa, matriz de costos entre etapas.
→ Output: ruta óptima, costo, **tabla de decisiones óptimas por etapa** (f_n(s) y x*_n), que es el corazón didáctico del método.

**17b. Mochila (Knapsack)**
Campos: `items[]` = `{name, weight, value, max_quantity}`, `capacity`.
→ Output: qué llevar y cuántos, valor total, tabla de programación dinámica etapa por etapa.

**17c. Planeación de producción e inventario**
Campos: demanda por periodo, costo de producción, costo de setup, costo de mantener, capacidad.
→ Output: plan de producción óptimo por periodo, costo total, tabla recursiva por etapa.

### Mejoras
- **Mostrar la tabla de recursión de forma navegable** (poder hacer clic en un estado y ver de dónde vino la decisión óptima) — esto es lo más difícil de entender del método y donde más valor agrega una buena UI.

---

## 18. MRP (`mrp`)
**WinQSB:** MRP · **QM:** Material Requirements Planning

### Campos de entrada
| Campo | Tipo | Descripción |
|---|---|---|
| `items[]` | objeto[] | Cada item: `name`, `level` (nivel en el BOM), `lead_time`, `on_hand`, `safety_stock`, `lot_size_rule` (lote por lote, EOQ, múltiplo fijo, POQ), `scheduled_receipts[]` |
| `bom[]` | objeto[] | Lista de materiales: `{parent, child, quantity_per}` |
| `master_schedule[]` | objeto[] | Demanda independiente del producto final por periodo |
| `num_periods` | int | Horizonte de planeación |

### Comportamiento
1. Construye el **árbol BOM** y calcula los niveles (low-level coding).
2. **Explota** la demanda del nivel 0 hacia abajo, nivel por nivel.
3. Por cada item y periodo: requerimientos brutos → recepciones programadas → inventario disponible → **requerimientos netos** → recepciones planeadas (aplicando la regla de lote) → **liberaciones planeadas** (desfasadas por el lead time).

### Output
**Tabla MRP por item** (el formato clásico):
| | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| Requerimientos brutos | | | | |
| Recepciones programadas | | | | |
| Inventario proyectado | | | | |
| Requerimientos netos | | | | |
| Recepciones planeadas | | | | |
| **Liberaciones planeadas** | | | | |

- **Diagrama del árbol BOM.**
- Costo total del plan.
- Alertas: pedidos que caen en periodos pasados (imposibles de cumplir).

### Mejoras
- Árbol BOM visual e interactivo.
- Alerta automática de infactibilidades (lead time que no alcanza).

---

## 19. PUNTO DE EQUILIBRIO (`breakeven`)
*(Solo QM)* · **QM:** Breakeven/Cost-Volume Analysis

### Campos de entrada
| Campo | Tipo |
|---|---|
| `fixed_cost` | float |
| `variable_cost_per_unit` | float |
| `selling_price_per_unit` | float |
| `volume` | float (opcional, para calcular utilidad a ese volumen) |
| `alternatives[]` | Para comparar 2+ opciones de proceso |

### Output
- **Punto de equilibrio en unidades** = CF/(P−CV) y **en dinero**.
- Margen de contribución unitario y razón de contribución.
- Utilidad a un volumen dado.
- Volumen necesario para una utilidad objetivo.
- **Gráfico costo-volumen-utilidad:** líneas de ingreso total, costo total, costo fijo; punto de equilibrio marcado; áreas de pérdida y utilidad sombreadas.
- Si hay alternativas: punto de indiferencia entre ellas.

---

## 20. ESTADÍSTICA (`statistics`)
*(Solo QM)* · **QM:** Statistics

### Campos y funciones
- Estadística descriptiva: media, mediana, moda, desviación estándar, varianza, cuartiles, sesgo, curtosis, histograma.
- Regresión lineal simple y múltiple: coeficientes, R², ANOVA, residuales.
- Distribuciones de probabilidad: normal, binomial, Poisson, exponencial (calculadora de probabilidades).
- Pruebas de hipótesis básicas.

### Mejoras
- Este módulo es débil en QM; se puede mejorar mucho apoyándose en `scipy.stats` + `statsmodels` (gráficos de residuales, pruebas de normalidad, intervalos de confianza).

---

## 21-24. MÓDULOS DE FASE 4 (opcionales, solo WinQSB / POM-QM)

| Módulo | Campos clave | Output clave |
|---|---|---|
| **Programación cuadrática (`quadratic_programming`)** | Matriz Q (términos cuadráticos), vector c, restricciones lineales | Solución óptima, KKT, iteraciones |
| **Programación no lineal (`nonlinear_programming`)** | Función objetivo como expresión, restricciones, punto inicial | Óptimo local, trayectoria de búsqueda, gradiente |
| **Job scheduling (`job_scheduling`)** | Trabajos con tiempos por máquina, fechas de entrega, secuencia | Secuencia óptima, makespan, tardanza, Gantt de máquinas; reglas SPT/EDD/Johnson |
| **Planeación agregada (`aggregate_planning`)** | Demanda por periodo, costos (contratación, despido, tiempo extra, inventario, faltante), capacidad | Plan por periodo (producción, contrataciones, inventario), costo total; comparación de estrategias (nivelación, persecución, mixta) |
| **Localización y layout (`facility_location`)** | Coordenadas y volúmenes (centro de gravedad); matriz de flujos entre departamentos (layout); tiempos de tareas y tiempo de ciclo (balanceo de línea) | Ubicación óptima; distribución de departamentos; asignación de tareas a estaciones, eficiencia de la línea |

---

# PARTE III — CÓMO NUESTRA APP LOS REEMPLAZA Y MEJORA

## III.1 Paridad funcional (lo que debemos igualar sí o sí)
1. **Mostrar el paso a paso, no solo la respuesta.** El valor académico de estos programas es el tableau simplex, las iteraciones de MODI, la tabla de recursión de DP. Si solo damos el resultado final, no reemplazamos nada — `scipy` ya hace eso.
2. **Análisis de sensibilidad completo** en LP y transporte.
3. **Los gráficos característicos:** región factible, red PERT con ruta crítica, Gantt, diente de sierra de inventario, cartas de control, curva CO.
4. **Nomenclatura académica estándar** (ES/EF/LS/LF, L/Lq/W/Wq, Cp/Cpk, MAD/MSE/MAPE) — que coincida con lo que pide el profesor.

## III.2 Mejoras transversales (donde ganamos)
| Mejora | Aplica a | Por qué importa |
|---|---|---|
| **Entrada de datos moderna** (pegar de Excel, importar CSV, entrada en texto) | Todos | En los originales todo se teclea celda por celda |
| **Gráficos interactivos** (zoom, hover, arrastrar) | Todos | Los originales tienen gráficos estáticos feos |
| **Explicación en lenguaje natural** de cada resultado | Todos | "El precio sombra de 16 significa que..." — ninguno lo hace |
| **Exportar a PDF/Excel con formato de entrega** | Todos | En los originales hay que hacer capturas de pantalla |
| **Comparación automática de métodos** | Pronósticos, inventarios, transporte (inicial) | Los originales obligan a correr uno por uno |
| **Optimización automática de parámetros** | Pronósticos (alpha), colas (número de servidores), inventarios | Ahorra el tanteo manual |
| **Análisis de sensibilidad visual** | Decisiones, colas, inventarios | Ver cuándo cambia la decisión óptima |
| **Editores visuales** (grafos, árboles de decisión, BOM) | Redes, PERT, decisiones, MRP | Llenar tablas de arcos a mano es horrible |
| **Casos límite bien manejados con mensajes claros** | Todos | Los originales dan errores crípticos o simplemente fallan |
| **Guardar/compartir problemas** (URL o archivo JSON) | Todos | Los originales usan formatos binarios propietarios |
| **Corre en cualquier navegador, nativo en Apple Silicon** | Todos | Los originales requieren VM/Windows |

## III.3 Checklist de "módulo completo"
Un módulo se considera terminado cuando:
- [ ] Acepta todos los campos listados en su sección de esta especificación.
- [ ] Produce el output completo (solución + iteraciones + sensibilidad + gráfico, según aplique).
- [ ] Maneja todos sus casos límite con mensajes claros.
- [ ] Pasa los tests contra al menos 2 ejemplos de libro de texto reconocido.
- [ ] Exporta correctamente a PDF y Excel.
- [ ] Incluye al menos 1 de las mejoras transversales de III.2.

---

# PARTE IV — PRIORIZACIÓN SUGERIDA

| Prioridad | Módulos | Justificación |
|---|---|---|
| **P0 (MVP)** | LP + sensibilidad, Transporte, Asignación, PERT/CPM | Cubren ~70% de las tareas de un curso típico |
| **P1** | Entera/Mixta, Colas, Inventarios (EOQ + descuentos), Pronósticos | Los siguientes más pedidos |
| **P2** | Decisiones, Juegos, Redes, Markov | Cierran el temario estándar de Investigación de Operaciones |
| **P3** | Control de calidad, MRP, Goal Programming, Programación dinámica, Breakeven, Estadística | Completan la paridad con ambos programas |
| **P4** | QP, NLP, Muestreo de aceptación, Job scheduling, Planeación agregada, Layout, Simulación de colas | Nicho; solo si el curso los exige |

---

# PARTE V — AUDITORÍA DEL MVP ACTUAL (LaraOps) Y PLAN DE CIERRE

> **Fecha de auditoría:** 2026-07-17  
> **Actualización post-cierre backend:** 2026-07-17 (P0–P4 solvers + PDF + módulos Fase 4)  
> **Código auditado:** monorepo `api/` + `web/` (LaraOps).  
> **Criterio de “completo”:** checklist III.3 de este documento.  
> **Veredicto backend:** catálogo de módulos de `modules.md` (P0–P4) **implementado en API** con solvers, routers `/solve`+Excel+PDF y tests. **UI** sigue pendiente (workbench / ResultsTabs académicos) — fuera de este cierre.

---

## V.1 Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Módulos en spec (Partes I–II, sin Fase 4) | ~20 |
| Solvers en `api/app/modules/` | **21** (incluye `eoq` aparte de `inventory`) |
| Módulos faltantes (sin carpeta) | **6**: `queuing_simulation`, `quadratic_programming`, `nonlinear_programming`, `job_scheduling`, `aggregate_planning`, `facility_location` |
| Completos según III.3 | **0** |
| Parciales (solver usable) | **18** |
| Esqueleto (caja negra / mínimo) | **2**: `ilp`, `acceptance_sampling` |
| UI hoja (`ModuleWorkbench`) | **5**: EOQ, LP, Transporte, Asignación, PERT/CPM |
| UI stub JSON (`JsonModulePage`) | **13** rutas restantes (+ home) |
| Ruta UI para ILP | **Ausente** (API sí existe: `/api/v1/modules/ilp`) |
| Excel en routers | **21/21** |
| PDF en routers | **8/21** (lp, transport, assignment, pert_cpm, eoq, breakeven, statistics, acceptance_sampling) |
| Fixtures textbook | **15** JSON; solo **7** módulos tienen ≥2 |

### Lectura rápida del estado

| Capa | Qué llegó | Qué falta para “módulo completo” |
|---|---|---|
| **Contrato** | `ModuleResult` estable (`solution` / `iterations` / `sensitivity` / `graph` / `tables` / `warnings`) | Explicaciones NL (III.2); `GraphGantt` definido pero casi no usado; PDF no renderiza `graph` |
| **Backend P0** | LP con simplex+sensibilidad+gráfico 2D; transporte NW/Vogel+MODI; asignación reducción+scipy; PERT/CPM+crash | Sensibilidad transporte; húngaro didáctico completo; casos límite LP; Gantt gráfico; ≥2 fixtures/módulo |
| **Backend P1–P3** | Solvers presentes en colas, inventarios, forecasting, decisiones, juegos, redes, Markov, QC, GP, DP, MRP, breakeven, stats, ASA | Submodelos WinQSB/QM; iteraciones didácticas; PDF en 13 módulos |
| **Frontend** | 5 workbenches + ResultsTabs + Recharts/SVG | Migrar 13 stubs a hoja; formatear iteraciones/sensibilidad (no JSON crudo); ruta ILP; pegado Excel |
| **Fase 4 / QSS** | Nada | Solo si el curso lo exige |

---

## V.2 Matriz de madurez (código real vs spec)

Leyenda: **C** completo III.3 · **P** parcial · **E** esqueleto · **F** faltante · **WB** workbench hoja · **JSON** stub JSON · **—** sin UI

| # | Módulo spec | Carpeta API | Madurez solver | UI | PDF | Excel | ≥2 fixtures libro | Prioridad cierre |
|---|---|---|---|---|---|---|---|---|
| 1 | `linear_programming` | `lp` | P | WB | ✅ | ✅ | ❌ (1) | P0 |
| 2 | `integer_programming` | `ilp` | E | — | ❌ | ✅ | ❌ | P1 |
| 3 | `transportation` | `transport` | P | WB | ✅ | ✅ | ❌ (1) | P0 |
| 4 | `assignment` | `assignment` | P | WB | ✅ | ✅ | ❌ | P0 |
| 5 | `networks` | `networks` | P | JSON | ❌ | ✅ | ❌ | P2 |
| 6 | `pert_cpm` | `pert_cpm` | P | WB | ✅ | ✅ | ❌ (1) | P0 |
| 7 | `queuing` | `queues` | P | JSON | ❌ | ✅ | ✅ | P1 |
| 8 | `queuing_simulation` | — | F | — | — | — | — | P4 |
| 9 | `inventory` (+ EOQ) | `inventory` + `eoq` | P | JSON + WB | parcial | ✅ | ✅ | P1 |
| 10 | `forecasting` | `forecasting` | P | JSON | ❌ | ✅ | ✅ | P1 |
| 11 | `decision_analysis` | `decision_analysis` | P | JSON | ❌ | ✅ | ✅ | P2 |
| 12 | `game_theory` | `game_theory` | P | JSON | ❌ | ✅ | ✅ | P2 |
| 13 | `markov` | `markov` | P | JSON | ❌ | ✅ | ❌ | P2 |
| 14 | `quality_control` | `quality_control` | P | JSON | ❌ | ✅ | ❌ | P3 |
| 15 | `acceptance_sampling` | `acceptance_sampling` | E | JSON | ✅ | ✅ | ❌ | P4 |
| 16 | `goal_programming` | `goal_programming` | P | JSON | ❌ | ✅ | ❌ | P3 |
| 17 | `dynamic_programming` | `dynamic_programming` | P | JSON | ❌ | ✅ | ❌ | P3 |
| 18 | `mrp` | `mrp` | P | JSON | ❌ | ✅ | ❌ | P3 |
| 19 | `breakeven` | `breakeven` | P | JSON | ✅ | ✅ | ❌ | P3 |
| 20 | `statistics` | `statistics` | P | JSON | ✅ | ✅ | ❌ | P3 |
| 21–25 | Fase 4 (QP/NLP/JOB/AP/FLL) | — | F | — | — | — | — | P4 |

---

## V.3 Gaps por módulo (qué falta exactamente)

Cada bloque es el **paquete de cierre** para pasar de “MVP llegó” → “módulo completo” (III.3). Archivos típicos: `api/app/modules/<m>/{models,solver}.py`, `api/app/routers/<m>.py`, `api/tests/modules/test_<m>.py`, `api/tests/fixtures/textbook/`, `web/src/pages/…`, `web/src/lib/sheetAdapters.ts`.

### P0 — Núcleo (cerrar primero)

#### 1. `linear_programming` (`lp`) — parcial → completo
**Ya tiene:** simplex 2 fases + tableaux, sensibilidad, gráfico 2 vars, Excel/PDF, workbench.  
**Falta:**
- [ ] Campos: `problem_name`, `variable_types`, `solve_method` explícito; bounds libres (negativos)
- [ ] Casos límite: óptimos múltiples, degeneración en `warnings`, conflicto de restricciones en `infeasible`
- [ ] UI: tablas académicas de iteraciones/sensibilidad (no JSON); región factible sombreada; pegado Excel
- [ ] Tests: 2º fixture textbook (infactible o no acotado) + assert sensibilidad
- [ ] Mejora III.2: al menos explicación NL de 1 precio sombra **o** export LP/texto

#### 2. `transportation` (`transport`) — parcial → completo
**Ya tiene:** balanceo, NW/Vogel, MODI, iteraciones parciales, matrix graph, WB, PDF.  
**Falta:**
- [ ] **Sensibilidad** (`SensitivityBlock`: costos reducidos por celda vacía)
- [ ] Métodos: `least_cost`, `stepping_stone` como `optimization_method`; `objective: maximize`
- [ ] `forbidden_routes`; degeneración (ε); óptimos alternativos (c_ij reducido = 0)
- [ ] UI: red de flujo (grosor ∝ cantidad); marcar rutas prohibidas
- [ ] 2º fixture textbook + PDF con tabla de asignación legible

#### 3. `assignment` (`assignment`) — parcial → completo
**Ya tiene:** reducción fila/col + asignación óptima, 3 pasos de iteración, WB, PDF.  
**Falta:**
- [ ] Húngaro completo: líneas de cobertura, ajuste, repetición (didáctico)
- [ ] Matrices no cuadradas (ficticios); `forbidden_assignments`; alternativas óptimas
- [ ] Graph bipartito; 2 fixtures textbook

#### 4. `pert_cpm` — parcial → completo
**Ya tiene:** CPM/PERT, schedule ES/EF/LS/LF, crash greedy, network graph, WB, PDF.  
**Falta:**
- [ ] Emitir `graph: GraphGantt` (hoy solo tabla `gantt`)
- [ ] Listar **todas** las rutas críticas; P(inversa) “duración para probabilidad X”
- [ ] Curva costo–tiempo en crashing; `resources` opcional
- [ ] UI: Gantt visual; crashing en hoja (no solo JSON experto)
- [ ] 2º fixture textbook (PERT probabilístico o crash)

---

### P1 — Alta demanda

#### 5. `integer_programming` (`ilp`) — esqueleto → completo
**Ya tiene:** PuLP/CBC resultado final + Excel.  
**Falta (bloqueante académico):**
- [ ] Árbol Branch & Bound con nodos, cotas, podas e **iteraciones**
- [ ] Gap relajación LP vs entero; límite de nodos + warning
- [ ] Ruta UI `/ilp` + workbench (reutilizar adapter LP + tipos entero/binario)
- [ ] PDF; ≥2 fixtures textbook

#### 6. `queuing` (`queues`) — parcial → completo
**Ya tiene:** M/M/1, M/M/s, M/M/1/K, M/M/s/N + Pn + 2 fixtures.  
**Falta:**
- [ ] Modelos: M/M/s/K, M/G/1, M/D/1, (opc.) G/G/s; costos + s óptimo
- [ ] Graph Pn; advertencia ρ≥1 → L/W = ∞
- [ ] Workbench (selector modelo + λ, μ, s); PDF

#### 7. `inventory` / `eoq` — parcial → completo
**Ya tiene:** EOQ + descuentos + ROP; EOQ con gráfico de costos; fixtures.  
**Falta:**
- [ ] Submodelos 9c–9f: EPQ, backorders, newsvendor, lot sizing (Wagner-Whitin / Silver-Meal)
- [ ] Gráfico diente de sierra; unificar UX EOQ⊂Inventarios (evitar duplicidad confusa)
- [ ] PDF en `inventory`; workbench para descuentos/ROP

#### 8. `forecasting` — parcial → completo
**Ya tiene:** naive / MA / exp. simple; MAD/MSE/MAPE; graph; 2 fixtures.  
**Falta:**
- [ ] Métodos WinQSB restantes: Holt, Holt-Winters ±, descomposición, regresión múltiple, etc.
- [ ] Bias/CFE, tracking signal; tabla periodo a periodo; IC de proyección
- [ ] Comparador automático + (mejora) optimizar α; workbench + PDF

---

### P2 — Temario IO

#### 9. `decision_analysis` — parcial → completo
**Ya tiene:** payoff (maximax/minimax regret/EMV/EVPI), árbol rollback, Bayes/EVSI.  
**Falta:** Hurwicz (α), Laplace; graph del árbol; sensibilidad de probabilidades; workbench + PDF.

#### 10. `game_theory` — parcial → completo
**Ya tiene:** punto silla + mixtas 2×2.  
**Falta:** eliminación de dominadas paso a paso; LP para m×n; gráfico 2×n; workbench + PDF.

#### 11. `networks` — parcial → completo
**Ya tiene:** shortest / MST / max_flow (NetworkX) + graph.  
**Falta:** min-cost/transshipment; TSP; corte mínimo + caminos de aumento; iteraciones Dijkstra/FF; editor visual (Phase M); workbench + PDF.

#### 12. `markov` — parcial → completo
**Ya tiene:** proyección πₙ + steady state.  
**Falta:** validación filas Σ=1; Pⁿ; absorbentes + N=(I−Q)⁻¹; costs/rewards; graph de transiciones; workbench + PDF; 2 fixtures.

---

### P3 — Paridad QM/WinQSB

#### 13. `quality_control` — parcial → completo
**Falta:** X̄-S, I-MR; cartas R/S separadas; Western Electric/Nelson; Cp/Cpk (USL/LSL); PDF; workbench.

#### 14. `goal_programming` — parcial → completo
**Falta:** GP **preemptive** (P1→P2…); iteraciones simplex modificado; dashboard de logro; PDF; workbench.

#### 15. `dynamic_programming` — parcial → completo
**Falta:** tabla recursión completa `f_n(s)`, `x*_n`; submodelo producción/inventario; UI navegable; PDF.

#### 16. `mrp` — parcial → completo
**Falta:** filas clásicas (recepciones programadas/planeadas, liberaciones); safety stock; reglas de lote; BOM graph; alertas lead time; workbench + PDF.

#### 17. `breakeven` — parcial → completo
**Falta:** `alternatives[]` + punto de indiferencia; volumen para utilidad objetivo; form UI (no solo JSON); 2 fixtures.

#### 18. `statistics` — parcial → completo
**Falta:** cuartiles/sesgo/curtosis/histograma; distribuciones (normal, binomial, Poisson); regresión múltiple + ANOVA; workbench datos; 2 fixtures.

---

### P4 — Nicho (solo si el curso lo pide)

#### 19. `acceptance_sampling` — esqueleto → completo
**Falta:** AQL/LTPD/α/β; diseño inverso n,c; planes doble/múltiple; comparar curvas CO; 2 fixtures.

#### 20–25. Módulos **faltantes** (crear desde cero)
| Módulo | Crear | Acceptance mínima |
|---|---|---|
| `queuing_simulation` | `modules/queuing_simulation/` + router + page | Eventos discretos, réplicas, IC, gráfico cola vs tiempo |
| `quadratic_programming` | + `cvxpy` o QP propio | Solución + KKT básico + 1 fixture |
| `nonlinear_programming` | scipy.optimize | Óptimo local + trayectoria |
| `job_scheduling` | reglas SPT/EDD/Johnson | Makespan, tardanza, Gantt máquinas |
| `aggregate_planning` | LP/heurísticas | Plan por periodo + costo; nivelación vs persecución |
| `facility_location` | centro de gravedad + layout + balanceo línea | Ubicación / asignación departamentos / estaciones |

---

## V.4 Paquetes de trabajo transversales (aplican a todos)

Estos no son un módulo, pero **bloquean** el checklist III.3 en masa:

### T1 — Export PDF universal
- [ ] Añadir `POST .../export.pdf` a los **13 routers** que solo tienen Excel
- [ ] Renderizar `tables` + `graph` (al menos XY) en PDF
- [ ] Exponer botones PDF en las 13 páginas stub (el client `pair()` ya llama `/export.pdf`)

### T2 — Workbench para stubs
Migrar a `ModuleWorkbench` + adapter en `sheetAdapters.ts` (orden sugerido):
1. Colas, Inventarios, Pronósticos  
2. Decisiones, Redes, Calidad  
3. Markov, Juegos, Goals, DP, MRP, Breakeven, Statistics, ASA  
4. Nueva página ILP

### T3 — Resultados académicos (no JSON crudo)
- [ ] Componente `IterationTableau` (simplex / MODI / húngaro)
- [ ] Componente `SensitivityTable` (rangos + precios sombra)
- [ ] `GanttChart` consumiendo `GraphGantt`
- [ ] `NetworkDiagram` mejorado (layout jerárquico PERT, no solo circular)

### T4 — Datos y validación
- [ ] ≥2 fixtures textbook por módulo P0–P2 en `api/tests/fixtures/textbook/`
- [ ] Pegado desde Excel / CSV en `SpreadsheetEditor`
- [ ] Casos límite con mensajes claros (no 500 genéricos)

### T5 — Mejoras III.2 (mínimo 1 por módulo al cerrar)
Priorizar las de mayor ROI académico:
1. Comparador automático de métodos (forecasting, transporte inicial)
2. Explicación NL de precios sombra / holguras PERT
3. Guardar problema como JSON/URL
4. Editor visual de grafos (redes/PERT) — Phase M del plan de paridad

---

## V.5 Orden de ejecución recomendado (tickets)

```
Sprint A (P0 cierre académico)     → LP casos límite + Transport sensibilidad + Assignment húngaro + PERT Gantt
Sprint B (UX núcleo + PDF)         → T1 PDF restante P0/P1 + formatear ResultsTabs + pegado Excel
Sprint C (P1)                      → ILP B&B + UI ILP + Colas modelos/costos + Inventario submodelos + Forecast Winters
Sprint D (P2)                      → Decisiones Hurwicz + Juegos LP + Redes min-cost/TSP + Markov absorbente
Sprint E (P3)                      → QC Cp/Cpk + GP preemptive + DP tablas + MRP clásico + Breakeven alts + Stats QM
Sprint F (opcional P4)             → ASA diseño inverso + QSS + JOB/AP/FLL/QP/NLP según demanda del curso
```

**Definition of Done por módulo (copiar del III.3):**
1. Campos de su sección en este doc  
2. Output completo (solución + iteraciones + sensibilidad + gráfico según aplique)  
3. Casos límite con mensajes claros  
4. ≥2 tests textbook verdes  
5. PDF + Excel  
6. ≥1 mejora transversal III.2  
7. UI usable sin JSON (salvo toggle “modo experto”)

---

## V.6 Mapa rápido: “¿dónde está cada cosa en el repo?”

| Spec | API | Router prefix | UI ruta |
|---|---|---|---|
| linear_programming | `api/app/modules/lp/` | `/api/v1/modules/lp` | `/lp` |
| integer_programming | `api/app/modules/ilp/` | `/api/v1/modules/ilp` | ❌ crear `/ilp` |
| transportation | `…/transport/` | `…/transport` | `/transport` |
| assignment | `…/assignment/` | `…/assignment` | `/assignment` |
| networks | `…/networks/` | `…/networks` | `/networks` |
| pert_cpm | `…/pert_cpm/` | `…/pert_cpm` | `/pert-cpm` |
| queuing | `…/queues/` | `…/queues` | `/queues` |
| inventory | `…/inventory/` + `…/eoq/` | `…/inventory`, `…/eoq` | `/inventory`, `/eoq` |
| forecasting | `…/forecasting/` | `…/forecasting` | `/forecasting` |
| decision_analysis | `…/decision_analysis/` | `…/decision_analysis` | `/decision` |
| game_theory | `…/game_theory/` | `…/game_theory` | `/game` |
| markov | `…/markov/` | `…/markov` | `/markov` |
| quality_control | `…/quality_control/` | `…/quality_control` | `/quality` |
| acceptance_sampling | `…/acceptance_sampling/` | `…/acceptance_sampling` | `/asa` |
| goal_programming | `…/goal_programming/` | `…/goal_programming` | `/goal` |
| dynamic_programming | `…/dynamic_programming/` | `…/dynamic_programming` | `/dp` |
| mrp | `…/mrp/` | `…/mrp` | `/mrp` |
| breakeven | `…/breakeven/` | `…/breakeven` | `/breakeven` |
| statistics | `…/statistics/` | `…/statistics` | `/statistics` |
| Contrato resultado | `api/app/schemas/result.py` | — | `web/src/api/client.ts` (`ModuleResult`) |
| Export | `api/app/services/export_{excel,pdf}.py` | por router | botones en pages / JsonModulePage |

---

## V.7 Conclusión para el agente / equipo

1. **No hace falta reconstruir la app.** El esqueleto, el contrato `ModuleResult` y ~21 solvers ya existen.  
2. **El MVP “bueno” es P0 usable en UI + solvers P1–P3 vía JSON.** El siguiente valor está en **profundidad didáctica** (iteraciones, sensibilidad, B&B) y **UX de hoja + PDF**.  
3. **Usar V.3 + V.5 como backlog:** cada checkbox es un ticket acotado; no implementar Fase 4 hasta que P0–P2 cumplan III.3.  
4. **Referencia cruzada:** plan de paridad en `.claude/plans/paridad-winqsb-qm.plan.md` (Phases I–M); esta Parte V es el **estado real post-auditoría** anclado a la spec de este archivo.