import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyRouteDelay,
  freezeTripBaseline,
  moveTravelDay,
  scheduleWarnings,
  shiftItemAndFollowing,
  syncTripDateRange,
  timeInZone,
  updateTravelDay,
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

test("opening-hours warning accepts visits inside an overnight period", async () => {
  const dataset = await sample();
  const point = dataset.timelineItems[2]!;
  point.schedule.current.start = "2026-10-10T14:30:00.000Z";
  point.schedule.current.end = "2026-10-10T15:30:00.000Z";
  if (point.kind === "point") {
    point.place.openingPeriods = [{ dayOfWeek: 6, opens: "18:00", closes: "02:00" }];
  }

  const codes = scheduleWarnings(dataset, "day_demo_kyoto_1").map((warning) => warning.code);
  assert.ok(!codes.includes("outside-opening-hours"));
});

test("opening periods require a weekday and standardized HH:mm values", async () => {
  const dataset = await sample();
  const point = dataset.timelineItems[2]!;
  if (point.kind === "point") {
    point.place.openingPeriods = [{ dayOfWeek: 8, opens: "9am", closes: "18:00" }];
  }

  const errors = validateDataset(dataset).errors;
  assert.ok(errors.some((error) => error.includes("dayOfWeek from 0 to 6")));
  assert.ok(errors.some((error) => error.includes("must use HH:mm times")));
});

test("local trip time converts using the trip timezone instead of the computer timezone", () => {
  const instant = zonedLocalToIso("2026-10-10", "09:00", "Asia/Tokyo");
  assert.equal(instant, "2026-10-10T00:00:00.000Z");
  assert.equal(timeInZone(instant, "Asia/Tokyo"), "09:00");
});

test("trip date range synchronization creates missing days and removes only empty outside days", async () => {
  const dataset = await sample();
  const result = syncTripDateRange(dataset, "trip_demo_kyoto", "2026-10-10", "2026-10-12", "Asia/Tokyo");
  assert.equal(result.createdDayIds.length, 1);
  assert.deepEqual(result.removedDayIds, []);
  assert.deepEqual(
    dataset.days.filter((day) => day.tripId === "trip_demo_kyoto").map((day) => [day.date, day.sortOrder]),
    [
      ["2026-10-10", 0],
      ["2026-10-11", 1],
      ["2026-10-12", 2],
    ],
  );

  const reduced = syncTripDateRange(dataset, "trip_demo_kyoto", "2026-10-10", "2026-10-10", "Asia/Tokyo");
  assert.equal(reduced.removedDayIds.length, 2);
  assert.deepEqual(dataset.days.filter((day) => day.tripId === "trip_demo_kyoto").map((day) => day.date), ["2026-10-10"]);
});

test("trip date range synchronization refuses to remove a populated day", async () => {
  const dataset = await sample();
  const before = structuredClone(dataset.days);
  const result = syncTripDateRange(dataset, "trip_demo_kyoto", "2026-10-11", "2026-10-11", "Asia/Tokyo");
  assert.deepEqual(result.blockedDates, ["2026-10-10"]);
  assert.deepEqual(dataset.days, before);
});

test("moving a travel day preserves local clock times, baseline, and a contiguous trip range", async () => {
  const dataset = await sample();
  const item = dataset.timelineItems.find((candidate) => candidate.dayId === "day_demo_kyoto_1")!;
  const originalStart = item.schedule.current.start;
  const originalLocalStart = timeInZone(originalStart, item.schedule.current.timeZone);

  const result = moveTravelDay(dataset, "day_demo_kyoto_1", "2026-10-12", "Europe/Paris");
  assert.equal(result.movedItemCount, 3);
  assert.equal(result.expandedTripRange, true);
  assert.equal(result.createdDayIds.length, 1);
  assert.equal(item.schedule.baseline?.start, originalStart);
  assert.equal(timeInZone(item.schedule.current.start, "Europe/Paris"), originalLocalStart);
  assert.equal(item.schedule.current.timeZone, "Europe/Paris");
  assert.deepEqual(
    dataset.days
      .filter((day) => day.tripId === "trip_demo_kyoto")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((day) => day.date),
    ["2026-10-10", "2026-10-11", "2026-10-12"],
  );
  assert.equal(dataset.trips[0]!.endDate, "2026-10-12");
  assert.equal(dataset.planChanges.filter((change) => change.entityType === "timelineItem").length, 3);
  assert.equal(dataset.planChanges.filter((change) => change.entityType === "day").length, 1);
  assert.equal(dataset.planChanges.filter((change) => change.entityType === "trip").length, 1);
});

test("editing only travel-day metadata does not freeze unchanged item schedules", async () => {
  const dataset = await sample();
  updateTravelDay(dataset, "day_demo_kyoto_1", {
    date: "2026-10-10",
    timeZone: "Asia/Tokyo",
    title: "Arrival day",
    notes: "Meet at the station",
  });
  assert.equal(dataset.days[0]!.title, "Arrival day");
  assert.equal(dataset.timelineItems.some((item) => item.schedule.baseline), false);
  assert.equal(dataset.planChanges.filter((change) => change.entityType === "day").length, 1);
  assert.equal(dataset.planChanges.filter((change) => change.entityType === "timelineItem").length, 0);
});
