import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// Exercise Next's actual consumer of the fast-glob -> tinyglobby security override.
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir: string | string[] } } }): string[];
};

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Next ESLint root discovery with the patched glob dependency", () => {
  it("discovers project directories from globs while excluding matching files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "grocery-eslint-"));
    directories.push(root);
    mkdirSync(path.join(root, "app-one"));
    mkdirSync(path.join(root, "app-two"));
    writeFileSync(path.join(root, "app-file"), "not a directory");

    const found = getRootDirs({ cwd: root, settings: { next: { rootDir: `${root}/app-*` } } });
    // Both glob implementations identify the same directories; tinyglobby can
    // express absolute input patterns as relative paths with trailing slashes.
    expect(found.map((directory) => path.resolve(directory)).sort())
      .toEqual([path.join(root, "app-one"), path.join(root, "app-two")]);
  });

  it("supports array configuration and backslash normalization without matching missing roots", () => {
    const root = mkdtempSync(path.join(tmpdir(), "grocery-eslint-"));
    directories.push(root);
    const app = path.join(root, "web");
    mkdirSync(app);

    expect(getRootDirs({
      cwd: root,
      settings: { next: { rootDir: [app.replaceAll("/", "\\"), `${root}/missing-*`] } }
    }).map((directory) => path.resolve(directory))).toEqual([app]);
    expect(getRootDirs({ cwd: root, settings: {} })).toEqual([root]);
  });
});
