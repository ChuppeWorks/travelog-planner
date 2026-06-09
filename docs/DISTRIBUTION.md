# Distribution

## Current hold

GitHub source and release artifacts may be updated for development and testing.
Do not submit the plugin to Obsidian Community Plugins, publish the Notion
template, or submit it to Notion Marketplace until the commercial Travelog web
app is ready to receive and serve converted users.

## Obsidian community plugin

### Release files

Each GitHub release must include:

- `main.js`
- `manifest.json`
- `styles.css`

The repository root also contains the required `manifest.json`, `versions.json`,
`README.md`, and `LICENSE`. Pushing a numeric version tag runs the release
workflow and publishes the required assets after all checks pass.

Run `pnpm build && pnpm package`; the files appear under
`release/obsidian/travelog-planner/`. A manual-install ZIP is also generated,
but the three files must still be attached individually to a community-plugin
GitHub release.

### Listing copy

**Name:** Travelog Planner

**Tagline:** Plan trips as a clear timeline of places and routes while keeping
your original plan intact.

**Description:** Travelog Planner is a free, local-first Obsidian plugin for
building executable travel itineraries. Organize each trip by date, then place
points and transport routes on one chronological timeline. Freeze a baseline,
shift delayed items and everything after them, and catch overlap or saved
opening-hour conflicts. Standardized time inputs and a multilingual interface
make planning consistent across trips. Your raw data stays in your vault using
an open schema designed for future Travelog import. Live itinerary maps and
automatic public-transit search are clearly labeled Travelog web-app features.

### Publish checklist

1. Host this project in a public GitHub repository.
2. Test desktop and mobile installation with BRAT or a manual plugin folder.
3. Push a numeric tag exactly matching `manifest.json`, such as `0.1.0`.
4. Confirm the automated GitHub release includes the three required files.
5. Submit a pull request to `obsidianmd/obsidian-releases`.

## Notion Marketplace

### Listing copy

**Name:** Travelog Planner: Points + Routes

**Tagline:** A travel plan that understands both where you go and how you get
there.

**Description:** Build each day as a chronological timeline of places and the
routes between them. Keep addresses, coordinates, opening hours, transport
lines, checklists, documents, and planned expenses together. Preserve a
baseline before departure so later changes never erase the original plan.
Opening and closing times use a validated `HH:mm` pair, and stable IDs make the
data ready for future Travelog import.

### Publish checklist

1. Import `notion/csv/*.csv`.
2. Apply the relation and view setup in `notion/PROPERTY_MAPPING.md`.
3. Duplicate the finished template into a clean workspace and verify it.
4. Publish with duplication enabled.
5. Submit it as a free Notion Marketplace template.

## Claims to avoid

- Do not claim live opening-hours or transit accuracy in the free MVP.
- Do not imply a Google Photos integration exists yet.
- Do not promise automatic Travelog sync before the sync service ships.
- Do not hide that the Notion CSV setup requires one-time relation wiring.
