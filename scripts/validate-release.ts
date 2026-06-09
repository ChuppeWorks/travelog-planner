import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rootManifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as Record<string, unknown>;
const pluginManifest = JSON.parse(
  await readFile(resolve(root, "apps/obsidian-plugin/manifest.json"), "utf8"),
) as Record<string, unknown>;
const rootVersions = JSON.parse(await readFile(resolve(root, "versions.json"), "utf8")) as Record<string, string>;
const pluginVersions = JSON.parse(
  await readFile(resolve(root, "apps/obsidian-plugin/versions.json"), "utf8"),
) as Record<string, string>;
const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string };

assert.deepEqual(rootManifest, pluginManifest, "Root and plugin manifests must match.");
assert.deepEqual(rootVersions, pluginVersions, "Root and plugin versions files must match.");
assert.equal(rootPackage.version, rootManifest.version, "Root package and manifest versions must match.");
assert.equal(rootVersions[String(rootManifest.version)], rootManifest.minAppVersion, "versions.json must include the current release.");
console.log(`Validated Obsidian release metadata ${String(rootManifest.version)}.`);
