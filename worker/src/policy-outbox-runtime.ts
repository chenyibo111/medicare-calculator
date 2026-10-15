export type OutboxWorkerEvent = "processed" | "idle" | "error";

export interface OutboxWorkerOptions {
  readonly processNext: () => Promise<boolean>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly once?: boolean;
  readonly shouldStop?: () => boolean;
  readonly onEvent?: (event: OutboxWorkerEvent, error?: unknown) => void;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runOutboxWorker(options: OutboxWorkerOptions): Promise<{ processed: number }> {
  const sleep = options.sleep ?? defaultSleep;
  const initialDelayMs = options.pollIntervalMs ?? 1_000;
  let delayMs = initialDelayMs;
  let processed = 0;

  while (!options.shouldStop?.()) {
    try {
      const didProcess = await options.processNext();
      if (didProcess) {
        processed += 1;
        delayMs = initialDelayMs;
        options.onEvent?.("processed");
        continue;
      }

      options.onEvent?.("idle");
      if (options.once) break;
    } catch (error) {
      options.onEvent?.("error", error);
    }

    if (options.shouldStop?.()) break;
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 10_000);
  }

  return { processed };
}
