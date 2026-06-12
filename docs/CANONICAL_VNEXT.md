# Travelog Canonical vNext Contract

## Status and scope

This document is the normative design for the first vNext canonical format,
identified here as schema version `2.0.0`. It is an implementation contract,
not a description of the current `1.0.0` TypeScript types.

vNext separates four things that the current payload partially conflates:

1. the editable plan;
2. immutable snapshots of the user's original plan;
3. confirmed facts about what actually happened;
4. observations and inferences that may support a fact but are not facts.

Synchronization behavior is defined in `SYNC_CONTRACT.md`. Existing schema,
types, and adapters remain `1.0.0` until an implementation explicitly adopts
this contract.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Problems this contract resolves

- `schedule.baseline`, `schedule.current`, and `schedule.actual` look like
  equivalent mutable fields even though they have different authority and
  lifecycle rules.
- A single mutable `actual` time window cannot preserve observations,
  corrections, evidence, or who confirmed a fact.
- `planChanges` is not a complete mutation log. It cannot safely replay state,
  represent every entity type, or distinguish a user edit from merge output.
- Removing an object from an array is a hard delete. A disconnected replica
  cannot distinguish deletion from an incomplete export.
- A whole-dataset import reconstructs state without a common base, so absence,
  field clearing, stale data, and concurrent edits are ambiguous.
- `updatedAt` and wall-clock time cannot provide entity ordering or conflict
  detection.

## Canonical concepts

### Editable plan

The editable plan is the active `trip`, `day`, `timelineItem`,
`checklistItem`, `expense`, and `attachment` entity state. A timeline item's
planned time is `value.schedule.current`.

`current` is the only schedule field directly edited by ordinary planning
commands. Changes to it are accepted through canonical mutations and are
represented by accepted operations.

### Baseline

A baseline is an immutable snapshot of the user's intended plan. It is not a
second editable copy of the timeline item.

- Sealing a baseline creates a `planBaseline` record.
- A baseline record MUST NOT be patched or deleted by ordinary editing,
  import, optimization, or connector sync.
- An explicit user correction creates a new `planBaseline` whose
  `supersedesBaselineId` points to the old record.
- The active baseline projection is the newest non-conflicted record in the
  supersession chain.
- The first automatic baseline seal MUST happen atomically with the first
  accepted change to the corresponding current plan.

### Actual fact

An `actualEvent` is an append-only, user-confirmed canonical fact such as
arrival, departure, route start, or route end. The actual timeline is a
projection over active `actualEvent` records. It is never a mutable
`schedule.actual` field.

A correction MUST append a new `actualEvent` with `supersedesEventId`; it MUST
NOT rewrite the prior event. If competing corrections cannot be ordered, the
actual projection is conflicted until a user resolves it.

### Evidence

Evidence is a preserved observation or inference that may support an actual
fact. Examples include GPS samples, photo timestamps, provider observations,
and inferred arrival windows.

**Mobile GPS and any machine inference are evidence. They are not canonical
facts before explicit user approval.** No adapter, model, background job, or
confidence threshold may bypass this rule.

An explicit user action such as tapping "Arrived" may create an `actualEvent`
directly because that action itself is approval. Approving previously captured
evidence creates an `actualEvent` and links the evidence in one atomic
transaction.

## Portable document shape

The portable vNext snapshot is sufficient to reconstruct canonical state. A
full synchronization operation log is optional in user exports and is not
required to read the snapshot.

```ts
interface CanonicalDocumentV2 {
  schemaVersion: "2.0.0";
  documentId: string;
  exportedAt?: ISODateTime;        // transport metadata; not a conflict clock
  snapshotCursor?: string;         // opaque sync watermark, when available

  entities: EntityRecord[];
  planBaselines: PlanBaseline[];
  actualEvents: ActualEvent[];
  evidence: EvidenceRecord[];
  tombstones: Tombstone[];

  extensions?: Record<string, unknown>;
}
```

Each active ordinary entity is wrapped without removing its stable ID from the
portable value:

