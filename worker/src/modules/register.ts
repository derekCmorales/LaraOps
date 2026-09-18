import { register } from "../registry";
import { solve as solveAssignment } from "./assignment/solver";
import { solve as solveEoq } from "./eoq/solver";
import { solve as solveQueues } from "./queues/solver";
import { solve as solveLp } from "./lp/solver";
import { solve as solveTransport } from "./transport/solver";
import { solve as solveNetworks } from "./networks/solver";
import { solve as solvePert } from "./pert_cpm/solver";

register("assignment", solveAssignment);
register("eoq", solveEoq);
register("queues", solveQueues);
register("lp", solveLp);
register("transport", solveTransport);
register("networks", solveNetworks);
register("pert_cpm", solvePert);
