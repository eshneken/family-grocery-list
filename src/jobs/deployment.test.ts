import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

const fakeCommand = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2).join(" ");
const tool = require("node:path").basename(process.argv[1]);
fs.appendFileSync(process.env.MOCK_LOG, tool + " " + args + "\\n");
const failure = process.env.MOCK_FAILURE;
if (tool === "curl") process.exit(failure === "readiness" ? 1 : 0);
if (args.includes("get configmap grocery-bootstrap-state") && failure === "missing-marker") {
  process.exit(1);
} else if (args.includes("get jobs")) {
  const active = failure === "active-job" && !fs.existsSync(process.env.MOCK_ACTIVE_SEEN);
  fs.writeFileSync(process.env.MOCK_ACTIVE_SEEN, "yes");
  console.log(JSON.stringify({ items: active ? [{ metadata: { labels: { task: "postgres-backup" } }, status: { active: 1 } }] : [] }));
} else if (args.includes("get cronjob grocery-postgres-backup")) {
  console.log("true");
} else if (args.includes("get cronjob")) {
  if (process.env.MOCK_EXISTING === "yes" || fs.existsSync(process.env.MOCK_CREATED)) console.log("cronjob.batch/grocery-shopping-timeout");
} else if (args.includes("get deployment")) {
  console.log("ghcr.io/example/app@sha256:" + "b".repeat(64));
} else if (args.startsWith("kustomize")) {
  console.log("kind: List\\nitems: []");
} else if (args.includes("apply --filename=") && args.includes("/application/rendered.yaml")) {
  fs.writeFileSync(process.env.MOCK_CREATED, "yes");
  if (failure === "apply") process.exit(1);
} else if (args.includes("wait --for=condition=complete") && failure === "migration") {
  process.exit(1);
} else if (args.includes("rollout status") && failure === "rollout" && !fs.existsSync(process.env.MOCK_ROLLED_BACK)) {
  fs.writeFileSync(process.env.MOCK_ROLLED_BACK, "yes");
  process.exit(1);
} else if (args.includes('"suspend":false') && failure === "activation") {
  process.exit(1);
}
`;

function deploy(existing: boolean, failure = "", readiness = "public") {
  const dir = mkdtempSync(join(tmpdir(), "grocery-deployment-test-"));
  try {
    for (const name of ["kubectl", "curl", "sleep"]) {
      writeFileSync(join(dir, name), fakeCommand, { mode: 0o700 });
    }
    const log = join(dir, "commands");
    let passed = true;
    try {
      execFileSync("bash", [resolve("scripts/deploy-application.sh")], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          IMAGE_REFERENCE: `ghcr.io/example/app@sha256:${"a".repeat(64)}`,
          RELEASE_ID: "c".repeat(40),
          READINESS_MODE: readiness,
          DEPLOYMENT_MODE: "restore-existing",
          MOCK_ACTIVE_SEEN: join(dir, "active-seen"),
          APP_HOSTNAME: "grocery.example.test",
          GOOGLE_CLIENT_ID: "test-client",
          GOOGLE_CLIENT_SECRET: "test-secret",
          NEXTAUTH_SECRET: "test-only-secret-with-at-least-32-characters",
          MOCK_LOG: log,
          MOCK_EXISTING: existing ? "yes" : "no",
          MOCK_FAILURE: failure,
          MOCK_CREATED: join(dir, "created"),
          MOCK_ROLLED_BACK: join(dir, "rolled-back")
        },
        stdio: "pipe"
      });
    } catch {
      passed = false;
    }
    return { passed, commands: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("production cleanup scheduling gate", () => {
  it.each([false, true])("enables only after readiness (existing scheduler: %s)", (existing) => {
    const { passed, commands } = deploy(existing);
    expect(passed).toBe(true);
    const activate = commands.findIndex((line) => line.includes('"suspend":false'));
    const ready = commands.findIndex((line) => line.startsWith("curl "));
    expect(activate).toBeGreaterThan(ready);
    expect(ready).toBeGreaterThan(commands.findIndex((line) => line.includes("rollout status")));
    if (existing) {
      expect(commands.findIndex((line) => line.includes('"suspend":true')))
        .toBeLessThan(commands.findIndex((line) => line.includes("kustomize")));
    }
    expect(readFileSync(resolve("deploy/k8s/application/shopping-timeout.yaml"), "utf8"))
      .toContain("suspend: true");
  });

  it.each(["migration", "apply", "rollout", "readiness", "activation"])
    ("leaves scheduling suspended after %s failure", (failure) => {
      const { passed, commands } = deploy(true, failure);
      expect(passed).toBe(false);
      const patches = commands.filter((line) => line.includes("patch cronjob"));
      expect(patches.at(-1)).toContain('"suspend":true');
      if (failure !== "activation") expect(patches.join("\n")).not.toContain('"suspend":false');
      if (failure === "rollout" || failure === "readiness") {
        expect(commands.some((line) => line.includes("set image deployment/grocery-app"))).toBe(true);
      }
    });

  it("refuses a restored environment without its reviewed restore marker", () => {
    const { passed, commands } = deploy(true, "missing-marker");
    expect(passed).toBe(false);
    expect(commands.join("\n")).not.toContain("kustomize");
  });

  it("keeps maintenance jobs paused when only internal readiness is requested", () => {
    const { passed, commands } = deploy(true, "", "internal");
    expect(passed).toBe(true);
    expect(commands.join("\n")).not.toContain("curl ");
    expect(commands.join("\n")).not.toContain('"suspend":false');
  });

  it("waits for an active backup before migrations", () => {
    const { passed, commands } = deploy(true, "active-job");
    expect(passed).toBe(true);
    expect(commands.filter((line) => line.includes("get jobs"))).toHaveLength(2);
    expect(commands.findIndex((line) => line.includes("sleep 15")))
      .toBeLessThan(commands.findIndex((line) => line.includes("kustomize")));
  });

  it("keeps a newly-created scheduler suspended after readiness failure", () => {
    const { passed, commands } = deploy(false, "readiness");
    expect(passed).toBe(false);
    expect(commands.filter((line) => line.includes("patch cronjob")).at(-1))
      .toContain('"suspend":true');
    expect(commands.join("\n")).not.toContain('"suspend":false');
  });
});
