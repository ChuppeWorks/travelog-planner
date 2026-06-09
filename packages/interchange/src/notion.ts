import {
  SCHEMA_VERSION,
  nowIso,
  type Attachment,
  type ChecklistItem,
  type Expense,
  type PlanChange,
  type PlaceDetails,
  type RouteDetails,
  type TimelineItem,
  type TransportMode,
  type TravelDay,
  type TravelogDataset,
  type Trip,
} from "../../schema/src";
import { parseCsv, stringifyCsv, type CsvRow } from "./csv";

export const NOTION_TABLE_FILES = {
  Trips: "Trips.csv",
  Days: "Days.csv",
  Timeline: "Timeline.csv",
  Checklist: "Checklist.csv",
  Expenses: "Expenses.csv",
  Attachments: "Attachments.csv",
  "Plan Changes": "Plan Changes.csv",
} as const;

export type NotionTableName = keyof typeof NOTION_TABLE_FILES;
export type NotionTables = Record<NotionTableName, string>;

const headers: Record<NotionTableName, string[]> = {
  Trips: ["Name", "id", "Status", "Start date", "End date", "Timezone", "Base currency", "Destinations", "Notes", "Created at", "Updated at", "Travelog JSON"],
  Days: ["Name", "id", "tripId", "Date", "Sort order", "Timezone", "Notes", "Travelog JSON"],
  Timeline: ["Name", "id", "tripId", "dayId", "Kind", "Sort order", "Current start", "Current end", "Timezone", "Baseline start", "Baseline end", "Actual start", "Actual end", "Actual delay minutes", "Place name", "Address", "Latitude", "Longitude", "Opening hours", "Transport mode", "Line", "Operator", "Delay minutes", "Fare amount", "Fare currency", "From point ID", "To point ID", "Notes", "Travelog JSON"],
  Checklist: ["Name", "id", "tripId", "dayId", "timelineItemId", "Phase", "Completed", "Sort order", "Travelog JSON"],
  Expenses: ["Name", "id", "tripId", "dayId", "timelineItemId", "Phase", "Category", "Amount", "Currency", "Payer", "Notes", "Travelog JSON"],
  Attachments: ["Name", "id", "tripId", "dayId", "timelineItemId", "Kind", "URL", "Provider", "Provider ID", "Travelog JSON"],
  "Plan Changes": ["Name", "id", "tripId", "entityType", "entityId", "Changed at", "Source", "Reason", "Before JSON", "After JSON", "Travelog JSON"],
};

export function datasetToNotionTables(dataset: TravelogDataset): NotionTables {
  return {
    Trips: stringifyCsv(headers.Trips, dataset.trips.map(tripRow)),
    Days: stringifyCsv(headers.Days, dataset.days.map(dayRow)),
    Timeline: stringifyCsv(headers.Timeline, dataset.timelineItems.map(timelineRow)),
    Checklist: stringifyCsv(headers.Checklist, dataset.checklistItems.map(checklistRow)),
    Expenses: stringifyCsv(headers.Expenses, dataset.expenses.map(expenseRow)),
    Attachments: stringifyCsv(headers.Attachments, dataset.attachments.map(attachmentRow)),
    "Plan Changes": stringifyCsv(headers["Plan Changes"], dataset.planChanges.map(changeRow)),
  };
}

export function notionTablesToDataset(tables: Partial<NotionTables>): TravelogDataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    trips: rows(tables.Trips).map(parseTrip),
    days: rows(tables.Days).map(parseDay),
    timelineItems: rows(tables.Timeline).map(parseTimeline),
    checklistItems: rows(tables.Checklist).map(parseChecklist),
    expenses: rows(tables.Expenses).map(parseExpense),
    attachments: rows(tables.Attachments).map(parseAttachment),
    planChanges: rows(tables["Plan Changes"]).map(parseChange),
  };
}

