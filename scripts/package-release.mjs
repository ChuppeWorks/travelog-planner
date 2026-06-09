import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const root = resolve(import.meta.dirname, "..");
const release = resolve(root, "release");
const obsidianRelease = resolve(release, "obsidian/travelog-planner");
const notionRelease = resolve(release, "notion");

await rm(release, { recursive: true, force: true });
await mkdir(obsidianRelease, { recursive: true });
await cp(resolve(root, "apps/obsidian-plugin/dist/main.js"), resolve(obsidianRelease, "main.js"));
await cp(resolve(root, "apps/obsidian-plugin/manifest.json"), resolve(obsidianRelease, "manifest.json"));
await cp(resolve(root, "apps/obsidian-plugin/styles.css"), resolve(obsidianRelease, "styles.css"));

await cp(resolve(root, "notion"), notionRelease, { recursive: true });
await cp(resolve(root, "schema"), resolve(release, "schema"), { recursive: true });
await cp(resolve(root, "docs"), resolve(release, "docs"), { recursive: true });
await cp(resolve(root, "examples"), resolve(release, "examples"), { recursive: true });

const manifest = JSON.parse(await readFile(resolve(root, "apps/obsidian-plugin/manifest.json"), "utf8"));
await writeFile(
  resolve(release, "RELEASE.txt"),
  `Travelog Planner ${manifest.version}\n\nObsidian: obsidian/travelog-planner/\nNotion: notion/\n`,
);
await execFileAsync("zip", ["-qr", resolve(release, `travelog-planner-obsidian-${manifest.version}.zip`), "."], {
  cwd: obsidianRelease,
});
await execFileAsync("zip", ["-qr", resolve(release, `travelog-planner-notion-${manifest.version}.zip`), "."], {
  cwd: notionRelease,
});
console.log(`Packaged Travelog Planner ${manifest.version} in ${release}`);
