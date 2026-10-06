import { useEffect, useState } from "react";
import {
  exportAsaPdf,
  exportAsaXlsx,
  exportBreakevenPdf,
  exportBreakevenXlsx,
  exportDecisionXlsx,
  exportDynamicProgrammingXlsx,
  exportForecastingPdf,
  exportForecastingXlsx,
  exportGameXlsx,
  exportGoalProgrammingXlsx,
  exportInventoryXlsx,
  exportMarkovXlsx,
  exportMrpXlsx,
  exportNetworksPdf,
  exportNetworksXlsx,
  exportQualityXlsx,
  exportStatisticsPdf,
  exportStatisticsXlsx,
  exportAggregateXlsx,
  exportFacilityXlsx,
  exportIlpXlsx,
  exportIlpPdf,
  exportJobXlsx,
  exportNlpXlsx,
  exportQpXlsx,
  exportQssXlsx,
  solveAggregate,
  solveAsa,
  solveBreakeven,
  solveDecision,
  solveDynamicProgramming,
  solveFacility,
  solveForecasting,
  solveGame,
  solveGoalProgramming,
  solveIlp,
  solveInventory,
  solveJob,
  solveMarkov,
  solveMrp,
  solveNetworks,
  solveNlp,
  solveQp,
  solveQss,
  solveQuality,
  solveStatistics,
} from "../api/client";
import FormModulePage from "../components/FormModulePage";
import {
  FieldGrid,
  MatrixEditor,
  NumberField,
  NumberListField,
  Section,
  SelectField,
  StringListField,
  TextField,
} from "../components/FormFields";
import IntersectionMatrix from "../components/IntersectionMatrix";
import RecordGrid from "../components/RecordGrid";
import {
  countLinks,
  diagonalFor,
  dropIndex,
  edgesFromMatrix,
  matrixFromEdges,
  missingPairs,
  nextNodeName,
  resizeMatrix as resizeNullable,
  symmetrize,
  writeCell,
  type Matrix,
} from "../lib/networkSheet";
import {
  AGG_EMPTY,
  AGG_EX,
  ASA_EMPTY,
  ASA_EX,
  BE_EMPTY,
  BE_EX,
  DEC_EMPTY,
  DEC_EX,
  DP_EMPTY,
  DP_EX,
  FAC_EMPTY,
  FAC_EX,
  FC_EMPTY,
  FC_EX,
  GAME_EMPTY,
  GAME_EX,
  GOAL_BODY_EX,
  ILP_EMPTY,
  ILP_EX,
  INV_EMPTY,
  INV_EX,
  JOBS_EMPTY,
  JOBS_EX,
  MARKOV_EMPTY,
  MARKOV_EX,
  MRP_EMPTY,
  MRP_EX,
  NET_EMPTY,
  NET_EX,
  NET_FLOW_EX,
  NET_MST_EX,
  NET_TRANS_EX,
  NET_TSP_EX,
  NLP_EMPTY,
  NLP_EX,
  QC_EMPTY,
  QC_EX,
  QP_EMPTY,
  QP_EX,
  QSS_EMPTY,
  QSS_EX,
  STAT_EMPTY,
  STAT_EX,
} from "../lib/moduleDefaults";

/** Redimensiona una matriz preservando celdas existentes. */
function resizeMatrix(m: number[][], rows: number, cols: number, fill = 0): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => m[r]?.[c] ?? fill)
  );
}

function resizeList(list: number[], n: number, fill = 0): number[] {
  return Array.from({ length: n }, (_, i) => list[i] ?? fill);
}

/* ——— Inventarios ——— */