function tripRow(trip: Trip): CsvRow {
  return {
    Name: trip.name, id: trip.id, Status: trip.status, "Start date": trip.startDate, "End date": trip.endDate,
    Timezone: trip.timeZone, "Base currency": trip.baseCurrency, Destinations: trip.destinations.join(" | "),
    Notes: trip.notes ?? "", "Created at": trip.createdAt, "Updated at": trip.updatedAt, "Travelog JSON": raw(trip),
  };
}

function dayRow(day: TravelDay): CsvRow {
  return {
    Name: day.title ?? day.date, id: day.id, tripId: day.tripId, Date: day.date, "Sort order": String(day.sortOrder),
    Timezone: day.timeZone, Notes: day.notes ?? "", "Travelog JSON": raw(day),
  };
}

function timelineRow(item: TimelineItem): CsvRow {
  const place = item.kind === "point" ? item.place : undefined;
  const route = item.kind === "route" ? item.route : undefined;
  return {
    Name: item.title, id: item.id, tripId: item.tripId, dayId: item.dayId, Kind: item.kind,
    "Sort order": String(item.sortOrder), "Current start": item.schedule.current.start ?? "",
    "Current end": item.schedule.current.end ?? "", Timezone: item.schedule.current.timeZone,
    "Baseline start": item.schedule.baseline?.start ?? "", "Baseline end": item.schedule.baseline?.end ?? "",
    "Actual start": item.schedule.actual?.start ?? "", "Actual end": item.schedule.actual?.end ?? "",
    "Actual delay minutes": optional(item.schedule.actualDelayMinutes), "Place name": place?.name ?? "", Address: place?.address ?? "",
    Latitude: optional(place?.coordinates?.latitude), Longitude: optional(place?.coordinates?.longitude),
    "Opening hours": place?.openingHoursText ?? "", "Transport mode": route?.mode ?? "", Line: route?.lineName ?? "",
    Operator: route?.operator ?? "", "Delay minutes": optional(route?.delayMinutes),
    "Fare amount": optional(route?.fare?.amount), "Fare currency": route?.fare?.currency ?? "",
    "From point ID": route?.fromPointId ?? "", "To point ID": route?.toPointId ?? "", Notes: item.notes ?? "",
    "Travelog JSON": raw(item),
  };
}

function checklistRow(item: ChecklistItem): CsvRow {
  return {
    Name: item.label, id: item.id, tripId: item.tripId, dayId: item.dayId ?? "", timelineItemId: item.timelineItemId ?? "",
    Phase: item.phase, Completed: String(item.completed), "Sort order": String(item.sortOrder), "Travelog JSON": raw(item),
  };
}

function expenseRow(item: Expense): CsvRow {
  return {
    Name: item.notes || `${item.category} ${item.amount} ${item.currency}`, id: item.id, tripId: item.tripId,
    dayId: item.dayId ?? "", timelineItemId: item.timelineItemId ?? "", Phase: item.phase, Category: item.category,
    Amount: String(item.amount), Currency: item.currency, Payer: item.payer ?? "", Notes: item.notes ?? "",
    "Travelog JSON": raw(item),
  };
}

function attachmentRow(item: Attachment): CsvRow {
  return {
    Name: item.caption ?? item.kind, id: item.id, tripId: item.tripId, dayId: item.dayId ?? "",
    timelineItemId: item.timelineItemId ?? "", Kind: item.kind, URL: item.url, Provider: item.provider ?? "",
    "Provider ID": item.providerId ?? "", "Travelog JSON": raw(item),
  };
}

function changeRow(item: PlanChange): CsvRow {
  return {
    Name: item.reason ?? `${item.entityType} change`, id: item.id, tripId: item.tripId, entityType: item.entityType,
    entityId: item.entityId, "Changed at": item.changedAt, Source: item.source, Reason: item.reason ?? "",
    "Before JSON": raw(item.before), "After JSON": raw(item.after), "Travelog JSON": raw(item),
  };
}

