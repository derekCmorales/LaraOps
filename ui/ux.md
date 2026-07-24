# ESPECIFICACIÓN UI/UX — Frontend
## App de Investigación de Operaciones (reemplazo de WinQSB + QM for Windows)

> Documento de dirección de diseño e interacción para el agente de desarrollo. Define principios, tokens, arquitectura de información, layout, componentes y flujos. El agente puede proponer ajustes de implementación, pero la **tesis de diseño** (sección 1) y el **sistema de tokens** (sección 2) son la base a respetar para que la app no se sienta como 22 herramientas sueltas.

---

## 1. Tesis de diseño

### 1.1 El problema con los originales
WinQSB y QM for Windows son gris sobre gris. Todo tiene el mismo peso visual: el dato que importa, el que no, el resultado óptimo, el ruido. El usuario tiene que **buscar** la información en la pantalla. Eso no es un problema de "se ven viejos" — es un problema funcional: en una tabla simplex de 8×12, si nada está jerarquizado, el usuario no encuentra la celda pivote.

### 1.2 La regla que define esta app

> **El color es semántica matemática, nunca decoración.**

En esta app, si algo tiene color, es porque significa algo:
- Rojo/magenta = ruta crítica, celda pivote, restricción activa, punto fuera de control.
- Ámbar = advertencia matemática (degeneración, óptimos múltiples, sistema inestable).
- Cian = variable básica, arco con flujo, valor óptimo.
- Todo lo demás vive en tinta sobre papel.

Esto significa que **la interfaz es casi monocromática por defecto**, y el color aparece solo donde hay información. Un usuario debe poder aprender a leer los resultados por el color, no por leer las etiquetas. Esa restricción es la disciplina central del diseño y aplica a los 22 módulos por igual.

### 1.3 El héroe es el tableau
No hay hero image, no hay gradientes, no hay tarjetas flotantes con sombras. **El dato es el héroe.** La pantalla de resultados es el producto; todo lo demás (navegación, entrada de datos) existe para llegar ahí rápido y salirse del camino.

### 1.4 Elemento firma: el *pivot trail*
Lo que hace memorable esta app y que ningún competidor tiene: el **visor de iteraciones sincronizado**. Un rail izquierdo persistente muestra el estado del algoritmo (variable que entra, variable que sale, valor de Z) mientras la tabla principal transiciona de una iteración a la siguiente, con la celda pivote trazando su camino. El usuario puede *scrubbear* las iteraciones con una barra tipo línea de tiempo (o las flechas del teclado) y ver el algoritmo moverse.

Esto aplica al simplex, a MODI en transporte, al método húngaro, al árbol de branch & bound y a la tabla de recursión de programación dinámica. Es el mismo componente reutilizado, y es donde se gasta toda la audacia del diseño. Todo lo demás se mantiene disciplinado y callado.

---

## 2. Sistema de tokens

### 2.1 Color

```css
/* Tinta y papel — base fría azulada (no gris neutro) */
--ink-900:  #0A1628;   /* texto principal — navy profundo */
--ink-600:  #3D5270;   /* texto secundario */
--ink-400:  #7A8FA8;   /* texto terciario, placeholders */
--ink-200:  #C8D4E4;   /* bordes de tabla */
--ink-100:  #E8EEF6;   /* fondo de encabezado de tabla, zebra */
--paper:    #F5F8FC;   /* fondo de la app — papel azul frío */
--paper-raised: #FFFFFF; /* fondo de superficies elevadas */

/* Semántica matemática — el ÚNICO color de la app */
--pivot:    #C4166B;   /* magenta plotter: celda pivote, ruta crítica, restricción activa */
--basic:    #0A6B9A;   /* azul técnico: variable básica, flujo, valor óptimo */
--warn:     #B06A00;   /* ámbar quemado: degeneración, múltiples óptimos, inestabilidad */
--error:    #9B1C1C;   /* infactible, no acotado, error de validación */
--muted-fill: #EBF1F8; /* relleno suave azul — región factible, holgura */
```

