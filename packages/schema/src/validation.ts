import { SCHEMA_VERSION, type TimelineItem, type TravelogDataset } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const PROVIDERS = new Set(["google-places", "google-routes", "openstreetmap", "apple-maps", "transit", "other"]);

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
  errors.push(...validateDatasetIntegrity(dataset));
  for (const item of dataset.timelineItems) validateTimelineItem(item, errors);
  return { valid: errors.length === 0, errors };
}

export function validateDatasetIntegrity(dataset: TravelogDataset): string[] {
  const errors: string[] = [];
  validateUniqueIds(dataset, errors);
  validateReferences(dataset, errors);
  return errors;
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
  const tripsById = new Map(dataset.trips.map((trip) => [trip.id, trip]));
  const daysById = new Map(dataset.days.map((day) => [day.id, day]));
  const itemsById = new Map(dataset.timelineItems.map((item) => [item.id, item]));

  for (const day of dataset.days) {
    if (!tripsById.has(day.tripId)) errors.push(`Day ${day.id} references missing trip ${day.tripId}.`);
  }
  for (const item of dataset.timelineItems) {
    if (!tripsById.has(item.tripId)) errors.push(`Timeline item ${item.id} references missing trip ${item.tripId}.`);
    const day = daysById.get(item.dayId);
    if (!day) errors.push(`Timeline item ${item.id} references missing day ${item.dayId}.`);
    else if (day.tripId !== item.tripId) errors.push(`Timeline item ${item.id} references day ${item.dayId} from another trip.`);
    if (item.kind === "route") {
      validateRoutePointReference(item.id, item.tripId, item.route?.fromPointId, itemsById, errors);
      validateRoutePointReference(item.id, item.tripId, item.route?.toPointId, itemsById, errors);
    }
  }
  for (const entity of dataset.checklistItems) {
    validateRelatedEntity("Checklist item", entity, tripsById, daysById, itemsById, errors);
  }
  for (const entity of dataset.expenses) {
    validateRelatedEntity("Expense", entity, tripsById, daysById, itemsById, errors);
  }
  for (const entity of dataset.attachments) {
    validateRelatedEntity("Attachment", entity, tripsById, daysById, itemsById, errors);
  }
}

function validateTimelineItem(item: TimelineItem, errors: string[]): void {
  const raw = item as unknown as Record<string, unknown>;
  if (raw.kind !== "point" && raw.kind !== "route") {
    errors.push(`Timeline item ${String(raw.id)} has invalid kind.`);
    return;
  }
  if (!item.schedule?.current?.timeZone) errors.push(`Timeline item ${item.id} needs a current schedule timezone.`);
  if (item.kind === "point") {
    if (!isRecord(raw.place)) errors.push(`Point ${item.id} needs place details.`);
    if (raw.route !== undefined) errors.push(`Point ${item.id} must not include route details.`);
    if (!item.place?.name) errors.push(`Point ${item.id} needs a place name.`);
    validateCoordinates(item.id, item.place?.coordinates, errors);
    validateProviderReferences(`Point ${item.id}`, item.place?.providerRefs, errors);
    for (const [index, period] of (item.place?.openingPeriods ?? []).entries()) {
      if (!Number.isInteger(period.dayOfWeek) || period.dayOfWeek < 0 || period.dayOfWeek > 6) {
        errors.push(`Point ${item.id} opening period ${index + 1} needs dayOfWeek from 0 to 6.`);
      }
      if (!validTime(period.opens) || !validTime(period.closes)) {
        errors.push(`Point ${item.id} opening period ${index + 1} must use HH:mm times.`);
      }
    }
  }
  if (item.kind === "route") {
    if (!isRecord(raw.route)) errors.push(`Route ${item.id} needs route details.`);
    if (raw.place !== undefined) errors.push(`Route ${item.id} must not include place details.`);
    if (!item.route?.mode) errors.push(`Route ${item.id} needs a transport mode.`);
    validateProviderReferences(`Route ${item.id}`, item.route?.providerRefs, errors);
  }
}

function validateRoutePointReference(
  routeId: string,
  tripId: string,
  pointId: string | undefined,
  itemsById: ReadonlyMap<string, TimelineItem>,
  errors: string[],
): void {
  if (!pointId) return;
  const point = itemsById.get(pointId);
  if (!point || point.kind !== "point") {
    errors.push(`Route ${routeId} references missing point ${pointId}.`);
  } else if (point.tripId !== tripId) {
    errors.push(`Route ${routeId} references point ${pointId} from another trip.`);
  }
}

function validateRelatedEntity(
  label: string,
  entity: { id: string; tripId: string; dayId?: string; timelineItemId?: string },
  tripsById: ReadonlyMap<string, unknown>,
  daysById: ReadonlyMap<string, { tripId: string }>,
  itemsById: ReadonlyMap<string, TimelineItem>,
  errors: string[],
): void {
  if (!tripsById.has(entity.tripId)) errors.push(`${label} ${entity.id} references missing trip ${entity.tripId}.`);

  const day = entity.dayId ? daysById.get(entity.dayId) : undefined;
  if (entity.dayId && !day) errors.push(`${label} ${entity.id} references missing day ${entity.dayId}.`);
  else if (day && day.tripId !== entity.tripId) {
    errors.push(`${label} ${entity.id} references day ${entity.dayId} from another trip.`);
  }

  const item = entity.timelineItemId ? itemsById.get(entity.timelineItemId) : undefined;
  if (entity.timelineItemId && !item) {
    errors.push(`${label} ${entity.id} references missing timeline item ${entity.timelineItemId}.`);
  } else if (item && item.tripId !== entity.tripId) {
    errors.push(`${label} ${entity.id} references timeline item ${entity.timelineItemId} from another trip.`);
  } else if (item && entity.dayId && item.dayId !== entity.dayId) {
    errors.push(`${label} ${entity.id} references timeline item ${entity.timelineItemId} from another day.`);
  }
}

function validateCoordinates(pointId: string, coordinates: unknown, errors: string[]): void {
  if (coordinates === undefined) return;
  if (
    !isRecord(coordinates)
    || !isFiniteNumber(coordinates.latitude)
    || coordinates.latitude < -90
    || coordinates.latitude > 90
    || !isFiniteNumber(coordinates.longitude)
    || coordinates.longitude < -180
    || coordinates.longitude > 180
  ) {
    errors.push(`Point ${pointId} coordinates need latitude -90 to 90 and longitude -180 to 180.`);
  }
}

function validateProviderReferences(label: string, providerRefs: unknown, errors: string[]): void {
  if (providerRefs === undefined) return;
  if (!Array.isArray(providerRefs)) {
    errors.push(`${label} providerRefs must be an array.`);
    return;
  }
  providerRefs.forEach((reference, index) => {
    if (
      !isRecord(reference)
      || !PROVIDERS.has(String(reference.provider))
      || typeof reference.id !== "string"
      || reference.id.length === 0
      || (reference.url !== undefined && typeof reference.url !== "string")
    ) {
      errors.push(`${label} providerRefs entry ${index + 1} is invalid.`);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
