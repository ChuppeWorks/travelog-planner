# Travelog Planner for Notion

This package creates a free Notion travel planner that uses the same logical
data model as the Obsidian plugin and future Travelog imports.

## What is included

- `Travelog Planner.md`: dashboard page to import.
- `csv/*.csv`: starter databases with demo data.
- `blueprint.json`: canonical property and relation blueprint.
- `PROPERTY_MAPPING.md`: exact relation, view, formula, and publishing setup.

## Install

1. In Notion, create a new page named **Travelog Planner**.
2. Import each CSV in `csv/` as a full-page database.
3. Follow `PROPERTY_MAPPING.md` to set property types and create relations.
4. Create linked database views on the dashboard page.
5. Delete the demo trip after testing.

CSV import cannot create Notion relations automatically. The manual relation
step is required once when creating the native template. After that, publish
the finished page as a duplicable Notion Marketplace template; users who
duplicate it receive the relations intact.

## Data compatibility

The visible Notion property names are friendly labels. The `id`, `tripId`,
`dayId`, and `timelineItemId` properties are the stable bridge to the common
Travelog schema. `Travelog JSON` preserves the full source entity. Do not
remove or regenerate these fields.

The template plans trips. Fields for baseline and actual timestamps exist so a
future Travelog sync does not require a breaking database redesign, but users
should normally edit only the current-plan fields in Notion.

## Interchange commands

```bash
pnpm export:notion examples/kyoto-weekend.travelog.json /tmp/notion-export
pnpm import:notion /tmp/notion-export /tmp/imported.travelog.json
```

Visible Notion fields override their corresponding values in `Travelog JSON`
during import, while fields Notion does not expose remain preserved.

Timeline `Opens` and `Closes` are a standardized pair. Enter both as local
24-hour `HH:mm` values or leave both blank. Notion does not provide a
date-free time property, so the importer validates these text fields before
converting them to canonical `openingPeriods`.
