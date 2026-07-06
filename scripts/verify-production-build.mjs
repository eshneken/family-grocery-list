import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const staticDirectory = path.resolve(".next/static");
const serverPath = path.resolve(".next/standalone/server.js");
const port = 3100;
const healthUrl = `http://127.0.0.1:${port}/api/health/live`;

/** Recursively lists production assets without relying on shell-specific glob behavior. */
async function filesWithin(directory) {
  const entries = await readdir(directory);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry);
      return (await stat(entryPath)).isDirectory() ? filesWithin(entryPath) : [entryPath];
    })
  );
  return files.flat();
}

/**
 * Confirms that Next produced compact JavaScript and CSS bundles rather than copying source assets.
 * The test allows a few non-empty lines for license banners while rejecting unminified source files.
 */
async function assertMinifiedAssets() {
  const assets = (await filesWithin(staticDirectory)).filter((file) => /\.(?:js|css)$/.test(file));
  if (assets.length === 0) throw new Error("Production build did not produce JavaScript or CSS assets.");

  for (const asset of assets) {
    const source = await readFile(asset, "utf8");
    const nonEmptyLines = source.split(/\r?\n/).filter((line) => line.trim()).length;
    if (nonEmptyLines > 3) {
      throw new Error(`Expected minified production asset, but ${path.relative(process.cwd(), asset)} has ${nonEmptyLines} non-empty lines.`);
    }
  }

  console.log(`Verified ${assets.length} compact JavaScript/CSS production assets.`);
}

/** Waits for the standalone server so the image build proves its optimized output can boot. */
async function waitForHealth(server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Standalone server exited early with code ${server.exitCode}.`);

    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The server normally needs a short startup window before it can accept the health probe.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Standalone server did not become healthy at ${healthUrl}.`);
}

/** Waits only when the child is still running, avoiding a missed exit event after a startup failure. */
async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

/** Starts the optimized standalone app, probes it, and always shuts it down before the image layer ends. */
async function verifyRuntime() {
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, HOSTNAME: "127.0.0.1", NODE_ENV: "production", PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await waitForHealth(server);
    console.log("Verified optimized standalone server health endpoint.");
  } finally {
    await stopServer(server);
  }
}

/** Verifies both production asset compactness and runtime health for the Docker build stage. */
async function main() {
  await assertMinifiedAssets();
  await verifyRuntime();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
