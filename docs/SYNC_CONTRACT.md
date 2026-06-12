# Travelog vNext Synchronization Contract

## Purpose

This document defines how Travelog canonical vNext state is changed and
synchronized across Web, Mobile, Obsidian, Notion, and manual imports. The
canonical records and invariants are defined in `CANONICAL_VNEXT.md`.

Synchronization is operation-based. Snapshots make bootstrap and export
practical, but a snapshot replacement is never a merge algorithm.

## Authority model

For an account-synchronized trip, the Travelog sync service is the canonical
revision and cursor authority. Clients may work offline and propose mutations,
but only accepted operations receive canonical revisions and cursors.

For a local-only trip, the local canonical engine performs the same checks and
acts as authority. Connecting that trip later uses the import-session protocol;
it does not copy arrays directly into server storage.

No adapter owns canonical conflict policy, revision allocation, tombstone
compaction, baseline authority, or actual-fact approval rules.

## Identifiers and ordering

- `entityId` is stable across all adapters.
- `clientMutationId` is generated once by the submitting device and is the
  idempotency key for retries.
- `operationId` identifies an accepted append-only operation.
- `revision` orders accepted changes for one entity only.
- `cursor` is an opaque, monotonically advancing position in one sync scope.
- Wall-clock timestamps MUST NOT determine operation order or resolve
  conflicts.

The sync scope SHOULD be one trip. Account-level discovery may use a separate
cursor, but operations from different scopes are not globally ordered.

## Mutation request

Clients push mutation requests, not pre-approved operations:

```ts
type FieldChange =
  | { op: "set"; path: string; value: unknown }
  | { op: "unset"; path: string };

type MutationAction =
  | { type: "create"; value: Record<string, unknown> }
  | { type: "patch"; changes: FieldChange[] }
  | { type: "delete"; reason?: string }
  | { type: "restore"; value: Record<string, unknown>; reason?: string }
  | { type: "seal-baseline"; subjectRevision: number }
  | { type: "correct-baseline"; supersedesBaselineId: string; schedule: Record<string, unknown>; reason: string }
  | { type: "append-actual-event"; value: Record<string, unknown> }
  | { type: "correct-actual-event"; supersedesEventId: string; value: Record<string, unknown>; reason: string }
  | { type: "capture-evidence"; value: Record<string, unknown> }
  | { type: "approve-evidence"; evidenceIds: string[]; actualEvents: Record<string, unknown>[] }
  | { type: "reject-evidence"; evidenceIds: string[]; reason?: string }
  | { type: "resolve-conflict"; conflictId: string; resolution: ConflictResolution };

interface MutationRequest {
  clientMutationId: string;
  schemaVersion: string;
  scope: { tripId: string };
  target: { entityType: string; entityId: string };
  baseRevision: number | null;     // null only for create/append of a new ID
  action: MutationAction;
  origin: OriginRef;
  actor: ActorRef;
  device?: DeviceRef;
  submittedAt: ISODateTime;        // audit only
  importSessionId?: string;
}
```

Field paths use JSON Pointer syntax. `set` and `unset` are distinct so `null`,
missing, and clear are not conflated. Arrays are atomic field values unless a
future schema explicitly gives their elements stable IDs and element-level
operations.

Protected commands such as actual-event approval and baseline correction MUST
be distinct actions. They MUST NOT be smuggled through a generic field patch.

## Accepted operation

An accepted mutation appends one or more canonical operations:

```ts
interface AcceptedOperation {
  operationId: string;
  clientMutationId: string;
  schemaVersion: string;
  scope: { tripId: string };
  cursor: string;
  target: { entityType: string; entityId: string };
  action: MutationAction;
  baseRevision: number | null;
  resultRevision: number | null;   // null for immutable append-only records without entity revisions
  acceptedAt: ISODateTime;
  origin: OriginRef;
  actor: ActorRef;
  device?: DeviceRef;
  importSessionId?: string;
  resolvesConflictId?: string;
}
```

The accepted operation log is append-only:

