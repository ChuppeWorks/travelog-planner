import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { datasetToNotionTables, NOTION_TABLE_FILES } from "../packages/interchange/src";
import type { TravelogDataset } from "../packages/schema/src";

const root = resolve(import.meta.dirname, "..");
const dataset = JSON.parse(
  await readFile(resolve(root, "examples/kyoto-weekend.travelog.json"), "utf8"),
) as TravelogDataset;
const output = resolve(root, "notion/csv");
await mkdir(output, { recursive: true });
const tables = datasetToNotionTables(dataset);
for (const [table, filename] of Object.entries(NOTION_TABLE_FILES)) {
  await writeFile(resolve(output, filename), tables[table as keyof typeof tables]);
}
console.log(`Generated Notion sample CSVs from the canonical example dataset.`);