**Justificación de la paleta:** la base es **papel azul frío** (tinta navy sobre cian muy diluido), no gris de WinQSB. Los colores semánticos siguen siendo **tintas de plóter**: magenta, azul técnico y ámbar quemado. Se usan puros, planos, sin gradiente, sin transparencia.

**Prohibido:** gradientes, sombras de color, color en botones primarios (los botones son tinta sobre papel o papel sobre tinta), color en la navegación, color decorativo de cualquier tipo. **Prohibido editar datos en JSON** — la entrada es siempre formulario, cuadrícula o texto del modelo.

### 2.2 Tipografía

| Rol | Familia | Uso |
|---|---|---|
| **Display** | `Sora` (700/800) | Nombre del módulo, títulos de pantalla, valor de Z en resultados. Geométrica y técnica, sin ser Inter/Archivo genérico. |
| **UI / cuerpo** | `Manrope` (400/500/600) | Etiquetas, botones, texto explicativo, tooltips. Alta legibilidad en densidad de datos. |
| **Datos** | `IBM Plex Mono` (400/500) | **Todo número que viva en una tabla o cuadrícula.** Cifras tabulares obligatorias (`font-variant-numeric: tabular-nums`). |

**Regla no negociable:** ningún número dentro de una tabla usa fuente proporcional. Las columnas numéricas se alinean por el punto decimal. Esta es la diferencia entre una tabla que se lee y una que se descifra.

```css
/* Escala tipográfica */
--text-display: 2.5rem / 1.05  /* Sora 800 */
--text-h1:      1.75rem / 1.2
--text-h2:      1.25rem / 1.3
--text-body:    0.9375rem / 1.5
--text-label:   0.8125rem / 1.4   /* uppercase, letter-spacing 0.06em */
--text-data:    0.875rem / 1.45   /* IBM Plex Mono, tabular-nums */
--text-caption: 0.75rem / 1.4
```

### 2.3 Espaciado, bordes, radio

```css
--space: 4px;  /* escala base: 4, 8, 12, 16, 24, 32, 48, 64 */

--radius-sm: 3px;   /* inputs, botones */
--radius-md: 5px;   /* paneles */
/* Tablas: radio 0. Una cuadrícula de cálculo tiene esquinas rectas. */

--border: 1px solid var(--ink-200);
--border-strong: 1px solid var(--ink-400);  /* separación de secciones en tablas */
--border-pivot: 2px solid var(--pivot);
```

**Sin sombras**, salvo una sola: `--shadow-overlay` para modales y dropdowns (`0 8px 24px rgba(18,22,28,0.12)`). Las tarjetas no flotan; se delimitan con borde.

---

## 3. Arquitectura de información

```
Lara [nombre de la app]
│
├── Inicio — selector de módulos
│
├── /modulo/:slug
│   ├── Datos       (entrada)
│   └── Resultados  (salida, con pestañas)
│
└── /guardados      (problemas guardados localmente)
```

Plano y sin jerarquía profunda. **Dos pantallas por módulo: Datos y Resultados.** Todo lo demás es ruido.

### 3.1 Agrupación de módulos en el selector

Los 22 módulos se agrupan por **tipo de problema**, no por el programa original del que vienen (el usuario no piensa "esto era de WinQSB"):

| Grupo | Módulos |
|---|---|
| **Optimización** | Programación lineal · Programación entera · Programación por metas · Programación cuadrática · Programación no lineal |
| **Redes y flujo** | Transporte · Asignación · Redes (ruta, árbol, flujo máx.) · Agente viajero |
| **Proyectos** | PERT/CPM · Programación de tareas |
| **Aleatoriedad y espera** | Teoría de colas · Simulación de colas · Cadenas de Markov |
| **Inventarios y producción** | Inventarios · MRP · Planeación agregada · Localización y layout |
| **Predicción y decisión** | Pronósticos · Análisis de decisiones · Teoría de juegos |
| **Calidad y estadística** | Control de calidad · Muestreo de aceptación · Estadística · Punto de equilibrio |

---

## 4. Layout maestro

