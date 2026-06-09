import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { datasetToNotionTables, NOTION_TABLE_FILES } from "../packages/interchange/src";
import { validateDataset, type TravelogDataset } from "../packages/schema/src";

const [input, outputDirectory] = process.argv.slice(2);
if (!input || !outputDirectory) {
  console.error("Usage: pnpm export:notion <travelog.json> <output-directory>");
  process.exit(1);
}

const dataset = JSON.parse(await readFile(resolve(input), "utf8")) as TravelogDataset;
const validation = validateDataset(dataset);
if (!validation.valid) throw new Error(`Invalid Travelog dataset:\n${validation.errors.join("\n")}`);

const output = resolve(outputDirectory);
await mkdir(output, { recursive: true });
const tables = datasetToNotionTables(dataset);
for (const [table, filename] of Object.entries(NOTION_TABLE_FILES)) {
  await writeFile(resolve(output, filename), tables[table as keyof typeof tables]);
}
console.log(`Exported ${Object.keys(tables).length} Notion CSV files to ${output}`);