export function InventoryPage() {
  const [model, setModel] = useState(INV_EMPTY.model);
  const [D, setD] = useState(INV_EMPTY.D);
  const [S, setS] = useState(INV_EMPTY.S);
  const [H, setH] = useState(INV_EMPTY.H);
  const [C, setC] = useState(INV_EMPTY.C);
  const [p, setP] = useState(INV_EMPTY.p);
  const [Cs, setCs] = useState(INV_EMPTY.Cs);
  const [meanD, setMeanD] = useState(INV_EMPTY.mean_demand);
  const [stdD, setStdD] = useState(INV_EMPTY.std_demand);
  const [Cu, setCu] = useState(INV_EMPTY.Cu);
  const [Co, setCo] = useState(INV_EMPTY.Co);

  return (
    <FormModulePage
      group="Inventarios y producción"
      title="Inventarios"
      blurb="EOQ y variantes. Los campos extra aparecen según el modelo elegido."
      filenameBase="inventory"
      schemaSlug="inventory"
      buildBody={() => {
        if (model === "newsvendor") {
          return { model, mean_demand: meanD, std_demand: stdD, Cu, Co };
        }
        const body: Record<string, unknown> = { model, D, S, H, C };
        if (model === "epq") body.p = p;
        if (model === "backorder") body.Cs = Cs;
        return body;
      }}
      solve={solveInventory}
      exportXlsx={exportInventoryXlsx}
      onLoadExample={() => {
        setModel(INV_EX.model);
        setD(INV_EX.D);
        setS(INV_EX.S);
        setH(INV_EX.H);
        setC(INV_EX.C);
        setP(INV_EX.p);
        setCs(INV_EX.Cs);
        setMeanD(INV_EX.mean_demand);
        setStdD(INV_EX.std_demand);
        setCu(INV_EX.Cu);
        setCo(INV_EX.Co);
      }}
      onImportBody={(body) => {
        const b = body as typeof INV_EX;
        if (b.model) setModel(b.model);
        if (b.D != null) setD(b.D);
        if (b.S != null) setS(b.S);
        if (b.H != null) setH(b.H);
        if (b.C != null) setC(b.C);
        if (b.p != null) setP(b.p);
        if (b.Cs != null) setCs(b.Cs);
        if (b.mean_demand != null) setMeanD(b.mean_demand);
        if (b.std_demand != null) setStdD(b.std_demand);
        if (b.Cu != null) setCu(b.Cu);
        if (b.Co != null) setCo(b.Co);
      }}
    >
      <Section title="Parámetros">
        <FieldGrid>
          <SelectField
            label="Modelo"
            value={model}
            onChange={setModel}
            options={[
              { value: "eoq", label: "EOQ" },
              { value: "epq", label: "EPQ" },
              { value: "backorder", label: "EOQ con faltantes" },
              { value: "newsvendor", label: "Vendedor de periódicos" },
            ]}
          />
          {model !== "newsvendor" && (
            <>
              <NumberField label="D (demanda)" value={D} onChange={setD} min={0} />
              <NumberField label="S (ordenar)" value={S} onChange={setS} min={0} />
              <NumberField label="H (mantener)" value={H} onChange={setH} min={0} />
              <NumberField label="C (unitario)" value={C} onChange={setC} min={0} />
            </>
          )}
          {model === "epq" && <NumberField label="p (producción)" value={p} onChange={setP} min={0} />}
          {model === "backorder" && <NumberField label="Cs (faltante)" value={Cs} onChange={setCs} min={0} />}
          {model === "newsvendor" && (
            <>
              <NumberField label="Demanda media" value={meanD} onChange={setMeanD} min={0} />
              <NumberField label="σ demanda" value={stdD} onChange={setStdD} min={0} />
              <NumberField label="Cu (subabasto)" value={Cu} onChange={setCu} min={0} />
              <NumberField label="Co (exceso)" value={Co} onChange={setCo} min={0} />
            </>
          )}
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— Pronósticos ——— */

export function ForecastingPage() {
  const [series, setSeries] = useState(FC_EMPTY.series);
  const [window, setWindow] = useState(FC_EMPTY.window);
  const [alpha, setAlpha] = useState(FC_EMPTY.alpha);
  const [beta, setBeta] = useState(FC_EMPTY.beta);
  const [gamma, setGamma] = useState(0.2);
  const [horizon, setHorizon] = useState(FC_EMPTY.horizon);
  const [seasonality, setSeasonality] = useState(4);
  const [optimizeAlpha, setOptimizeAlpha] = useState(false);
  const [methods, setMethods] = useState<string[]>([
    "naive",
    "moving_average",
    "exponential",
    "holt",
    "linear_trend",
  ]);

  const toggleMethod = (m: string) => {
    setMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  return (
    <FormModulePage
      group="Predicción y decisión"
      title="Pronósticos"
      blurb="Serie histórica, selección de métodos y parámetros. Compara errores o enfócate en un solo método."
      filenameBase="forecasting"
      schemaSlug="forecasting"
      buildBody={() => ({
        series,
        methods: methods.length ? methods : ["naive"],
        window,
        alpha,
        beta,
        gamma,
        seasonality,
        horizon,
        optimize_alpha: optimizeAlpha,
      })}
      solve={solveForecasting}
      exportXlsx={exportForecastingXlsx}
      exportPdf={exportForecastingPdf}
      onLoadExample={() => {
        setSeries(FC_EX.series);
        setWindow(FC_EX.window);
        setAlpha(FC_EX.alpha);
        setBeta(FC_EX.beta);
        setHorizon(FC_EX.horizon);
      }}
      onImportBody={(body) => {
        const b = body as typeof FC_EX & {
          methods?: string[];
          gamma?: number;
          seasonality?: number;
          optimize_alpha?: boolean;
        };
        if (b.series) setSeries([...b.series]);
        if (b.window != null) setWindow(b.window);
        if (b.alpha != null) setAlpha(b.alpha);
        if (b.beta != null) setBeta(b.beta);
        if (b.horizon != null) setHorizon(b.horizon);
        if (b.methods) setMethods([...b.methods]);
        if (b.gamma != null) setGamma(b.gamma);
        if (b.seasonality != null) setSeasonality(b.seasonality);
        if (b.optimize_alpha != null) setOptimizeAlpha(b.optimize_alpha);
      }}
    >
      <Section title="Serie y parámetros">
        <NumberListField label="Serie histórica" value={series} onChange={setSeries} />
        <FieldGrid>
          <NumberField label="Ventana MA" value={window} onChange={setWindow} min={1} />
          <NumberField label="α" value={alpha} onChange={setAlpha} step={0.05} min={0} />
          <NumberField label="β (Holt)" value={beta} onChange={setBeta} step={0.05} min={0} />
          <NumberField label="γ (Winters)" value={gamma} onChange={setGamma} step={0.05} min={0} />
          <NumberField label="Estacionalidad" value={seasonality} onChange={setSeasonality} min={2} />
          <NumberField label="Horizonte" value={horizon} onChange={setHorizon} min={1} />
        </FieldGrid>
        <label className="field-checkbox">
          <input type="checkbox" checked={optimizeAlpha} onChange={(e) => setOptimizeAlpha(e.target.checked)} />
          Optimizar α (y β/γ si aplica) por mínimo MSE
        </label>
      </Section>
      <Section title="Métodos a evaluar">
        <div className="field-grid" style={{ display: "grid", gap: 8 }}>
          {[
            { id: "naive", label: "Ingenuo" },
            { id: "moving_average", label: "Media móvil" },
            { id: "exponential", label: "Suavizado exponencial" },
            { id: "holt", label: "Holt (tendencia)" },
            { id: "holt_winters_additive", label: "Holt-Winters aditivo" },
            { id: "holt_winters_multiplicative", label: "Holt-Winters multiplicativo" },
            { id: "linear_trend", label: "Tendencia lineal" },
          ].map((m) => (
            <label key={m.id} className="field-checkbox">
              <input
                type="checkbox"
                checked={methods.includes(m.id)}
                onChange={() => toggleMethod(m.id)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </Section>
    </FormModulePage>
  );
}

/* ——— Decisiones ——— */

export function DecisionPage() {
  const [mode, setMode] = useState<"payoff_table" | "decision_tree" | "bayes">("payoff_table");
  const [alternatives, setAlternatives] = useState(DEC_EMPTY.alternatives);
  const [states, setStates] = useState(DEC_EMPTY.states);
  const [payoff, setPayoff] = useState(DEC_EMPTY.payoff);
  const [probabilities, setProbabilities] = useState(DEC_EMPTY.probabilities);
  const [hurwicz, setHurwicz] = useState(DEC_EMPTY.hurwicz_alpha);
  const [criterion, setCriterion] = useState("all");
  const [rootId, setRootId] = useState("");
  const [treePayload, setTreePayload] = useState<unknown[] | null>(null);
  const [bayesPayload, setBayesPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setPayoff((prev) => resizeMatrix(prev, alternatives.length, states.length));
    setProbabilities((prev) => resizeList(prev, states.length, 1 / Math.max(states.length, 1)));
  }, [alternatives.length, states.length]);

  return (
    <FormModulePage
      group="Predicción y decisión"
      title="Análisis de decisiones"
      blurb="Tabla de pagos, árbol de decisión o análisis de Bayes. Carga ejemplos avanzados vía JSON."
      filenameBase="decision"
      schemaSlug="decision"
      buildBody={() => {
        if (mode === "decision_tree" && treePayload) {
          return { mode, root_id: rootId, tree: treePayload };
        }
        if (mode === "bayes" && bayesPayload) {
          return { mode, bayes: bayesPayload };
        }
        return {
          mode,
          alternatives,
          states,
          payoff,
          probabilities,
          criterion,
          hurwicz_alpha: hurwicz,
        };
      }}
      solve={solveDecision}
      exportXlsx={exportDecisionXlsx}
      onLoadExample={() => {
        setAlternatives(DEC_EX.alternatives);
        setStates(DEC_EX.states);
        setPayoff(DEC_EX.payoff.map((r) => [...r]));
        setProbabilities(DEC_EX.probabilities);
        setHurwicz(DEC_EX.hurwicz_alpha);
      }}
      onImportBody={(body) => {
        const b = body as typeof DEC_EX & {
          mode?: "payoff_table" | "decision_tree" | "bayes";
          criterion?: string;
          tree?: unknown;
          root_id?: string;
          bayes?: unknown;
        };
        if (b.mode) setMode(b.mode);
        if (b.alternatives) setAlternatives([...b.alternatives]);
        if (b.states) setStates([...b.states]);
        if (b.payoff) setPayoff(b.payoff.map((r) => [...r]));
        if (b.probabilities) setProbabilities([...b.probabilities]);
        if (b.hurwicz_alpha != null) setHurwicz(b.hurwicz_alpha);
        if (b.criterion) setCriterion(b.criterion);
        if (b.root_id) setRootId(b.root_id);
        if (b.tree) setTreePayload(b.tree as unknown[]);
        if (b.bayes) setBayesPayload(b.bayes as Record<string, unknown>);
      }}
    >
      <Section title="Modo de análisis">
        <FieldGrid>
          <SelectField
            label="Modo"
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            options={[
              { value: "payoff_table", label: "Tabla de pagos" },
              { value: "decision_tree", label: "Árbol de decisión (JSON)" },
              { value: "bayes", label: "Bayes (JSON)" },
            ]}
          />
          {mode === "payoff_table" && (
            <SelectField
              label="Criterio"
              value={criterion}
              onChange={setCriterion}
              options={[
                { value: "all", label: "Todos" },
                { value: "maximax", label: "Máximax" },
                { value: "maximin", label: "Máximin" },
                { value: "hurwicz", label: "Hurwicz" },
                { value: "expected_value", label: "Valor esperado" },
              ]}
            />
          )}
        </FieldGrid>
      </Section>
      {mode === "payoff_table" && (
        <>
      <Section title="Alternativas y estados">
        <StringListField label="Alternativas" value={alternatives} onChange={setAlternatives} />
        <StringListField label="Estados" value={states} onChange={setStates} />
        <NumberListField label="Probabilidades" value={probabilities} onChange={setProbabilities} />
        <NumberField label="α Hurwicz" value={hurwicz} onChange={setHurwicz} step={0.1} min={0} />
      </Section>
      <MatrixEditor
        label="Matriz de pagos"
        values={payoff}
        rowLabels={alternatives}
        colLabels={states}
        onChange={setPayoff}
      />
        </>
      )}
      {mode !== "payoff_table" && (
        <p className="field-hint">
          Para árbol o Bayes, pega el JSON completo (incluye tree/root_id o bayes) y pulsa «Aplicar al formulario».
        </p>
      )}
    </FormModulePage>
  );
}

/* ——— Juegos ——— */

export function GamePage() {
  const [rows, setRows] = useState(GAME_EMPTY.row_strategies);
  const [cols, setCols] = useState(GAME_EMPTY.col_strategies);
  const [payoff, setPayoff] = useState(GAME_EMPTY.payoff);

  useEffect(() => {
    setPayoff((prev) => resizeMatrix(prev, rows.length, cols.length));
  }, [rows.length, cols.length]);

  return (
    <FormModulePage
      group="Predicción y decisión"
      title="Teoría de juegos"
      blurb="Juego de suma cero: edita la matriz de pagos del jugador fila."
      filenameBase="game"
      schemaSlug="game"
      buildBody={() => ({ row_strategies: rows, col_strategies: cols, payoff })}
      solve={solveGame}
      exportXlsx={exportGameXlsx}
      onLoadExample={() => {
        setRows(GAME_EX.row_strategies);
        setCols(GAME_EX.col_strategies);
        setPayoff(GAME_EX.payoff.map((r) => [...r]));
      }}
      onImportBody={(body) => {
        const b = body as typeof GAME_EX;
        if (b.row_strategies) setRows([...b.row_strategies]);
        if (b.col_strategies) setCols([...b.col_strategies]);
        if (b.payoff) setPayoff(b.payoff.map((r) => [...r]));
      }}
    >
      <Section title="Estrategias">
        <StringListField label="Fila (jugador 1)" value={rows} onChange={setRows} />
        <StringListField label="Columna (jugador 2)" value={cols} onChange={setCols} />
      </Section>
      <MatrixEditor label="Pagos" values={payoff} rowLabels={rows} colLabels={cols} onChange={setPayoff} />
    </FormModulePage>
  );
}

/* ——— Redes ——— */

type NetworkExample = {
  problem: string;
  nodes: string[];
  edges: { source: string; target: string; weight?: number | null; capacity?: number | null }[];
  source: string;
  sink: string;
  node_supply?: Record<string, number>;
  distance_matrix?: number[][];
  directed?: boolean;
  tsp_method?: string | null;
};

function exampleForProblem(problem: string): NetworkExample {
  if (problem === "mst") return NET_MST_EX;
  if (problem === "max_flow") return NET_FLOW_EX;
  if (problem === "transshipment") return NET_TRANS_EX;
  if (problem === "tsp") return NET_TSP_EX;
  return NET_EX;
}

function matrixHint(problem: string): string {
  if (problem === "mst") {
    return "Peso de la arista entre la fila y la columna. Vacío = sin conexión. Al ser no dirigido, el otro lado se copia solo.";
  }
  if (problem === "max_flow") {
    return "Capacidad del arco fila → columna. Vacío = ese arco no existe.";
  }
  if (problem === "transshipment") {
    return "Costo unitario del arco fila → columna. En Oferta: positivo es oferta, negativo es demanda y 0 es transbordo. Se resuelve con el método simplex de redes.";
  }
  if (problem === "tsp") {
    return "Distancia entre ciudades. La diagonal es 0. El resto de las casillas es obligatorio.";
  }
  return "Costo del arco fila → columna. Vacío = no hay arco. La coma es decimal: 1,5.";
}

function applyNetworkExample(ex: NetworkExample) {
  const nodes = [...ex.nodes];
  const diagonal = diagonalFor(ex.problem);
  const weights =
    ex.problem === "tsp" && ex.distance_matrix
      ? ex.distance_matrix.map((row) => row.map((n) => n))
      : matrixFromEdges(
          nodes,
          ex.edges,
          ex.problem === "max_flow" ? "capacity" : "weight",
          ex.problem === "mst",
          diagonal,
        );
  const hasCap = ex.problem === "transshipment" && ex.edges.some((e) => e.capacity != null && e.capacity > 0);
  return {
    nodes,
    weights,
    capacities: hasCap ? matrixFromEdges(nodes, ex.edges, "capacity_only", false, null) : resizeNullable([], nodes.length, null),
    useCapacity: hasCap,
    supply: nodes.map((n) => ex.node_supply?.[n] ?? 0),
    source: nodes.includes(ex.source) ? ex.source : nodes[0] ?? "",
    sink: nodes.includes(ex.sink) ? ex.sink : nodes[nodes.length - 1] ?? "",
    directed: ex.problem === "shortest_path" ? ex.directed !== false : ex.problem !== "mst" && ex.problem !== "tsp",
    symmetricCosts: false,
    symmetricTsp: false,
    tspMethod: ex.tsp_method === "heuristic" || ex.tsp_method === "exact" ? ex.tsp_method : "auto",
  };
}

export function NetworksPage() {
  const empty = applyNetworkExample(NET_EMPTY);
  const [problem, setProblem] = useState(NET_EMPTY.problem);
  const [nodes, setNodes] = useState(empty.nodes);
  const [weights, setWeights] = useState<Matrix>(empty.weights);
  const [capacities, setCapacities] = useState<Matrix>(empty.capacities);
  const [useCapacity, setUseCapacity] = useState(empty.useCapacity);
  const [supply, setSupply] = useState(empty.supply);
  const [source, setSource] = useState(empty.source);
  const [sink, setSink] = useState(empty.sink);
  const [directed, setDirected] = useState(empty.directed);
  const [symmetricCosts, setSymmetricCosts] = useState(false);
  const [symmetricTsp, setSymmetricTsp] = useState(false);
  const [tspMethod, setTspMethod] = useState("auto");

  const isTsp = problem === "tsp";
  const isTrans = problem === "transshipment";
  const isMst = problem === "mst";
  const needsTerminals = problem === "shortest_path" || problem === "max_flow";
  const symmetric =
    isMst ||
    (problem === "shortest_path" && !directed) ||
    (isTrans && symmetricCosts) ||
    (isTsp && symmetricTsp);
  const upperOnly = isMst || (problem === "shortest_path" && !directed);
  const supplySum = supply.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0);

  function changeProblem(next: string) {
    setProblem(next);
    const diagonal = diagonalFor(next);
    setWeights((prev) => {
      const sized = resizeNullable(prev, nodes.length, diagonal);
      return next === "mst" ? symmetrize(sized, null) : sized;
    });
    setCapacities((prev) => resizeNullable(prev, nodes.length, null));
    if (next === "mst" || next === "tsp") setDirected(false);
    if (next === "max_flow" || next === "transshipment" || next === "shortest_path") setDirected(true);
  }

  function addNode() {
    const name = nextNodeName(nodes);
    const diagonal = diagonalFor(problem);
    setNodes((prev) => [...prev, name]);
    setWeights((prev) => resizeNullable(prev, prev.length + 1, diagonal));
    setCapacities((prev) => resizeNullable(prev, prev.length + 1, null));
    setSupply((prev) => [...prev, 0]);
  }

  function removeNode(index: number) {
    if (nodes.length <= 2) return;
    const removed = nodes[index];
    const nextNodes = nodes.filter((_, i) => i !== index);
    setNodes(nextNodes);
    setWeights((prev) => dropIndex(prev, index, diagonalFor(problem)));
    setCapacities((prev) => dropIndex(prev, index, null));
    setSupply((prev) => prev.filter((_, i) => i !== index));
    if (source === removed) setSource(nextNodes[0] ?? "");
    if (sink === removed) setSink(nextNodes[nextNodes.length - 1] ?? "");
  }

  function renameNode(index: number, name: string) {
    if (nodes.some((node, i) => i !== index && node === name)) return false;
    const previous = nodes[index];
    const next = nodes.slice();
    next[index] = name;
    setNodes(next);
    if (source === previous) setSource(name);
    if (sink === previous) setSink(name);
    return true;
  }

  function load(ex: NetworkExample) {
    const snap = applyNetworkExample(ex);
    setProblem(ex.problem);
    setNodes(snap.nodes);
    setWeights(snap.weights);
    setCapacities(snap.capacities);
    setUseCapacity(snap.useCapacity);
    setSupply(snap.supply);
    setSource(snap.source);
    setSink(snap.sink);
    setDirected(snap.directed);
    setSymmetricCosts(snap.symmetricCosts);
    setSymmetricTsp(snap.symmetricTsp);
    setTspMethod(snap.tspMethod);
  }

  return (
    <FormModulePage
      group="Redes y flujo"
      title="Redes"
      blurb="Cada tipo usa una tabla de intersecciones: la fila es el origen y la columna el destino. Una casilla vacía es un arco que no existe. Los decimales aceptan coma o punto."
      filenameBase="networks"
      schemaSlug="networks"
      buildBody={() => {
        if (nodes.length < 2) throw new Error("hacen falta al menos dos nodos");
        if (isTsp) {
          const missing = missingPairs(nodes, weights);
          if (missing.length) {
            const [a, b] = missing[0];
            throw new Error(`falta la distancia entre ${a} y ${b}`);
          }
          const body: Record<string, unknown> = {
            problem,
            nodes,
            directed: false,
            distance_matrix: weights.map((row) => row.map((cell) => cell ?? 0)),
          };
          if (tspMethod === "exact" || tspMethod === "heuristic") body.tsp_method = tspMethod;
          return body;
        }
        const edges = edgesFromMatrix(nodes, weights, {
          upperOnly,
          asCapacity: problem === "max_flow",
          capacities: isTrans && useCapacity ? capacities : null,
        });
        if (!edges.length) throw new Error("indica al menos una conexión en la tabla");
        const body: Record<string, unknown> = {
          problem,
          nodes,
          edges,
          directed: isMst ? false : directed,
        };
        if (needsTerminals) {
          if (!nodes.includes(source) || !nodes.includes(sink)) {
            throw new Error("elige origen y destino entre los nodos");
          }
          body.source = source;
          body.sink = sink;
        }
        if (isTrans) {
          body.node_supply = Object.fromEntries(nodes.map((node, i) => [node, supply[i] ?? 0]));
          body.directed = true;
        }
        return body;
      }}
      solve={solveNetworks}
      exportXlsx={exportNetworksXlsx}
      exportPdf={exportNetworksPdf}
      onLoadExample={() => load(exampleForProblem(problem))}
      onImportBody={(body) => {
        const b = body as NetworkExample;
        const problemNext = b.problem || problem;
        const nodesNext = b.nodes?.length ? [...b.nodes] : [...nodes];
        const diagonal = diagonalFor(problemNext);
        let weightsNext: Matrix;
        if (b.distance_matrix && (problemNext === "tsp" || !b.edges?.length)) {
          weightsNext = resizeNullable(
            b.distance_matrix.map((row) => row.map((n) => (n == null ? null : Number(n)))),
            nodesNext.length,
            diagonal,
          );
        } else if (b.edges) {
          weightsNext = matrixFromEdges(
            nodesNext,
            b.edges,
            problemNext === "max_flow" ? "capacity" : "weight",
            problemNext === "mst" || b.directed === false,
            diagonal,
          );
        } else {
          weightsNext = resizeNullable(weights, nodesNext.length, diagonal);
        }
        const hasCap =
          problemNext === "transshipment" && !!b.edges?.some((e) => e.capacity != null && Number(e.capacity) > 0);
        setProblem(problemNext);
        setNodes(nodesNext);
        setWeights(weightsNext);
        setCapacities(
          hasCap && b.edges ? matrixFromEdges(nodesNext, b.edges, "capacity_only", false, null) : resizeNullable([], nodesNext.length, null),
        );
        setUseCapacity(hasCap);
        setSupply(nodesNext.map((n) => b.node_supply?.[n] ?? 0));
        setSource(b.source && nodesNext.includes(b.source) ? b.source : nodesNext[0] ?? "");
        setSink(b.sink && nodesNext.includes(b.sink) ? b.sink : nodesNext[nodesNext.length - 1] ?? "");
        setDirected(problemNext === "shortest_path" ? b.directed !== false : problemNext !== "mst" && problemNext !== "tsp");
        setSymmetricCosts(problemNext === "transshipment" && b.directed === false);
        setSymmetricTsp(false);
        setTspMethod(b.tsp_method === "heuristic" || b.tsp_method === "exact" ? b.tsp_method : "auto");
      }}
    >
      <Section title="Problema">
        <FieldGrid>
          <SelectField
            label="Tipo"
            value={problem}
            onChange={changeProblem}
            options={[
              { value: "shortest_path", label: "Ruta más corta" },
              { value: "mst", label: "Árbol de expansión mínima" },
              { value: "max_flow", label: "Flujo máximo" },
              { value: "transshipment", label: "Flujo de costo mínimo (transbordo)" },
              { value: "tsp", label: "Agente viajante (TSP)" },
            ]}
          />
          {needsTerminals && (
            <>
              <SelectField
                label="Origen"
                value={source}
                onChange={setSource}
                options={nodes.map((node) => ({ value: node, label: node }))}
              />
              <SelectField
                label="Destino"
                value={sink}
                onChange={setSink}
                options={nodes.map((node) => ({ value: node, label: node }))}
              />
            </>
          )}
          {isTsp && (
            <SelectField
              label="Método"
              value={tspMethod}
              onChange={setTspMethod}
              options={[
                { value: "auto", label: "Automático" },
                { value: "exact", label: "Exacto (hasta 10 nodos)" },
                { value: "heuristic", label: "Heurística" },
              ]}
            />
          )}
        </FieldGrid>
        {problem === "shortest_path" && (
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={directed}
              onChange={(e) => {
                const next = e.target.checked;
                setDirected(next);
                if (!next) setWeights((prev) => symmetrize(prev, null));
              }}
            />
            Grafo dirigido
          </label>
        )}
        {isTrans && (
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={symmetricCosts}
              onChange={(e) => {
                const next = e.target.checked;
                setSymmetricCosts(next);
                if (next) setWeights((prev) => symmetrize(prev, null));
              }}
            />
            Costos simétricos
          </label>
        )}
        {isTrans && (
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={useCapacity}
              onChange={(e) => {
                const next = e.target.checked;
                setUseCapacity(next);
                if (next) setCapacities((prev) => resizeNullable(prev, nodes.length, null));
              }}
            />
            Limitar capacidad de los arcos
          </label>
        )}
        {isTsp && (
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={symmetricTsp}
              onChange={(e) => {
                const next = e.target.checked;
                setSymmetricTsp(next);
                if (next) setWeights((prev) => symmetrize(prev, 0));
              }}
            />
            Distancias simétricas
          </label>
        )}
        <IntersectionMatrix
          label={
            isMst
              ? "Pesos"
              : problem === "max_flow"
                ? "Capacidades"
                : isTsp
                  ? "Distancias"
                  : isTrans
                    ? "Costos y oferta"
                    : "Costos"
          }
          hint={matrixHint(problem)}
          nodes={nodes}
          values={weights}
          diagonal={isTsp ? "zero" : "blank"}
          onRename={renameNode}
          onAddNode={addNode}
          onRemoveNode={removeNode}
          onChange={(row, col, value) => setWeights((prev) => writeCell(prev, row, col, value, symmetric))}
          supply={isTrans ? supply : undefined}
          onSupplyChange={
            isTrans
              ? (index, value) => setSupply((prev) => prev.map((n, i) => (i === index ? value : n)))
              : undefined
          }
          linkCount={countLinks(weights, upperOnly)}
        />
        {isTrans && (
          <p className={supplySum > -1e-6 ? "field-hint" : "error-inline"}>
            Suma de oferta y demanda: {supplySum.toLocaleString("es-MX", { maximumFractionDigits: 4 })}
            {Math.abs(supplySum) < 1e-6
              ? " · balanceada"
              : supplySum > 0
                ? " · sobra oferta: se agrega un destino ficticio con costo 0"
                : " · la demanda supera a la oferta: no se puede atender a todos"}
          </p>
        )}
        {isTrans && useCapacity && (
          <IntersectionMatrix
            label="Capacidades"
            hint="Vacío = sin límite. Un número es lo máximo que puede circular por ese arco."
            nodes={nodes}
            values={capacities}
            diagonal="blank"
            lockStructure
            onRename={() => false}
            onAddNode={() => undefined}
            onRemoveNode={() => undefined}
            onChange={(row, col, value) => setCapacities((prev) => writeCell(prev, row, col, value, symmetricCosts))}
            linkCount={countLinks(capacities, false)}
          />
        )}
      </Section>
    </FormModulePage>
  );
}

/* ——— Markov ——— */

export function MarkovPage() {
  const [states, setStates] = useState(MARKOV_EMPTY.states);
  const [transition, setTransition] = useState(MARKOV_EMPTY.transition);
  const [initial, setInitial] = useState(MARKOV_EMPTY.initial);
  const [steps, setSteps] = useState(MARKOV_EMPTY.steps);
  const [useRewards, setUseRewards] = useState(false);
  const [rewards, setRewards] = useState<number[]>([0, 0]);
  const [analyzeAbsorption, setAnalyzeAbsorption] = useState(false);
  const [nPower, setNPower] = useState(10);

  useEffect(() => {
    const n = states.length;
    setTransition((prev) => resizeMatrix(prev, n, n));
    setInitial((prev) => resizeList(prev, n, n > 0 ? 1 / n : 0));
    setRewards((prev) => resizeList(prev, n));
  }, [states.length]);

  return (
    <FormModulePage
      group="Aleatoriedad y espera"
      title="Cadenas de Markov"
      blurb="Matriz de transición P (filas suman 1) y distribución inicial."
      filenameBase="markov"
      schemaSlug="markov"
      buildBody={() => ({
        states,
        transition,
        initial,
        steps,
        ...(useRewards ? { rewards } : {}),
        ...(analyzeAbsorption ? { n_power: nPower } : {}),
      })}
      solve={solveMarkov}
      exportXlsx={exportMarkovXlsx}
      onLoadExample={() => {
        setStates(MARKOV_EX.states);
        setTransition(MARKOV_EX.transition.map((r) => [...r]));
        setInitial([...MARKOV_EX.initial]);
        setSteps(MARKOV_EX.steps);
      }}
      onImportBody={(body) => {
        const b = body as typeof MARKOV_EX & { rewards?: number[]; n_power?: number };
        if (b.states) setStates([...b.states]);
        if (b.transition) setTransition(b.transition.map((r) => [...r]));
        if (b.initial) setInitial([...b.initial]);
        if (b.steps != null) setSteps(b.steps);
        if (b.rewards) {
          setUseRewards(true);
          setRewards([...b.rewards]);
        }
        if (b.n_power != null) {
          setAnalyzeAbsorption(true);
          setNPower(b.n_power);
        }
      }}
    >
      <Section title="Estados">
        <StringListField label="Estados" value={states} onChange={setStates} />
        <NumberListField label="Distribución inicial" value={initial} onChange={setInitial} />
        <NumberField label="Pasos (distribución transitoria)" value={steps} onChange={setSteps} min={1} />
        <label className="field-checkbox">
          <input type="checkbox" checked={useRewards} onChange={(e) => setUseRewards(e.target.checked)} />
          Incluir recompensas por estado
        </label>
        {useRewards && (
          <NumberListField label="Recompensa por estado" value={rewards} onChange={setRewards} />
        )}
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={analyzeAbsorption}
            onChange={(e) => setAnalyzeAbsorption(e.target.checked)}
          />
          Análisis de absorción (matriz fundamental)
        </label>
        {analyzeAbsorption && (
          <NumberField
            label="Potencia n de P (Pⁿ)"
            value={nPower}
            onChange={setNPower}
            min={1}
            hint="Útil para cadenas con estados absorbentes"
          />
        )}
      </Section>
      <MatrixEditor
        label="Matriz de transición P"
        values={transition}
        rowLabels={states}
        colLabels={states}
        onChange={setTransition}
      />
    </FormModulePage>
  );
}

/* ——— Calidad ——— */

export function QualityPage() {
  const [chart, setChart] = useState(QC_EMPTY.chart);
  const [samples, setSamples] = useState(QC_EMPTY.samples);
  const [USL, setUSL] = useState(QC_EMPTY.USL);
  const [LSL, setLSL] = useState(QC_EMPTY.LSL);

  return (
    <FormModulePage
      group="Calidad y estadística"
      title="Control de calidad"
      blurb="Cada fila es una muestra. Límites de especificación opcionales para Cp/Cpk."
      filenameBase="quality"
      schemaSlug="quality"
      buildBody={() => ({ chart, samples, USL, LSL })}
      solve={solveQuality}
      exportXlsx={exportQualityXlsx}
      onLoadExample={() => {
        setChart(QC_EX.chart);
        setSamples(QC_EX.samples.map((r) => [...r]));
        setUSL(QC_EX.USL);
        setLSL(QC_EX.LSL);
      }}
      onImportBody={(body) => {
        const b = body as typeof QC_EX;
        if (b.chart) setChart(b.chart);
        if (b.samples) setSamples(b.samples.map((r) => [...r]));
        if (b.USL != null) setUSL(b.USL);
        if (b.LSL != null) setLSL(b.LSL);
      }}
    >
      <Section title="Carta">
        <FieldGrid>
          <SelectField
            label="Tipo"
            value={chart}
            onChange={setChart}
            options={[
              { value: "xbar_r", label: "X̄-R" },
              { value: "p", label: "p" },
              { value: "c", label: "c" },
              { value: "u", label: "u" },
            ]}
          />
          <NumberField label="Límite superior (USL)" value={USL} onChange={setUSL} hint="Especificación máxima" />
          <NumberField label="Límite inferior (LSL)" value={LSL} onChange={setLSL} hint="Especificación mínima" />
        </FieldGrid>
      </Section>
      <MatrixEditor label="Muestras" values={samples} onChange={setSamples} />
    </FormModulePage>
  );
}

/* ——— Goal ——— */

type GoalDef = {
  id: string;
  varName: string;
  coeff: number;
  sense: string;
  target: number;
  priority: number;
};

type HardConstraint = {
  id: string;
  coeffs: Record<string, number>;
  sense: string;
  rhs: number;
};

export function GoalPage() {
  const [varNames, setVarNames] = useState<string[]>(GOAL_BODY_EX.variable_names);
  const [goals, setGoals] = useState<GoalDef[]>(
    GOAL_BODY_EX.goals.map((g) => ({
      id: g.id,
      varName: Object.keys(g.coeffs)[0] ?? "x1",
      coeff: Object.values(g.coeffs)[0] ?? 1,
      sense: g.sense,
      target: g.target,
      priority: g.priority,
    }))
  );
  const [hardConstraints, setHardConstraints] = useState<HardConstraint[]>(
    GOAL_BODY_EX.hard_constraints.map((c) => ({
      id: c.id,
      coeffs: { ...c.coeffs },
      sense: c.sense,
      rhs: c.rhs,
    }))
  );

  function buildGoalsBody() {
    return {
      variable_names: varNames,
      hard_constraints: hardConstraints.map((c) => ({
        id: c.id,
        coeffs: c.coeffs,
        sense: c.sense,
        rhs: c.rhs,
      })),
      goals: goals.map((g) => ({
        id: g.id,
        coeffs: { [g.varName]: g.coeff },
        sense: g.sense,
        target: g.target,
        priority: g.priority,
        weight_pos: 1,
        weight_neg: 1,
      })),
    };
  }

  return (
    <FormModulePage
      group="Optimización"
      title="Programación por metas"
      blurb="Define metas con prioridades y restricciones duras. El solver minimiza desviaciones de forma preemptiva."
      filenameBase="goal"
      schemaSlug="goal"
      buildBody={buildGoalsBody}
      solve={solveGoalProgramming}
      exportXlsx={exportGoalProgrammingXlsx}
      onLoadExample={() => {
        setVarNames([...GOAL_BODY_EX.variable_names]);
        setGoals(
          GOAL_BODY_EX.goals.map((g) => ({
            id: g.id,
            varName: Object.keys(g.coeffs)[0] ?? "x1",
            coeff: Object.values(g.coeffs)[0] ?? 1,
            sense: g.sense,
            target: g.target,
            priority: g.priority,
          }))
        );
        setHardConstraints(
          GOAL_BODY_EX.hard_constraints.map((c) => ({
            id: c.id,
            coeffs: { ...c.coeffs },
            sense: c.sense,
            rhs: c.rhs,
          }))
        );
      }}
      onImportBody={(body) => {
        const b = body as typeof GOAL_BODY_EX;
        if (b.variable_names) setVarNames([...b.variable_names]);
        if (b.goals) {
          setGoals(
            b.goals.map((g) => ({
              id: g.id,
              varName: Object.keys(g.coeffs)[0] ?? "x1",
              coeff: Number(Object.values(g.coeffs)[0] ?? 1),
              sense: g.sense,
              target: g.target,
              priority: g.priority,
            }))
          );
        }
        if (b.hard_constraints) {
          setHardConstraints(
            b.hard_constraints.map((c) => ({
              id: c.id,
              coeffs: { ...c.coeffs },
              sense: c.sense,
              rhs: c.rhs,
            }))
          );
        }
      }}
    >
      <Section title="Variables">
        <StringListField label="Variables de decisión" value={varNames} onChange={setVarNames} />
      </Section>
      <Section title="Metas">
        {goals.map((g, idx) => (
          <FieldGrid key={g.id}>
            <TextField label="Id meta" value={g.id} onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, id: v } : x)))} mono />
            <TextField label="Variable" value={g.varName} onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, varName: v } : x)))} mono />
            <NumberField label="Coeficiente" value={g.coeff} onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, coeff: v } : x)))} />
            <SelectField
              label="Sentido"
              value={g.sense}
              onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, sense: v } : x)))}
              options={[
                { value: "=", label: "=" },
                { value: ">=", label: "≥" },
                { value: "<=", label: "≤" },
              ]}
            />
            <NumberField label="Valor meta" value={g.target} onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, target: v } : x)))} />
            <NumberField label="Prioridad" value={g.priority} onChange={(v) => setGoals((prev) => prev.map((x, i) => (i === idx ? { ...x, priority: v } : x)))} min={1} />
          </FieldGrid>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setGoals((prev) => [...prev, { id: `g${prev.length + 1}`, varName: varNames[0] ?? "x1", coeff: 1, sense: "=", target: 0, priority: prev.length + 1 }])}>
          + Añadir meta
        </button>
      </Section>
      <Section title="Restricciones duras">
        {hardConstraints.map((c, idx) => (
          <FieldGrid key={c.id}>
            <TextField label="Id" value={c.id} onChange={(v) => setHardConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, id: v } : x)))} mono />
            <SelectField
              label="Sentido"
              value={c.sense}
              onChange={(v) => setHardConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, sense: v } : x)))}
              options={[
                { value: "<=", label: "≤" },
                { value: ">=", label: "≥" },
                { value: "=", label: "=" },
              ]}
            />
            <NumberField label="Lado derecho" value={c.rhs} onChange={(v) => setHardConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, rhs: v } : x)))} />
          </FieldGrid>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setHardConstraints((prev) => [...prev, { id: `c${prev.length + 1}`, coeffs: { [varNames[0] ?? "x1"]: 1 }, sense: "<=", rhs: 0 }])}>
          + Añadir restricción
        </button>
      </Section>
    </FormModulePage>
  );
}

