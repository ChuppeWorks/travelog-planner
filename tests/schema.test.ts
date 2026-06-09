import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyRouteDelay,
  freezeTripBaseline,
  scheduleWarnings,
  shiftItemAndFollowing,
  timeInZone,
  validateDataset,
  zonedLocalToIso,
  type TravelogDataset,
} from "../packages/schema/src";

async function sample(): Promise<TravelogDataset> {
  return JSON.parse(await readFile(new URL("../examples/kyoto-weekend.travelog.json", import.meta.url), "utf8")) as TravelogDataset;
}

test("example dataset is valid", async () => {
  const result = validateDataset(await sample());
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("freezing baseline preserves it while a later shift changes current plan", async () => {
  const dataset = await sample();
  assert.equal(freezeTripBaseline(dataset, "trip_demo_kyoto"), 3);
  const baseline = dataset.timelineItems[1]!.schedule.baseline!.start;

  assert.equal(shiftItemAndFollowing(dataset, "route_demo_bus", 15), 2);
  assert.equal(dataset.timelineItems[1]!.schedule.baseline!.start, baseline);
  assert.equal(dataset.timelineItems[1]!.schedule.current.start, "2026-10-10T00:35:00.000Z");
  assert.equal(dataset.timelineItems[2]!.schedule.current.start, "2026-10-10T01:00:00.000Z");
  assert.equal(dataset.planChanges.length, 2);
});

test("shifting automatically preserves the original plan even without manual freeze", async () => {
  const dataset = await sample();
  const original = dataset.timelineItems[1]!.schedule.current.start;
  shiftItemAndFollowing(dataset, "route_demo_bus", 10);
  assert.equal(dataset.timelineItems[1]!.schedule.baseline!.start, original);
  assert.notEqual(dataset.timelineItems[1]!.schedule.current.start, original);
});

test("route delay is explicit and moves the route plus following items", async () => {
  const dataset = await sample();
  assert.equal(applyRouteDelay(dataset, "route_demo_bus", 20), 2);
  const route = dataset.timelineItems[1]!;
  assert.equal(route.kind, "route");
  if (route.kind === "route") assert.equal(route.route.delayMinutes, 20);
  assert.equal(dataset.planChanges.length, 3);
});

test("schedule warnings detect overlap and a broken route link", async () => {
  const dataset = await sample();
  dataset.timelineItems[1]!.schedule.current.start = "2026-10-10T09:10:00+09:00";
  const route = dataset.timelineItems[1]!;
  if (route.kind === "route") route.route.toPointId = "point_missing";

  const codes = scheduleWarnings(dataset, "day_demo_kyoto_1").map((warning) => warning.code);
  assert.ok(codes.includes("overlap"));
  assert.ok(codes.includes("broken-route-link"));
});

test("opening-hours warning uses the item's IANA timezone", async () => {
  const dataset = await sample();
  const point = dataset.timelineItems[2]!;
  if (point.kind === "point") {
    point.place.openingPeriods = [{ dayOfWeek: 6, opens: "12:00", closes: "18:00" }];
  }

  const codes = scheduleWarnings(dataset, "day_demo_kyoto_1").map((warning) => warning.code);
  assert.ok(codes.includes("outside-opening-hours"));
});

test("local trip time converts using the trip timezone instead of the computer timezone", () => {
  const instant = zonedLocalToIso("2026-10-10", "09:00", "Asia/Tokyo");
  assert.equal(instant, "2026-10-10T00:00:00.000Z");
  assert.equal(timeInZone(instant, "Asia/Tokyo"), "09:00");
});
