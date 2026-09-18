import { register } from "../registry";
import { solve as solveQueues } from "./queues/solver";
import { solve as solveLp } from "./lp/solver";
import { solve as solveTransport } from "./transport/solver";
import { solve as solveNetworks } from "./networks/solver";
import { solve as solvePert } from "./pert_cpm/solver";

register("queues", solveQueues);
register("lp", solveLp);
register("transport", solveTransport);
register("networks", solveNetworks);
register("pert_cpm", solvePert);
