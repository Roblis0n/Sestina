# Demo 1 — focus substitution boundary

The Brief asks for a mechanism explanation, while the candidate replaces it
with adjacent background description. The edit remains inside the allowed
file scope, so the current deterministic layer must not invent a scope error or
claim that it detected semantic target substitution. The live report must say
`semantic_pending`, with fulfillment still `unproven`.

`pnpm demo:offline` copies the files under `input/` into a fresh temporary
project, invokes the real CLI/Core lifecycle, writes real reports inside that
temporary project, validates them, and removes the project.
