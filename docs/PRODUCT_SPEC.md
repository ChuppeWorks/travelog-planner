# Travelog Planner Product Spec

## Positioning

Travelog Planner is the calm, editable planning layer that lives where users
already think: Obsidian or Notion. It is not another destination recommendation
feed. It turns a user's own travel research into an executable point-and-route
timeline and preserves that data for future Travelog use.

## Free MVP

### Shared capabilities

- Create trips and dated travel days.
- Add points and routes to one chronological timeline.
- Store place name, custom name, address, coordinates, standardized opening
  and closing times, notes.
- Store transport mode, line/operator, linked endpoints, fare, notes.
- Store planned checklist items, costs, and attachments.
- Automatically preserve a frozen baseline before the first schedule edit.
- Warn about overlapping items, invalid time windows, saved opening-hour
  conflicts, and broken route links.
- Export or retain data using schema version `1.0.0`.

### Obsidian

- Local-first JSON data in the user's vault.
- Timeline view and commands for creating trips, points, and routes.
- Freeze an entire trip baseline on demand, automatically preserve individual
  baselines on edit, and shift an item plus all following items.
- Apply an explicit route delay while shifting dependent later items.
- Enter coordinates and open a point in Google Maps.
- Enter opening and closing hours with native time-only inputs.
- Direct live itinerary maps and automatic public-transit search to Travelog.
- Choose the interface language or follow the system language.
- Export the canonical dataset as Notion-compatible CSV files from the plugin.
- No required account or external API key.

### Notion

- Native databases for Trips, Days, Timeline, Checklist, Expenses, Attachments.
- Views and relations described in a repeatable setup guide.
- Importable sample CSVs with stable schema IDs.
- Collaboration supplied by Notion.

## Future Travelog paid capabilities

- Place search, live operating hours, maps, public-transit schedules.
- Reservation email/document extraction.
- Replanning proposals with dependency-aware impact previews and rollback.
- Delay and disruption alerts with alternate-route suggestions.
- Actual travel timeline, GPS/photo import, journal, sharing, and keepsakes.
- Cross-platform sync and conflict resolution.

## Non-goals for the free MVP

- Automatically booking travel.
- Generating opaque AI itineraries.
- Full real-time transport integration.
- Editing the `actual` record.
- Requiring users to upload private trip data to a server.

## Success signals

- A new user can create a trip and first day's mixed point/route timeline in
  under five minutes.
- A user can change one delay and understand which later items move.
- An Obsidian export and a Notion export can resolve to the same logical IDs.
- Users voluntarily keep using the free tool for a real trip.
- Users ask for live replanning or recording features rather than basic fixes.
