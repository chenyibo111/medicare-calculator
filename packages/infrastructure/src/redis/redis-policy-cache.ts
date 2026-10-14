import { createClient } from "redis";
import type { PolicyCache } from "../../../application/src/ports.js";

interface RedisCacheCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  sAdd(key: string, member: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(keys: string | string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

function versionKey(version: string): string {
  return `policy:version:${version}:keys`;
}

export class RedisPolicyCache implements PolicyCache {
  constructor(
    private readonly client: RedisCacheCommands,
    private readonly ttlSeconds = 300,
  ) {}

  static async connect(url: string): Promise<RedisPolicyCache> {
    const client = createClient({ url });
    client.on("error", () => undefined);
    await client.connect();
    return new RedisPolicyCache(client as RedisCacheCommands);
  }

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; status: "hit" | "miss" }> {
    const cached = await this.client.get(key);
    if (cached !== null) {
      return { value: JSON.parse(cached) as T, status: "hit" };
    }

    const value = await loader();
    await this.client.set(key, JSON.stringify(value), { EX: this.ttlSeconds });
    const version = this.policyVersion(value);
    if (version !== null) {
      await this.client.sAdd(versionKey(version), key);
      await this.client.expire(versionKey(version), this.ttlSeconds);
    }
    return { value, status: "miss" };
  }

  async invalidateByPolicyVersion(version: string): Promise<void> {
    const keys = await this.client.sMembers(versionKey(version));
    if (keys.length > 0) {
      await this.client.del(keys);
    }
    await this.client.del(versionKey(version));
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  private policyVersion(value: unknown): string | null {
    if (!value || typeof value !== "object" || !("version" in value)) return null;
    return typeof value.version === "string" ? value.version : null;
  }
}
