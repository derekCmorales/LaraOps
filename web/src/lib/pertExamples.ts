import type { PertBody } from "./sheetAdapters";

export const CPM_EXAMPLE: PertBody = {
  mode: "cpm",
  activities: [
    { id: "A", predecessors: [], duration: 3 },
    { id: "B", predecessors: ["A"], duration: 4 },
    { id: "C", predecessors: ["A"], duration: 2 },
    { id: "D", predecessors: ["B", "C"], duration: 5 },
  ],
};

export const PERT_EXAMPLE: PertBody = {
  mode: "pert",
  activities: [
    { id: "A", predecessors: [], a: 2, m: 3, b: 5 },
    { id: "B", predecessors: ["A"], a: 3, m: 4, b: 6 },
    { id: "C", predecessors: ["A"], a: 1, m: 2, b: 4 },
    { id: "D", predecessors: ["B", "C"], a: 4, m: 5, b: 8 },
  ],
};
