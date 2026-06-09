import {
  SCHEMA_VERSION,
  type Id,
  type ISODateTime,
  type PlanChange,
  type ScheduleWarning,
  type TimelineItem,
  type TravelDay,
  type TravelogDataset,
} from "./types";
import { partsInTimeZone, timeInZone, zonedLocalToIso } from "./time";

export interface SyncTripDateRangeResult {
  createdDayIds: Id[];
  removedDayIds: Id[];
  blockedDates: string[];
}

export interface MoveTravelDayResult {
  movedItemCount: number;
  createdDayIds: Id[];
  expandedTripRange: boolean;
}

export interface TravelDayUpdate {
  date: string;
  timeZone: string;
  title?: string;
  notes?: string;
}

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

export function datesInRange(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`);
  }
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function dayHasContent(dataset: TravelogDataset, dayId: Id): boolean {
  return (
    dataset.timelineItems.some((item) => item.dayId === dayId) ||
    dataset.checklistItems.some((item) => item.dayId === dayId) ||
    dataset.expenses.some((item) => item.dayId === dayId) ||
    dataset.attachments.some((item) => item.dayId === dayId)
  );
}

export function resortTripDays(dataset: TravelogDataset, tripId: Id): void {
  dataset.days
    .filter((day) => day.tripId === tripId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder)
    .forEach((day, index) => {
      day.sortOrder = index;
    });
}

export function syncTripDateRange(
  dataset: TravelogDataset,
  tripId: Id,
  startDate: string,
  endDate: string,
  defaultTimeZone: string,
): SyncTripDateRangeResult {
  if (!dataset.trips.some((trip) => trip.id === tripId)) {
    throw new Error(`Trip not found: ${tripId}`);
  }
  assertTimeZone(defaultTimeZone);
  const desiredDates = datesInRange(startDate, endDate);
  const desired = new Set(desiredDates);
  const tripDays = dataset.days.filter((day) => day.tripId === tripId);
  const outsideDays = tripDays.filter((day) => !desired.has(day.date));
  const blockedDates = outsideDays.filter((day) => dayHasContent(dataset, day.id)).map((day) => day.date).sort();
  if (blockedDates.length) {
    return { createdDayIds: [], removedDayIds: [], blockedDates };
  }

  const removedDayIds = outsideDays.map((day) => day.id);
  const removed = new Set(removedDayIds);
  dataset.days = dataset.days.filter((day) => !removed.has(day.id));

  const existingDates = new Set(
    dataset.days.filter((day) => day.tripId === tripId).map((day) => day.date),
  );
  const createdDays: TravelDay[] = desiredDates
    .filter((date) => !existingDates.has(date))
    .map((date) => ({
      id: newId("day"),
      tripId,
      date,
      sortOrder: 0,
      timeZone: defaultTimeZone,
    }));
  dataset.days.push(...createdDays);
  resortTripDays(dataset, tripId);
  return {
    createdDayIds: createdDays.map((day) => day.id),
    removedDayIds,
    blockedDates: [],
  };
}

export function moveTravelDay(
  dataset: TravelogDataset,
  dayId: Id,
  date: string,
  timeZone: string,
  reason = "Moved travel day",
): MoveTravelDayResult {
  const day = dataset.days.find((candidate) => candidate.id === dayId);
  if (!day) throw new Error(`Travel day not found: ${dayId}`);
  return updateTravelDay(
    dataset,
    dayId,
    {
      date,
      timeZone,
      ...(day.title ? { title: day.title } : {}),
      ...(day.notes ? { notes: day.notes } : {}),
    },
    reason,
  );
}

export function updateTravelDay(
  dataset: TravelogDataset,
  dayId: Id,
  update: TravelDayUpdate,
  reason = "Updated travel day",
): MoveTravelDayResult {
  if (!isIsoDate(update.date)) throw new Error(`Invalid date: ${update.date}`);
  assertTimeZone(update.timeZone);
  const day = dataset.days.find((candidate) => candidate.id === dayId);
  if (!day) throw new Error(`Travel day not found: ${dayId}`);
  const trip = dataset.trips.find((candidate) => candidate.id === day.tripId);
  if (!trip) throw new Error(`Trip not found: ${day.tripId}`);
  const duplicate = dataset.days.some(
    (candidate) => candidate.tripId === day.tripId && candidate.id !== day.id && candidate.date === update.date,
  );
  if (duplicate) throw new Error(`Travel day already exists: ${update.date}`);

  const scheduleChanged = day.date !== update.date || day.timeZone !== update.timeZone;
  const items = dataset.timelineItems.filter((item) => item.dayId === day.id);
  const schedules = scheduleChanged
    ? items.map((item) => {
        const current = item.schedule.current;
        const sourceTimeZone = current.timeZone || day.timeZone;
        const start = moveLocalDateTime(current.start, sourceTimeZone, update.date, update.timeZone);
        const end = moveLocalDateTime(current.end, sourceTimeZone, update.date, update.timeZone);
        return { item, current: { start, end, timeZone: update.timeZone } };
      })
    : [];
  const dayBefore = clone(day);
  const tripBefore = clone(trip);

  day.date = update.date;
  day.timeZone = update.timeZone;
  if (update.title) day.title = update.title;
  else delete day.title;
  if (update.notes) day.notes = update.notes;
  else delete day.notes;
  for (const { item, current } of schedules) {
    const before = clone(item.schedule.current);
    ensureBaseline(item);
    item.schedule.current = current;
    item.updatedAt = nowIso();
    dataset.planChanges.push(createPlanChange(item, before, clone(current), reason));
  }

  const startDate = update.date < trip.startDate ? update.date : trip.startDate;
  const endDate = update.date > trip.endDate ? update.date : trip.endDate;
  const expandedTripRange = startDate !== trip.startDate || endDate !== trip.endDate;
  const sync = syncTripDateRange(dataset, trip.id, startDate, endDate, trip.timeZone);
  trip.startDate = startDate;
  trip.endDate = endDate;
  if (expandedTripRange) trip.updatedAt = nowIso();
  resortTripDays(dataset, trip.id);

  dataset.planChanges.push(createEntityPlanChange(trip.id, "day", day.id, dayBefore, clone(day), reason));
  if (expandedTripRange) {
    dataset.planChanges.push(
      createEntityPlanChange(trip.id, "trip", trip.id, tripBefore, clone(trip), "Expanded trip for moved day"),
    );
  }
  return {
    movedItemCount: schedules.length,
    createdDayIds: sync.createdDayIds,
    expandedTripRange,
  };
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
  return createEntityPlanChange(item.tripId, "timelineItem", item.id, before, after, reason);
}

function createEntityPlanChange(
  tripId: Id,
  entityType: PlanChange["entityType"],
  entityId: Id,
  before: unknown,
  after: unknown,
  reason?: string,
): PlanChange {
  return {
    id: newId("change"),
    tripId,
    entityType,
    entityId,
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

function moveLocalDateTime(
  value: ISODateTime | null,
  sourceTimeZone: string,
  date: string,
  targetTimeZone: string,
): ISODateTime | null {
  if (!value) return null;
  const moved = zonedLocalToIso(date, timeInZone(value, sourceTimeZone), targetTimeZone);
  if (!moved) throw new Error(`Local time does not exist on ${date} in ${targetTimeZone}`);
  return moved;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
}
