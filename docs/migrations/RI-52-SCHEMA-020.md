# RI-52 Schema 020 — Closed External App Pilots

> Status: `implemented_and_offline_verified`
> Migration: `020-closed-external-app-pilots`
> Previous schema: `019`

## 1. Scope

Schema 020 adds project-local persistence for one Codex-only Closed External App Pilot. It does not alter Brief, Decision, Issue, Evidence, Episode, Working Memory, Finding, Appeal, Deliberation, Provider, Receipt, or Authority semantics.

The migration adds:

- `closed_external_app_pilots`: strict aggregate snapshot, current finite state, evidence class, version, and lifecycle timestamps;
- `closed_external_app_pilot_events`: append-only public transition records keyed by project, Pilot, and event sequence;
- indexes for bounded project/state/updated listing and Pilot event pagination.

Attempts, Context confirmations, candidate/Review/Receipt/continuity bindings, bounded metrics, feedback, and stable failure facts live inside the strictly decoded aggregate JSON so one CAS update cannot split mutually dependent state.

## 2. Constraints and atomicity

- Pilot and event IDs use typed `rpil_` / `rpev_` identities and bind one `rprj_` project foreign key.
- State is restricted to the RI-52 finite state set.
- Version is positive and updated through repository compare-and-swap.
- Event sequence is positive and unique per Pilot; project/Pilot foreign-key bindings prevent cross-project insertion.
- Aggregate snapshot and newly emitted events commit in one transaction.
- The service uses a Store unit of work where an intermediate domain state must not be externally observable, including `candidate_received` → `candidate_confirmation_required`.

## 3. Recovery behavior

- Clean schema 019 upgrades once to 020; reopening 020 is idempotent.
- A new database receives all migrations through 020 in order.
- `launching`, `running`, and `continuity_check_running` are recovered to `interrupted_unknown` on Core startup. There is no automatic resubmission.
- Unknown schema, unknown state, malformed JSON, mismatched project identity, invalid typed IDs, non-monotonic event data, and corrupt versions fail closed.
- Closed Pilots cannot be reopened; late candidate/continuity results after cancellation or closure are rejected.
- List and event reads use bounded keyset pagination and reject malformed or cross-project cursors.

## 4. Privacy boundary

The aggregate stores the exact confirmed Manifest bytes because preview/payload identity and restart inspection are product facts. It does not store Codex hidden reasoning, complete JSONL, raw stderr, credentials, complete environment variables, unbounded Provider envelopes, or runtime temporary-file paths. Candidate content is project-local and excluded from the minimal evidence export.

Optional free-text feedback remains inside the project aggregate and is not included in the normalized evidence export. Ordinary reports, Capsules, RI-43 participant evidence, telemetry, and cloud sync do not enumerate Pilot rows.

## 5. Verification

Migration and repository tests prove:

- 019 → 020 and new-database application;
- table/index/foreign-key/check creation and idempotent reopen;
- atomic CAS updates and conflict failure;
- project isolation and bounded pagination;
- duplicate candidate and closed-Pilot fencing;
- attempt-budget persistence;
- interrupted invocation recovery without retry;
- corrupt aggregate/state failure;
- evidence export redaction.

The migration is additive and has no automatic destructive down migration. A project backup should be made before intentionally opening schema 020 with an older build.
