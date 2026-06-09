import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { notionTablesToDataset, NOTION_TABLE_FILES, type NotionTables } from "../packages/interchange/src";
import { validateDataset } from "../packages/schema/src";

const [inputDirectory, output] = process.argv.slice(2);
if (!inputDirectory || !output) {
  console.error("Usage: pnpm import:notion <csv-directory> <travelog.json>");
  process.exit(1);
}

const tables: Partial<NotionTables> = {};
for (const [table, filename] of Object.entries(NOTION_TABLE_FILES)) {
  try {
    tables[table as keyof NotionTables] = await readFile(resolve(inputDirectory, filename), "utf8");
  } catch {
    console.warn(`Skipping missing table: ${filename}`);
  }
}
const dataset = notionTablesToDataset(tables);
const validation = validateDataset(dataset);
if (!validation.valid) throw new Error(`Imported dataset is invalid:\n${validation.errors.join("\n")}`);
await writeFile(resolve(output), `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Imported Notion CSV files into ${resolve(output)}`);