```ts
type EntityType =
  | "trip"
  | "day"
  | "timelineItem"
  | "checklistItem"
  | "expense"
  | "attachment";

interface EntityRecord<T = CanonicalEntityValue> {
  meta: EntityMeta;
  value: T;                        // value.id MUST equal meta.entityId
  extensions?: Record<string, unknown>;
}

interface EntityMeta {
  entityType: EntityType;
  entityId: string;
  tripId?: string;
  revision: number;                // positive, entity-scoped integer
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Attribution;
  updatedBy: Attribution;
}
```

`CanonicalEntityValue` retains the logical `1.0.0` entity fields, with these
vNext changes:

- a timeline item schedule contains `current` only;
- embedded `baseline`, `actual`, and `actualDelayMinutes` are not vNext
  canonical fields;
- provider IDs remain references and never become canonical IDs;
- unknown migrated fields are retained in `extensions`, not silently dropped.

## Attribution

Attribution identifies how a canonical record entered state. It does not grant
authority by itself.

```ts
interface Attribution {
  origin: OriginRef;
  actor: ActorRef;
  device?: DeviceRef;
  operationId: string;
}

interface OriginRef {
  system: "travelog-web" | "travelog-mobile" | "obsidian" | "notion" | "import" | "migration";
  installationId: string;         // stable connector/app installation ID
  externalObjectId?: string;      // provider row/file ID, never canonical ID
}

interface ActorRef {
  type: "user" | "service" | "connector" | "migration";
  id: string;
}

interface DeviceRef {
  id: string;
  clientType: "web" | "mobile" | "obsidian-plugin" | "notion-connector" | "import-cli";
  appVersion: string;
}
```

Actor, device, and origin MUST remain separate:

- actor answers who authorized the change;
- device answers which client submitted it;
- origin answers which system representation produced it.

## Baseline records

```ts
interface PlanBaseline {
  id: string;
  tripId: string;
  subjectType: "timelineItem";
  subjectId: string;
  capturedFromRevision: number;
  schedule: TimeWindow;
  sealedAt: ISODateTime;
  sealedBy: Attribution;
  supersedesBaselineId?: string;
  reason?: string;
}
```

Baseline invariants:

1. `capturedFromRevision` MUST identify an existing revision of the subject.
2. `schedule` MUST equal the subject's current schedule at that revision.
3. A record is immutable after creation.
4. At most one record may supersede a given baseline without creating a
   baseline conflict.
5. Import and optimization MUST NOT create a superseding baseline unless the
   user explicitly approves the protected change.

## Actual events

```ts
type ActualEventKind =
  | "arrived"
  | "departed"
  | "visit-started"
  | "visit-ended"
  | "route-started"
  | "route-ended";

interface ActualEvent {
  id: string;
  tripId: string;
  subjectType: "timelineItem";
  subjectId: string;
  kind: ActualEventKind;
  effectiveAt: ISODateTime;
  timeZone: string;
  recordedAt: ISODateTime;
  assertion: "user-declared" | "evidence-approved" | "legacy-migrated" | "correction";
  evidenceIds: string[];
  confirmedBy: Attribution;
  supersedesEventId?: string;
  note?: string;
  extensions?: Record<string, unknown>;
}
```

Actual event invariants:

1. An event is immutable after creation.
2. `subjectId` MUST identify a timeline item in the same trip.
3. Each `evidenceId` MUST identify evidence in the same trip.
4. `evidence-approved` MUST contain at least one evidence ID.
5. `correction` MUST contain `supersedesEventId`.
6. `effectiveAt` is when the event happened; `recordedAt` is when it was
   confirmed. Neither orders entity revisions or synchronization.
7. Deleting or correcting a timeline item MUST NOT silently delete its actual
   events. The resulting orphan/protected-fact issue requires explicit user
   resolution.

The actual schedule projection for a point uses the active `arrived` or
`visit-started` event as start and active `departed` or `visit-ended` event as
end. A route uses active `route-started` and `route-ended` events. Delay is a
derived comparison between current or baseline plan and the actual projection;
it is not stored as a canonical fact.

## Evidence records and approval

