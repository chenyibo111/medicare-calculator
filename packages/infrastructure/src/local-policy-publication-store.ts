import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PolicyPublicationStore } from "../../application/src/publish-policy.js";

export class LocalPolicyPublicationStore implements PolicyPublicationStore {
  constructor(private readonly outputDirectory: string) {}

  async publishApprovedVersion({ publication }: Parameters<PolicyPublicationStore["publishApprovedVersion"]>[0]): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    const { policy } = publication;
    await writeFile(join(this.outputDirectory, `${policy.region}-${policy.version}.json`), `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  }
}
