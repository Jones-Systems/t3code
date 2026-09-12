import type { WorkstreamReadContext, WorkstreamState } from "./model.ts";

function cacheKey(context: WorkstreamReadContext): string {
  return [
    context.registryId,
    context.principalId,
    context.ownerScopeId,
    context.contractVersion,
    context.contractManifest,
    context.authorizationRevision,
  ].join("\u0000");
}

/** Metadata-only memory cache. It deliberately has no persistence adapter. */
export class WorkstreamMetadataCache {
  readonly #entries = new Map<string, WorkstreamState>();

  constructor(readonly maxEntries = 4) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive safe integer");
    }
  }

  read(context: WorkstreamReadContext, connected: boolean): WorkstreamState | null {
    if (!connected) {
      return null;
    }
    const key = cacheKey(context);
    const value = this.#entries.get(key) ?? null;
    if (value) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }

  write(state: WorkstreamState): void {
    const key = cacheKey(state.context);
    this.#entries.delete(key);
    this.#entries.set(key, state);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#entries.delete(oldest);
    }
  }

  purge(): void {
    this.#entries.clear();
  }

  purgeBinding(context: WorkstreamReadContext): void {
    this.#entries.delete(cacheKey(context));
  }

  transitionBinding(
    previous: WorkstreamReadContext,
    next: WorkstreamReadContext,
  ): WorkstreamState | null {
    this.purgeBinding(previous);
    return this.read(next, true);
  }
}
