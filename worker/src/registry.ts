import type { ModuleResult } from "./schema";

export type ModuleSolver = (body: unknown) => ModuleResult;

const MODULES = new Map<string, ModuleSolver>();

export function register(name: string, solver: ModuleSolver): void {
  MODULES.set(name, solver);
}

export function getModule(name: string): ModuleSolver | undefined {
  return MODULES.get(name);
}

export function listModules(): string[] {
  return [...MODULES.keys()].sort();
}
