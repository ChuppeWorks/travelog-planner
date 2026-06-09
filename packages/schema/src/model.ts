import {
  SCHEMA_VERSION,
  type Id,
  type ISODateTime,
  type PlanChange,
  type ScheduleWarning,
  type TimelineItem,
  type TravelogDataset,
} from "./types";
import { partsInTimeZone } from "./time";

export function createEmptyDataset(): TravelogDataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    trips: [],
    days: [],
    timelineItems: [],
    checklistItems: [],
    expenses: [],
    attachments: [],
    planChanges: [],
  };
}

export function newId(prefix: string): Id {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

export function nowIso(): ISODateTime {
  return new Date().toISOString();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function freezeTripBaseline(dataset: TravelogDataset, tripId: Id): number {
  let count = 0;
  for (const item of dataset.timelineItems) {
    if (item.tripId === tripId && !item.schedule.baseline) {
      item.schedule.baseline = clone(item.schedule.current);
      item.updatedAt = nowIso();
      count += 1;
    }
  }
  return count;
}

export function ensureBaseline(item: TimelineItem): void {
  if (!item.schedule.baseline) item.schedule.baseline = clone(item.schedule.current);
}

export function updateCurrentSchedule(
  dataset: TravelogDataset,
  itemId: Id,
  start: ISODateTime | null,
  end: ISODateTime | null,
  reason?: string,
): void {
  const item = dataset.timelineItems.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Timeline item not found: ${itemId}`);

  ensureBaseline(item);
  const before = clone(item.schedule.current);
  item.schedule.current = { ...item.schedule.current, start, end };
  item.updatedAt = nowIso();
  dataset.planChanges.push(createPlanChange(item, before, clone(item.schedule.current), reason));
}

export function shiftItemAndFollowing(
  dataset: TravelogDataset,
  itemId: Id,
  minutes: number,
  reason = `Shifted by ${minutes} minutes`,
): number {
  const anchor = dataset.timelineItems.find((item) => item.id === itemId);
  if (!anchor) throw new Error(`Timeline item not found: ${itemId}`);

  const items = dataset.timelineItems
    .filter((item) => item.dayId === anchor.dayId && item.sortOrder >= anchor.sortOrder)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const item of items) {
    ensureBaseline(item);
    const before = clone(item.schedule.current);
    item.schedule.current = {
      ...item.schedule.current,
      start: shiftDateTime(item.schedule.current.start, minutes),
      end: shiftDateTime(item.schedule.current.end, minutes),
    };
    item.updatedAt = nowIso();
    dataset.planChanges.push(
      createPlanChange(item, before, clone(item.schedule.current), reason),
    );
  }

  return items.length;
}

export function applyRouteDelay(dataset: TravelogDataset, routeId: Id, minutes: number): number {
  const route = dataset.timelineItems.find((item) => item.id === routeId);
  if (!route || route.kind !== "route") throw new Error(`Route not found: ${routeId}`);
  const before = { delayMinutes: route.route.delayMinutes ?? 0 };
  route.route.delayMinutes = before.delayMinutes + minutes;
  route.updatedAt = nowIso();
  dataset.planChanges.push(
    createPlanChange(route, before, { delayMinutes: route.route.delayMinutes }, `Route delay changed by ${minutes} minutes`),
  );
  return shiftItemAndFollowing(dataset, routeId, minutes, `Applied route delay of ${minutes} minutes`);
}

export function scheduleWarnings(dataset: TravelogDataset, dayId: Id): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const items = dataset.timelineItems
    .filter((item) => item.dayId === dayId)
    .sort(compareTimelineItems);

  for (const [index, item] of items.entries()) {
    const { start, end } = item.schedule.current;
    if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
      warnings.push({
        code: "invalid-window",
        itemId: item.id,
        message: `${item.title}: end time is before start time.`,
      });
    }

    const previous = items[index - 1];
    if (previous?.schedule.current.end && start) {
      if (new Date(previous.schedule.current.end).getTime() > new Date(start).getTime()) {
        warnings.push({
          code: "overlap",
          itemId: item.id,
          message: `${item.title}: overlaps with ${previous.title}.`,
        });
      }
    }

    if (item.kind === "point" && start && end && item.place.openingPeriods?.length) {
      if (!isInsideOpeningHours(start, end, item.schedule.current.timeZone, item.place.openingPeriods)) {
        warnings.push({
          code: "outside-opening-hours",
          itemId: item.id,
          message: `${item.title}: planned visit is outside the saved opening hours.`,
        });
      }
    }

    if (item.kind === "route") {
      for (const pointId of [item.route.fromPointId, item.route.toPointId]) {
        if (pointId && !dataset.timelineItems.some((candidate) => candidate.id === pointId && candidate.kind === "point")) {
          warnings.push({
            code: "broken-route-link",
            itemId: item.id,
            message: `${item.title}: route references a missing point.`,
          });
          break;
        }
      }
    }
  }

  return warnings;
}

export function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  const aStart = a.schedule.current.start ? new Date(a.schedule.current.start).getTime() : Number.MAX_SAFE_INTEGER;
  const bStart = b.schedule.current.start ? new Date(b.schedule.current.start).getTime() : Number.MAX_SAFE_INTEGER;
  return aStart - bStart || a.sortOrder - b.sortOrder;
}

function createPlanChange(
  item: TimelineItem,
  before: unknown,
  after: unknown,
  reason?: string,
): PlanChange {
  return {
    id: newId("change"),
    tripId: item.tripId,
    entityType: "timelineItem",
    entityId: item.id,
    changedAt: nowIso(),
    source: "user",
    ...(reason ? { reason } : {}),
    before: before as Record<string, unknown>,
    after: after as Record<string, unknown>,
  };
}

function shiftDateTime(value: ISODateTime | null, minutes: number): ISODateTime | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function isInsideOpeningHours(
  start: ISODateTime,
  end: ISODateTime,
  timeZone: string,
  periods: Array<{ dayOfWeek: number; opens: string; closes: string }>,
): boolean {
  const startParts = partsInTimeZone(new Date(start), timeZone);
  const endParts = partsInTimeZone(new Date(end), timeZone);
  const dayDifference = Math.round(
    (Date.UTC(endParts.year, endParts.month - 1, endParts.day) -
      Date.UTC(startParts.year, startParts.month - 1, startParts.day)) /
      86_400_000,
  );
  const visitStart = startParts.dayOfWeek * 1_440 + startParts.hour * 60 + startParts.minute;
  const visitEnd =
    startParts.dayOfWeek * 1_440 + dayDifference * 1_440 + endParts.hour * 60 + endParts.minute;
  const weekMinutes = 7 * 1_440;

  return periods.some((period) => {
    const opens = period.dayOfWeek * 1_440 + minutes(period.opens);
    let closes = period.dayOfWeek * 1_440 + minutes(period.closes);
    if (closes <= opens) closes += 1_440;
    return [-weekMinutes, 0, weekMinutes].some(
      (shift) => opens + shift <= visitStart && closes + shift >= visitEnd,
    );
  });
}

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}
