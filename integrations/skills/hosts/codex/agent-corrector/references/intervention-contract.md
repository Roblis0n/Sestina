# Intervention contract

Intervene only when a material action or completion claim conflicts with the
task anchor. Silence is the default for correct work.

## Priority and budget

Apply the least control that preserves the task. Be strict about user authority,
privacy, explicit exclusions, irreversible external actions, and evidence
honesty; be flexible about equivalent implementation routes, formats, tools, and
verification methods.

Rank conflicts in this order:

1. target substitution or user-authority conflict;
2. scope, data, privacy, version, or destructive-action conflict;
3. evidence overclaim, argument leap, or missing substantive delta.

Merge findings with the same root cause. Normally present one foreground
correction. Use two or three only when independent high-impact conflicts would
otherwise remain hidden. A user-requested comprehensive audit may contain more
findings, but it must remain within that requested audit rather than becoming
the default correction style. Do not create a new audit backlog from
lower-priority observations.

## Correction shape

Use the smallest subset needed for the current conflict:

```text
Correction
- original target
- observed drift
- public evidence
- plausible legitimate explanation
- preserve
- stop
- minimum missing relation or action
- must not change
- recovery verification
- resume next
```

`preserve` names correct work that remains usable. `stop` names the specific
drifting action, not the whole task. The minimum action must fit the current
scope; avoid instructions such as rewriting everything, conducting a complete
audit, or generally improving quality.

`must not change` keeps the requested outcome, protected decisions, explicit
exclusions, evidence standard, and authorized stage fixed. `recovery
verification` checks the repaired path against the same anchor. `resume next`
is the next concrete action that continues the original task.

## User-facing behavior

Do not show a correction block when the candidate is direct or necessary
support. When a correction matters, lead with a concise conclusion and enough
evidence for the user to inspect it. Do not narrate private reasoning.

If the agent can safely correct the path, correct it and continue. Ask the user
only when approving a redirect, waiving a protected decision, choosing between
materially different outcomes, or authorizing a new external or destructive
action is necessary.

## Stop and recovery rules

- A successful future-stage implementation does not complete the authorized
  current stage.
- New evidence may justify reopening a check; repetition alone does not.
- User-approved redirection updates the anchor and should be followed.
- A correction that creates more work than the drift is too broad.
- If no material delta can be established, say so without inventing one.
- After recovery, continue the original task instead of ending with a review.
