import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublishedPolicyStore } from "../../application/src/publish-policy.js";
import type { PublishedPolicy } from "../../domain/src/policy.js";

export class LocalPolicyPublicationStore implements PublishedPolicyStore {
  constructor(private readonly outputDirectory: string) {}

  async savePublished(policy: PublishedPolicy & { readonly status: "published" }): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    await writeFile(join(this.outputDirectory, `${policy.region}-${policy.version}.json`), `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  }
}
