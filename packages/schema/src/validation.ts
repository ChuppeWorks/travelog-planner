import { SCHEMA_VERSION, type TimelineItem, type TravelogDataset } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDataset(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["Dataset must be an object."] };
  if (value.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);

  for (const key of [
    "trips",
    "days",
    "timelineItems",
    "checklistItems",
    "expenses",
    "attachments",
    "planChanges",
  ]) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`);
  }
  if (errors.length) return { valid: false, errors };

  const dataset = value as unknown as TravelogDataset;
  validateUniqueIds(dataset, errors);
  validateReferences(dataset, errors);
  for (const item of dataset.timelineItems) validateTimelineItem(item, errors);
  return { valid: errors.length === 0, errors };
}

function validateUniqueIds(dataset: TravelogDataset, errors: string[]): void {
  const ids = new Set<string>();
  for (const entity of [
    ...dataset.trips,
    ...dataset.days,
    ...dataset.timelineItems,
    ...dataset.checklistItems,
    ...dataset.expenses,
    ...dataset.attachments,
    ...dataset.planChanges,
  ]) {
    if (!entity.id) errors.push("Every entity must have an id.");
    else if (ids.has(entity.id)) errors.push(`Duplicate id: ${entity.id}`);
    else ids.add(entity.id);
  }
}

function validateReferences(dataset: TravelogDataset, errors: string[]): void {
  const tripIds = new Set(dataset.trips.map((trip) => trip.id));
  const dayIds = new Set(dataset.days.map((day) => day.id));
  const itemIds = new Set(dataset.timelineItems.map((item) => item.id));

  for (const day of dataset.days) {
    if (!tripIds.has(day.tripId)) errors.push(`Day ${day.id} references missing trip ${day.tripId}.`);
  }
  for (const item of dataset.timelineItems) {
    if (!tripIds.has(item.tripId)) errors.push(`Timeline item ${item.id} references missing trip ${item.tripId}.`);
    if (!dayIds.has(item.dayId)) errors.push(`Timeline item ${item.id} references missing day ${item.dayId}.`);
  }
  for (const entity of [...dataset.checklistItems, ...dataset.expenses, ...dataset.attachments]) {
    if (!tripIds.has(entity.tripId)) errors.push(`${entity.id} references missing trip ${entity.tripId}.`);
    if (entity.dayId && !dayIds.has(entity.dayId)) errors.push(`${entity.id} references missing day ${entity.dayId}.`);
    if (entity.timelineItemId && !itemIds.has(entity.timelineItemId)) {
      errors.push(`${entity.id} references missing timeline item ${entity.timelineItemId}.`);
    }
  }
}

function validateTimelineItem(item: TimelineItem, errors: string[]): void {
  const raw = item as unknown as Record<string, unknown>;
  if (raw.kind !== "point" && raw.kind !== "route") errors.push(`Timeline item ${String(raw.id)} has invalid kind.`);
  if (!item.schedule?.current?.timeZone) errors.push(`Timeline item ${item.id} needs a current schedule timezone.`);
  if (item.kind === "point" && !item.place?.name) errors.push(`Point ${item.id} needs a place name.`);
  if (item.kind === "point") {
    for (const [index, period] of (item.place?.openingPeriods ?? []).entries()) {
      if (!Number.isInteger(period.dayOfWeek) || period.dayOfWeek < 0 || period.dayOfWeek > 6) {
        errors.push(`Point ${item.id} opening period ${index + 1} needs dayOfWeek from 0 to 6.`);
      }
      if (!validTime(period.opens) || !validTime(period.closes)) {
        errors.push(`Point ${item.id} opening period ${index + 1} must use HH:mm times.`);
      }
    }
  }
  if (item.kind === "route" && !item.route?.mode) errors.push(`Route ${item.id} needs a transport mode.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
