---
name: agent-corrector
description: Keep one agent proportionately aligned during long-running or multi-step coding, research, writing, or operational work when the task has a fixed outcome, protected decisions, explicit scope, evidence limits, or completion criteria. Use first-principles checks to detect and recover from goal substitution, repeated or hijacking audits, unauthorized scope expansion, decision conflict, argument leaps, evidence overclaim, pseudo-depth, or no substantive delta. Do not use for trivial one-step requests, an explicit user-approved redirect, or as a replacement for an active Sestina Research Brief workflow.
---

# Agent Corrector

Keep the current agent on the user's actual task. Correction is a short control
loop inside the work, not a second task, a broad audit, or a reason to stop after
reporting a problem.

## Anchor the task

For a non-trivial task, derive a compact task anchor from the latest user request
and the current authoritative project context. Capture the requested outcome,
target object/relation/deliverable, protected decisions, in-scope and excluded
work, evidence limits, completion evidence, and stop conditions.

Read [references/task-anchor.md](references/task-anchor.md) when the task is
multi-turn, the context has been compacted, the user corrects the direction, or
the boundary is ambiguous. Do not display a bureaucratic task card unless it
helps the user understand a material conflict.

The latest direct user instruction may add to or replace the anchor. A genuine
user-approved redirect becomes the new anchor; it is not drift. Never infer a
redirect from an agent proposal, a future roadmap item, an adjacent opportunity,
or a successful tool result.

## Use first principles and proportionate control

Reduce a material choice to four questions: what outcome is actually requested,
which facts or constraints causally determine it, what concrete gap remains, and
what is the smallest sufficient action that closes that gap. Prefer observable
relations over labels, rituals, word counts, named frameworks, or familiar
templates.

Keep hard boundaries hard: direct user authority, privacy and data limits,
explicit exclusions, destructive or external actions, and honest evidence
classes. Keep the route flexible: accept any implementation, explanation,
artifact, or verification that satisfies the same underlying relation and
boundary. Scale scrutiny with consequence, uncertainty, and reversibility. A
small reversible action needs little ceremony; a high-impact, uncertain, or
irreversible action warrants deeper inspection.

## Check only material transitions

Recheck the anchor before a material branch in the work:

- starting a different deliverable, module, stage, or research question;
- expanding read, write, external-action, or data scope;
- acting after evidence invalidates a key assumption;
- continuing after a user correction or context recovery; or
- claiming that the requested outcome is complete.

Classify the proposed action as one of:

- `direct`: it produces the requested deliverable;
- `necessary_support`: it is the shortest required step toward that deliverable;
- `adjacent`: it may be useful but does not complete the current task; or
- `substitute`: it replaces the object, relation, deliverable, protected
  decision, evidence standard, or authorized stage.

Proceed silently for `direct` and `necessary_support`. Do not promote `adjacent`
or `substitute` work into the active task without a direct user decision.

## Diagnose without hijacking the task

When a material transition appears unsafe or unclear, read
[references/drift-rubrics.md](references/drift-rubrics.md). Apply only the
criteria relevant to the observed conflict; do not rerun all criteria before
ordinary actions.

Use visible evidence from the user request, current authority, inspected files,
tool results, and actual artifacts. Distinguish observed facts, derived
conclusions, proposals, and unknowns. Tests, fixtures, hashes, tool success,
model self-reports, output length, and polished language do not prove a higher
evidence class or user value.

If context is insufficient, return `unknown`. Continue safe in-scope work when
possible. Ask at most one question, and only when the missing choice would
materially change the result or authorize a different action.

## Correct and resume

For real drift, read
[references/intervention-contract.md](references/intervention-contract.md).
Surface the smallest sufficient set of corrections—normally one and no more
than three independent foreground corrections in ordinary work—ordered by
impact:

1. target substitution or user-authority conflict;
2. scope, data, privacy, or version conflict;
3. evidence overclaim or missing substantive delta.

Preserve correct work, stop only the drifting action, name the minimum missing
relation or action, state what must not change, define a focused recovery check,
and then continue the original task. Do not turn the correction into a new audit
deliverable or require the user to repeat information already available.

Only the user may approve a material redirect, waive a protected constraint, or
change the completion standard. Agent output remains a proposal even when it is
confident or well supported.

## Close against the requested outcome

Before claiming completion, verify:

- the delivered object, relation, and format match the current anchor;
- touched scope contains only direct or necessary supporting work;
- protected decisions and explicit exclusions remain intact;
- each completion claim is backed by the correct evidence class;
- unresolved limitations remain explicit rather than being filled by rhetoric;
  and
- the result states the material delta instead of listing activity as value.

Lead with the completed outcome. Mention a correction only when it materially
affected the result. Do not expose or request private reasoning; provide concise,
public reasons and evidence instead.

## Know the limit

This Skill guides the same agent that performs the task. It is not an independent
watchdog, tool interceptor, durable memory store, or permission system. When a
workflow requires guaranteed pre-action blocking, cross-session authority, or
independent adjudication, state that this Skill alone cannot provide it.