function parseTrip(row: CsvRow): Trip {
  const base = fromRaw<Partial<Trip>>(row);
  const trip = {
    ...base, id: row.id!, name: row.Name!, status: row.Status as Trip["status"], startDate: row["Start date"]!,
    endDate: row["End date"]!, timeZone: row.Timezone!, baseCurrency: row["Base currency"]!,
    destinations: split(row.Destinations), ...(row.Notes ? { notes: row.Notes } : {}),
    createdAt: row["Created at"] || base.createdAt || nowIso(), updatedAt: row["Updated at"] || base.updatedAt || nowIso(),
  } as Trip;
  if (!row.Notes) delete trip.notes;
  return trip;
}

function parseDay(row: CsvRow): TravelDay {
  const base = fromRaw<Partial<TravelDay>>(row);
  const day = {
    ...base, id: row.id!, tripId: row.tripId!, date: row.Date!, sortOrder: number(row["Sort order"]),
    timeZone: row.Timezone!, ...(row.Name && (base.title || row.Name !== row.Date) ? { title: row.Name } : {}),
    ...(row.Notes ? { notes: row.Notes } : {}),
  } as TravelDay;
  if (!row.Notes) delete day.notes;
  return day;
}

function parseTimeline(row: CsvRow): TimelineItem {
  const base = fromRaw<Partial<TimelineItem>>(row);
  const timeZone = row.Timezone || base.schedule?.current.timeZone || "UTC";
  const schedule = {
    ...base.schedule,
    current: { start: nullable(row["Current start"]), end: nullable(row["Current end"]), timeZone },
    ...(row["Baseline start"] || row["Baseline end"]
      ? { baseline: { start: nullable(row["Baseline start"]), end: nullable(row["Baseline end"]), timeZone } }
      : base.schedule?.baseline ? { baseline: base.schedule.baseline } : {}),
    ...(row["Actual start"] || row["Actual end"]
      ? { actual: { start: nullable(row["Actual start"]), end: nullable(row["Actual end"]), timeZone } }
      : base.schedule?.actual ? { actual: base.schedule.actual } : {}),
    ...(row["Actual delay minutes"]
      ? { actualDelayMinutes: number(row["Actual delay minutes"]) }
      : base.schedule?.actualDelayMinutes !== undefined ? { actualDelayMinutes: base.schedule.actualDelayMinutes } : {}),
  };
  const kind = row.Kind || base.kind || "point";
  const common = {
    ...base, id: row.id!, tripId: row.tripId!, dayId: row.dayId!, sortOrder: number(row["Sort order"]),
    title: row.Name!, schedule, ...(row.Notes ? { notes: row.Notes } : {}), createdAt: base.createdAt || nowIso(),
    updatedAt: base.updatedAt || nowIso(),
  };
  if (!row.Notes) delete common.notes;
  if (kind === "route") {
    const route: Partial<RouteDetails> = base.kind === "route" && base.route ? { ...base.route } : {};
    delete route.lineName;
    delete route.operator;
    delete route.delayMinutes;
    delete route.fare;
    delete route.fromPointId;
    delete route.toPointId;
    return {
      ...common, kind: "route", route: {
        ...route, mode: (row["Transport mode"] || "other") as TransportMode,
        ...(row.Line ? { lineName: row.Line } : {}), ...(row.Operator ? { operator: row.Operator } : {}),
        ...(row["Delay minutes"] ? { delayMinutes: number(row["Delay minutes"]) } : {}),
        ...(row["Fare amount"] ? { fare: { amount: number(row["Fare amount"]), currency: row["Fare currency"] || "USD" } } : {}),
        ...(row["From point ID"] ? { fromPointId: row["From point ID"] } : {}), ...(row["To point ID"] ? { toPointId: row["To point ID"] } : {}),
      },
    } as TimelineItem;
  }
  const place: Partial<PlaceDetails> = base.kind === "point" && base.place ? { ...base.place } : {};
  delete place.name;
  delete place.address;
  delete place.coordinates;
  delete place.openingHoursText;
  if (!row["Opening hours"]) delete place.openingPeriods;
  return {
    ...common, kind: "point", place: {
      ...place,
      name: row["Place name"] || (base.kind === "point" && base.place ? base.place.name : row.Name!),
      ...(row.Address ? { address: row.Address } : {}),
      ...(row.Latitude !== "" && row.Longitude !== "" ? { coordinates: { latitude: number(row.Latitude), longitude: number(row.Longitude) } } : {}),
      ...(row["Opening hours"] ? { openingHoursText: row["Opening hours"] } : {}),
    },
  } as TimelineItem;
}

