import { SolverError } from "../../errors";

/**
 * Analizador recursivo descendente para fórmulas aritméticas.
 * No usa eval ni Function.
 *
 * Gramática (la potencia asocia a la derecha y ata más que el signo):
 *   expresión = término { (+|-) término }
 *   término   = potencia { (*|/) potencia }
 *   potencia  = (+|-) potencia | factor
 *   factor    = primario [ ^ potencia ]
 *   primario  = número | nombre | nombre(args) | ( expresión )
 */

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  min: { min: 1, max: 16 },
  max: { min: 1, max: 16 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
};

export const RESERVED_NAMES = new Set(Object.keys(FUNCTIONS));

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" }
  | { k: "eof" };

type Node =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "(") {
      out.push({ k: "lp" });
      i += 1;
      continue;
    }
    if (c === ")") {
      out.push({ k: "rp" });
      i += 1;
      continue;
    }
    if (c === ",") {
      out.push({ k: "comma" });
      i += 1;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      out.push({ k: "op", v: c });
      i += 1;
      continue;
    }
    if (c === "." || (c >= "0" && c <= "9")) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new SolverError("Hay un número incompleto en la fórmula.");
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new SolverError("Hay un número no válido en la fórmula.");
      out.push({ k: "num", v });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) throw new SolverError("Hay un nombre incompleto en la fórmula.");
      out.push({ k: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new SolverError(
      `No se permite el símbolo «${c}» en la fórmula. Usa + − * / ^, paréntesis y los nombres de las variables.`,
    );
  }
  out.push({ k: "eof" });
  return out;
}

export type CompiledExpression = {
  evaluate: (env: Record<string, number>) => number;
  /** Nombres de variables que la fórmula sí usa. */
  used: string[];
};

export function compileExpression(source: string, names: ReadonlySet<string>): CompiledExpression {
  const text = source.trim();
  if (!text) throw new SolverError("La expresión está vacía.");
  if (text.length > 800) throw new SolverError("La expresión es demasiado larga (máximo 800 caracteres).");

  const tokens = tokenize(text);
  let i = 0;
  const used = new Set<string>();
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  function isOp(op: string): boolean {
    const t = peek();
    return t.k === "op" && t.v === op;
  }

  function parseExpression(): Node {
    let left = parseTerm();
    while (isOp("+") || isOp("-")) {
      const op = (eat() as { k: "op"; v: "+" | "-" }).v;
      left = { type: "bin", op, left, right: parseTerm() };
    }
    return left;
  }

  function parseTerm(): Node {
    let left = parsePower();
    while (isOp("*") || isOp("/")) {
      const op = (eat() as { k: "op"; v: "*" | "/" }).v;
      left = { type: "bin", op, left, right: parsePower() };
    }
    return left;
  }

  function parsePower(): Node {
    if (isOp("+") || isOp("-")) {
      const op = (eat() as { k: "op"; v: "+" | "-" }).v;
      const arg = parsePower();
      return op === "-" ? { type: "neg", arg } : arg;
    }
    return parseFactor();
  }

  function parseFactor(): Node {
    const base = parsePrimary();
    if (isOp("^")) {
      eat();
      return { type: "bin", op: "^", left: base, right: parsePower() };
    }
    return base;
  }

  function parseArgList(): Node[] {
    if (peek().k === "rp") {
      eat();
      return [];
    }
    const args = [parseExpression()];
    while (peek().k === "comma") {
      eat();
      if (peek().k === "rp" || peek().k === "comma") {
        throw new SolverError("Sobró una coma entre los argumentos de la función.");
      }
      args.push(parseExpression());
    }
    if (peek().k !== "rp") throw new SolverError("Falta el paréntesis de cierre de la función.");
    eat();
    return args;
  }

  function parsePrimary(): Node {
    const t = peek();
    if (t.k === "num") {
      eat();
      return { type: "num", value: t.v };
    }
    if (t.k === "id") {
      eat();
      if (peek().k === "lp") {
        eat();
        const args = parseArgList();
        const rule = FUNCTIONS[t.v];
        if (!rule) {
          throw new SolverError(
            `«${t.v}» no es una función permitida. Puedes usar min, max, abs, sqrt, floor y ceil.`,
          );
        }
        if (args.length < rule.min || args.length > rule.max) {
          const esperado = rule.min === rule.max ? String(rule.min) : `${rule.min} a ${rule.max}`;
          throw new SolverError(`La función ${t.v} acepta ${esperado} argumento(s) y recibió ${args.length}.`);
        }
        return { type: "call", name: t.v, args };
      }
      if (!names.has(t.v)) {
        if (FUNCTIONS[t.v]) {
          throw new SolverError(`«${t.v}» es una función: escríbela con paréntesis, por ejemplo ${t.v}(x).`);
        }
        throw new SolverError(`La fórmula usa «${t.v}», que no es una variable definida.`);
      }
      used.add(t.v);
      return { type: "var", name: t.v };
    }
    if (t.k === "lp") {
      eat();
      const inner = parseExpression();
      if (peek().k !== "rp") throw new SolverError("Falta un paréntesis de cierre en la fórmula.");
      eat();
      return inner;
    }
    if (t.k === "comma") {
      throw new SolverError(
        "La coma solo separa argumentos de una función. En la fórmula escribe los decimales con punto, por ejemplo 1.5.",
      );
    }
    throw new SolverError("Se esperaba un número, una variable o un paréntesis en la fórmula.");
  }

  const ast = parseExpression();
  if (peek().k === "comma") {
    throw new SolverError(
      "La coma solo separa argumentos de una función. En la fórmula escribe los decimales con punto, por ejemplo 1.5.",
    );
  }
  if (peek().k !== "eof") {
    throw new SolverError("La fórmula tiene símbolos de más. Revisa operadores y paréntesis.");
  }

  return {
    used: [...used],
    evaluate: (env) => evaluate(ast, env),
  };
}

function evaluate(node: Node, env: Record<string, number>): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var":
      return env[node.name];
    case "neg":
      return -evaluate(node.arg, env);
    case "bin": {
      const left = evaluate(node.left, env);
      const right = evaluate(node.right, env);
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "^":
          return left ** right;
      }
      return Number.NaN;
    }
    case "call": {
      const args = node.args.map((arg) => evaluate(arg, env));
      switch (node.name) {
        case "min":
          return Math.min(...args);
        case "max":
          return Math.max(...args);
        case "abs":
          return Math.abs(args[0]);
        case "sqrt":
          return Math.sqrt(args[0]);
        case "floor":
          return Math.floor(args[0]);
        case "ceil":
          return Math.ceil(args[0]);
        default:
          return Number.NaN;
      }
    }
  }
}