/* ——— DP ——— */

type ItemRow = { id: string; weight: number; value: number };

export function DpPage() {
  const [problem, setProblem] = useState(DP_EMPTY.problem);
  const [capacity, setCapacity] = useState(DP_EMPTY.capacity);
  const [items, setItems] = useState<ItemRow[]>(DP_EMPTY.items.map((i) => ({ ...i })));

  return (
    <FormModulePage
      group="Optimización"
      title="Programación dinámica"
      blurb="Mochila 0-1: edita ítems en la cuadrícula. También soporta diligencia por etapas vía JSON."
      filenameBase="dp"
      schemaSlug="dp"
      buildBody={() => ({ problem, capacity, items })}
      solve={solveDynamicProgramming}
      exportXlsx={exportDynamicProgrammingXlsx}
      onLoadExample={() => {
        setProblem(DP_EX.problem);
        setCapacity(DP_EX.capacity);
        setItems(DP_EX.items.map((i) => ({ ...i })));
      }}
      onImportBody={(body) => {
        const b = body as { problem?: string; capacity?: number; items?: ItemRow[] };
        if (b.problem) setProblem(b.problem);
        if (b.capacity != null) setCapacity(b.capacity);
        if (b.items) setItems(b.items.map((i) => ({ ...i })));
      }}
    >
      <Section title="Problema">
        <FieldGrid>
          <SelectField
            label="Tipo"
            value={problem}
            onChange={setProblem}
            options={[
              { value: "knapsack", label: "Mochila" },
              { value: "stagecoach", label: "Diligencia (rutas por etapas)" },
            ]}
          />
          <NumberField label="Capacidad" value={capacity} onChange={setCapacity} min={0} />
        </FieldGrid>
        {problem === "knapsack" && (
          <RecordGrid<ItemRow>
            label="Ítems"
            columns={[
              { key: "id", label: "Id", type: "text" },
              { key: "weight", label: "Peso", type: "number" },
              { key: "value", label: "Valor", type: "number" },
            ]}
            rows={items}
            onChange={setItems}
            emptyRow={() => ({ id: "", weight: 0, value: 0 })}
          />
        )}
      </Section>
    </FormModulePage>
  );
}

