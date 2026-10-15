import type { PolicyCache, PolicyRepository } from "../../../application/src/ports.js";
import type { PublishedPolicy } from "../../../domain/src/policy.js";
import { PostgresOutboxDispatcher, type StoredOutboxEvent } from "../postgres/postgres-outbox-dispatcher.js";

function stringPayload(event: StoredOutboxEvent, name: string): string | null {
  const value = event.payload[name];
  return typeof value === "string" ? value : null;
}

export class PolicyPublicationDispatcher {
  constructor(
    private readonly dependencies: {
      readonly outbox: PostgresOutboxDispatcher;
      readonly cache: PolicyCache;
      readonly repository: PolicyRepository;
      readonly today?: () => string;
      readonly onEvent?: (event: StoredOutboxEvent, outcome: "processed" | "error", error?: unknown) => void;
    },
  ) {}

  async processNext(): Promise<boolean> {
    return this.dependencies.outbox.processNext(async (event) => {
      try {
        if (event.eventType !== "policy.published") return;

        const previousVersion = stringPayload(event, "previousPolicyVersion");
        if (previousVersion) await this.dependencies.cache.invalidateByPolicyVersion(previousVersion);

        const region = stringPayload(event, "region");
        const benefitPlan = stringPayload(event, "benefitPlan");
        const effectiveFrom = stringPayload(event, "effectiveFrom");
        if (!region || !benefitPlan || !effectiveFrom) {
          throw new Error(`Outbox 事件 ${event.id} 缺少政策预热所需字段`);
        }

        const today = (this.dependencies.today ?? (() => new Date().toISOString().slice(0, 10)))();
        const calculationDate = effectiveFrom > today ? effectiveFrom : today;
        const key = `policy:v1:${region}:${benefitPlan}:${calculationDate}`;
        await this.dependencies.cache.getOrLoad(key, async (): Promise<PublishedPolicy> => {
          const policy = await this.dependencies.repository.findPublished({
            region,
            hospitalLevel: "community",
            employmentStatus: benefitPlan === "居民医保" ? "resident" : "employed",
            calculationDate,
          });
          if (policy === null) throw new Error(`无法预热政策版本：${event.id}`);
          return policy;
        });
        this.dependencies.onEvent?.(event, "processed");
      } catch (error) {
        this.dependencies.onEvent?.(event, "error", error);
        throw error;
      }
    });
  }
}
