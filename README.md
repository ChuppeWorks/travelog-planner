# Travelog Planner

Travelog Planner is a free, local-first planning layer for Obsidian and Notion.
Both products use the same versioned data model so a future Travelog service can
import plans without forcing users to rebuild their trips.

## Product promise

- Organize travel as `Trip -> Day -> chronological Point / Route`.
- Keep the original plan (`baseline`) separate from the editable plan
  (`current`) and future travel record (`actual`).
- Make the free tools genuinely useful for planning.
- Keep raw data portable and user-owned.
- Round-trip canonical JSON through Notion CSV without discarding hidden fields.
- Enter opening and closing hours as standardized local `HH:mm` values.
- Use the Obsidian interface in 20 languages plus system-language auto mode.
- Keep free planning local while live maps and automatic transit search point
  clearly to the future paid Travelog web app.
- Reserve live provider integrations, automatic replanning, and rich travel
  recording for the future Travelog service.

## Repository map

- `packages/schema`: canonical TypeScript model and validation.
- `schema/travelog.schema.json`: platform-neutral interchange contract.
- `apps/obsidian-plugin`: installable Obsidian community plugin.
- `notion`: importable databases and exact native-template setup guide.
- `docs`: research, complete user-needs catalog, roadmap, product decisions,
  and distribution notes.

## Develop

```bash
pnpm install
pnpm check
pnpm build
pnpm package
```

Convert between the shared dataset and Notion CSV exports:

```bash
pnpm export:notion examples/kyoto-weekend.travelog.json /tmp/notion-export
pnpm import:notion /tmp/notion-export /tmp/imported.travelog.json
```

The Obsidian release files are generated in
`release/obsidian/travelog-planner/`. The Notion distribution package is copied
to `release/notion/`. Ready-to-share ZIP archives are generated beside them.

Published builds are available from the
[GitHub releases page](https://github.com/ChuppeWorks/travelog-planner/releases).

## Status

`0.1.0` is a planning MVP. It intentionally stores fields needed by the future
plan-to-record workflow, while its user interface edits planning data only.
