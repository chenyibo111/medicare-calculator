import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/offline-demo/src/index.html");
const outputDirectory = resolve(root, "apps/offline-demo/dist");

await mkdir(outputDirectory, { recursive: true });
await cp(source, resolve(outputDirectory, "index.html"));
