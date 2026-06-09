# Product Roadmap

## Product boundary

The free tools must remain useful without a Travelog account. Paid Travelog
earns conversion through live data, automation, cross-device execution, and
recording rather than by withholding basic planning or export.

## Phase 0: Foundation completed in this repository

- Shared versioned schema with stable IDs.
- Trip -> Day -> Point / Route chronology.
- Baseline, current plan, eventual actual record, and change log.
- Obsidian planning UI with local JSON.
- Notion import package and native-template blueprint.
- Lossless canonical JSON <-> Notion CSV interchange.
- Market research, user-needs catalog, and release documentation.

## Phase 1: Free product launch

### Obsidian

- Test with real desktop and mobile vaults.
- Add drag/reorder.
- Completed: trip/day editing with protected populated days and schedule-aware
  date/timezone moves.
- Add a useful map panel without compromising local-first behavior.
- Add import/export commands in the plugin UI.
- Complete community-plugin submission.

### Notion

- Build the native Notion page from the blueprint.
- Add polished linked views, buttons, formulas, and database templates.
- Test a clean duplicate.
- Publish the free Marketplace template.

Official Obsidian and Notion submission is intentionally deferred until the
commercial Travelog web app is complete enough to receive converted users.

### Validation

- Recruit 5-10 users planning real trips.
- Measure time to first usable day plan.
- Track which fields users actually fill.
- Interview users after a plan changes during travel.

## Phase 2: Travelog Trip Pass

- Modern onboarding with direct creation, Obsidian import/sync, and Notion
  import/sync as equal starting paths.
- Global checkout for a per-trip Trip Pass and lifetime core entitlement.
- Place search, coordinates, live and exceptional opening hours.
- Transit and route lookup with provider references.
- Preflight validation of the full itinerary.
- Dependency-aware replan proposals with impact preview and rollback.
- Delay, cancellation, weather, and closure alerts.
- Offline mobile trip package and booking document wallet.
- Collaborative current plan and group notifications.

See `COMMERCIAL_WEBAPP.md` for release gates and synchronization behavior.

## Phase 3: Travel record and lifetime value

- Actual point/route timeline and GPS recording.
- Google Photos Picker and local photo import.
- Planned-versus-actual comparison.
- Journal, memory map, yearly summaries.
- Shareable web story, PDF, video, and optional printed travel book.

## Pricing experiments

Test in this order:

1. Free planning -> one-trip Trip Pass.
2. Trip Pass bundles for couples or groups.
3. Lifetime core license with metered live-provider usage.
4. Optional keepsakes and storage.

Do not begin with a mandatory annual subscription. Public user complaints and
the low frequency of leisure travel make it a poor default for this product.
