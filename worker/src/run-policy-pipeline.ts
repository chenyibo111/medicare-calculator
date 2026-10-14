import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyPublisher } from "../../packages/application/src/publish-policy.js";
import { DemoExtractionAdapter } from "../../packages/infrastructure/src/demo-extraction-adapter.js";
import { LocalPolicyPublicationStore } from "../../packages/infrastructure/src/local-policy-publication-store.js";
import { LocalPolicySource } from "../../packages/infrastructure/src/local-policy-source.js";
import { LocalReviewGateway } from "../../packages/infrastructure/src/local-review-gateway.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = await new LocalPolicySource().fetch(resolve(root, "data/raw-policy-sources/city-a-source.json"));
const draft = await new DemoExtractionAdapter().propose(source);
const draftDirectory = resolve(root, "data/policy-drafts");
await mkdir(draftDirectory, { recursive: true });
await writeFile(resolve(draftDirectory, `${draft.id}.json`), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
const reviewGateway = new LocalReviewGateway();
const approved = await reviewGateway.approve(draft, "demo-policy-reviewer");
const published = await new PolicyPublisher({ store: new LocalPolicyPublicationStore(resolve(root, "data/published-policies")), reviewGateway }).publish(approved);

console.log(JSON.stringify({ source: source.sourceUrl, draft: draft.id, demoAIProposal: draft.demoAIProposal, reviewer: approved.reviewer, publishedVersion: published.policy.version, outboxEvent: "policy.published" }, null, 2));
