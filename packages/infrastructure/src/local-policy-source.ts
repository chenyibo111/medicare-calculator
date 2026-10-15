import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { CapturedPolicySource, PolicySourceConnector } from "../../application/src/publish-policy.js";

export class LocalPolicySource implements PolicySourceConnector {
  async fetch(sourceConfig: string): Promise<CapturedPolicySource> {
    const rawBytes = await readFile(sourceConfig);
    const rawDocument = rawBytes.toString("utf8");
    const value = JSON.parse(rawDocument) as Record<string, unknown>;
    if (typeof value.region !== "string" || typeof value.sourceUrl !== "string" || typeof value.capturedAt !== "string") {
      throw new Error("受控政策源缺少 region、sourceUrl 或 capturedAt");
    }
    return {
      sourceId: randomUUID(),
      region: value.region,
      sourceUrl: value.sourceUrl,
      capturedAt: value.capturedAt,
      artifact: {
        fileName: basename(sourceConfig),
        format: "json",
        sha256: createHash("sha256").update(rawBytes).digest("hex"),
        byteLength: rawBytes.length,
      },
      rawDocument,
    };
  }
}
