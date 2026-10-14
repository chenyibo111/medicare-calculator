import { readFile } from "node:fs/promises";
import type { PolicySourceConnector, RawPolicySource } from "../../application/src/publish-policy.js";

export class LocalPolicySource implements PolicySourceConnector {
  async fetch(sourceConfig: string): Promise<RawPolicySource> {
    return JSON.parse(await readFile(sourceConfig, "utf8")) as RawPolicySource;
  }
}
