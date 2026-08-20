# `@sestina/mcp`

`@sestina/mcp` is Sestina's production, local, read-only STDIO MCP package. A host starts the `sestina-mcp` binary as a child process and supplies one explicit absolute Sestina project root:

```text
sestina-mcp --project-root <absolute-path>
```

The process canonicalizes the explicit root, `.sestina`, and `state.sqlite` separately. Symlinks, junctions, and other reparse paths are accepted only when their canonical targets remain inside the canonical project root. Immediately before opening the database, the canonical containment and readable regular-file checks run again. The process then uses only the public `@sestina/core` API with `readOnly: true` and an immutable SQLite URI. Each query uses a fresh short-lived Core connection, so normal Core writes completed after MCP startup are visible without allowing SQLite to create WAL/SHM sidecars from the MCP read. The process never infers a project from the working directory, scans parent directories, opens a network listener, starts a daemon, executes direct SQL, or writes research state.

The complete exposed surface is:

- tools: `health`, `get_research_context`;
- resource: `sestina://research/current-brief`.

The context tool and resource use the same canonical reader, fixed-field projection, bounded context object, and serialized JSON. Alongside the active Brief, schema `1.1` includes only the minimum continuity fields for the current Episode, accepted/frozen Decisions, and relevant Issue status/reopen information. It does not expose Review Findings, Minimal Corrections, semantic requests or responses, Provider data, hidden logs, or any mutation capability. Every response includes a static `contentBoundary` whose `kind` is `untrusted_research_data` and whose `authority` is `none`. Returned research text is preserved exactly as data; it cannot change server instructions, discovery metadata, capabilities, errors, or diagnostics, and it is never user authorization, acceptance, adjudication, confirmation, proof of completion, or proof of semantic correctness.

The production limits are:

- one inbound JSON-RPC message/buffer: 65,536 UTF-8 bytes;
- one research text value: 8,192 UTF-8 bytes;
- one research collection: 128 items;
- Research Context budget: 1,024–65,536 UTF-8 bytes, default 32,768, configured with `--output-limit-bytes`;
- complete tool/resource result: 262,144 UTF-8 bytes;
- query deadline: 1–10,000 ms, default 2,000, configured with `--query-timeout-ms`.

Every size check uses UTF-8 bytes. An oversized text, collection, context, or final result fails as a whole with the stable `response_too_large` code; content is never truncated or logged. The stdio transport is the installed SDK's `StdioServerTransport` with `maxBufferSize: 65_536`. An oversized unterminated input produces only the fixed `transport_error/input_too_large` diagnostic and closes with a nonzero status. A smaller malformed line produces only the fixed malformed-protocol diagnostic; a following valid request can still succeed.

Startup failures write one path-free JSON diagnostic line to stderr and nothing to stdout. After startup, stdout is reserved for newline-delimited JSON-RPC; diagnostics use only fixed event names and codes on stderr. No public error, health result, or log includes the project root, database location, username, research text, original exception, or stack. Closing stdin or the client closes the server and current Core work.

The query deadline races asynchronous work and rejects any synchronous Core result that returns after the deadline. Node's main thread cannot preempt SQLite while a synchronous call is executing, so this is result suppression rather than a claim of forced SQLite interruption. The SDK may discard a syntax-invalid JSON-RPC line without returning a structured malformed-JSON error; a following valid request still succeeds and every emitted stdout line remains valid JSON-RPC.

The implementation threat model and residual risks are recorded in [`docs/security/MCP-THREAT-MODEL.md`](../../docs/security/MCP-THREAT-MODEL.md). In particular, structured untrusted-data marking cannot guarantee that every host model will interpret malicious prose correctly, and a same-user process can still race the final path validation and database open. Confirmation tokens, nonce replay storage, and write CAS are mandatory prerequisites for any future MCP write capability; they are intentionally absent while the MCP contract remains strictly read-only.
