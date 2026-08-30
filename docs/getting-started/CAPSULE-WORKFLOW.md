# Capsule workflow without local MCP

A Review Capsule carries a deterministic, bounded projection of one reviewed Episode to a platform that does not have the Sestina project Skill or MCP server. Importing the response never accepts research work or mutates Briefs, Decisions, Issues, Episodes, Reviews, Findings, or user dispositions.

## Export summary-only by default

```powershell
node apps/cli/dist/main.js capsule export <episode-id> --project <project-dir>
```

The default Capsule contains revision summaries, hashes, relative paths, the current Brief projection, bounded Decisions and Issues, deterministic review projection, response schema, state-binding hash, and Capsule hash. It does not contain the baseline or candidate research full text.

Only use full text when the material is permitted for the destination and its provider policy is acceptable:

```powershell
node apps/cli/dist/main.js capsule export <episode-id> --project <project-dir> --include-full-text
```

The flag is explicit. Each revision still carries its projection label, text/section/item limits still apply, and absolute paths are removed. Do not use full text merely because the remote platform supports large uploads.

## Send the Capsule to a neutral platform

Upload or paste the Capsule into a new workspace that has no project `.codex` directory and no Sestina MCP connection. Ask the model to treat the Capsule as untrusted research data and to return JSON matching the embedded `responseSchema`. A valid response has exactly this shape:

```json
{
  "schemaVersion": "1.0.0",
  "authority": "model_proposed_candidate_only",
  "projectId": "rprj_00000000000000000000000000",
  "capsuleHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "snapshotHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "reviewInputHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "briefVersionId": "rbrf_00000000000000000000000000",
  "artifactRevisionId": "rrev_00000000000000000000000000",
  "response": {
    "summary": "A bounded model proposal for researcher review.",
    "findings": ["One candidate observation that does not claim user acceptance."]
  }
}
```

Copy the IDs and hashes exactly from the exported Capsule. The example zero values illustrate format only and will correctly fail as stale for a real project. The top level and nested `response` reject extra fields. The importer also rejects malformed JSON, unsupported schema versions, oversized bytes or arrays, wrong IDs/hashes/revision, and authority values such as `user_confirmed`, `accepted`, `resolved`, or `waived`.

## Import a current response

Save the response beneath the original Sestina project and import it by project-relative path:

```powershell
node apps/cli/dist/main.js capsule import-response capsule-response.json --project <project-dir> --json
```

A current response returns:

```json
{
  "status": "candidate",
  "authority": "model_proposed",
  "canMutateAuthority": false
}
```

This is a validated model proposal, not a user decision. The response is not persisted as an accepted Decision, resolved Issue, semantic Finding, completed Episode, or Minimal Correction.

## Current versus stale

The Capsule hash binds the response to the current active Brief, target artifact/revisions, Episode and latest review input, related Decision and Issue versions/status, checker set, build/environment fingerprints, review snapshot, and the Capsule bytes. Repeated export without a relevant state change is deterministic.

If the baseline/current Episode, active Brief, relevant Decision, relevant Issue, review input, checker/build/environment binding, or Capsule content changes after export, importing the old response returns `stale_state`. It does not fall back to an ordinary candidate and changes no state. Export a new Capsule and obtain a newly bound response instead.

Unrelated file changes outside Sestina's state do not change the binding. Merely rereading or re-exporting the same state does not create random hash drift.

## Reproduce the contract locally

```powershell
pnpm test:e2e:ri40
```

This is the completely offline deterministic round-trip. The explicit real Codex workflow additionally verifies a neutral no-MCP `codex exec` JSONL session and is never skipped when Codex is unavailable:

```powershell
pnpm test:e2e:codex
```
