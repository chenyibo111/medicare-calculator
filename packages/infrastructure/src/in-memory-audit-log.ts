import type { AuditLog } from "../../application/src/ports.js";

type AuditEvent = Parameters<AuditLog["append"]>[0];

export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
  }

  readAll(): readonly AuditEvent[] {
    return this.events;
  }
}
