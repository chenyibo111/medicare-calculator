import { describe, expect, it } from "vitest";
import { PolicyPublicationDispatcher } from "../../packages/infrastructure/src/outbox/policy-publication-dispatcher.js";
import type { StoredOutboxEvent } from "../../packages/infrastructure/src/postgres/postgres-outbox-dispatcher.js";

describe("PolicyPublicationDispatcher", () => {
  it("失效旧版本并按新版本生效日预热政策缓存", async () => {
    const invalidated: string[] = [];
    const cacheKeys: string[] = [];
    const dispatcher = new PolicyPublicationDispatcher({
      outbox: {
        async processNext(deliver: (event: StoredOutboxEvent) => Promise<void>) {
          await deliver({
            id: "event-1",
            eventType: "policy.published",
            aggregateId: "policy-1",
            payload: {
              region: "城市A",
              benefitPlan: "职工医保",
              effectiveFrom: "2026-12-01",
              previousPolicyVersion: "A-2026.01",
            },
          });
          return true;
        },
      } as never,
      cache: {
        async invalidateByPolicyVersion(version) { invalidated.push(version); },
        async getOrLoad(key, loader) {
          cacheKeys.push(key);
          return { value: await loader(), status: "miss" as const };
        },
      },
      repository: {
        async findPublished() {
          return { version: "A-2026.02" } as never;
        },
      },
      today: () => "2026-10-15",
    });

    await expect(dispatcher.processNext()).resolves.toBe(true);
    expect(invalidated).toEqual(["A-2026.01"]);
    expect(cacheKeys).toEqual(["城市A:employed:2026-12-01"]);
  });

  it("处理完成时把 Outbox 事件交给运行日志观察器", async () => {
    const observed: Array<{ id: string; outcome: string }> = [];
    const dispatcher = new PolicyPublicationDispatcher({
      outbox: {
        async processNext(deliver: (event: StoredOutboxEvent) => Promise<void>) {
          await deliver({
            id: "event-log-1",
            eventType: "policy.published",
            aggregateId: "policy-log-1",
            payload: {
              region: "城市A",
              benefitPlan: "职工医保",
              effectiveFrom: "2026-10-15",
            },
          });
          return true;
        },
      } as never,
      cache: {
        async invalidateByPolicyVersion() {},
        async getOrLoad(_key, loader) { return { value: await loader(), status: "miss" as const }; },
      },
      repository: {
        async findPublished() { return { version: "A-2026.02" } as never; },
      },
      onEvent: (event, outcome) => { observed.push({ id: event.id, outcome }); },
    });

    await dispatcher.processNext();

    expect(observed).toEqual([{ id: "event-log-1", outcome: "processed" }]);
  });

  it("首个发布事件没有旧版本时不会执行失效", async () => {
    const invalidated: string[] = [];
    const dispatcher = new PolicyPublicationDispatcher({
      outbox: {
        async processNext(deliver: (event: StoredOutboxEvent) => Promise<void>) {
          await deliver({
            id: "event-first-version",
            eventType: "policy.published",
            aggregateId: "policy-first-version",
            payload: {
              region: "城市A",
              benefitPlan: "职工医保",
              effectiveFrom: "2026-10-15",
              previousPolicyVersion: null,
            },
          });
          return true;
        },
      } as never,
      cache: {
        async invalidateByPolicyVersion(version) { invalidated.push(version); },
        async getOrLoad(_key, loader) { return { value: await loader(), status: "miss" as const }; },
      },
      repository: {
        async findPublished() { return { version: "A-2026.01" } as never; },
      },
    });

    await dispatcher.processNext();

    expect(invalidated).toEqual([]);
  });
});
