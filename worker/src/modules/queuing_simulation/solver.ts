import { SolverError } from "../../errors";
import type { GraphXY, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";
import { createRng, sampleExponential, seedToUint32 } from "../monte_carlo/rng";
import { solve as solveQueues } from "../queues/solver";

/**
 * Simulación de eventos discretos M/M/s, porte de
 * api/app/modules/queuing_simulation/solver.py.
 *
 * La trayectoria no coincide con Python: allí el reloj exponencial sale de
 * random.Random (Mersenne Twister) y aquí de Mulberry32 con la inversa
 * X = −ln(1−U) / tasa. Las métricas sí siguen las mismas reglas:
 * áreas de cola y sistema, espera solo de quien empieza servicio después
 * del calentamiento, rechazo si el sistema está lleno.
 *
 * El gráfico de Python comparaba int(t) con int(last_t) después de igualar
 * ambos, así que solo guardaba un punto. Aquí se muestra la fila a lo largo
 * del horizonte. El último intervalo se corta en el tiempo de simulación
 * para que la utilización no se salga de [0, 1] por el evento que cae después.
 */

const MAX_EVENTS = 2_000_000;
const MAX_SERVERS = 100;
const MAX_TIME = 1_000_000;
/** Eventos que se listan uno por uno en la tabla «eventos». */
const TRACE_EVENTS = 25;

type Request = {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
  time: number;
  warmup: number;
  seed: number;
  capacity: number | null;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("El cuerpo debe ser un objeto JSON.");
  }
  return body as Record<string, unknown>;
}

function requirePositive(value: unknown, missing: string, invalid: string): number {
  if (value == null || value === "") throw new SolverError(missing);
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) throw new SolverError(invalid);
  return value;
}

function parseRequest(body: unknown): Request {
  const o = asRecord(body);
  const arrivalRate = requirePositive(
    o.arrival_rate,
    "Ingresa la tasa de llegada λ (clientes por unidad de tiempo).",
    "La tasa de llegada debe ser mayor que 0.",
  );
  const serviceRate = requirePositive(
    o.service_rate,
    "Ingresa la tasa de servicio μ de cada servidor.",
    "La tasa de servicio debe ser mayor que 0.",
  );
  let servers = 1;
  if (o.num_servers != null && o.num_servers !== "") {
    if (typeof o.num_servers !== "number" || !Number.isInteger(o.num_servers) || o.num_servers < 1) {
      throw new SolverError("El número de servidores debe ser un entero mayor o igual que 1.");
    }
    if (o.num_servers > MAX_SERVERS) {
      throw new SolverError(`El número de servidores no puede superar ${MAX_SERVERS}.`);
    }
    servers = o.num_servers;
  }
  const time = requirePositive(
    o.simulation_time ?? 1000,
    "Ingresa el tiempo de simulación.",
    "El tiempo de simulación debe ser mayor que 0.",
  );
  if (time > MAX_TIME) {
    throw new SolverError(`El tiempo de simulación no puede superar ${MAX_TIME}.`);
  }

  let warmup = 0;
  if (o.warmup != null && o.warmup !== "") {
    if (typeof o.warmup !== "number" || !Number.isFinite(o.warmup)) {
      throw new SolverError("El calentamiento debe ser un número.");
    }
    if (o.warmup < 0) throw new SolverError("El calentamiento no puede ser negativo.");
    warmup = o.warmup;
  }
  if (warmup >= time) {
    throw new SolverError("El calentamiento debe ser menor que el tiempo de simulación.");
  }

  let seed = 42;
  if (o.seed != null && o.seed !== "") {
    if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) {
      throw new SolverError("La semilla debe ser un número.");
    }
    seed = o.seed;
  }

  let capacity: number | null = null;
  if (o.capacity != null) {
    if (typeof o.capacity !== "number" || !Number.isInteger(o.capacity) || o.capacity < 1) {
      throw new SolverError("La capacidad debe ser un entero mayor o igual que 1, o null si el cupo es ilimitado.");
    }
    capacity = o.capacity;
  }

  return {
    arrivalRate,
    serviceRate,
    servers,
    time,
    warmup,
    seed,
    capacity,
  };
}

function clock(rng: () => number, rate: number): number {
  const x = sampleExponential(rng, rate);
  // Un cero exacto no avanzaría el reloj. La inversa abierta ya es > 0;
  // el piso evita un empate numérico si el logaritmo se redondea a cero.
  return x > 1e-12 ? x : 1e-12;
}

type SimSummary = {
  L: number;
  Lq: number;
  W: number;
  Wq: number;
  utilization: number;
  rejected: number;
  arrivals: number;
};

/**
 * Valores exactos del mismo modelo (M/M/s o M/M/s/K) con el solver de teoría de colas.
 * Sin cupo y con carga ≥ 1 no hay estado estable, así que no hay contra qué comparar.
 */