- retrying a `clientMutationId` returns the original result;
- an accepted operation is never edited or removed;
- rollback appends compensating operations;
- migration may transform the stored representation but must preserve
  operation identity and semantic effect;
- `planChanges` views are derived from accepted current-plan operations and
  are not a second audit source.

## Entity state transitions

```text
absent --create(base=null)----------------------> active revision 1
active revision N --patch(base=N)--------------> active revision N+1
active revision N --delete(base=N)-------------> tombstone revision N+1
tombstone revision N --restore(base=N)---------> active revision N+1

pending evidence --approve---------------------> accepted review + actualEvent(s)
pending evidence --reject----------------------> rejected review
actualEvent --correct--------------------------> unchanged prior event + appended superseding event
baseline absent --seal-------------------------> immutable baseline
baseline present --explicit correct-----------> unchanged prior baseline + appended superseding baseline
```

Delete versus concurrent update, restore versus concurrent restore, and
competing protected corrections produce conflicts. They are not resolved by
last-write-wins.

## Push, pull, and acknowledgement API

The logical API is:

```ts
type MutationResult =
  | { status: "accepted"; clientMutationId: string; operationIds: string[]; resultRevisions: number[] }
  | { status: "duplicate"; clientMutationId: string; operationIds: string[]; resultRevisions: number[] }
  | { status: "conflict"; clientMutationId: string; conflictId: string }
  | { status: "rejected"; clientMutationId: string; code: string; message: string };

pushMutations(request: {
  scope: { tripId: string };
  baseCursor?: string;
  mutations: MutationRequest[];
}): {
  results: MutationResult[];       // accepted, conflict, rejected, or duplicate
  currentCursor: string;
};

pullOperations(request: {
  scope: { tripId: string };
  afterCursor?: string;
  limit: number;
  acceptedSchemaVersions: string[];
}): {
  operations: AcceptedOperation[];
  nextCursor: string;
  hasMore: boolean;
  snapshotRequired?: { reason: "cursor-expired" | "schema-unsupported"; snapshotId: string };
};

acknowledgeCursor(request: {
  scope: { tripId: string };
  deviceId: string;
  cursor: string;
}): void;

getSnapshot(request: {
  scope: { tripId: string };
  snapshotId?: string;
}): CanonicalDocumentV2;
```

Protocol rules:

1. A client pulls until `hasMore` is false before claiming it is up to date.
2. The server returns operations in cursor order.
3. Push batches preserve request order and are idempotent per mutation.
4. Commands declared atomic by canonical rules either all commit or all fail.
5. A client applies operations transactionally, persists the new cursor, then
   acknowledges it.
6. A cursor is opaque. Clients never parse, increment, or compare cursor
   internals.
7. When a cursor expires, the client obtains a snapshot and resumes from its
   `snapshotCursor`; it does not replay stale local state as authoritative.

## Conflict detection

For a patch based on stale revision `B` while the active entity is at revision
`C`, the authority obtains the canonical field paths changed in revisions
`B+1..C`.

- Disjoint changed paths: automatically rebase and accept.
- Same or ancestor/descendant path overlap: create a field conflict.
- Array field overlap: conflict, because arrays are atomic by default.
- Update versus tombstone: conflict.
- Delete versus any unobserved update: conflict.
- Create using an existing or tombstoned ID: conflict.
- Baseline changes: protected conflict unless performed by the named explicit
  baseline command.
- Actual-event append with a new ID: normally conflict-free.
- Competing superseding events for the same actual event: preserve both and
  mark the actual projection conflicted.
- Evidence append with a new ID: normally conflict-free.
- Concurrent evidence review transitions: conflict unless they are identical
  idempotent approvals/rejections.

Provider freshness, confidence, `updatedAt`, origin, or adapter priority MUST
NOT silently defeat a user-confirmed value.

## Conflict record and resolution

