# `@sestina/mcp`

`@sestina/mcp` is Sestina's production, local, read-only STDIO MCP package. A host starts the `sestina-mcp` binary as a child process and supplies one explicit absolute Sestina project root:

```text
sestina-mcp --project-root <absolute-path>
```

The process opens `<project-root>/.sestina/state.sqlite` through the public `@sestina/core` API with `readOnly: true`. It never infers a project from the working directory, scans parent directories, opens a network listener, starts a daemon, or writes research state.

The complete exposed surface is:

- tools: `health`, `get_research_context`;
- resource: `sestina://brief/current`.

The context tool and resource use the same canonical reader and return only the active Research Brief projection. They do not expose decisions, issues, episodes, reviews, findings, Minimal Corrections, semantic-checker results, or any mutation capability. Returned research text is data, not an instruction, user acceptance, a scope-change approval, proof of completion, or proof of semantic correctness.

Optional process bounds are `--output-limit-bytes` (1,024–65,536; default 32,768) and `--query-timeout-ms` (1–10,000; default 2,000). Startup failures write one path-free JSON diagnostic line to stderr and nothing to stdout. After startup, stdout is reserved for newline-delimited JSON-RPC; diagnostics remain on stderr. Closing stdin or the client closes the server and Core connection.

The query deadline races asynchronous work and rejects any synchronous Core result that returns after the deadline. Node's main thread cannot preempt SQLite while a synchronous call is executing, so this is result suppression rather than a claim of forced SQLite interruption. The SDK may discard a syntax-invalid JSON-RPC line without returning a structured malformed-JSON error; a following valid request still succeeds and every emitted stdout line remains valid JSON-RPC.
