const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export type ModuleResult = {
  module: string;
  status: string;
  solution: {
    variables: Record<string, number>;
    objective_value: number | null;
    objective_sense: "min" | "max" | null;
    metrics: Record<string, number>;
  };
  iterations: unknown[] | null;
  sensitivity: unknown | null;
  graph: {
    type: string;
    series?: {
      name: string;
      x: number[];
      y: number[];
      role?: string;
      equation?: string;
      meta?: { x: number; y: number; z?: number; sources?: string[] }[];
    }[];
    x_label?: string;
    y_label?: string;
    title?: string;
    subtitle?: string;
    kind?: string;
    value_label?: string;
    row_labels?: string[];
    col_labels?: string[];
    values?: (number | null)[][];
    nodes?: unknown[];
    edges?: unknown[];
    bars?: { id: string; start: number; end: number; critical?: boolean; slack?: number }[];
  } | null;
  tables: { name: string; columns: string[]; rows: unknown[][] }[] | null;
  warnings: string[];
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postBlob(path: string, body: unknown): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
  return res.blob();
}

function pair(mod: string) {
  return {
    solve: (body: unknown) => postJson<ModuleResult>(`/api/v1/modules/${mod}/solve`, body),
    exportXlsx: (body: unknown) => postBlob(`/api/v1/modules/${mod}/export.xlsx`, body),
    exportPdf: (body: unknown) => postBlob(`/api/v1/modules/${mod}/export.pdf`, body),
  };
}

function bind(mod: string) {
  const p = pair(mod);
  return p;
}

const eoq = bind("eoq");
export const solveEoq = eoq.solve;
export const exportEoqXlsx = eoq.exportXlsx;
export const exportEoqPdf = eoq.exportPdf;

const lp = bind("lp");
export const solveLp = lp.solve;
export const exportLpXlsx = lp.exportXlsx;
export const exportLpPdf = lp.exportPdf;

const transport = bind("transport");
export const solveTransport = transport.solve;
export const exportTransportXlsx = transport.exportXlsx;
export const exportTransportPdf = transport.exportPdf;

const assignment = bind("assignment");
export const solveAssignment = assignment.solve;
export const exportAssignmentXlsx = assignment.exportXlsx;
export const exportAssignmentPdf = assignment.exportPdf;

const pert = bind("pert_cpm");
export const solvePertCpm = pert.solve;
export const exportPertCpmXlsx = pert.exportXlsx;
export const exportPertCpmPdf = pert.exportPdf;

const queues = bind("queues");
export const solveQueues = queues.solve;
export const exportQueuesXlsx = queues.exportXlsx;
export const exportQueuesPdf = queues.exportPdf;

const inventory = bind("inventory");
export const solveInventory = inventory.solve;
export const exportInventoryXlsx = inventory.exportXlsx;
export const exportInventoryPdf = inventory.exportPdf;

const forecasting = bind("forecasting");
export const solveForecasting = forecasting.solve;
export const exportForecastingXlsx = forecasting.exportXlsx;
export const exportForecastingPdf = forecasting.exportPdf;

const decision = bind("decision_analysis");
export const solveDecision = decision.solve;
export const exportDecisionXlsx = decision.exportXlsx;
export const exportDecisionPdf = decision.exportPdf;

const game = bind("game_theory");
export const solveGame = game.solve;
export const exportGameXlsx = game.exportXlsx;
export const exportGamePdf = game.exportPdf;

const networks = bind("networks");
export const solveNetworks = networks.solve;
export const exportNetworksXlsx = networks.exportXlsx;
export const exportNetworksPdf = networks.exportPdf;

const markov = bind("markov");
export const solveMarkov = markov.solve;
export const exportMarkovXlsx = markov.exportXlsx;
export const exportMarkovPdf = markov.exportPdf;

const quality = bind("quality_control");
export const solveQuality = quality.solve;
export const exportQualityXlsx = quality.exportXlsx;
export const exportQualityPdf = quality.exportPdf;

const goal = bind("goal_programming");
export const solveGoalProgramming = goal.solve;
export const exportGoalProgrammingXlsx = goal.exportXlsx;
export const exportGoalProgrammingPdf = goal.exportPdf;

const dp = bind("dynamic_programming");
export const solveDynamicProgramming = dp.solve;
export const exportDynamicProgrammingXlsx = dp.exportXlsx;
export const exportDynamicProgrammingPdf = dp.exportPdf;

const mrp = bind("mrp");
export const solveMrp = mrp.solve;
export const exportMrpXlsx = mrp.exportXlsx;
export const exportMrpPdf = mrp.exportPdf;

const breakeven = bind("breakeven");
export const solveBreakeven = breakeven.solve;
export const exportBreakevenXlsx = breakeven.exportXlsx;
export const exportBreakevenPdf = breakeven.exportPdf;

const statistics = bind("statistics");
export const solveStatistics = statistics.solve;
export const exportStatisticsXlsx = statistics.exportXlsx;
export const exportStatisticsPdf = statistics.exportPdf;

const asa = bind("acceptance_sampling");
export const solveAsa = asa.solve;
export const exportAsaXlsx = asa.exportXlsx;
export const exportAsaPdf = asa.exportPdf;

const ilp = bind("ilp");
export const solveIlp = ilp.solve;
export const exportIlpXlsx = ilp.exportXlsx;
export const exportIlpPdf = ilp.exportPdf;

const qss = bind("queuing_simulation");
export const solveQss = qss.solve;
export const exportQssXlsx = qss.exportXlsx;
export const exportQssPdf = qss.exportPdf;

const qp = bind("quadratic_programming");
export const solveQp = qp.solve;
export const exportQpXlsx = qp.exportXlsx;
export const exportQpPdf = qp.exportPdf;

const nlp = bind("nonlinear_programming");
export const solveNlp = nlp.solve;
export const exportNlpXlsx = nlp.exportXlsx;
export const exportNlpPdf = nlp.exportPdf;

const job = bind("job_scheduling");
export const solveJob = job.solve;
export const exportJobXlsx = job.exportXlsx;
export const exportJobPdf = job.exportPdf;

const aggregate = bind("aggregate_planning");
export const solveAggregate = aggregate.solve;
export const exportAggregateXlsx = aggregate.exportXlsx;
export const exportAggregatePdf = aggregate.exportPdf;

const facility = bind("facility_location");
export const solveFacility = facility.solve;
export const exportFacilityXlsx = facility.exportXlsx;
export const exportFacilityPdf = facility.exportPdf;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
