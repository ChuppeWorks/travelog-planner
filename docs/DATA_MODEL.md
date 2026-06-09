# Common Data Model

## Why the model is normalized

Obsidian stores local JSON while Notion stores rows in related databases. A
normalized dataset gives both platforms the same entities and stable IDs:

```text
Trip
  -> Day
    -> TimelineItem (Point | Route)
      -> ChecklistItem
      -> Expense
      -> Attachment
  -> PlanChange
```

## The three timelines

Every point and route has a `VersionedSchedule`.

- `baseline`: optional frozen original plan. Obsidian creates it automatically
  before the first schedule edit; once created, free tools do not mutate it.
- `current`: the latest editable plan.
- `actual`: the eventual observed arrival/departure or travel time.

`planChanges` is an append-only audit trail for modifications to `current`.
This supports future explanations such as "the train delay moved three later
items by 20 minutes" without destroying the user's original intent.

## Time and geography

- Dates use `YYYY-MM-DD`.
- Instants use ISO 8601 with an offset or `Z`.
- Each schedule also stores an IANA timezone.
- Date-free local times, including place opening and closing times, use
  24-hour `HH:mm`. Canonical processing uses structured `openingPeriods`;
  `openingHoursText` exists only for display and legacy compatibility. A
  closing time at or before its opening time represents an overnight period.
- Coordinates use decimal WGS84 latitude and longitude.
- Provider-specific IDs are references, never canonical identity.

## Compatibility rules

1. IDs are stable across Obsidian, Notion, and future Travelog imports.
2. Unknown fields must be preserved by future migration tools.
3. A major schema version may break compatibility; minor versions only add
   optional fields.
4. Derived warnings and route calculations are not canonical data.
5. Baseline and actual data must never be silently overwritten by an import.

## Future synchronization envelope

Schema `1.0.0` is the portable planning payload. Ongoing Travelog
synchronization will wrap those entities with origin, revision, deletion
tombstone, and connector-cursor metadata. This sync metadata must not replace
stable canonical IDs or require users to surrender their usable Obsidian or
Notion copy.

Conflicts are resolved per field. Independent edits may merge automatically,
but competing edits to the same field, any destructive import, and any change
to `baseline` or `actual` require an explicit preview or user decision.
