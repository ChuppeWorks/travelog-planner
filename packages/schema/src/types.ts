export const SCHEMA_VERSION = "1.0.0" as const;

export type Id = string;
export type ISODate = string;
export type ISODateTime = string;

export interface TravelogDataset {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt?: ISODateTime;
  trips: Trip[];
  days: TravelDay[];
  timelineItems: TimelineItem[];
  checklistItems: ChecklistItem[];
  expenses: Expense[];
  attachments: Attachment[];
  planChanges: PlanChange[];
}

export interface Trip {
  id: Id;
  name: string;
  status: "idea" | "planning" | "ready" | "traveling" | "completed" | "archived";
  startDate: ISODate;
  endDate: ISODate;
  timeZone: string;
  baseCurrency: string;
  destinations: string[];
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TravelDay {
  id: Id;
  tripId: Id;
  date: ISODate;
  sortOrder: number;
  timeZone: string;
  title?: string;
  notes?: string;
}

export interface TimeWindow {
  start: ISODateTime | null;
  end: ISODateTime | null;
  timeZone: string;
}

export interface VersionedSchedule {
  baseline?: TimeWindow;
  current: TimeWindow;
  actual?: TimeWindow;
  actualDelayMinutes?: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface ProviderReference {
  provider: "google-places" | "openstreetmap" | "apple-maps" | "transit" | "other";
  id: string;
  url?: string;
}

export interface OpeningPeriod {
  dayOfWeek: number;
  opens: string;
  closes: string;
}

export interface PlaceDetails {
  name: string;
  customName?: string;
  address?: string;
  coordinates?: Coordinates;
  providerRefs?: ProviderReference[];
  openingPeriods?: OpeningPeriod[];
  openingHoursText?: string;
  expectedDurationMinutes?: number;
}

export type TransportMode =
  | "walk"
  | "bicycle"
  | "car"
  | "taxi"
  | "bus"
  | "tram"
  | "subway"
  | "train"
  | "ferry"
  | "flight"
  | "other";

export interface RouteDetails {
  fromPointId?: Id;
  toPointId?: Id;
  mode: TransportMode;
  lineName?: string;
  operator?: string;
  delayMinutes?: number;
  fare?: Money;
  reservationRef?: string;
  providerRefs?: ProviderReference[];
}

interface TimelineItemBase {
  id: Id;
  tripId: Id;
  dayId: Id;
  sortOrder: number;
  title: string;
  schedule: VersionedSchedule;
  notes?: string;
  tags?: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PointItem extends TimelineItemBase {
  kind: "point";
  place: PlaceDetails;
}

export interface RouteItem extends TimelineItemBase {
  kind: "route";
  route: RouteDetails;
}

export type TimelineItem = PointItem | RouteItem;

export interface ChecklistItem {
  id: Id;
  tripId: Id;
  dayId?: Id;
  timelineItemId?: Id;
  label: string;
  phase: "before" | "during" | "after";
  completed: boolean;
  sortOrder: number;
}

export interface Expense {
  id: Id;
  tripId: Id;
  dayId?: Id;
  timelineItemId?: Id;
  phase: "planned" | "actual";
  category:
    | "transport"
    | "lodging"
    | "food"
    | "activity"
    | "shopping"
    | "fee"
    | "other";
  amount: number;
  currency: string;
  payer?: string;
  notes?: string;
}

export interface Attachment {
  id: Id;
  tripId: Id;
  dayId?: Id;
  timelineItemId?: Id;
  kind: "booking" | "ticket" | "photo" | "receipt" | "document" | "link";
  url: string;
  provider?: "google-photos" | "local" | "web" | "other";
  providerId?: string;
  caption?: string;
}

export interface PlanChange {
  id: Id;
  tripId: Id;
  entityType: "trip" | "day" | "timelineItem";
  entityId: Id;
  changedAt: ISODateTime;
  source: "user" | "optimization" | "provider-update" | "import";
  reason?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ScheduleWarning {
  code: "invalid-window" | "overlap" | "outside-opening-hours" | "broken-route-link";
  itemId: Id;
  message: string;
}
