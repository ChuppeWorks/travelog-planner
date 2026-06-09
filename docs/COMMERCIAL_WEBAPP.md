# Commercial Travelog Web App

## Product promise

Travelog turns a manually researched plan into a live, executable trip and
then into a durable travel record. It must be markedly more useful than the
free Obsidian plugin and Notion template without making either free tool feel
crippled.

The paid value is:

- current Google place data and an interactive itinerary map;
- worldwide route and public-transit proposals with times, transfers, fares,
  provider references, and confidence;
- dependency-aware replanning with impact preview and rollback;
- disruption, opening-hours, reservation, and weather checks;
- offline trip execution, collaboration, and actual travel recording;
- optional synchronization with Obsidian and Notion.

## Equal entry paths

The first-run screen must offer three equally visible choices:

1. **Create a new trip in Travelog.** No Obsidian or Notion account is needed.
2. **Connect Obsidian.** Import an existing canonical JSON dataset, then
   optionally enable ongoing synchronization through a companion plugin.
3. **Connect Notion.** Authorize a chosen Notion workspace and map or create
   the Travelog databases, then optionally enable ongoing synchronization.

A user can disconnect either integration and continue using Travelog. Export
must remain available after a Trip Pass expires.

## Onboarding and purchase flow

1. Show a concise interactive explanation: plan, validate, travel, adapt,
   record.
2. Let the user create or import enough of a trip to understand the product
   before presenting payment.
3. Demonstrate paid value on the user's own itinerary: live map, transit
   proposal, or preflight warnings.
4. Present two clear purchase choices:
   - **Trip Pass:** paid automation and execution for one named trip, including
     a clearly stated post-trip record window.
   - **Lifetime:** permanent access to core Travelog features; expensive
     provider usage may have a fair-use allowance or credits.
5. Use a merchant-of-record or similarly global checkout provider to handle
   cards, local payment methods, tax/VAT, receipts, refunds, and regional
   compliance. Confirm exact provider and countries before implementation.
6. Return directly to the itinerary and run the demonstrated paid action after
   checkout.

Do not force an annual subscription as the default offer.

## Synchronization contract

The canonical Travelog schema remains the shared logical model. Web storage may
be optimized differently, but imports and exports must resolve to the same
stable entity IDs.

### Required sync metadata

- `origin`: `travelog`, `obsidian`, or `notion`, plus source workspace/vault ID.
- monotonically increasing entity revision or opaque server version;
- `updatedAt` and last editor/source;
- tombstones for deleted entities;
- per-connector sync cursor and last successful sync time;
- schema version and migration result;
- provider references kept separate from canonical identity.

### Obsidian

- Manual import/export works without an account.
- Ongoing sync requires explicit opt-in and a narrowly scoped companion-plugin
  connection.
- The vault JSON remains a user-owned usable copy.
- The plugin sends changed entities since the last cursor, not the whole vault
  on every sync.

### Notion

- OAuth authorization must be limited to pages/databases selected by the user.
- Stable Travelog IDs remain visible properties because Notion row IDs are
  provider-specific.
- A connector maps Notion properties to canonical entities and preserves
  unsupported fields in canonical raw data.
- Relation wiring, partial API support, rate limits, and eventual consistency
  must be treated as normal connector states.

### Conflict behavior

- Merge independent field changes automatically.
- Never silently overwrite `baseline` or `actual`.
- Show a field-level comparison when the same field changed in two sources.
- Let the user choose one side, combine values, or keep both as an alternate.
- Record every accepted resolution in `planChanges`.
- Preview destructive imports and provide rollback.

## Maps, places, and routing

Google Maps Platform is the preferred primary map and place-data provider
because users expect rich place details and current opening information.
Canonical coordinates, addresses, and provider-neutral references must still
be stored so the product can support regions, costs, licensing constraints, or
features that require another provider.

Worldwide routing needs a provider adapter layer rather than a single hardcoded
API:

- walking, cycling, and driving route adapters;
- public-transit route adapters with departure/arrival, transfers, line,
  operator, platform where available, fare where available, and attribution;
- explicit coverage and freshness metadata;
- manual fallback when no provider returns a viable result;
- cached normalized proposals that respect provider retention rules;
- user confirmation before a proposal changes the current plan.

## Commercial release gates

- A user can create a trip entirely inside Travelog.
- Obsidian and Notion imports produce the same logical trip.
- At least one connector supports a tested ongoing sync and conflict flow.
- Checkout, entitlement, refund, and expired-pass behavior work end to end.
- Google map and place details include required attribution and comply with
  display/storage policies.
- Transit coverage, missing fare behavior, and confidence are honestly shown.
- Preflight validation and replanning never overwrite the baseline.
- Mobile and offline execution are usable during a real trip.
- Export and account deletion are tested.
