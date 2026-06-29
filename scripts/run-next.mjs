import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveLaunchConfig } from "./run-next-config.mjs";

export function launchNext(argv = process.argv.slice(2), sourceEnv = process.env) {
  const config = resolveLaunchConfig(argv, sourceEnv);
  const nextBin = path.resolve("node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, config.command, ...config.forwardedArgs], {
    env: config.env,
    stdio: "inherit"
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("error", (error) => {
    console.error(`Unable to start Next.js: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });

  return child;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    launchNext();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
