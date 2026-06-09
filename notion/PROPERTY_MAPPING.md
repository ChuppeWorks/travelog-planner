# Native Notion Setup

## Database relations

After importing all CSV files, create these relation properties. Keep the
plain-text ID properties; relations are an additional human-friendly layer.

| Database | Relation | Target | Match using |
|---|---|---|---|
| Days | Trip | Trips | `tripId` -> `id` |
| Timeline | Trip | Trips | `tripId` -> `id` |
| Timeline | Day | Days | `dayId` -> `id` |
| Checklist | Trip | Trips | `tripId` -> `id` |
| Checklist | Day | Days | `dayId` -> `id` |
| Checklist | Timeline item | Timeline | `timelineItemId` -> `id` |
| Expenses | Trip | Trips | `tripId` -> `id` |
| Expenses | Day | Days | `dayId` -> `id` |
| Expenses | Timeline item | Timeline | `timelineItemId` -> `id` |
| Attachments | Trip | Trips | `tripId` -> `id` |
| Attachments | Day | Days | `dayId` -> `id` |
| Attachments | Timeline item | Timeline | `timelineItemId` -> `id` |
| Plan Changes | Trip | Trips | `tripId` -> `id` |
| Plan Changes | Timeline item | Timeline | `entityId` -> `id` when entityType is timelineItem |

## Property types

Use `blueprint.json` as the complete contract. Important conversions:

- Convert dates and date-times to Notion **Date** properties.
- Convert `Completed` to **Checkbox**.
- Convert statuses, kinds, phases, categories, modes, and currencies to
  **Select**.
- Convert amounts, coordinates, sort orders, and delay minutes to **Number**.
- Keep all canonical ID properties as **Text**.
- Use Timeline `Name` as the user's custom display name and `Place name` as
  the searchable canonical place name.
- Enter Timeline `Opens` and `Closes` as 24-hour local times in exact `HH:mm`
  format, such as `09:30`. Both must be filled or both left blank. Notion has
  no date-free time property, so these remain text properties; Travelog import
  rejects malformed or incomplete pairs and stores them as structured
  `openingPeriods`.
- Keep provider references and change snapshots as **Text** containing JSON.
- Keep `Travelog JSON` as **Text** and hide it from normal views. It preserves
  fields that Notion cannot display and enables lossless future import.

## Recommended Timeline views

### Daily plan

- Layout: List or Table
- Group: Day
- Sort: Current start ascending, Sort order ascending
- Show: Kind, Current start, Current end, Address, Transport mode, Line,
  Planned cost rollup

### Map-ready places

- Filter: Kind is `point`
- Show: Address, Latitude, Longitude
- Use Notion Map when available, but keep latitude/longitude for Travelog sync.

### Routes

- Filter: Kind is `route`
- Show: Transport mode, Line, Operator, From point ID, To point ID, Current
  start, Current end

### Baseline changes

- Filter: Baseline start is not empty
- Compare Baseline start with Current start.
- Optional formula `Shift minutes`:

```text
dateBetween(prop("Current start"), prop("Baseline start"), "minutes")
```

## Recommended templates

Create these database templates inside Notion:

- **New Trip:** status Planning, base currency set, embedded linked views of
  Days, Timeline, Checklist, and Expenses filtered to the trip.
- **New Point:** kind Point, blank address/coordinates/Opens/Closes.
- **New Route:** kind Route, blank endpoint IDs and line.
- **Trip packing item:** phase Before.
- **Reservation document:** kind Booking.

## Publish

1. Replace demo content with polished example content or keep one clearly
   marked demo trip.
2. Confirm a duplicated test copy preserves all relations and views.
3. Publish the dashboard page to the web with duplication enabled.
4. Submit the public duplicate link to Notion Marketplace as a free template.
5. Use the product description in `../docs/DISTRIBUTION.md`.
