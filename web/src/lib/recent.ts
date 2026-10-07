import { MODULES, type ModuleMeta } from "./modulesCatalog";

/**
 * Módulos abiertos hace poco, para volver a ellos desde el inicio.
 * Solo es comodidad de cada navegador: si el almacenamiento falla, la página funciona igual.
 */

const RECENT_KEY = "laraops:recent";
const RECENT_MAX = 4;

function readList(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeList(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento: no se recuerda, y no pasa nada */
  }
}

function bySlug(slug: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.slug === slug);
}

export function recordVisit(slug: string) {
  if (!bySlug(slug)?.migrated) return;
  writeList([slug, ...readList().filter((item) => item !== slug)].slice(0, RECENT_MAX));
}

export function recentModules(): ModuleMeta[] {
  return readList()
    .map(bySlug)
    .filter((m): m is ModuleMeta => !!m && m.migrated);
}

export function clearRecent() {
  writeList([]);
}