function parseChecklist(row: CsvRow): ChecklistItem {
  const base = fromRaw<Partial<ChecklistItem>>(row);
  return { ...base, id: row.id!, tripId: row.tripId!, ...(row.dayId ? { dayId: row.dayId } : {}), ...(row.timelineItemId ? { timelineItemId: row.timelineItemId } : {}), label: row.Name!, phase: row.Phase as ChecklistItem["phase"], completed: (row.Completed ?? "").toLowerCase() === "true", sortOrder: number(row["Sort order"]) };
}

function parseExpense(row: CsvRow): Expense {
  const base = fromRaw<Partial<Expense>>(row);
  const expense = { ...base, id: row.id!, tripId: row.tripId!, ...(row.dayId ? { dayId: row.dayId } : {}), ...(row.timelineItemId ? { timelineItemId: row.timelineItemId } : {}), phase: row.Phase as Expense["phase"], category: row.Category as Expense["category"], amount: number(row.Amount), currency: row.Currency!, ...(row.Payer ? { payer: row.Payer } : {}), ...(row.Notes ? { notes: row.Notes } : {}) } as Expense;
  if (!row.Payer) delete expense.payer;
  if (!row.Notes) delete expense.notes;
  return expense;
}

function parseAttachment(row: CsvRow): Attachment {
  const base = fromRaw<Partial<Attachment>>(row);
  const attachment = { ...base, id: row.id!, tripId: row.tripId!, ...(row.dayId ? { dayId: row.dayId } : {}), ...(row.timelineItemId ? { timelineItemId: row.timelineItemId } : {}), kind: row.Kind as Attachment["kind"], url: row.URL!, ...(row.Provider ? { provider: row.Provider as Attachment["provider"] } : {}), ...(row["Provider ID"] ? { providerId: row["Provider ID"] } : {}), ...(row.Name && (base.caption || row.Name !== row.Kind) ? { caption: row.Name } : {}) } as Attachment;
  if (!row.Provider) delete attachment.provider;
  if (!row["Provider ID"]) delete attachment.providerId;
  if (!row.Name || (!base.caption && row.Name === row.Kind)) delete attachment.caption;
  return attachment;
}

function parseChange(row: CsvRow): PlanChange {
  const base = fromRaw<Partial<PlanChange>>(row);
  const change = { ...base, id: row.id!, tripId: row.tripId!, entityType: row.entityType as PlanChange["entityType"], entityId: row.entityId!, changedAt: row["Changed at"]!, source: row.Source as PlanChange["source"], ...(row.Reason ? { reason: row.Reason } : {}), before: parseJson<Record<string, unknown>>(row["Before JSON"], {}), after: parseJson<Record<string, unknown>>(row["After JSON"], {}) } as PlanChange;
  if (!row.Reason) delete change.reason;
  return change;
}

function rows(csv: string | undefined): CsvRow[] { return csv ? parseCsv(csv) : []; }
function raw(value: unknown): string { return JSON.stringify(value); }
function optional(value: number | undefined): string { return value === undefined ? "" : String(value); }
function nullable(value: string | undefined): string | null { return value || null; }
function number(value: string | undefined): number { return Number(value || 0); }
function split(value: string | undefined): string[] { return (value ?? "").split(/\s*\|\s*/).filter(Boolean); }
function fromRaw<T>(row: CsvRow): T { return parseJson<T>(row["Travelog JSON"], {} as T); }
function parseJson<T>(value: string | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
