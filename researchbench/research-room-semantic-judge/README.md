# Research Room Semantic Judge development benchmark

This directory is a synthetic, development-only evaluation harness for the real Research Room Semantic Judge protocol. It is not the missing RI-35 locked benchmark, external-user evidence, market evidence, adoption evidence, or proof of a real second use.

## What is locked

The development and test sets are separate. The test set, protocol-adversarial set, schemas, codebook, Prompt hash, Rubric hash, and protocol hash are bound by `lock/test-lock.json`. The first lock was generated before any Provider run. Labels, thresholds, schemas, Prompt, Rubric, and test cases cannot be changed silently: append a reason to `CHANGELOG.md`, create a new lock, and invalidate prior results.

Each of the twelve categories has a positive, hard-negative, boundary, and missing-context case in both zh-CN and English in both sets. `data/protocol-adversarial.jsonl` separately covers malformed and authority-bearing responses. All records are synthetic and carry `countsAsExternalEvidence: false`.

## Reproducible workflow

Build the runtime before using the tools:

```text
pnpm --filter @sestina/research build
pnpm --filter @sestina/review build
pnpm --filter @sestina/research-room build
```

1. Export hash-bound requests without labels or API keys:

```text
pnpm semantic:judge:export -- --split test --provider-config <safe-provider-config.json> --output <requests.json>
```

2. Either send those synthetic requests through an explicitly selected Provider or obtain responses out of band. A Provider run is capped and requires the literal confirmation flag:

```text
pnpm semantic:judge:run -- --confirm-synthetic-send --provider-config <safe-provider-config.json> --split test --max-cases 96 --output <predictions.jsonl>
```

For external HTTPS only, explicitly provide `SESTINA_JUDGE_API_KEY` to that process. The value is never written. No port scan, Provider discovery, model download, fallback, redirect, retry, or uncapped batch is performed.

3. Strictly import externally obtained responses without retaining Provider raw responses:

```text
pnpm semantic:judge:import -- --requests <requests.json> --responses <responses.jsonl> --output <predictions.jsonl>
```

4. Evaluate a complete prediction file:

```text
pnpm semantic:judge:evaluate -- --split test --predictions <predictions.jsonl>
```

The evaluator writes aggregate and failure-case reports. Without a user-configured Provider and genuine model predictions, it returns `blocked_missing_user_config`; fixtures and encoded answers are not accepted as semantic-quality evidence.

## Evidence layers

1. Protocol unit tests prove schema, compiler, hash, span, Authority, and failure behavior.
2. A loopback HTTP test service proves the one-shot network adapter and state transitions, not semantic judgment quality.
3. A real Provider host smoke can prove that a configured model processed synthetic input.
4. This development benchmark can measure that model on constructed cases, never real-user quality.
5. External usability and real second use remain `unproven`.

## Network, cost, and privacy

- Export and evaluation are offline.
- The Provider runner is the only network-capable benchmark command. It needs explicit configuration, an explicit confirmation flag, and an explicit maximum case count.
- Inputs contain no real project, user file, private conversation, or secret.
- API keys are not accepted in config files and are not stored in requests, predictions, reports, or provenance.
- Provider raw responses are transient and are not written by the runner or importer.
- Cost is recorded only when known; otherwise it remains `null`, never estimated as fact.
- Synthetic benchmark results never count as external evidence.

Current checked-in status: `real_provider_host_smoke = blocked_missing_user_config`, `development_semantic_metrics = blocked_missing_user_config`, external-user usability, real second use, and market evidence = `unproven`.
