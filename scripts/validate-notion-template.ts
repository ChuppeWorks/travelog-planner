import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  datasetToNotionTables,
  notionTablesToDataset,
  NOTION_TABLE_FILES,
  parseCsv,
  type NotionTables,
} from "../packages/interchange/src";
import { validateDataset, type TravelogDataset } from "../packages/schema/src";

const root = resolve(import.meta.dirname, "..");
const blueprint = JSON.parse(await readFile(resolve(root, "notion/blueprint.json"), "utf8")) as {
  databases: Record<string, { file: string; properties: Record<string, string>; relations?: Record<string, string> }>;
};
const sample = JSON.parse(
  await readFile(resolve(root, "examples/kyoto-weekend.travelog.json"), "utf8"),
) as TravelogDataset;
const expectedTables = datasetToNotionTables(sample);
const actualTables = {} as NotionTables;
const errors: string[] = [];

for (const [databaseName, database] of Object.entries(blueprint.databases)) {
  const csv = await readFile(resolve(root, "notion", database.file), "utf8");
  actualTables[databaseName as keyof NotionTables] = csv;
  const headers = firstRecord(csv);
  const properties = Object.keys(database.properties);
  const missing = properties.filter((property) => !headers.includes(property));
  const extra = headers.filter((header) => !properties.includes(header));
  if (missing.length) errors.push(`${databaseName}: blueprint properties missing from CSV: ${missing.join(", ")}`);
  if (extra.length) errors.push(`${databaseName}: CSV headers missing from blueprint: ${extra.join(", ")}`);

  for (const [index, row] of parseCsv(csv).entries()) {
    try {
      JSON.parse(row["Travelog JSON"] ?? "");
    } catch {
      errors.push(`${databaseName}: row ${index + 2} has invalid Travelog JSON.`);
    }
  }
  for (const target of Object.values(database.relations ?? {})) {
    if (!blueprint.databases[target]) errors.push(`${databaseName}: relation target does not exist: ${target}`);
  }
}

const imported = notionTablesToDataset(actualTables);
const validation = validateDataset(imported);
errors.push(...validation.errors.map((error) => `Imported Notion dataset: ${error}`));

for (const [table, expected] of Object.entries(expectedTables)) {
  try {
    assert.equal(actualTables[table as keyof NotionTables], expected);
  } catch {
    errors.push(`${table}: sample CSV is stale; run pnpm generate:notion.`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${Object.keys(blueprint.databases).length} Notion databases and canonical round-trip.`);
}

function firstRecord(csv: string): string[] {
  const firstLine = csv.slice(0, csv.indexOf("\n"));
  return firstLine.split(",");
}