function theoryTable(req: Request, sim: SimSummary): NamedTable | null {
  const s = req.servers;
  let body: Record<string, unknown>;
  if (req.capacity == null) {
    if (req.arrivalRate >= s * req.serviceRate) return null;
    body = s === 1 ? { model: "M/M/1" } : { model: "M/M/s", s };
  } else {
    if (req.capacity < s) return null;
    body = s === 1 ? { model: "M/M/1/K", K: req.capacity } : { model: "M/M/s/K", s, K: req.capacity };
  }
  let m: Record<string, number>;
  try {
    m = solveQueues({ ...body, lambda: req.arrivalRate, mu: req.serviceRate, include_pn: false }).solution.metrics;
  } catch {
    return null;
  }
  const util = m.busy_servers != null ? m.busy_servers / s : m.rho;
  const row = (label: string, simulated: number, exact: number | undefined) => [
    label,
    simulated,
    exact ?? null,
    exact == null || Math.abs(exact) < 1e-12 ? null : (simulated - exact) / exact,
  ];
  const rows: unknown[][] = [
    row("L", sim.L, m.L),
    row("Lq", sim.Lq, m.Lq),
    row("W", sim.W, m.W),
    row("Wq", sim.Wq, m.Wq),
    row("Utilización", sim.utilization, util),
  ];
  if (req.capacity != null) {
    rows.push(row("P(rechazo)", sim.arrivals > 0 ? sim.rejected / sim.arrivals : 0, m.P_block));
  }
  return {
    name: "teoria",
    columns: ["metrica", "simulado", "teorico", "diferencia_relativa"],
    rows,
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseRequest(body);
  const rng = createRng(req.seed);
  const seed32 = seedToUint32(req.seed);

  let t = 0;
  let lastT = 0;
  let nextArrival = clock(rng, req.arrivalRate);
  const freeAt = Array.from({ length: req.servers }, () => 0);
  const queue: number[] = [];
  const queueIds: number[] = [];
  const servingId = Array.from({ length: req.servers }, () => 0);
  let qHead = 0;
  let arrivals = 0;
  const trace: unknown[][] = [];
  const busyNow = (time: number) => freeAt.reduce((acc, free) => acc + (free > time ? 1 : 0), 0);
  const log = (time: number, kind: string, customer: number, server: number | null) => {
    if (trace.length >= TRACE_EVENTS) return;
    trace.push([trace.length + 1, time, kind, customer, server == null ? "—" : server + 1, qLen(), busyNow(time)]);
  };
  const qLen = () => queue.length - qHead;

  let served = 0;
  let rejected = 0;
  let waitSum = 0;
  let systemSum = 0;
  let busyTime = 0;
  let areaQueue = 0;
  let areaSystem = 0;

  const samplesT: number[] = [];
  const samplesQ: number[] = [];
  const stride = Math.max(req.time / 400, 1e-6);
  let nextSample = 0;
  const sample = (time: number) => {
    if (samplesT.length === 0 || time >= nextSample - 1e-9) {
      samplesT.push(time);
      samplesQ.push(qLen());
      nextSample = time + stride;
    }
  };
  sample(0);

  let events = 0;
  while (t < req.time) {
    let nextDep = Number.POSITIVE_INFINITY;
    for (const free of freeAt) {
      if (free > t && free < nextDep) nextDep = free;
    }
    const nextEvent = Math.min(nextArrival, nextDep);
    const tEnd = Math.min(nextEvent, req.time);
    // Solo cuenta lo que cae después del calentamiento, aunque el tramo empiece antes.
    const dt = tEnd - Math.max(lastT, req.warmup);
    if (dt > 0) {
      let busy = 0;
      for (const free of freeAt) if (free > lastT) busy += 1;
      const waiting = qLen();
      areaQueue += waiting * dt;
      areaSystem += (busy + waiting) * dt;
      busyTime += busy * dt;
    }
    if (nextEvent > req.time) {
      t = req.time;
      break;
    }

    t = nextEvent;
    lastT = t;
    const isArrival = Math.abs(t - nextArrival) < 1e-12;
    if (isArrival) {
      arrivals += 1;
      const inSystem = busyNow(t) + qLen();
      if (req.capacity != null && inSystem >= req.capacity) {
        rejected += 1;
        log(t, "llegada rechazada (sistema lleno)", arrivals, null);
      } else {
        let assigned = false;
        for (let i = 0; i < freeAt.length; i++) {
          if (freeAt[i] <= t) {
            const service = clock(rng, req.serviceRate);
            freeAt[i] = t + service;
            if (t >= req.warmup) {
              systemSum += service;
              served += 1;
            }
            assigned = true;
            servingId[i] = arrivals;
            log(t, "llegada, pasa directo a servicio", arrivals, i);
            break;
          }
        }
        if (!assigned) {
          queue.push(t);
          queueIds.push(arrivals);
          log(t, "llegada, espera en la fila", arrivals, null);
        }
      }
      nextArrival = t + clock(rng, req.arrivalRate);
    } else {
      for (let i = 0; i < freeAt.length; i++) {
        if (Math.abs(freeAt[i] - t) < 1e-9) {
          if (qLen() > 0) {
            const arrivedAt = queue[qHead];
            const who = queueIds[qHead];
            qHead += 1;
            const service = clock(rng, req.serviceRate);
            const wait = Math.max(0, t - arrivedAt);
            if (t >= req.warmup) {
              waitSum += wait;
              systemSum += wait + service;
              served += 1;
            }
            freeAt[i] = t + service;
            log(t, `sale el cliente ${servingId[i]}; entra el ${who} desde la fila`, who, i);
            servingId[i] = who;
          } else {
            freeAt[i] = t;
            log(t, "salida; el servidor queda libre", servingId[i], i);
          }
          break;
        }
      }
    }

    if (qHead > 1024 && qHead * 2 > queue.length) {
      queue.splice(0, qHead);
      queueIds.splice(0, qHead);
      qHead = 0;
    }
    sample(t);
    events += 1;
    if (events > MAX_EVENTS) {
      throw new SolverError("La simulación generó demasiados eventos. Reduce el tiempo o las tasas.");
    }
  }

  if (samplesT[samplesT.length - 1] !== req.time) {
    samplesT.push(req.time);
    samplesQ.push(qLen());
  }

  const horizon = req.time - req.warmup;
  const Lq = areaQueue / horizon;
  const L = areaSystem / horizon;
  const Wq = served > 0 ? waitSum / served : 0;
  const W = served > 0 ? systemSum / served : 0;
  let utilization = busyTime / (horizon * req.servers);
  if (utilization < 0 && utilization > -1e-8) utilization = 0;
  if (utilization > 1 && utilization < 1 + 1e-8) utilization = 1;
  const lambdaEff = served / horizon;

  const metrics: Record<string, number> = {
    served,
    rejected,
    Lq,
    L,
    Wq,
    W,
    utilization,
    lambda_eff: lambdaEff,
    horizon,
  };

  const warnings = [
    "Simulación de eventos discretos de una cola M/M/s con una sola réplica. Los promedios cambian si cambias la semilla o el horizonte.",
  ];
  if (req.warmup > 0) {
    warnings.push("El calentamiento no entra en L, Lq, W, Wq ni en la utilización. Los rechazos sí se cuentan desde el inicio.");
  }
  const offered = req.arrivalRate / (req.servers * req.serviceRate);
  if (req.capacity == null && offered >= 1) {
    warnings.push(
      "La carga λ / (s · μ) es mayor o igual que 1: sin cupo la fila no se estabiliza y L, Lq, W y Wq crecen con el tiempo simulado. Estas cifras describen este horizonte, no un estado estable.",
    );
  }
  if (rejected > 0) {
    warnings.push(`Se rechazaron ${rejected} clientes porque el sistema estaba en su cupo.`);
  }

  const theory = theoryTable(req, { L, Lq, W, Wq, utilization, rejected, arrivals });
  if (theory) {
    warnings.push(
      "La tabla «simulado contra teórico» compara esta corrida con la fórmula exacta del modelo. Las diferencias se achican con un horizonte más largo; una sola réplica siempre trae algo de ruido.",
    );
  }

  const graph: GraphXY = {
    type: "xy",
    series: [{ name: "longitud_cola", x: samplesT, y: samplesQ }],
    x_label: "Tiempo simulado",
    y_label: "Clientes en cola",
    title: "Evolución de la longitud de cola",
    subtitle: `Servidores = ${req.servers} · horizonte = ${req.time}`,
  };

  const tables: NamedTable[] = [
    {
      name: "datos",
      columns: ["dato", "valor"],
      rows: [
        ["λ", req.arrivalRate],
        ["μ", req.serviceRate],
        ["servidores", req.servers],
        ["tiempo", req.time],
        ["warmup", req.warmup],
        ["capacidad", req.capacity ?? "ilimitada"],
        ["semilla", seed32],
      ],
    },
    {
      name: "resumen",
      columns: ["métrica", "valor"],
      rows: [
        ["Clientes atendidos", served],
        ["Clientes rechazados", rejected],
        ["Lq", Lq],
        ["L", L],
        ["Wq", Wq],
        ["W", W],
        ["Utilización", utilization],
      ],
    },
  ];

  if (theory) tables.push(theory);
  tables.push({
    name: "eventos",
    columns: ["evento", "tiempo", "que_pasa", "cliente", "servidor", "en_fila", "ocupados"],
    rows: trace,
  });

  return okResult("queuing_simulation", {
    variables: { ...metrics },
    metrics,
    graph,
    tables,
    warnings,
  });
}