```ts
interface ConflictRecord {
  id: string;
  scope: { tripId: string };
  target: { entityType: string; entityId: string };
  status: "open" | "resolved";
  kind: "field" | "delete-update" | "restore" | "baseline" | "actual" | "evidence-review" | "import";
  baseRevision: number | null;
  currentRevision: number | null;
  baseValue?: unknown;
  currentValue?: unknown;
  proposedValue?: unknown;
  conflictingPaths: string[];
  proposedMutation: MutationRequest;
  createdAt: ISODateTime;
  resolvedAt?: ISODateTime;
  resolutionOperationId?: string;
}

type ConflictResolution =
  | { type: "keep-current" }
  | { type: "accept-proposed" }
  | { type: "set-value"; changes: FieldChange[] }
  | { type: "keep-both"; newEntityId: string }
  | { type: "cancel-delete" }
  | { type: "confirm-delete" };
```

Resolution is a new user-attributed mutation against the latest revision. It
appends an accepted operation referencing the conflict ID. Conflict records
are audit records and MUST NOT be removed when resolved.

The UI MUST show base, current, and proposed values for every conflicting path.
Protected baseline and actual conflicts MUST identify the actor and evidence
or source on each side.

## Delete, restore, and tombstone retention

Normal delete produces a tombstone and never cascades through protected facts.
A delete request that would orphan active children, baselines, actual events,
or evidence returns a preview requiring an explicit policy for each dependent
record.

Supported dependent policies are:

- delete child by creating its own tombstone;
- reparent child to a valid active parent;
- keep protected fact/evidence and mark the subject reference unresolved;
- cancel the delete.

Hard purge is an administrative privacy/retention action, not ordinary sync.
Before compacting a tombstone, the authority MUST establish all of:

1. every active registered replica has acknowledged a cursor after the delete;
2. the tombstone retention period has elapsed;
3. no retained record references the tombstone;
4. no legal hold or user export job requires it;
5. the compaction result prevents an old replica from resurrecting the ID.

A replica returning from before the compaction watermark MUST re-bootstrap
from a snapshot.

## Import session and merge contract

Every manual import and connector bootstrap is a staged import session:

```ts
interface ImportSession {
  id: string;
  scope: { tripId?: string };
  source: OriginRef;
  sourceSchemaVersion: string;
  migratedSchemaVersion: string;
  baseSnapshotId?: string;
  status: "prepared" | "awaiting-approval" | "committed" | "cancelled" | "failed";
  preview: ImportPreview;
}

interface ImportPreview {
  creates: ProposedChange[];
  updates: ProposedChange[];
  explicitDeletes: ProposedChange[];
  ambiguousAbsences: ProposedChange[];
  conflicts: ProposedChange[];
  protectedChanges: ProposedChange[];
  warnings: string[];
  lossReport: string[];
}

interface ProposedChange {
  target: { entityType: string; entityId: string };
  baseRevision: number | null;
  action: MutationAction;
  reason: string;
}
```

Import algorithm:

1. Parse, validate, migrate, and normalize the external representation.
2. Find the last successful base snapshot for the same connector mapping.
3. Compute a three-way diff: base, current canonical, imported candidate.
4. Auto-merge only disjoint, non-protected field changes.
5. Treat source tombstones or proven deletion of previously mapped external
   objects as explicit delete proposals.
6. Treat all other missing rows/files as ambiguous absence, never deletion.
7. Require approval for destructive, protected, or conflicting changes.
8. Commit approved changes as one attributed mutation batch with
   `importSessionId`.
9. Store the resulting source-to-canonical mapping and new base snapshot only
   after commit.
10. Rollback, when requested, appends a compensating batch; it never erases
    imported operations.

Without a known base, import is additive/upsert-only by default. Matching is by
stable Travelog ID. Name, title, date, provider ID, or row position MUST NOT
silently merge identities.

For legacy Notion CSV, a blank visible field is an explicit `unset` only when
the property is present in the imported table. A missing property, missing
table, or missing row is not an explicit clear or delete.

## Adapter ownership

### Canonical core

Owns:

- schema validation and migration registry;
- stable IDs, revisions, operation application, and tombstones;
- canonical invariants and protected-field rules;
- conflict detection and resolution semantics;
- baseline, actual-event, evidence, and projection behavior;
- semantic fingerprint and round-trip release gates.

