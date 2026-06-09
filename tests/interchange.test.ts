import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  datasetToNotionTables,
  notionTablesToDataset,
  parseCsv,
  stringifyCsv,
} from "../packages/interchange/src";
import { validateDataset, type TravelogDataset } from "../packages/schema/src";

async function sample(): Promise<TravelogDataset> {
  return JSON.parse(
    await readFile(new URL("../examples/kyoto-weekend.travelog.json", import.meta.url), "utf8"),
  ) as TravelogDataset;
}

test("Notion CSV export and import preserve the canonical Travelog entities", async () => {
  const original = await sample();
  const imported = notionTablesToDataset(datasetToNotionTables(original));
  delete imported.exportedAt;
  assert.deepEqual(imported, original);
  assert.equal(validateDataset(imported).valid, true);
});

test("visible Notion fields override preserved raw JSON", async () => {
  const tables = datasetToNotionTables(await sample());
  const rows = parseCsv(tables.Timeline);
  rows[0]!.Name = "Kyoto Station Hachijo Exit";
  tables.Timeline = stringifyCsv(Object.keys(rows[0]!), rows);
  const imported = notionTablesToDataset(tables);
  const point = imported.timelineItems.find((item) => item.id === "point_demo_station");
  assert.equal(point?.title, "Kyoto Station Hachijo Exit");
  assert.equal(point?.kind, "point");
  if (point?.kind === "point") assert.equal(point.place.name, "Kyoto Station");
});

test("clearing a visible Notion field removes the preserved raw value", async () => {
  const tables = datasetToNotionTables(await sample());
  const rows = parseCsv(tables.Timeline);
  rows[0]!.Address = "";
  rows[1]!.Line = "";
  tables.Timeline = stringifyCsv(Object.keys(rows[0]!), rows);
  const imported = notionTablesToDataset(tables);
  const point = imported.timelineItems.find((item) => item.id === "point_demo_station");
  const route = imported.timelineItems.find((item) => item.id === "route_demo_bus");
  if (point?.kind === "point") assert.equal(point.place.address, undefined);
  if (route?.kind === "route") assert.equal(route.route.lineName, undefined);
});

test("CSV utilities preserve commas, quotes, and multiline notes", () => {
  const csv = stringifyCsv(["Name", "Notes"], [{ Name: 'A "quoted", name', Notes: "line 1\nline 2" }]);
  assert.deepEqual(parseCsv(csv), [{ Name: 'A "quoted", name', Notes: "line 1\nline 2" }]);
});
