import { describe, expect, it } from "vitest";
import { runOutboxWorker } from "../../worker/src/policy-outbox-runtime.js";

describe("runOutboxWorker", () => {
  it("一次模式会排空事件并返回处理数量", async () => {
    const outcomes = [true, true, false];

    const result = await runOutboxWorker({
      once: true,
      processNext: async () => outcomes.shift() ?? false,
    });

    expect(result).toEqual({ processed: 2 });
  });

  it("处理失败时记录错误且不会把事件计为已处理", async () => {
    const error = new Error("Redis 暂时不可用");
    const outcomes: Array<true | false | Error> = [error, false];
    const events: Array<{ event: string; error?: unknown }> = [];
    const sleeps: number[] = [];

    const result = await runOutboxWorker({
      once: true,
      processNext: async () => {
        const outcome = outcomes.shift() ?? false;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      onEvent: (event, eventError) => { events.push({ event, error: eventError }); },
    });

    expect(result).toEqual({ processed: 0 });
    expect(events).toContainEqual({ event: "error", error });
    expect(sleeps).toEqual([1_000]);
  });

  it("常驻模式空闲后等待并在停止信号出现时退出", async () => {
    let stopped = false;
    const sleeps: number[] = [];

    const result = await runOutboxWorker({
      processNext: async () => false,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        stopped = true;
      },
      shouldStop: () => stopped,
    });

    expect(result).toEqual({ processed: 0 });
    expect(sleeps).toEqual([1_000]);
  });
});
