import { clearKernelSerializationCache, freezeKernel } from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";

interface Entry { raw: string; value: unknown; bytes: number }
const caches = new WeakMap<
  StorageDatabase,
  { entries: Map<string, Entry>; bytes: number }
>();
/** A bounded decoding optimization, never a source of database state. Callers
 * must fetch the current SQL row and recheck its columns/relations on every read. */
export function readValidatedKernelJson<T>(
  db: StorageDatabase,
  table: string,
  id: string,
  raw: unknown,
  parse: () => T,
): T {
  if (db.readOnly) return freezeKernel(parse());
  let cache = caches.get(db);
  if (!cache) {
    cache = { entries: new Map(), bytes: 0 };
    caches.set(db, cache);
  }
  const key = `${table}:${id}`,
    prior = cache.entries.get(key);
  if (prior && typeof raw === "string" && prior.raw === raw) {
    cache.entries.delete(key);
    cache.entries.set(key, prior);
    return prior.value as T;
  }
  if (prior) {
    cache.entries.delete(key);
    cache.bytes -= prior.bytes;
  }
  const value = freezeKernel(parse());
  const bytes = typeof raw === "string" ? raw.length * 2 : Infinity;
  if (bytes <= 16 * 1024 * 1024) {
    while (
      cache.entries.size &&
      (cache.entries.size >= 4096 || cache.bytes + bytes > 16 * 1024 * 1024)
    ) {
      const oldest = cache.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = cache.entries.get(oldest);
      if (!entry) break;
      cache.bytes -= entry.bytes;
      cache.entries.delete(oldest);
    }
    cache.entries.set(key, { raw: raw as string, value, bytes });
    cache.bytes += bytes;
  }
  return value;
}
export function clearKernelReadCache(db: StorageDatabase): void {
  caches.delete(db);
  clearKernelSerializationCache();
}
