# Production data-flow inventory

The authoritative machine-readable form is returned by `sestina privacy show --json`. This document explains the same production manifest.

| Flow | Trigger | Data categories | Destination | Network | Explicit user action or confirmation | Can change research authority |
| --- | --- | --- | --- | --- | --- | --- |
| Local Core/CLI | A local Sestina command | Project research state, Brief, Decisions, Issues, Reviews, recovery metadata | Project `.sestina/` and explicit local output | No | Command is explicit; authority-changing research actions retain their existing confirmation rules | No external actor is involved |
| Codex host/model | `connection-status --verify-host --yes` or active user-directed host work | Bounded research context, project/active-Brief identifiers, current research boundaries | User-selected Codex model provider | Yes | Yes; real verification requires `--yes` | No; MCP is read-only and model output is not user authority |
| Research Room Semantic Judge | User configures the original Judge, generates an exact Manifest, inspects it, and explicitly confirms one assessment | User-selected bounded Research Room context; frozen source/input/criterion/rubric/state bindings; suggestion required for that assessment | User-configured `openai_compatible` endpoint | Only after confirmation | Yes; saving config does not probe and `/models` test is metadata-only | No; strict normalized output is a candidate and Kernel/user Authority remains controlling |
| RI-49 second opinion | User separately configures a second runtime, records an Appeal, selects Context, inspects the exact Manifest and independence basis, and confirms one attempt | Frozen challenged source/input/criterion/rubric; appeal question; only explicitly selected Brief/Decision/Issue/Evidence fields; never original verdict/reason/confidence/raw response | Separately configured `openai_compatible` endpoint | Only after confirmation | Yes; every retry requires a fresh Manifest confirmation | No; assessment and deterministic comparison cannot resolve the Appeal |
| Local model | None in the current production runtime | None (`fields: []`) | None | No | Not available | No |
| Capsule transfer | Explicit Capsule export, user transfer, or response import | Bounded portable research projection selected by the user | Local file, then any destination selected and operated by the user | Sestina does not upload | Yes | No; response remains `model_proposed` candidate |
| Backup/restore | `data backup`, restore preview, or confirmed `data restore ... --yes` | SQLite project state, active Research Brief, hashes and binding metadata | `.sestina/backups/` and the same local `.sestina/` state | No | Backup/status are explicit; restore commit requires `--yes` | Restores a previously user-authorized local state; no external model authority |

## Local storage contents

`.sestina/state.sqlite` stores local research lifecycle records through schema 18. In addition to append-only Appeals, it stores project-bound Deliberation Room source/context freezes, participant identity digests, two exact Context Manifests, round/attempt state, normalized assessments, deterministic Difference summaries, challenge/manual-opinion disclosure, direct-user Resolutions, transitions, idempotent command receipts, and lineage. It does not store Provider secrets, raw responses, authentication headers, full network payloads, private sessions, or hidden reasoning. `.sestina/research-brief.yaml` is the file projection of the active research question and boundaries. `.sestina/backups/manual/` contains strict managed recovery bundles; `.sestina/backups/forensic/` contains raw pre-restore evidence when the current state is not healthy enough to create a verified bundle.

Recovery bundles intentionally exclude `.codex`, `.agents`, authentication stores, Provider configuration/responses, log files, temporary files, Capsule responses, and user project source files outside the active Brief. Secret backends remain separate from project recovery.

## Output boundaries

Privacy and recovery status outputs contain policy fields, managed IDs, versions, sizes, hashes, validation states, and confirmation state. They do not contain research text, Provider responses, tokens/secrets, authentication state, personal paths, or native SQLite errors. Explicit content-read commands retain their documented research-data output.

See [LOCAL-FIRST-GUARANTEE.md](LOCAL-FIRST-GUARANTEE.md) and [backup/restore details](../recovery/BACKUP-RESTORE.md).

## Deliberation Provider boundary

The owner-visible Manifest is the exact allowlist for each participant request.
Both initial requests are frozen before either result is accepted; A receives
no B output/private context/session and B receives no A output/private
context/session. User-only Resolution content is excluded from Provider input.
The adapter may send only the frozen request to the explicitly configured
endpoint after both Manifests are confirmed. No automatic fallback, retry,
external search, tool, file, shell, cross-project memory, or synthesis call is
allowed. At most four calls can occur in one Room.

Only normalized validated public assessments are persisted. Participant-private
content is excluded from the other participant and the default export. Manual
external opinions retain source, capture time, and exposure disclosure and are
always marked non-verifiable for mutual blindness. Cross-project Room reads,
events, imports, search, and deep links fail closed. See
[the RI-50 architecture contract](../architecture/04-MUTUALLY-BLIND-BOUNDED-DELIBERATION-ROOMS.md).
