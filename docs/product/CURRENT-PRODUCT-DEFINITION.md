# Product definition

Sestina is a **local, interactive research application**. Its purpose is to
preserve judgment continuity during long-running AI-assisted research: the
current question, accepted decisions, unresolved issues, evidence boundaries,
corrections, provenance, and the actual increment added by each revision.

## Product kernel and primary interface

The **Research Deliberation Kernel** is the product's business core. It owns
research objects, legal state transitions, authority checks, Context Manifests,
receipts, recovery rules, and the distinction between evidence, proposals, and
accepted research state.

The **Research Room** is the primary interface. It is a project-bound research
workspace, not an empty stateless chat. It exposes the active research line and
lets the user inspect, compare, correct, accept, reject, defer, resolve, reopen,
back up, and recover structured research state.

CLI, Skills, MCP, and host adapters are supporting interfaces for access,
automation, diagnostics, and recovery. They do not own or duplicate research
rules. The public MCP surface is intentionally read-only.

## Authority invariant

The user is the only research authority. Models and agents may create bounded
proposals or evidence with provenance. They cannot activate a Brief, accept or
reject a Review, resolve or waive an Issue, change a Decision, settle an Appeal
or Deliberation Room, or declare research complete. These actions require an
explicit direct-user command checked by the Kernel.

Missing proof remains unknown or unproven. Tool success, signatures, hashes,
agreement between models, test fixtures, and release integrity do not become
evidence of research correctness, Provider quality, external adoption, or
market value.

## Local-first and outbound context

Project state is stored locally in the selected project's `.sestina`
directory. Sestina has no required cloud account, automatic synchronization,
telemetry, crash upload, automatic content log, or background model request.

Optional Provider calls are request-bound exceptions. The user configures a
Provider, generates and inspects an exact Context Manifest, and confirms that
specific request. The Manifest records included and excluded categories,
purpose, limits, hashes, and runtime identity. Stale state or changed
configuration invalidates confirmation. Raw Provider envelopes, credentials,
and hidden reasoning are not persisted.

## Product limits in 0.2.0

Version 0.2.0 is an archive-based public preview for Windows x64, macOS arm64,
and Ubuntu x64. It is not a native installer or background desktop service and
does not include automatic updates, signing, notarization, npm publication,
cloud sync, public write-capable MCP, or a formal local-model runtime.

The release provides verified implementation and artifact evidence. Real
external-user value, repeated-use value, Provider semantic quality, and market
value require separate observation and are not claimed by this release.
