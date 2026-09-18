import { SolverError } from "./errors";

export const LIMITS = {
  lpVars: 25,
  lpConstraints: 50,
  transportDim: 20,
  assignmentDim: 20,
  eoqGraphPoints: 200,
  networkNodes: 80,
  networkEdges: 200,
  tspExactMax: 10,
  tspHeuristicMax: 25,
  pertActivities: 100,
  queuesSMax: 40,
  queuesK: 500,
  queuesN: 200,
} as const;

export function assertLimit(ok: boolean, message: string): void {
  if (!ok) throw new SolverError(message);
}