Does not own provider authentication, provider row/file layout, or UI.

### Travelog Web

Owns:

- canonical authority for synchronized trips;
- operation log, cursor issuance, acknowledgements, snapshots, and retention;
- conflict and import preview UI;
- user approval for protected changes and evidence;
- connector registration, access control, export, and account-deletion flows.

Web MUST NOT treat provider data or connector priority as user approval.

### Travelog Mobile

Owns:

- offline local snapshot, mutation outbox, and device cursor;
- GPS/photo/sensor capture and local evidence preparation;
- explicit user actions such as "Arrived", approval, rejection, and correction;
- retry and deduplication using stable `clientMutationId` values.

Mobile MUST submit GPS and inference as evidence. It MUST NOT emit an
`actualEvent` from background sensing or inference without a distinct user
approval action.

### Obsidian adapter

Owns:

- vault file format, plugin UI, stable ID preservation, and local change
  detection;
- user-owned manual import/export;
- opt-in sync outbox/cursor storage and mapping file;
- preservation of unsupported canonical fields in a sidecar or raw envelope.

Obsidian MUST NOT infer remote deletion from a missing partial file, allocate
canonical revisions, discard tombstones, or resolve conflicts silently.

### Notion adapter

Owns:

- OAuth scope, selected database/page mapping, property mapping, relation
  wiring, pagination, retries, and rate-limit handling;
- stable Travelog ID properties and external Notion page-ID mapping;
- preservation of unsupported canonical fields in a raw property/sidecar;
- polling/webhook reconciliation under eventual consistency.

Notion MUST NOT:

- use a Notion row ID as canonical identity;
- treat a temporarily missing query result as deletion;
- treat an omitted property as a clear;
- overwrite unsupported or protected canonical fields;
- allocate canonical revisions or resolve conflicts.

A Notion deletion becomes an explicit delete proposal only after the connector
confirms that a previously mapped page is archived/deleted, passes an
eventual-consistency grace period, and applies the user's configured delete
policy.

### Manual import/export adapters

Own parsing, rendering, loss reporting, and source-specific validation. They
do not own merge policy. An export MUST identify omitted history, raw
evidence, unsupported fields, and tombstones.

## Offline and retry behavior

- A client persists its outbox before showing a local mutation as durable.
- Reconnect sends the same `clientMutationId`; retry never creates a second
  logical change.
- Local optimistic state is provisional until accepted.
- Rejection or conflict does not delete the local proposal; it moves it to a
  visible reconciliation state.
- Devices pull accepted operations, apply them, then rebase remaining outbox
  mutations against the new local revisions.
- Device clock skew affects display timestamps only.

## Security and privacy boundary

- Actor identity comes from authenticated authority context, not an
  adapter-supplied display string.
- Device and connector installations are revocable.
- Raw GPS access is separately permissioned and may use shorter retention than
  canonical facts.
- Evidence approval records who approved the conversion to a fact.
- Exports and account deletion must state whether raw evidence, operation
  history, and tombstones are included or purged.

## Required acceptance scenarios

A synchronization implementation is not releasable until automated tests cover:

1. duplicate mutation retry returns one accepted operation;
2. disjoint stale edits auto-merge and overlapping edits create a conflict;
3. delete versus offline update creates a conflict, not resurrection or loss;
4. tombstones reach every registered replica before eligible compaction;
5. cursor expiry forces snapshot bootstrap;
6. missing Notion row and missing Obsidian partial file do not imply delete;
7. explicit external deletion produces a previewed tombstone mutation;
8. import without a base is additive/upsert-only;
9. baseline and actual facts survive imports and normal plan edits unchanged;
10. GPS and inference remain evidence until explicit approval;
11. evidence approval atomically creates actual events and review attribution;
12. actual correction appends a superseding event;
13. rollback appends compensating operations and preserves audit history;
14. every old fixture passes the migrate-to-round-trip gate defined in
    `CANONICAL_VNEXT.md`;
15. Obsidian, Notion, Web, and Mobile produce the same semantic canonical
    fingerprint for equivalent supported edits.
