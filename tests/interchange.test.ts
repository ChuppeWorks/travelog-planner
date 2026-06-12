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
  const point = original.timelineItems.find((item) => item.id === "point_demo_station");
  if (point?.kind === "point") {
    point.place.openingPeriods = [
      { dayOfWeek: 5, opens: "10:00", closes: "17:00" },
      { dayOfWeek: 6, opens: "06:00", closes: "23:00" },
      { dayOfWeek: 0, opens: "08:00", closes: "20:00" },
    ];
    point.place.openingHoursText = "Weekly schedule";
  }
  const imported = notionTablesToDataset(datasetToNotionTables(original));
  delete imported.exportedAt;
  assert.deepEqual(imported, original);
  assert.equal(validateDataset(imported).valid, true);
});

test("visible Notion fields override preserved raw JSON", async () => {
  const tables = datasetToNotionTables(await sample());
  const rows = parseCsv(tables.Timeline);
  rows[0]!.Name = "Kyoto Station Hachijo Exit";
  rows[0]!.Opens = "05:30";
  rows[0]!.Closes = "23:30";
  tables.Timeline = stringifyCsv(Object.keys(rows[0]!), rows);
  const imported = notionTablesToDataset(tables);
  const point = imported.timelineItems.find((item) => item.id === "point_demo_station");
  assert.equal(point?.title, "Kyoto Station Hachijo Exit");
  assert.equal(point?.kind, "point");
  if (point?.kind === "point") {
    assert.equal(point.place.name, "Kyoto Station");
    assert.deepEqual(point.place.openingPeriods, [{ dayOfWeek: 6, opens: "05:30", closes: "23:30" }]);
    assert.equal(point.place.openingHoursText, "05:30-23:30");
  }
});

test("Notion exposes one translated place name while preserving canonical name choices", async () => {
  const dataset = await sample();
  const point = dataset.timelineItems.find((item) => item.id === "point_demo_station");
  if (point?.kind === "point") {
    point.place.originalName = { text: "京都駅", languageCode: "ja", provider: "google-places" };
    point.place.localizedNames = [{ text: "Kyoto Station", languageCode: "en", provider: "google-places" }];
    point.place.nameDisplayPreference = "original";
  }
  const tables = datasetToNotionTables(dataset);
  const rows = parseCsv(tables.Timeline);
  assert.equal(rows[0]!["Original name"], "京都駅");
  assert.equal(rows[0]!["Google translated name"], "Kyoto Station");
  assert.equal(rows[0]!["Name display"], "original");

  const imported = notionTablesToDataset(tables);
  const importedPoint = imported.timelineItems.find((item) => item.id === "point_demo_station");
  assert.equal(importedPoint?.kind, "point");
  if (importedPoint?.kind === "point") {
    assert.equal(importedPoint.place.originalName?.text, "京都駅");
    assert.equal(importedPoint.place.originalName?.languageCode, "ja");
    assert.equal(importedPoint.place.originalName?.provider, "google-places");
    assert.equal(importedPoint.place.localizedNames?.[0]?.languageCode, "en");
    assert.equal(importedPoint.place.nameDisplayPreference, "original");
  }
});

test("clearing a visible Notion field removes the preserved raw value", async () => {
  const dataset = await sample();
  const pointWithHours = dataset.timelineItems.find((item) => item.id === "point_demo_station");
  if (pointWithHours?.kind === "point") {
    pointWithHours.place.openingPeriods = [{ dayOfWeek: 6, opens: "06:00", closes: "23:00" }];
    pointWithHours.place.openingHoursText = "06:00-23:00";
  }
  const tables = datasetToNotionTables(dataset);
  const rows = parseCsv(tables.Timeline);
  rows[0]!.Address = "";
  rows[0]!.Opens = "";
  rows[0]!.Closes = "";
  rows[1]!.Line = "";
  tables.Timeline = stringifyCsv(Object.keys(rows[0]!), rows);
  const imported = notionTablesToDataset(tables);
  const point = imported.timelineItems.find((item) => item.id === "point_demo_station");
  const route = imported.timelineItems.find((item) => item.id === "route_demo_bus");
  if (point?.kind === "point") {
    assert.equal(point.place.address, undefined);
    assert.equal(point.place.openingPeriods, undefined);
    assert.equal(point.place.openingHoursText, undefined);
  }
  if (route?.kind === "route") assert.equal(route.route.lineName, undefined);
});

test("Notion opening times require a complete standardized HH:mm pair", async () => {
  const tables = datasetToNotionTables(await sample());
  const rows = parseCsv(tables.Timeline);
  rows[0]!.Opens = "6am";
  rows[0]!.Closes = "";
  tables.Timeline = stringifyCsv(Object.keys(rows[0]!), rows);
  assert.throws(
    () => notionTablesToDataset(tables),
    /must provide Opens and Closes as HH:mm/,
  );
});

test("CSV utilities preserve commas, quotes, and multiline notes", () => {
  const csv = stringifyCsv(["Name", "Notes"], [{ Name: 'A "quoted", name', Notes: "line 1\nline 2" }]);
  assert.deepEqual(parseCsv(csv), [{ Name: 'A "quoted", name', Notes: "line 1\nline 2" }]);
});