```ts
type EvidenceKind =
  | "gps-sample"
  | "gps-segment"
  | "photo-timestamp"
  | "provider-observation"
  | "user-note"
  | "inference";

interface EvidenceRecord {
  id: string;
  tripId: string;
  revision: number;                // 1 when pending, increments on review
  kind: EvidenceKind;
  capturedAt: ISODateTime;
  recordedAt: ISODateTime;
  source: Attribution;
  subjectCandidates: Array<{ type: "timelineItem"; id: string }>;
  payload: Record<string, unknown>;
  payloadHash: string;
  confidence?: number;             // 0..1, informational only
  derivedFromEvidenceIds?: string[];
  review: EvidenceReview;
  retention?: { expiresAt?: ISODateTime; rawExternalRef?: string };
}

type EvidenceReview =
  | { state: "pending" }
  | { state: "accepted"; reviewedAt: ISODateTime; reviewedBy: Attribution; actualEventIds: string[] }
  | { state: "rejected"; reviewedAt: ISODateTime; reviewedBy: Attribution; reason?: string };
```

Evidence transitions:

```text
captured/inferred -> pending revision 1
pending revision N -> accepted revision N+1 + append actualEvent(s)
pending revision N -> rejected revision N+1
accepted/rejected -> terminal
re-open -> create a new evidence record
```

The raw GPS stream MAY live outside the portable document for privacy and
size, but the evidence record MUST retain a hash, attribution, time range, and
review result. Exports MUST state whether raw evidence is omitted.

## Revisions and tombstones

`revision` is a positive integer scoped to `(entityType, entityId)`.

- Creation produces revision `1`.
- Every accepted semantic patch, delete, or restore increments revision by
  exactly one.
- Clients submit `baseRevision`; clients MUST NOT assign the accepted next
  revision.
- Revisions do not order different entities.
- `updatedAt` is display/audit metadata and MUST NOT be used for conflict
  resolution.

Evidence review uses the same revision precondition: capture creates revision
`1`, and the terminal accepted or rejected review creates revision `2`.
Immutable baseline and actual-event records are append-only and therefore do
not have mutable entity revisions.

Deleting an entity creates a tombstone instead of removing all knowledge of the
ID:

```ts
interface Tombstone {
  entityType: EntityType;
  entityId: string;
  tripId?: string;
  revision: number;
  deletedAt: ISODateTime;
  deletedBy: Attribution;
  priorRevision: number;
  reason?: string;
}
```

Exactly one of an active `EntityRecord` or a `Tombstone` may exist for an
ordinary entity ID. A restore consumes the tombstone as its base, creates an
active record at `tombstone.revision + 1`, and leaves the delete operation in
history.

Normal application behavior MUST NOT hard-delete tombstones. Compaction is
allowed only under the acknowledgement and retention rules in
`SYNC_CONTRACT.md`.

## Cross-record invariants

An implementation MUST validate all of the following before committing a
batch:

1. IDs are globally unique across active records, baselines, actual events,
   evidence, and tombstones.
2. Every active child references an active parent in the same trip.
3. A route endpoint references an active point in the same trip.
4. A tombstone and active entity never share the same `(entityType, entityId)`.
5. A baseline, actual event, or accepted evidence review is never changed by a
   normal patch.
6. Protected facts are not cascade-deleted with their subject.
7. `current` edits never mutate a baseline or actual event.
8. Provider observations, GPS, and inference never directly create an
   `actualEvent`.
9. Unknown extension fields survive migration and adapter round trips.
10. Applying the same accepted operation more than once is idempotent.

## Canonical command API

These are logical service APIs. Implementations may expose them over HTTP,
local functions, or a transaction queue, but their preconditions and results
must remain equivalent.

```ts
createEntity(request: CreateEntityRequest): CommitResult;
patchEntity(request: PatchEntityRequest): CommitResult;
deleteEntity(request: DeleteEntityRequest): CommitResult;
restoreEntity(request: RestoreEntityRequest): CommitResult;

sealBaseline(request: SealBaselineRequest): CommitResult;
correctBaseline(request: CorrectBaselineRequest): CommitResult; // explicit user approval required

recordUserActual(request: RecordUserActualRequest): CommitResult;
captureEvidence(request: CaptureEvidenceRequest): CommitResult;
approveEvidence(request: ApproveEvidenceRequest): CommitResult; // atomically appends actual event(s)
rejectEvidence(request: RejectEvidenceRequest): CommitResult;
correctActualEvent(request: CorrectActualEventRequest): CommitResult;

projectActualTimeline(tripId: string): ActualProjection;
validateCanonical(document: unknown): ValidationResult;
```

