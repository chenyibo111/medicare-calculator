import { build } from "esbuild";
import { cp, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "apps/offline-demo/src");
const outputDirectory = resolve(root, "apps/offline-demo/dist");

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  cp(resolve(sourceDirectory, "index.html"), resolve(outputDirectory, "index.html")),
  cp(resolve(sourceDirectory, "styles.css"), resolve(outputDirectory, "styles.css")),
]);
await build({
  entryPoints: [resolve(sourceDirectory, "main.ts")], bundle: true, format: "iife", platform: "browser", target: ["es2022"], outfile: resolve(outputDirectory, "app.js"),
  plugins: [{ name: "typescript-source-imports", setup(build) { build.onResolve({ filter: /\.js$/ }, (args) => { const candidate = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts")); return existsSync(candidate) ? { path: candidate } : undefined; }); } }],
});
await stat(resolve(outputDirectory, "app.js"));
