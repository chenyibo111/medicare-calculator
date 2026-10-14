import { describe, expect, it } from "vitest";
import { RedisPolicyCache } from "../../packages/infrastructure/src/redis/redis-policy-cache.js";

const integration = process.env.REDIS_URL ? describe : describe.skip;

integration("RedisPolicyCache", () => {
  it("首次未命中、再次命中，并按政策版本清理关联键", async () => {
    const cache = await RedisPolicyCache.connect(process.env.REDIS_URL!);
    const key = `policy:v1:测试市:居民医保:${Date.now()}`;
    let loads = 0;

    try {
      await expect(cache.getOrLoad(key, async () => ({ version: "TEST-1", amount: ++loads }))).resolves.toEqual({
        status: "miss",
        value: { version: "TEST-1", amount: 1 },
      });
      await expect(cache.getOrLoad(key, async () => ({ version: "TEST-1", amount: ++loads }))).resolves.toEqual({
        status: "hit",
        value: { version: "TEST-1", amount: 1 },
      });
      await cache.invalidateByPolicyVersion("TEST-1");
      await expect(cache.getOrLoad(key, async () => ({ version: "TEST-1", amount: ++loads }))).resolves.toEqual({
        status: "miss",
        value: { version: "TEST-1", amount: 2 },
      });
    } finally {
      await cache.close();
    }
  });
});
