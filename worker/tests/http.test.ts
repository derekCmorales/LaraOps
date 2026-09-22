import { describe, expect, it } from "vitest";
import app from "../src/app";
import { moduleResultToXlsx } from "../src/export/xlsx";
import { moduleResultToPdf } from "../src/export/pdf";
import { solve as solveLp } from "../src/modules/lp/solver";

describe("http + export", () => {
  it("health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", product: "LaraOps" });
  });

  it("unknown module is 501", async () => {
    const res = await app.request("/api/v1/modules/inventory/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "eoq", D: 1, S: 1, H: 1 }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toContain("inventory");
  });

  it("solves eoq over HTTP", async () => {
    const res = await app.request("/api/v1/modules/eoq/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ D: 1000, S: 10, H: 0.5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solution: { metrics: { Q_star: number }; variables: { Q: number } } };
    expect(body.solution.metrics.Q_star).toBeCloseTo(200, 5);
    expect(body.solution.variables.Q).toBeCloseTo(200, 5);
  });

  it("solves assignment over HTTP", async () => {
    const res = await app.request("/api/v1/modules/assignment/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agents: ["A", "B", "C"],
        tasks: ["X", "Y", "Z"],
        costs: [
          [9, 2, 7],
          [6, 4, 3],
          [5, 8, 1],
        ],
        sense: "min",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solution: { objective_value: number } };
    expect(body.solution.objective_value).toBeCloseTo(9, 5);
  });

  it("exports assignment xlsx", async () => {
    const res = await app.request("/api/v1/modules/assignment/export.xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agents: ["A", "B"],
        tasks: ["X", "Y"],
        costs: [
          [1, 4],
          [3, 2],
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it("solves queues over HTTP", async () => {
    const res = await app.request("/api/v1/modules/queues/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "M/M/1", lambda: 10, mu: 15 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solution: { metrics: { L: number } } };
    expect(body.solution.metrics.L).toBeCloseTo(2, 5);
  });

  it("lists networks among deployed modules", async () => {
    const res = await app.request("/api/v1/modules");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { modules: string[] };
    expect(body.modules).toContain("networks");
  });

  it("solves shortest path over HTTP", async () => {
    const res = await app.request("/api/v1/modules/networks/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        problem: "shortest_path",
        nodes: ["A", "B", "C", "D"],
        edges: [
          { source: "A", target: "B", weight: 4 },
          { source: "A", target: "C", weight: 2 },
          { source: "B", target: "C", weight: 1 },
          { source: "B", target: "D", weight: 5 },
          { source: "C", target: "D", weight: 3 },
        ],
        source: "A",
        sink: "D",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solution: { metrics: { path_length: number } }; graph: { type: string } };
    expect(body.solution.metrics.path_length).toBeCloseTo(5, 5);
    expect(body.graph?.type).toBe("network");
  });

  it("exports networks xlsx", async () => {
    const res = await app.request("/api/v1/modules/networks/export.xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        problem: "mst",
        nodes: ["A", "B", "C"],
        edges: [
          { source: "A", target: "B", weight: 1 },
          { source: "B", target: "C", weight: 2 },
          { source: "A", target: "C", weight: 5 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it("builds xlsx and pdf bytes", async () => {
    const result = solveLp({
      sense: "max",
      objective: { x1: 3, x2: 2 },
      constraints: [
        { id: "c1", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 100 },
        { id: "c2", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 80 },
        { id: "c3", coeffs: { x1: 1, x2: 0 }, sense: "<=", rhs: 40 },
      ],
    });
    const xlsx = moduleResultToXlsx(result);
    expect(xlsx.byteLength).toBeGreaterThan(100);
    const pdf = await moduleResultToPdf(result);
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