/* ——— MRP ——— */

type BomRow = { parent: string; component: string; qty_per: number };

export function MrpPage() {
  const [items, setItems] = useState(MRP_EMPTY.items);
  const [bom, setBom] = useState<BomRow[]>(MRP_EMPTY.bom.map((r) => ({ ...r })));
  const [grossA, setGrossA] = useState(MRP_EMPTY.grossA);
  const [onHandA, setOnHandA] = useState(MRP_EMPTY.onHandA);
  const [onHandB, setOnHandB] = useState(MRP_EMPTY.onHandB);
  const [ltA, setLtA] = useState(MRP_EMPTY.ltA);
  const [ltB, setLtB] = useState(MRP_EMPTY.ltB);

  return (
    <FormModulePage
      group="Inventarios y producción"
      title="MRP"
      blurb="BOM en cuadrícula y requerimientos brutos del ítem padre por periodo."
      filenameBase="mrp"
      schemaSlug="mrp"
      buildBody={() => ({
        items,
        bom: bom.map((r) => ({ parent: r.parent, component: r.component, qty_per: r.qty_per })),
        gross_requirements: { A: grossA },
        on_hand: { A: onHandA, B: onHandB },
        lead_times: { A: ltA, B: ltB },
      })}
      solve={solveMrp}
      exportXlsx={exportMrpXlsx}
      onLoadExample={() => {
        setItems([...MRP_EX.items]);
        setBom(MRP_EX.bom.map((r) => ({ ...r })));
        setGrossA([...MRP_EX.grossA]);
        setOnHandA(MRP_EX.onHandA);
        setOnHandB(MRP_EX.onHandB);
        setLtA(MRP_EX.ltA);
        setLtB(MRP_EX.ltB);
      }}
      onImportBody={(body) => {
        const b = body as {
          items?: string[];
          bom?: BomRow[];
          gross_requirements?: Record<string, number[]>;
          on_hand?: Record<string, number>;
          lead_times?: Record<string, number>;
        };
        if (b.items) setItems([...b.items]);
        if (b.bom) setBom(b.bom.map((r) => ({ ...r })));
        if (b.gross_requirements?.A) setGrossA([...b.gross_requirements.A]);
        if (b.on_hand?.A != null) setOnHandA(b.on_hand.A);
        if (b.on_hand?.B != null) setOnHandB(b.on_hand.B);
        if (b.lead_times?.A != null) setLtA(b.lead_times.A);
        if (b.lead_times?.B != null) setLtB(b.lead_times.B);
      }}
    >
      <Section title="Estructura">
        <StringListField label="Ítems" value={items} onChange={setItems} />
        <RecordGrid<BomRow>
          label="BOM (lista de materiales)"
          columns={[
            { key: "parent", label: "Padre", type: "text" },
            { key: "component", label: "Componente", type: "text" },
            { key: "qty_per", label: "Cantidad", type: "number" },
          ]}
          rows={bom}
          onChange={setBom}
          emptyRow={() => ({ parent: "A", component: "B", qty_per: 1 })}
        />
        <NumberListField label="Req. brutos A por periodo" value={grossA} onChange={setGrossA} />
        <FieldGrid>
          <NumberField label="Inv. A" value={onHandA} onChange={setOnHandA} min={0} />
          <NumberField label="Inv. B" value={onHandB} onChange={setOnHandB} min={0} />
          <NumberField label="Tiempo de entrega A" value={ltA} onChange={setLtA} min={0} />
          <NumberField label="Tiempo de entrega B" value={ltB} onChange={setLtB} min={0} />
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— Breakeven ——— */

export function BreakevenPage() {
  const [fixed, setFixed] = useState(BE_EMPTY.fixed_cost);
  const [variable, setVariable] = useState(BE_EMPTY.variable_cost);
  const [price, setPrice] = useState(BE_EMPTY.price);
  const [volume, setVolume] = useState(BE_EMPTY.volume);

  return (
    <FormModulePage
      group="Calidad y estadística"
      title="Punto de equilibrio"
      blurb="Costos fijos, variables y precio. Obtén Q* y el gráfico CVP."
      filenameBase="breakeven"
      schemaSlug="breakeven"
      buildBody={() => ({ fixed_cost: fixed, variable_cost: variable, price, volume })}
      solve={solveBreakeven}
      exportXlsx={exportBreakevenXlsx}
      exportPdf={exportBreakevenPdf}
      onLoadExample={() => {
        setFixed(BE_EX.fixed_cost);
        setVariable(BE_EX.variable_cost);
        setPrice(BE_EX.price);
        setVolume(BE_EX.volume);
      }}
      onImportBody={(body) => {
        const b = body as typeof BE_EX;
        if (b.fixed_cost != null) setFixed(b.fixed_cost);
        if (b.variable_cost != null) setVariable(b.variable_cost);
        if (b.price != null) setPrice(b.price);
        if (b.volume != null) setVolume(b.volume);
      }}
    >
      <Section title="Parámetros CVP">
        <FieldGrid>
          <NumberField label="Costo fijo" value={fixed} onChange={setFixed} min={0} />
          <NumberField label="Costo variable" value={variable} onChange={setVariable} min={0} />
          <NumberField label="Precio" value={price} onChange={setPrice} min={0} />
          <NumberField label="Volumen (ref.)" value={volume} onChange={setVolume} min={0} />
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— Estadística ——— */

export function StatisticsPage() {
  const [analysis, setAnalysis] = useState(STAT_EMPTY.analysis);
  const [data, setData] = useState(STAT_EMPTY.data);
  const [x, setX] = useState(STAT_EMPTY.x);
  const [y, setY] = useState(STAT_EMPTY.y);

  return (
    <FormModulePage
      group="Calidad y estadística"
      title="Estadística"
      blurb="Pega los datos y elige el análisis."
      filenameBase="statistics"
      schemaSlug="statistics"
      buildBody={() => {
        if (analysis === "regression") return { analysis, x, y };
        return { analysis, data };
      }}
      solve={solveStatistics}
      exportXlsx={exportStatisticsXlsx}
      exportPdf={exportStatisticsPdf}
      onLoadExample={() => {
        setAnalysis(STAT_EX.analysis);
        setData([...STAT_EX.data]);
        setX([...STAT_EX.x]);
        setY([...STAT_EX.y]);
      }}
      onImportBody={(body) => {
        const b = body as typeof STAT_EX;
        if (b.analysis) setAnalysis(b.analysis);
        if (b.data) setData([...b.data]);
        if (b.x) setX([...b.x]);
        if (b.y) setY([...b.y]);
      }}
    >
      <Section title="Datos">
        <SelectField
          label="Análisis"
          value={analysis}
          onChange={setAnalysis}
          options={[
            { value: "descriptive", label: "Descriptiva" },
            { value: "regression", label: "Regresión" },
            { value: "ttest", label: "Prueba t" },
          ]}
        />
        {analysis === "regression" ? (
          <>
            <NumberListField label="Variable independiente (X)" value={x} onChange={setX} />
            <NumberListField label="Variable dependiente (Y)" value={y} onChange={setY} />
          </>
        ) : (
          <NumberListField label="Datos" value={data} onChange={setData} />
        )}
      </Section>
    </FormModulePage>
  );
}

/* ——— ASA ——— */

export function AsaPage() {
  const [plan, setPlan] = useState(ASA_EMPTY.plan);
  const [N, setN] = useState(ASA_EMPTY.N);
  const [n, setNSample] = useState(ASA_EMPTY.n);
  const [c, setC] = useState(ASA_EMPTY.c);

  return (
    <FormModulePage
      group="Calidad y estadística"
      title="Muestreo de aceptación"
      blurb="Plan de atributos: tamaño de lote N, muestra n y aceptación c."
      filenameBase="asa"
      schemaSlug="asa"
      buildBody={() => ({ plan, N, n, c })}
      solve={solveAsa}
      exportXlsx={exportAsaXlsx}
      exportPdf={exportAsaPdf}
      onLoadExample={() => {
        setPlan(ASA_EX.plan);
        setN(ASA_EX.N);
        setNSample(ASA_EX.n);
        setC(ASA_EX.c);
      }}
      onImportBody={(body) => {
        const b = body as typeof ASA_EX;
        if (b.plan) setPlan(b.plan);
        if (b.N != null) setN(b.N);
        if (b.n != null) setNSample(b.n);
        if (b.c != null) setC(b.c);
      }}
    >
      <Section title="Plan">
        <FieldGrid>
          <SelectField
            label="Tipo"
            value={plan}
            onChange={setPlan}
            options={[{ value: "attributes_single", label: "Atributos simple" }]}
          />
          <NumberField label="N (lote)" value={N} onChange={setN} min={1} />
          <NumberField label="n (muestra)" value={n} onChange={setNSample} min={1} />
          <NumberField label="c (aceptación)" value={c} onChange={setC} min={0} />
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— ILP ——— */

type IlpConstraint = { id: string; coeffs: number[]; sense: string; rhs: number };

export function IlpPage() {
  const [sense, setSense] = useState(ILP_EMPTY.sense);
  const [varNames, setVarNames] = useState(["x", "y"]);
  const [objCoeffs, setObjCoeffs] = useState([ILP_EMPTY.objX, ILP_EMPTY.objY]);
  const [constraints, setConstraints] = useState<IlpConstraint[]>([
    { id: "c1", coeffs: [ILP_EMPTY.c1x, ILP_EMPTY.c1y], sense: "<=", rhs: ILP_EMPTY.c1rhs },
  ]);
  const [integerVars, setIntegerVars] = useState(["x", "y"]);

  useEffect(() => {
    setObjCoeffs((prev) => resizeList(prev, varNames.length));
    setConstraints((prev) =>
      prev.map((c) => ({ ...c, coeffs: resizeList(c.coeffs, varNames.length) }))
    );
  }, [varNames.length]);

  return (
    <FormModulePage
      group="Optimización"
      title="Programación entera"
      blurb="Define variables, función objetivo y restricciones. Las variables listadas como enteras se resuelven con ramificación y acotamiento."
      filenameBase="ilp"
      schemaSlug="ilp"
      buildBody={() => ({
        sense,
        objective: Object.fromEntries(varNames.map((v, i) => [v, objCoeffs[i] ?? 0])),
        constraints: constraints.map((c) => ({
          id: c.id,
          coeffs: Object.fromEntries(varNames.map((v, i) => [v, c.coeffs[i] ?? 0])),
          sense: c.sense,
          rhs: c.rhs,
        })),
        integer_vars: integerVars.filter((v) => varNames.includes(v)),
        include_graph: varNames.length === 2,
      })}
      solve={solveIlp}
      exportXlsx={exportIlpXlsx}
      exportPdf={exportIlpPdf}
      onLoadExample={() => {
        setSense(ILP_EX.sense);
        setVarNames(["x", "y"]);
        setObjCoeffs([ILP_EX.objX, ILP_EX.objY]);
        setConstraints([{ id: "c1", coeffs: [ILP_EX.c1x, ILP_EX.c1y], sense: "<=", rhs: ILP_EX.c1rhs }]);
        setIntegerVars(["x", "y"]);
      }}
      onImportBody={(body) => {
        const b = body as {
          sense?: string;
          objective?: Record<string, number>;
          constraints?: { id: string; coeffs: Record<string, number>; sense: string; rhs: number }[];
          integer_vars?: string[];
          binary_vars?: string[];
        };
        if (b.sense) setSense(b.sense);
        if (b.objective) {
          const names = Object.keys(b.objective);
          setVarNames(names);
          setObjCoeffs(names.map((n) => b.objective![n]));
        }
        if (b.constraints) {
          const names = b.objective ? Object.keys(b.objective) : varNames;
          setConstraints(
            b.constraints.map((c) => ({
              id: c.id,
              coeffs: names.map((n) => c.coeffs[n] ?? 0),
              sense: c.sense,
              rhs: c.rhs,
            }))
          );
        }
        if (b.integer_vars) setIntegerVars([...b.integer_vars]);
        else if (b.binary_vars) setIntegerVars([...b.binary_vars]);
      }}
    >
      <Section title="Modelo">
        <FieldGrid>
          <SelectField
            label="Objetivo"
            value={sense}
            onChange={setSense}
            options={[
              { value: "max", label: "Maximizar" },
              { value: "min", label: "Minimizar" },
            ]}
          />
        </FieldGrid>
        <StringListField label="Variables" value={varNames} onChange={setVarNames} />
        <NumberListField label="Coeficientes del objetivo" value={objCoeffs} onChange={setObjCoeffs} />
        <StringListField label="Variables enteras" value={integerVars} onChange={setIntegerVars} />
      </Section>
      <Section title="Restricciones">
        {constraints.map((c, idx) => (
          <div key={c.id} style={{ marginBottom: 16 }}>
            <FieldGrid>
              <TextField label="Id" value={c.id} onChange={(v) => setConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, id: v } : x)))} mono />
              <SelectField
                label="Sentido"
                value={c.sense}
                onChange={(v) => setConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, sense: v } : x)))}
                options={[
                  { value: "<=", label: "≤" },
                  { value: ">=", label: "≥" },
                  { value: "=", label: "=" },
                ]}
              />
              <NumberField label="Lado derecho" value={c.rhs} onChange={(v) => setConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, rhs: v } : x)))} />
            </FieldGrid>
            <NumberListField
              label={`Coeficientes (${varNames.join(", ")})`}
              value={c.coeffs}
              onChange={(vals) => setConstraints((prev) => prev.map((x, i) => (i === idx ? { ...x, coeffs: vals } : x)))}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setConstraints((prev) => [
              ...prev,
              { id: `c${prev.length + 1}`, coeffs: resizeList([], varNames.length), sense: "<=", rhs: 0 },
            ])
          }
        >
          + Añadir restricción
        </button>
      </Section>
    </FormModulePage>
  );
}

