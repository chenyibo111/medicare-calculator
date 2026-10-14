import type { PolicyCache } from "../../application/src/ports.js";

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
  readonly policyVersion?: string;
};

function policyVersionOf(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "version" in value && typeof value.version === "string") {
    return value.version;
  }
  return undefined;
}

export class TtlPolicyCache implements PolicyCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly now: () => number;

  constructor(options: { readonly ttlMs: number; readonly now?: () => number }) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  private readonly ttlMs: number;

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; status: "hit" | "miss" }> {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (entry !== undefined && entry.expiresAt > this.now()) {
      return { value: entry.value, status: "hit" };
    }

    const value = await loader();
    this.entries.set(key, {
      value,
      expiresAt: this.now() + this.ttlMs,
      policyVersion: policyVersionOf(value),
    });
    return { value, status: "miss" };
  }

  async invalidateByPolicyVersion(version: string): Promise<void> {
    // The local adapter has no secondary version index. Publication therefore
    // clears this process snapshot instead of risking an older version under a
    // versionless lookup key. A production cache adapter may target keys by
    // region/version through an invalidation event.
    void version;
    this.entries.clear();
  }
}