### 4.1 Pantalla de inicio (selector de módulos)

```
┌──────────────────────────────────────────────────────────────┐
│ LARA                                        Guardados   ⌘K   │  ← barra, 56px, borde inferior
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ¿Qué necesitas resolver?                                    │  ← display, alineado izquierda
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ 🔍 Busca un método o describe tu problema…          │     │  ← campo de búsqueda, foco automático
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  OPTIMIZACIÓN                                                │  ← eyebrow, uppercase, ink-400
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ Programación │ Programación │ Programación │             │
│  │ lineal       │ entera       │ por metas    │             │
│  │              │              │              │             │
│  │ Simplex,     │ Branch and   │ Metas con    │             │
│  │ sensibilidad │ bound        │ prioridades  │             │
│  └──────────────┴──────────────┴──────────────┘             │
│                                                              │
│  REDES Y FLUJO                                               │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ …            │ …            │ …            │             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Detalle del campo de búsqueda:** no solo filtra por nombre de módulo, también por **método** ("Vogel", "húngaro", "Holt-Winters", "EOQ", "ruta crítica") y por **sinónimo académico** ("cola" → Teoría de colas, "árbol de decisión" → Análisis de decisiones). El usuario que llega con una tarea no sabe cómo se llama el módulo; sabe cómo lo llamó el profesor. **Esta es la mejora #1 sobre los originales**, donde hay que saber de antemano qué módulo abrir.

**Tarjeta de módulo:** nombre (Public Sans 600) + una línea con los métodos que incluye (ink-400, caption). Sin iconos. Sin color. Hover: el borde pasa a `--ink-400` y aparece una flecha. Nada más.

### 4.2 Pantalla de módulo — Datos

```
┌──────────────────────────────────────────────────────────────┐
│ ← LARA / Optimización / Programación lineal        Guardar   │
├──────────────────────────────────────────────────────────────┤
│ ┌── Datos ──┬── Resultados ──┐                               │  ← pestañas; Resultados deshabilitada hasta resolver
│ │           │                                                 │
│ │  ┌─ Configuración ──────────────────────────┐              │
│ │  │ Objetivo:  (•) Maximizar  ( ) Minimizar   │              │
│ │  │ Variables: [ 2 ]   Restricciones: [ 3 ]   │              │
│ │  │ Método:    [ Simplex ▾ ]                  │              │
│ │  └───────────────────────────────────────────┘              │
│ │                                                             │
│ │  ┌─ Modelo ────────────────── [Cuadrícula|Texto] ─┐        │  ← toggle de modo de entrada
│ │  │                                                 │        │
│ │  │           X1      X2      op      RHS          │        │
│ │  │  Max      40      50                           │        │
│ │  │  C1        1       2      ≤       40           │        │
│ │  │  C2        4       3      ≤      120           │        │
│ │  │  C3        1       0      ≥        5           │        │
│ │  │                                                 │        │
│ │  │  + Agregar restricción    + Agregar variable   │        │
│ │  └─────────────────────────────────────────────────┘        │
│ │                                                             │
│ │  Vista previa del modelo                                    │  ← se actualiza en vivo
│ │  Max Z = 40X₁ + 50X₂                                        │
│ │  s.a.  X₁ + 2X₂ ≤ 40                                        │
│ │        4X₁ + 3X₂ ≤ 120                                      │
│ │        X₁ ≥ 5                                               │
│ │        X₁, X₂ ≥ 0                                           │
│ │                                                             │
│ │                              [ Cargar ejemplo ] [ Resolver ]│  ← barra fija abajo
│ └─────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────┘
```

**Decisiones clave:**

1. **Doble modo de entrada — Cuadrícula / Texto.** La cuadrícula replica lo que el usuario conoce de WinQSB/QM. El modo Texto permite escribir el modelo directamente (`Max 40x1 + 50x2 s.t. x1 + 2x2 <= 40; ...`) o **pegar desde Excel/PDF de la tarea**. Los dos modos están sincronizados en vivo: cambias uno, el otro se actualiza. Ninguno de los dos programas originales tiene esto y es lo que más tiempo ahorra en la práctica.

2. **Vista previa del modelo en notación matemática, en vivo.** El usuario ve el modelo formateado como lo escribiría a mano *antes* de resolver. Esto atrapa el 90% de los errores de captura, que es donde realmente se pierde tiempo. En los originales, si te equivocas en un signo, te enteras cuando el resultado sale absurdo.

3. **La cuadrícula se comporta como Excel.** Tab/Enter/flechas para navegar, pegar rangos, escribir sobre la celda seleccionada sin entrar en modo edición. Si el usuario viene de WinQSB, sus dedos ya saben esto.

4. **"Cargar ejemplo"** trae un problema clásico de libro de texto resuelto (el de Beaver Creek Pottery para LP, etc.). Sirve para aprender la interfaz y para verificar que la app funciona. Los originales incluían ejemplos; nosotros también, pero accesibles en un clic.

### 4.3 Pantalla de módulo — Resultados

```
┌──────────────────────────────────────────────────────────────┐
│ ← LARA / Optimización / Programación lineal    Exportar ▾    │
├──────────────────────────────────────────────────────────────┤
│ ┌── Datos ──┬── Resultados ──┐                               │
│ │                                                             │
│ │  ● Óptimo encontrado                    Z = 1,360.00        │  ← banda de estado + valor, display
│ │                                                             │
│ │  [ Solución ][ Iteraciones ][ Sensibilidad ][ Gráfico ]     │  ← sub-pestañas
│ │  ─────────────                                              │
│ │                                                             │
│ │  VARIABLES                                                  │
│ │  ┌────────┬──────────┬───────────────┬─────────────┐       │
│ │  │Variable│    Valor │ Costo reducido│ Coef. obj.  │       │
│ │  ├────────┼──────────┼───────────────┼─────────────┤       │
│ │  │ X₁     │    24.00 │          0.00 │       40.00 │       │  ← mono, tabular, alineado al decimal
│ │  │ X₂     │     8.00 │          0.00 │       50.00 │       │
│ │  └────────┴──────────┴───────────────┴─────────────┘       │
│ │                                                             │
│ │  RESTRICCIONES                                              │
│ │  ┌────────┬─────────┬─────────┬──────────┬──────────┐      │
│ │  │Restric.│ Lado izq│    RHS  │  Holgura │ P. sombra│      │
│ │  ├────────┼─────────┼─────────┼──────────┼──────────┤      │
│ │  │ C1     │   40.00 │   40.00 │     0.00 │    16.00 │ ●    │  ← ● = activa (color --pivot)
│ │  │ C2     │  120.00 │  120.00 │     0.00 │     6.00 │ ●    │
│ │  │ C3     │   24.00 │    5.00 │    19.00 │     0.00 │      │
│ │  └────────┴─────────┴─────────┴──────────┴──────────┘      │
│ │                                                             │
│ │  ┌─ Qué significa ─────────────────────────────────┐       │
│ │  │ Las restricciones C1 y C2 están activas: todo el │       │
│ │  │ recurso se consume. Una unidad más de C1 aumenta │       │
│ │  │ Z en 16.00, válido hasta un RHS de 60.00.        │       │
│ │  └─────────────────────────────────────────────────┘       │
│ └─────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────┘
```

**Decisiones clave:**

1. **La banda de estado es lo primero.** Óptimo / Infactible / No acotado / Degenerado, con el valor objetivo en tipografía display al lado. El usuario sabe en 300ms si el problema salió o no.

2. **El panel "Qué significa".** Traducción a lenguaje natural del resultado, generada desde los datos (no con IA — con plantillas deterministas alimentadas por el output del solver). Ningún programa original hace esto y es donde más se pierde el estudiante: sabe que el precio sombra es 16, no sabe qué hacer con ese 16. Este panel aparece en **todos** los módulos, adaptado a su contenido.

3. **Las sub-pestañas son estándar en todos los módulos** (Solución / Iteraciones / Sensibilidad / Gráfico). Si un módulo no tiene alguna, simplemente no aparece — pero el orden nunca cambia. El usuario aprende la app una vez.

### 4.4 Sub-pestaña Iteraciones — el elemento firma

```
┌──────────────────────────────────────────────────────────────┐
│  [ Solución ][ Iteraciones ][ Sensibilidad ][ Gráfico ]      │
│               ──────────────                                 │
│                                                              │
│  ┌─ Estado ────┐  ┌─ Tabla simplex ─────────────────────┐   │
│  │             │  │                                      │   │
│  │ Iteración   │  │      Cj    40   50    0    0    0   │   │
│  │   2 de 3    │  │  Base  Xb   X₁   X₂   S₁   S₂   S₃  │   │
│  │             │  │  ──────────────────────────────────  │   │
│  │ Entra:  X₂  │  │  S₁    40    1  [2]    1    0    0  │   │  ← [2] = celda pivote, borde magenta
│  │ Sale:   S₁  │  │  S₂   120    4    3    0    1    0  │   │
│  │             │  │  S₃     5    1    0    0    0   -1  │   │
│  │ Pivote: 2   │  │  ──────────────────────────────────  │   │
│  │             │  │  Zj−Cj  0  -40  -50    0    0    0  │   │  ← columna entrante resaltada
│  │ Z = 1,000   │  │                ↑                     │   │
│  │             │  │           más negativa               │   │
│  │ ┌─────────┐ │  └──────────────────────────────────────┘   │
│  │ │Por qué? │ │                                             │
│  │ │X₂ tiene │ │  ◀ ═══●═══════ ▶     Iteración 2 de 3      │  ← scrubber / línea de tiempo
│  │ │el Zj−Cj │ │     1   2   3                               │
│  │ │más neg. │ │                                             │
│  │ └─────────┘ │  [ ⏵ Reproducir ]  [ Ver todas ]           │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
```

**Cómo funciona:**
- **Scrubber**: arrastra o usa `←`/`→` para moverte entre iteraciones. La tabla hace *cross-fade* de 180ms entre estados; **las celdas que cambiaron de valor parpadean brevemente en `--basic`**. El usuario ve *qué* cambió, no solo el resultado.
- **Rail de estado izquierdo**: siempre visible, muestra variable entrante, saliente, elemento pivote, valor de Z, y un micro-panel "¿Por qué?" que explica la regla aplicada en ese paso (criterio de entrada, razón mínima para la salida).
- **Reproducir**: anima toda la secuencia, 1.2s por iteración. Para presentar en clase o entender el flujo completo de un vistazo.
- **Ver todas**: cambia a vista de lista con todas las tablas apiladas (útil para exportar a PDF y entregar la tarea con todo el procedimiento).
- **Este mismo componente** sirve para MODI (celda entrante + ciclo de ajuste resaltado), método húngaro (líneas de cobertura animadas), branch & bound (el rail muestra el nodo actual y la tabla muestra su relajación), y programación dinámica (el rail muestra la etapa, la tabla la recursión).

`prefers-reduced-motion` desactiva todas las transiciones; el scrubber sigue funcionando con cambios instantáneos.

### 4.5 Sub-pestaña Gráfico (varía por módulo)

| Módulo | Visualización |
|---|---|
| LP (2 var) | Región factible (`--muted-fill`), restricciones como rectas etiquetadas, vértices marcados, línea de nivel de Z arrastrable, óptimo en `--pivot` |
| Transporte / Redes | Grafo con grosor de arco ∝ flujo; arcos con flujo en `--basic`, arcos sin flujo en `--ink-200` |
| PERT/CPM | Diagrama de red (react-flow) con ruta crítica en `--pivot` + Gantt con holgura sombreada |
| Colas | Curva de Lq/Wq vs. número de servidores, con el óptimo de costo marcado |
| Inventarios | Diente de sierra + curva de costos (ordenar/mantener/total) cruzándose en Q* |
| Pronósticos | Serie real (`--ink-900`) vs. ajustada (`--basic`) vs. proyección (`--basic` punteado) |
| Control de calidad | Carta con LCS/LC/LCI; puntos fuera de control en `--pivot` |
| Markov | Diagrama de estados + evolución de la distribución |
| Decisiones | Árbol con ramas óptimas en `--pivot` |

**Regla común:** todo gráfico es interactivo (hover muestra el valor exacto en mono), exportable como PNG/SVG, y **usa exactamente los mismos tokens semánticos de color**. Un usuario que aprendió que magenta = crítico en PERT lo reconoce en la carta de control.

---

## 5. Componentes comunes (contrato del design system)

| Componente | Responsabilidad | Se usa en |
|---|---|---|
| `<ModuleShell>` | Barra superior, breadcrumb, pestañas Datos/Resultados, barra de acción inferior | Todos los módulos |
| `<DataGrid>` | Cuadrícula editable tipo Excel: pegar, navegar con teclado, validar por celda | Todos los módulos de entrada matricial |
| `<TextModelInput>` | Entrada del modelo en texto + parser + sincronización con la cuadrícula | LP, ILP, Goal Programming |
| `<ModelPreview>` | Renderiza el modelo en notación matemática en vivo | LP, ILP, GP, QP, NLP |
| `<StatusBand>` | Banda de estado (óptimo/infactible/…) + valor objetivo | Todos |
| `<SolutionTable>` | Tabla de resultados con mono tabular y alineación decimal | Todos |
| `<IterationsViewer>` | **El elemento firma**: rail de estado + tabla + scrubber + reproducir | LP, ILP, transporte, asignación, DP |
| `<SensitivityTable>` | Rangos de optimalidad / factibilidad, precios sombra, costos reducidos | LP, ILP, transporte |
| `<Explainer>` | Panel "Qué significa": traducción a lenguaje natural del resultado | Todos |
| `<NetworkCanvas>` | Editor + visor de grafos (react-flow) | Redes, transporte, PERT, Markov, decisiones |
| `<ChartFrame>` | Contenedor estándar de gráficos con leyenda, hover y export | Todos los que grafican |revi
| `<ExportMenu>` | PDF (reporte completo) / Excel / PNG | Todos |
| `<ExampleLoader>` | Carga un problema de libro de texto en la cuadrícula | Todos |

**Regla de extensión:** agregar un módulo nuevo no debe requerir crear componentes nuevos, salvo su gráfico específico. Si un módulo necesita un componente común nuevo, es señal de que hay que generalizar, no de que hay que hacer una excepción.

---

## 6. Flujos de interacción clave

### 6.1 Flujo principal (el que se optimiza para velocidad)
```
Inicio → busca "vogel" → tarjeta Transporte → cuadrícula → pega matriz de costos
      → Resolver → Resultados/Solución → Iteraciones → Exportar PDF
