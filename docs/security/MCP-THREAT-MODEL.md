# MCP threat model

## Scope and protected assets

This model covers the local `@sestina/mcp` stdio process and its three read-only surfaces: `health`, `get_research_context`, and `sestina://research/current-brief`. It protects the selected project's state boundary, the database from MCP-originated writes, the confidentiality of local paths and non-projected state, the authority boundary between research text and user instructions, bounded process memory/output, and protocol-clean stdout.

It does not claim that the MCP host, operating-system account, or another process running as the same user is trusted. There is no secret input or secret-return path in the current MCP contract.

## Trust boundaries and attacker capabilities

- The explicit `--project-root` is untrusted until canonicalized and contained. The process never searches the current or parent directories.
- `.sestina`, `state.sqlite`, symlinks, junctions, and reparse targets are untrusted filesystem state.
- Every projected Brief or continuity string and collection is untrusted research data, including text that resembles `SYSTEM`, JSON-RPC, approval, confirmation, an actor, a path, or a tool call.
- JSON-RPC input is untrusted and bounded by the SDK transport before protocol dispatch.
- `@sestina/core` is the only database boundary. MCP passes `readOnly: true` and `immutable: true`; it contains no SQL.
- An attacker may control research text, call tools with arbitrary JSON, send malformed or oversized stdio input, provide an escaping project path, or race files using another same-user local process.

The accurate attack surface is the three startup options, newline-delimited stdin, the canonical local SQLite file, the two fixed tools, the one fixed resource, protocol stdout, and fixed diagnostic stderr. There are no prompts, template resources, network listeners, daemon endpoints, accounts, telemetry, write tools, Capsule import, or semantic-review surface.

RI-52 adds an invocation-only **frozen mode**, not a public capability. The Codex Runner creates an exact Context file and an empty audit file inside one new operating-system temporary directory, then starts the same stdio MCP with absolute `--frozen-context-file`, expected project ID, expected Manifest hash, and audit path. The server requires both files to have the same canonical parent, verifies SHA-256 and project/Manifest binding before serving, and exposes the same two tools and one Resource. It never opens the live project database in frozen mode. The temporary path is not returned to the model or persisted in Pilot diagnostics.

## Threat-to-control map

| Threat | Current control | Proof test | Residual risk |
|---|---|---|---|
| `.sestina` or `state.sqlite` escapes the selected project | Canonical `realpath`; `path.relative` containment for root/state/database; readable directory/regular-file checks; final revalidation immediately before Core open | `security-paths.test.ts`, `security-paths-unreadable.test.ts` | A same-user process can still replace a file between final validation and SQLite open (TOCTOU). The immutable URI reduces writes, not this race. |
| Similar path prefix bypass (`project` vs `project-evil`) | Component-aware `path.relative` containment, never string-prefix comparison | `security-paths.test.ts` | Filesystem behavior below the OS canonicalization layer remains trusted. |
| Research text impersonates system/user authority or tool instructions | Fixed `contentBoundary` with `kind: untrusted_research_data` and `authority: none`; fixed-field projection; static server/discovery/error text; identical tool/resource serialization | `security-content-boundary.test.ts`, `stdio-process.test.ts` | Structured marking cannot theoretically guarantee that every host model will interpret malicious prose correctly. Hosts must still treat returned fields as data. |
| Arbitrary database attributes leak through MCP | Explicit nested projection of allowed Brief fields plus minimum current Episode, accepted/frozen Decision, and relevant Issue status/reopen fields; no YAML, source, actor, raw Finding, semantic request/response, Provider data, or unknown-property forwarding | `security-content-boundary.test.ts`, `project-reader.test.ts` | A future schema field remains unavailable until deliberately projected and tested. |
| Oversized text, collections, context, result, or unterminated input consumes memory/output | UTF-8 byte limits at 8,192 bytes per text, 128 items per collection, configured context budget, 262,144 bytes per complete MCP result, and 65,536-byte SDK stdio buffer; whole-response rejection with `response_too_large` | `security-limits.test.ts`, `stdio-process.test.ts` | A legitimate but larger Brief is rejected fail-closed. Synchronous SQLite work cannot be force-interrupted; the deadline suppresses late results. |
| Model forges actor, approval, confirmation, Capsule, Decision, Issue, Review, or Finding input | Exactly two strict-empty-input tools; one fixed resource; no prompts/templates/write registration; Core opens read-only and immutable | `security-capabilities.test.ts`, `server-contract.test.ts`, `package-boundary.test.ts` | This is safety by capability absence, not an implemented write-security protocol. |
| Read-only calls alter SQLite state or create WAL/SHM | Each query uses a fresh Core connection with `readOnly: true` and SQLite immutable URI; database bytes and directory entries are compared before/after serial and concurrent calls | `security-capabilities.test.ts`, `project-reader.test.ts` | Immutable SQLite assumes the opened file is not concurrently mutated. A normal Core write must finish before its new checkpoint is relied upon; same-user hostile concurrent replacement remains outside this guarantee. |
| Malformed or oversized input contaminates stdout/stderr | stdout is transport-only; stderr uses fixed event names/codes and never includes the exception or input; oversized transport closes with nonzero status | `stdio-process.test.ts` | SDK protocol behavior and the local pipe implementation remain dependencies. |
| Previewed Context differs from the Codex-readable payload | Manifest hashes exact canonical UTF-8; Runner writes that exact string; frozen reader recomputes hash; Codex JSONL events and a two-entry local audit must both match project/Manifest/payload | `frozen-pilot-reader.test.ts`, `codex-pilot-runner.test.ts`, `ri52-api.test.ts` | A compromised same-user host process can read its own invocation payload; this is disclosed, not prevented. |
| Confirmation is replayed for another project/attempt/hash | nonce, expiry, project, Pilot, attempt, purpose, Manifest, hash, and expected version are Kernel-validated and consumed once | RI-52 domain/Core/API/store tests | A user may explicitly confirm another later Manifest; there is no automatic retry. |
| Cancelled or crashed invocation commits a late result | Abort terminates the child; cancelled/closed/unknown states reject late results; startup recovery marks unproved running attempts `interrupted_unknown` | RI-52 domain/runner/API/browser tests | OS process termination is best-effort; Kernel fencing remains authoritative even if process exit is delayed. |
| Model/schema attempts to expand Authority or reference another project | Strict exact-key output decoder fixes `model_proposed` / `host_observation`, `canMutateAuthority=false`, current-project IDs and byte limits; import still enters existing Review | `codex-pilot-runner.test.ts`, RI-52 Core/API tests | Semantic truth of a structurally valid candidate remains unproven. |

## Currently unreachable write threats

Confirmation replay, Capsule import, model writes to Decision/Issue/Review, concurrent write overwrite, and CAS conflicts are currently unreachable because no MCP write capability or confirmation input exists. RI-38 has not implemented write safety and must not be cited as having done so.

Before any future MCP write tool is implemented or registered, it must first add an action/project/version/expiry/nonce-bound confirmation token, one-time nonce and replay storage, CAS/version-conflict handling, and independent adversarial tests. Until all of those controls exist and pass, MCP write tools remain prohibited.

RI-52 does not relax this rule. Candidate import, Review disposition, feedback, close, and evidence export are loopback Research Room commands handled by Kernel/Core; none is exposed through MCP.