/* ——— QP ——— */

export function QpPage() {
  const [Q, setQ] = useState(QP_EMPTY.Q);
  const [c, setC] = useState(QP_EMPTY.c);
  const [boundsLow, setBoundsLow] = useState(QP_EMPTY.boundsLow);
  const [boundsHigh, setBoundsHigh] = useState(QP_EMPTY.boundsHigh);
  const [constraints, setConstraints] = useState(QP_EMPTY.constraints);

  useEffect(() => {
    const n = c.length;
    setBoundsLow((prev) => resizeList(prev, n));
    setBoundsHigh((prev) => resizeList(prev, n));
    setConstraints((prev) =>
      prev.map((row) => ({ ...row, coeffs: resizeList(row.coeffs, n) }))
    );
  }, [c.length]);

  return (
    <FormModulePage
      group="Optimización"
      title="Programación cuadrática"
      blurb="Minimiza ½x′Qx + c′x. Q es la matriz Hessiana; c el vector lineal. Cotas y restricciones Ax ≤ b opcionales."
      filenameBase="qp"
      schemaSlug="qp"
      buildBody={() => ({
        Q,
        c,
        bounds: boundsLow.map((lo, i) => [lo, boundsHigh[i] ?? lo]),
        A_ub: constraints.length ? constraints.map((r) => r.coeffs) : undefined,
        b_ub: constraints.length ? constraints.map((r) => r.rhs) : undefined,
        include_graph: c.length === 2,
      })}
      solve={solveQp}
      exportXlsx={exportQpXlsx}
      onLoadExample={() => {
        setQ(QP_EX.Q.map((r) => [...r]));
        setC([...QP_EX.c]);
        setBoundsLow([...QP_EX.boundsLow]);
        setBoundsHigh([...QP_EX.boundsHigh]);
        setConstraints(QP_EX.constraints.map((r) => ({ ...r, coeffs: [...r.coeffs] })));
      }}
      onImportBody={(body) => {
        const b = body as {
          Q?: number[][];
          c?: number[];
          bounds?: number[][];
          A_ub?: number[][];
          b_ub?: number[];
        };
        if (b.Q) setQ(b.Q.map((r) => [...r]));
        if (b.c) setC([...b.c]);
        if (b.bounds) {
          setBoundsLow(b.bounds.map((pair) => pair[0] ?? -1));
          setBoundsHigh(b.bounds.map((pair) => pair[1] ?? 1));
        }
        if (b.A_ub && b.b_ub) {
          setConstraints(b.A_ub.map((coeffs, i) => ({ coeffs: [...coeffs], rhs: b.b_ub![i] ?? 0 })));
        }
      }}
    >
      <MatrixEditor label="Matriz Q (Hessiana)" values={Q} onChange={setQ} />
      <NumberListField label="Vector de costos (c)" value={c} onChange={setC} />
      <NumberListField label="Cota inferior por variable" value={boundsLow} onChange={setBoundsLow} />
      <NumberListField label="Cota superior por variable" value={boundsHigh} onChange={setBoundsHigh} />
      <Section title="Restricciones lineales (Ax ≤ b)">
        {constraints.map((row, idx) => (
          <FieldGrid key={idx}>
            <NumberListField
              label={`Coeficientes fila ${idx + 1}`}
              value={row.coeffs}
              onChange={(vals) =>
                setConstraints((prev) => prev.map((r, i) => (i === idx ? { ...r, coeffs: vals } : r)))
              }
            />
            <NumberField
              label="Lado derecho"
              value={row.rhs}
              onChange={(v) =>
                setConstraints((prev) => prev.map((r, i) => (i === idx ? { ...r, rhs: v } : r)))
              }
            />
          </FieldGrid>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setConstraints((prev) => [...prev, { coeffs: resizeList([], c.length), rhs: 0 }])
          }
        >
          + Añadir restricción
        </button>
      </Section>
    </FormModulePage>
  );
}

/* ——— NLP ——— */

export function NlpPage() {
  const [diag, setDiag] = useState(NLP_EMPTY.quadratic_diag);
  const [linear, setLinear] = useState(NLP_EMPTY.linear);
  const [x0, setX0] = useState(NLP_EMPTY.x0);
  const [boundsLow, setBoundsLow] = useState(NLP_EMPTY.boundsLow);
  const [boundsHigh, setBoundsHigh] = useState(NLP_EMPTY.boundsHigh);
  const [constraints, setConstraints] = useState(NLP_EMPTY.constraints);

  useEffect(() => {
    const n = x0.length;
    setDiag((prev) => resizeList(prev, n));
    setLinear((prev) => resizeList(prev, n));
    setBoundsLow((prev) => resizeList(prev, n));
    setBoundsHigh((prev) => resizeList(prev, n));
    setConstraints((prev) =>
      prev.map((row) => ({ ...row, coeffs: resizeList(row.coeffs, n) }))
    );
  }, [x0.length]);

  return (
    <FormModulePage
      group="Optimización"
      title="Programación no lineal"
      blurb="Minimiza Σ aᵢxᵢ² + Σ bᵢxᵢ desde x₀. Trayectoria de convergencia en el gráfico. Restricciones lineales opcionales."
      filenameBase="nlp"
      schemaSlug="nlp"
      buildBody={() => ({
        quadratic_diag: diag,
        linear,
        x0,
        bounds: boundsLow.map((lo, i) => [lo, boundsHigh[i] ?? lo]),
        A_ub: constraints.length ? constraints.map((r) => r.coeffs) : undefined,
        b_ub: constraints.length ? constraints.map((r) => r.rhs) : undefined,
      })}
      solve={solveNlp}
      exportXlsx={exportNlpXlsx}
      onLoadExample={() => {
        setDiag([...NLP_EX.quadratic_diag]);
        setLinear([...NLP_EX.linear]);
        setX0([...NLP_EX.x0]);
        setBoundsLow([...NLP_EX.boundsLow]);
        setBoundsHigh([...NLP_EX.boundsHigh]);
        setConstraints(NLP_EX.constraints.map((r) => ({ ...r, coeffs: [...r.coeffs] })));
      }}
      onImportBody={(body) => {
        const b = body as typeof NLP_EX & {
          bounds?: number[][];
          A_ub?: number[][];
          b_ub?: number[];
        };
        if (b.quadratic_diag) setDiag([...b.quadratic_diag]);
        if (b.linear) setLinear([...b.linear]);
        if (b.x0) setX0([...b.x0]);
        if (b.bounds) {
          setBoundsLow(b.bounds.map((p) => p[0] ?? -5));
          setBoundsHigh(b.bounds.map((p) => p[1] ?? 5));
        }
        if (b.A_ub && b.b_ub) {
          setConstraints(b.A_ub.map((coeffs, i) => ({ coeffs: [...coeffs], rhs: b.b_ub![i] ?? 0 })));
        }
      }}
    >
      <Section title="Función objetivo f(x) = Σ aᵢxᵢ² + Σ bᵢxᵢ">
        <NumberListField label="Coeficientes cuadráticos (aᵢ)" value={diag} onChange={setDiag} />
        <NumberListField label="Coeficientes lineales (bᵢ)" value={linear} onChange={setLinear} />
        <NumberListField label="Punto inicial x₀" value={x0} onChange={setX0} />
        <NumberListField label="Cota inferior" value={boundsLow} onChange={setBoundsLow} />
        <NumberListField label="Cota superior" value={boundsHigh} onChange={setBoundsHigh} />
      </Section>
      <Section title="Restricciones (Ax ≤ b)">
        {constraints.map((row, idx) => (
          <FieldGrid key={idx}>
            <NumberListField
              label={`Coeficientes fila ${idx + 1}`}
              value={row.coeffs}
              onChange={(vals) =>
                setConstraints((prev) => prev.map((r, i) => (i === idx ? { ...r, coeffs: vals } : r)))
              }
            />
            <NumberField
              label="Lado derecho"
              value={row.rhs}
              onChange={(v) =>
                setConstraints((prev) => prev.map((r, i) => (i === idx ? { ...r, rhs: v } : r)))
              }
            />
          </FieldGrid>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setConstraints((prev) => [...prev, { coeffs: resizeList([], x0.length), rhs: 0 }])
          }
        >
          + Añadir restricción
        </button>
      </Section>
      <Section title="Método y convergencia">
        <p className="field-hint">
          Se minimiza f(x)=Σaᵢxᵢ²+Σbᵢxᵢ con SLSQP si hay restricciones lineales, o L-BFGS-B si solo hay cotas.
          El gráfico muestra la trayectoria de x₁; en métricas verás iteraciones (nit) y si el optimizador convergió.
          Si nit crece sin mejorar f, prueba otro x₀ o relaja cotas.
        </p>
      </Section>
    </FormModulePage>
  );
}

/* ——— QSS ——— */

export function QssPage() {
  const [arrival, setArrival] = useState(QSS_EMPTY.arrival_rate);
  const [service, setService] = useState(QSS_EMPTY.service_rate);
  const [servers, setServers] = useState(QSS_EMPTY.num_servers);
  const [simTime, setSimTime] = useState(QSS_EMPTY.simulation_time);
  const [warmup, setWarmup] = useState(QSS_EMPTY.warmup);
  const [seed, setSeed] = useState(QSS_EMPTY.seed);

  return (
    <FormModulePage
      group="Aleatoriedad y espera"
      title="Simulación de colas"
      blurb="Simulación de eventos discretos M/M/s. Ajusta tiempo y warmup."
      filenameBase="qss"
      schemaSlug="qss"
      buildBody={() => ({
        arrival_rate: arrival,
        service_rate: service,
        num_servers: servers,
        simulation_time: simTime,
        warmup,
        seed,
      })}
      solve={solveQss}
      exportXlsx={exportQssXlsx}
      onLoadExample={() => {
        setArrival(QSS_EX.arrival_rate);
        setService(QSS_EX.service_rate);
        setServers(QSS_EX.num_servers);
        setSimTime(QSS_EX.simulation_time);
        setWarmup(QSS_EX.warmup);
        setSeed(QSS_EX.seed);
      }}
      onImportBody={(body) => {
        const b = body as typeof QSS_EX;
        if (b.arrival_rate != null) setArrival(b.arrival_rate);
        if (b.service_rate != null) setService(b.service_rate);
        if (b.num_servers != null) setServers(b.num_servers);
        if (b.simulation_time != null) setSimTime(b.simulation_time);
        if (b.warmup != null) setWarmup(b.warmup);
        if (b.seed != null) setSeed(b.seed);
      }}
    >
      <Section title="Simulación">
        <FieldGrid>
          <NumberField label="λ llegada" value={arrival} onChange={setArrival} min={0} />
          <NumberField label="μ servicio" value={service} onChange={setService} min={0} />
          <NumberField label="Servidores" value={servers} onChange={setServers} min={1} />
          <NumberField label="Tiempo sim." value={simTime} onChange={setSimTime} min={1} />
          <NumberField label="Calentamiento" value={warmup} onChange={setWarmup} min={0} hint="Periodos iniciales que se descartan" />
          <NumberField label="Semilla" value={seed} onChange={setSeed} min={0} />
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— Jobs ——— */

type JobRow = { id: string; time: number; due_date: number };

export function JobsPage() {
  const [rule, setRule] = useState(JOBS_EMPTY.rule);
  const [jobs, setJobs] = useState<JobRow[]>(JOBS_EMPTY.jobs.map((j) => ({ ...j })));

  return (
    <FormModulePage
      group="Proyectos"
      title="Programación de tareas"
      blurb="Cuadrícula de trabajos. Johnson requiere exactamente 2 máquinas (tiempo en la columna duración)."
      filenameBase="jobs"
      schemaSlug="jobs"
      buildBody={() => ({
        rule,
        jobs: jobs.map((j) => ({ id: j.id, times: [j.time], due_date: j.due_date })),
      })}
      solve={solveJob}
      exportXlsx={exportJobXlsx}
      onLoadExample={() => {
        setRule(JOBS_EX.rule);
        setJobs(JOBS_EX.jobs.map((j) => ({ ...j })));
      }}
      onImportBody={(body) => {
        const b = body as { rule?: string; jobs?: { id: string; times?: number[]; due_date?: number }[] };
        if (b.rule) setRule(b.rule);
        if (b.jobs) {
          setJobs(
            b.jobs.map((j) => ({
              id: j.id,
              time: j.times?.[0] ?? 0,
              due_date: j.due_date ?? 0,
            }))
          );
        }
      }}
    >
      <Section title="Trabajos">
        <SelectField
          label="Regla"
          value={rule}
          onChange={setRule}
          options={[
            { value: "spt", label: "SPT (tiempo de procesamiento)" },
            { value: "edd", label: "EDD (fecha de entrega)" },
            { value: "johnson", label: "Johnson (2 máquinas)" },
          ]}
        />
        <RecordGrid<JobRow>
          label="Lista de trabajos"
          columns={[
            { key: "id", label: "Id", type: "text" },
            { key: "time", label: "Duración", type: "number" },
            { key: "due_date", label: "Fecha entrega", type: "number" },
          ]}
          rows={jobs}
          onChange={setJobs}
          emptyRow={() => ({ id: "", time: 0, due_date: 0 })}
        />
      </Section>
    </FormModulePage>
  );
}

/* ——— Aggregate ——— */

type DemandRow = { period: number; demand: number };

export function AggregatePage() {
  const [periods, setPeriods] = useState<DemandRow[]>(
    AGG_EMPTY.demand.map((d, i) => ({ period: i + 1, demand: d }))
  );
  const [workforce, setWorkforce] = useState(AGG_EMPTY.initial_workforce);
  const [prod, setProd] = useState(AGG_EMPTY.production_per_worker);
  const [hire, setHire] = useState(AGG_EMPTY.cost_hire);
  const [fire, setFire] = useState(AGG_EMPTY.cost_fire);
  const [hold, setHold] = useState(AGG_EMPTY.cost_hold);
  const [strategy, setStrategy] = useState(AGG_EMPTY.strategy);

  return (
    <FormModulePage
      group="Inventarios y producción"
      title="Planeación agregada"
      blurb="Demanda por periodo en cuadrícula y costos de contratar, despedir y mantener."
      filenameBase="aggregate"
      schemaSlug="aggregate"
      buildBody={() => ({
        demand: periods.map((p) => p.demand),
        initial_workforce: workforce,
        production_per_worker: prod,
        cost_hire: hire,
        cost_fire: fire,
        cost_hold: hold,
        strategy,
      })}
      solve={solveAggregate}
      exportXlsx={exportAggregateXlsx}
      onLoadExample={() => {
        setPeriods(AGG_EX.demand.map((d, i) => ({ period: i + 1, demand: d })));
        setWorkforce(AGG_EX.initial_workforce);
        setProd(AGG_EX.production_per_worker);
        setHire(AGG_EX.cost_hire);
        setFire(AGG_EX.cost_fire);
        setHold(AGG_EX.cost_hold);
        setStrategy(AGG_EX.strategy);
      }}
      onImportBody={(body) => {
        const b = body as typeof AGG_EX & { initial_workforce?: number };
        if (b.demand) setPeriods(b.demand.map((d, i) => ({ period: i + 1, demand: d })));
        if (b.initial_workforce != null) setWorkforce(b.initial_workforce);
        if (b.production_per_worker != null) setProd(b.production_per_worker);
        if (b.cost_hire != null) setHire(b.cost_hire);
        if (b.cost_fire != null) setFire(b.cost_fire);
        if (b.cost_hold != null) setHold(b.cost_hold);
        if (b.strategy) setStrategy(b.strategy);
      }}
    >
      <Section title="Plan">
        <RecordGrid<DemandRow>
          label="Demanda por periodo"
          columns={[
            { key: "period", label: "Periodo", type: "number" },
            { key: "demand", label: "Demanda", type: "number" },
          ]}
          rows={periods}
          onChange={setPeriods}
          emptyRow={() => ({ period: periods.length + 1, demand: 0 })}
        />
        <FieldGrid>
          <SelectField
            label="Estrategia"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: "chase", label: "Persecución de demanda" },
              { value: "level", label: "Nivel constante" },
              { value: "mixed", label: "Mixta" },
            ]}
          />
          <NumberField label="Fuerza laboral inicial" value={workforce} onChange={setWorkforce} min={0} />
          <NumberField label="Prod. / trabajador" value={prod} onChange={setProd} min={0} />
          <NumberField label="Costo contratar" value={hire} onChange={setHire} min={0} />
          <NumberField label="Costo despedir" value={fire} onChange={setFire} min={0} />
          <NumberField label="Costo mantener" value={hold} onChange={setHold} min={0} />
        </FieldGrid>
      </Section>
    </FormModulePage>
  );
}

/* ——— Facility ——— */

type PointRow = { name: string; x: number; y: number; volume: number };
type TaskRow = { id: string; time: number; predecessors: string };

export function FacilityPage() {
  const [mode, setMode] = useState(FAC_EMPTY.mode);
  const [points, setPoints] = useState<PointRow[]>(FAC_EMPTY.points.map((p) => ({ ...p })));
  const [cycleTime, setCycleTime] = useState(FAC_EMPTY.cycleTime);
  const [tasks, setTasks] = useState<TaskRow[]>(FAC_EMPTY.tasks.map((t) => ({ ...t })));

  return (
    <FormModulePage
      group="Inventarios y producción"
      title="Localización y layout"
      blurb="Centro de gravedad con cuadrícula de sitios, o balanceo de línea con tareas y tiempo de ciclo."
      filenameBase="facility"
      schemaSlug="facility"
      buildBody={() => {
        if (mode === "line_balance") {
          return {
            mode,
            cycle_time: cycleTime,
            tasks: tasks.map((t) => ({
              id: t.id,
              time: t.time,
              predecessors: t.predecessors
                ? t.predecessors.split(/[,;\s]+/).filter(Boolean)
                : [],
            })),
          };
        }
        return { mode, points };
      }}
      solve={solveFacility}
      exportXlsx={exportFacilityXlsx}
      onLoadExample={() => {
        setMode(FAC_EX.mode);
        setPoints(FAC_EX.points.map((p) => ({ ...p })));
        setCycleTime(FAC_EX.cycleTime);
        setTasks(FAC_EX.tasks.map((t) => ({ ...t })));
      }}
      onImportBody={(body) => {
        const b = body as {
          mode?: string;
          points?: PointRow[];
          cycle_time?: number;
          tasks?: { id: string; time: number; predecessors?: string[] }[];
        };
        if (b.mode) setMode(b.mode);
        if (b.points) setPoints(b.points.map((p) => ({ ...p })));
        if (b.cycle_time != null) setCycleTime(b.cycle_time);
        if (b.tasks) {
          setTasks(
            b.tasks.map((t) => ({
              id: t.id,
              time: t.time,
              predecessors: (t.predecessors ?? []).join(","),
            }))
          );
        }
      }}
    >
      <Section title="Método">
        <SelectField
          label="Tipo"
          value={mode}
          onChange={setMode}
          options={[
            { value: "center_of_gravity", label: "Centro de gravedad" },
            { value: "line_balance", label: "Balanceo de línea" },
          ]}
        />
        {mode === "center_of_gravity" ? (
          <RecordGrid<PointRow>
            label="Sitios / clientes"
            columns={[
              { key: "name", label: "Nombre", type: "text" },
              { key: "x", label: "X", type: "number" },
              { key: "y", label: "Y", type: "number" },
              { key: "volume", label: "Volumen", type: "number" },
            ]}
            rows={points}
            onChange={setPoints}
            emptyRow={() => ({ name: "", x: 0, y: 0, volume: 0 })}
          />
        ) : (
          <>
            <NumberField label="Tiempo de ciclo" value={cycleTime} onChange={setCycleTime} min={0} />
            <RecordGrid<TaskRow>
              label="Tareas"
              columns={[
                { key: "id", label: "Id", type: "text" },
                { key: "time", label: "Tiempo", type: "number" },
                { key: "predecessors", label: "Predecesores", type: "text" },
              ]}
              rows={tasks}
              onChange={setTasks}
              emptyRow={() => ({ id: "", time: 0, predecessors: "" })}
            />
          </>
        )}
      </Section>
    </FormModulePage>
  );
}