```
**Objetivo: menos de 90 segundos** desde abrir la app hasta tener el PDF de una tarea de transporte 4×5. Cada fricción en este camino es un bug de diseño.

### 6.2 Flujo de verificación (el segundo caso de uso real)
El usuario ya resolvió la tarea a mano y quiere comprobar. Necesita **comparar su tabla con la nuestra**, iteración por iteración. Por eso el scrubber y la vista "Ver todas" existen: no es una animación bonita, es la función central para este flujo.

### 6.3 Flujo de aprendizaje
El usuario no entiende el método. Usa "Cargar ejemplo" → Reproducir en Iteraciones → lee los micro-paneles "¿Por qué?" → lee "Qué significa" en la solución.

### 6.4 Atajos de teclado (todos los módulos)
| Tecla | Acción |
|---|---|
| `⌘K` / `Ctrl+K` | Buscador de módulos desde cualquier pantalla |
| `⌘↵` / `Ctrl+↵` | Resolver |
| `←` `→` | Navegar iteraciones (en la pestaña Iteraciones) |
| `⌘E` | Abrir menú de exportación |
| `Tab` / `↵` / flechas | Navegación de la cuadrícula (comportamiento Excel) |
| `⌘V` | Pegar rango desde Excel en la cuadrícula |

---

## 7. Estados: vacío, cargando, error

### 7.1 Cargando
La mayoría de problemas se resuelven en <100ms. **No mostrar spinner para nada bajo 400ms** — un spinner que parpadea se siente más lento que ningún spinner. Para simulaciones largas (Monte Carlo, colas): barra de progreso determinada con el número de réplicas completadas y botón Cancelar.

### 7.2 Estado vacío
La pestaña Resultados antes de resolver no dice "No hay datos". Dice qué hacer:
> **Aún no has resuelto este modelo.** Completa los datos y presiona Resolver.
> [ Ir a Datos ]

### 7.3 Errores de validación (en la entrada)
Se muestran **en la celda**, no en un modal. Borde `--error` + mensaje bajo la cuadrícula:
> **C2 no tiene operador.** Elige ≤, ≥ o = en la columna "op".

No decir "Error de validación". Decir qué pasó y dónde.

### 7.4 Resultados matemáticamente problemáticos
Estos **no son errores** — son resultados legítimos y hay que tratarlos con la misma dignidad que un óptimo:

| Estado | Banda | Panel explicativo |
|---|---|---|
| Infactible | `--error` | "No existe solución que cumpla todas las restricciones. C1 y C3 se contradicen: C1 exige X₁ ≤ 5 y C3 exige X₁ ≥ 12." |
| No acotado | `--error` | "Z crece indefinidamente en la dirección de X₂. Suele indicar que falta una restricción." |
| Degenerado | `--warn` | "Una variable básica vale 0. La solución es válida, pero los precios sombra pueden no ser únicos." |
| Óptimos múltiples | `--warn` | "Existen infinitas soluciones óptimas con Z = 1,360. Vértices alternativos: (24, 8) y (30, 0)." |
| Sistema inestable (colas) | `--warn` | "ρ = 1.15 ≥ 1: la cola crece sin límite. Se necesitan al menos 2 servidores." |

Este manejo es una de las mayores mejoras sobre los originales, donde un problema infactible produce un mensaje críptico o simplemente una tabla vacía.

---

## 8. Microcopy

**Principios:**
- **Voz activa, nombra la acción por lo que hace.** "Resolver", no "Enviar". "Exportar a PDF", no "Generar salida".
- **Consistencia de vocabulario en todo el flujo.** El botón dice "Resolver" → la banda dice "Resuelto" → el PDF se llama "solución".
- **Nomenclatura académica exacta.** Usamos los términos del libro de texto: "precio sombra", "costo reducido", "holgura", "rango de optimalidad", "ruta crítica". Nada de sinónimos "amigables" inventados — el usuario tiene que poder mapear la pantalla con lo que le pide el profesor.
- **Tooltips explican, no repiten.** El tooltip de "Costo reducido" no dice "el costo reducido"; dice "Cuánto tendría que mejorar el coeficiente de X₃ para que valga la pena producirlo".
- **Los errores no se disculpan.** Nada de "Lo sentimos, algo salió mal". Di qué pasó y cómo arreglarlo.

---

## 9. Responsive

Esta es una app de escritorio por naturaleza — nadie resuelve un simplex 12×8 en un teléfono. Pero debe **degradar con dignidad**, no romperse:

| Breakpoint | Comportamiento |
|---|---|
| ≥1280px | Layout completo. Iteraciones: rail + tabla lado a lado. |
| 1024–1280px | El rail de Iteraciones se colapsa a una barra horizontal sobre la tabla. |
| 768–1024px | Las pestañas Datos/Resultados se vuelven pantallas separadas con navegación. Las tablas tienen scroll horizontal con la primera columna fija. |
| <768px | **Modo consulta:** se puede *ver* un resultado guardado y exportarlo, pero la entrada de datos matriciales muestra un aviso honesto: "La captura de modelos funciona mejor en pantalla grande. Puedes ver y exportar resultados desde aquí." No fingir que se puede editar una matriz 8×12 en un móvil. |

---

## 10. Accesibilidad (piso no negociable)

- **El color nunca es el único portador de información.** La ruta crítica es magenta **y** tiene la etiqueta "crítica" en la tabla. La celda pivote es magenta **y** tiene corchetes `[2]`. Un usuario con daltonismo debe poder usar la app completa. (Esto además hace que el PDF impreso en blanco y negro siga funcionando — que es como se entregan muchas tareas.)
- Contraste mínimo AA en todo texto; los tokens de color están elegidos para cumplirlo sobre `--paper`.
- **Foco de teclado visible siempre**, con un anillo de 2px en `--ink-900` (no removerlo nunca en la cuadrícula).
- La app entera es navegable con teclado: es una herramienta de captura de datos, el mouse es opcional.
- Tablas con `<caption>`, `<th scope>`, y encabezados reales — no divs con apariencia de tabla. Esto además hace que copiar/pegar a Excel funcione bien.
- `prefers-reduced-motion`: elimina las transiciones del scrubber, el parpadeo de celdas y el auto-play; la funcionalidad se mantiene intacta.
- Etiquetas `aria-live` en la banda de estado para anunciar el resultado al resolver.

---

## 11. Motion

**Presupuesto de animación: mínimo y con propósito.** Toda la audacia se gasta en el visor de iteraciones; el resto de la app no se mueve.

| Dónde | Qué | Duración |
|---|---|---|
| Transición entre iteraciones | Cross-fade de la tabla + parpadeo de celdas cambiadas | 180ms / 400ms |
| Celda pivote | Se dibuja el borde (no fade) | 120ms |
| Cambio de pestaña | Ninguna. Instantáneo. | 0 |
| Aparición de resultados | Fade sutil de la banda de estado | 150ms |
| Hover en tarjetas/botones | Cambio de borde | 100ms |

Sin parallax, sin reveals al hacer scroll, sin skeletons animados, sin números que cuentan hacia arriba. Esta es una herramienta de trabajo.

---

## 12. Anti-patrones (qué NO hacer)

- ❌ **Tarjetas con sombra y esquinas muy redondeadas** para envolver tablas. Una tabla de cálculo tiene esquinas rectas.
- ❌ **Color en la navegación o en botones primarios.** El color está reservado; gastarlo en un botón azul destruye el sistema entero.
- ❌ **Iconos decorativos** en las tarjetas de módulo. No hay un icono bueno para "programación por metas"; habría uno genérico y mentiroso.
- ❌ **Dashboard de bienvenida** con estadísticas de uso. Nadie necesita saber cuántos problemas resolvió.
- ❌ **Fuente proporcional en tablas numéricas.**
- ❌ **Ocultar el procedimiento detrás de un "ver detalles".** El procedimiento es el producto.
- ❌ **Modales para errores de validación.** El error vive donde está el problema.
- ❌ **Renombrar términos académicos** por versiones "más amigables".
- ❌ **Spinners para operaciones de 50ms.**
- ❌ **Onboarding tutorial de 5 pasos.** "Cargar ejemplo" es el onboarding.
- ❌ **Editar el problema en JSON.** La entrada es formulario, cuadrícula o texto del modelo — nunca un textarea de JSON.

---

## 13. Entregable esperado del agente para el frontend

1. Implementar el sistema de tokens (sección 2) como configuración de Tailwind + variables CSS, antes de cualquier componente.
2. Construir `<ModuleShell>`, `<DataGrid>`, `<StatusBand>`, `<SolutionTable>` y `<Explainer>` como el núcleo compartido — probados primero con el módulo piloto de Fase 0.
3. Construir `<IterationsViewer>` como pieza dedicada durante el módulo de LP, diseñada desde el inicio para ser reutilizada por MODI, húngaro, B&B y DP (su API recibe una lista genérica de "pasos" con estado + matriz + celdas resaltadas).
4. Verificar el piso de accesibilidad (sección 10) antes de cerrar cada módulo, no al final del proyecto.
5. Antes de construir, presentar una propuesta visual de la pantalla de Resultados de LP (la más importante de la app) para aprobación.