Every mutating request MUST contain an idempotency key, origin, actor, device
when applicable, and the expected base revision or expected immutable-record
state. Every multi-record command MUST commit atomically or not at all.

## v1 to vNext migration

Migration from `1.0.0` follows these rules:

| v1 input | vNext result |
| --- | --- |
| each entity array item | active `EntityRecord` at revision `1` |
| `schedule.current` | vNext `schedule.current` |
| `schedule.baseline` | immutable `planBaseline`, attribution `migration` |
| `schedule.actual.start` | confirmed `actualEvent` of the matching start kind with assertion `legacy-migrated` |
| `schedule.actual.end` | confirmed `actualEvent` of the matching end kind with assertion `legacy-migrated` |
| `actualDelayMinutes` | omitted; recomputed as a derived projection |
| `planChanges` | preserved as non-replayable legacy audit extensions; never used to reconstruct state |
| missing entity | no tombstone inferred |
| unknown field | preserved under the nearest record's `extensions` |

A legacy actual value is preserved as a fact because silently demoting existing
user data would be destructive. The UI SHOULD label it as migrated and allow
the user to correct it by appending a superseding event.

No migration may invent a deletion for an entity absent from a legacy file.

## Schema-version migration registry

Migrations are explicit, ordered, pure steps:

```ts
interface MigrationStep {
  id: string;                      // stable, unique implementation ID
  fromVersion: string;
  toVersion: string;
  migrate(input: unknown, context: MigrationContext): unknown;
}

interface MigrationContext {
  deterministicId(namespace: string, sourceId: string): string;
  sourceDocumentId: string;
}

registerMigration(step: MigrationStep): void;
migrateDocument(input: unknown, targetVersion: string): MigrationResult;
```

Registry invariants:

- There is exactly one registered forward path from every supported version to
  the current version.
- Steps are deterministic, side-effect free, and make no network or clock
  calls.
- Generated IDs are deterministic from source identity.
- Each step validates its output before the next step runs.
- Unknown fields are preserved.
- Running `migrateDocument` on the target version is a semantic no-op.
- A failure returns the original input plus structured diagnostics; it never
  returns a partially migrated document as canonical.
- Down-migration is not implicit. A legacy export is a named adapter with an
  explicit loss report.

## Import boundary

Parsing an external file does not mutate canonical state. Every import follows:

```text
parse -> validate source -> migrate -> normalize -> prepare merge preview
      -> user/policy approval -> atomic canonical mutation batch
```

Absence is not deletion unless the source contains a vNext tombstone or an
adapter can prove that a previously mapped external object was explicitly
deleted. Baseline changes, actual-event changes, destructive changes, and
ambiguous absences always require preview.

The detailed merge and adapter rules are in `SYNC_CONTRACT.md`.

## Release gate: old fixture to migrate to round trip

Supporting vNext in a release requires a fixture matrix, not only a current
schema validation test.

For every historically shipped fixture and every supported adapter:

1. Load the old fixture without modifying it.
2. Migrate it through the registered path to the current version.
3. Validate all canonical and cross-record invariants.
4. Compute a deterministic semantic fingerprint.
5. Export through the adapter.
6. Re-import using the exported snapshot as the known merge base.
7. Migrate and validate the re-imported result.
8. Assert the same semantic fingerprint, except for fields named in an
   approved, machine-readable loss report.
9. Assert that no missing row became a tombstone, no protected fact changed,
   and no unknown field disappeared.
10. Run the operation-idempotency and migration-target-no-op checks.

The semantic fingerprint includes active entity values, revisions, baselines,
actual events, evidence review state, tombstones, and extensions. It excludes
transport-only fields such as `exportedAt`, opaque cursor values, and
adapter-specific external row IDs.

A release MUST fail when any old fixture cannot migrate, validate, and
round-trip under these rules.
