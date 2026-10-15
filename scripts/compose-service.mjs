import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const root = new URL("./", import.meta.url);
const migrationScript = new URL("db-migrate.mjs", root);
const seedScript = new URL("db-seed.mjs", root);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} 退出，状态码 ${code ?? "未知"}`));
    });
  });
}

for (const script of [migrationScript, seedScript]) {
  if (!existsSync(script)) {
    throw new Error(
      `Compose 服务缺少 ${script.pathname.split("/").at(-1)}。请使用包含数据库迁移与种子的完整项目版本。`,
    );
  }
}

await run("pnpm", ["exec", "tsx", migrationScript.pathname]);
await run("pnpm", ["exec", "tsx", seedScript.pathname]);
await run("pnpm", ["--filter", "@medicare/service-web", "start"]);
