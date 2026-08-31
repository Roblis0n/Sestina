# Agent Corrector

Status: `completed_and_verified_bounded_behavior`

Task: `TOOLING-SKILL-01 Standalone Single-Agent Correction Skill`

## Task contract

### Intended outcome

Provide a lightweight, standalone Codex Skill that helps one agent preserve the
user's requested outcome, protected decisions, scope, evidence boundaries, and
completion criteria during long-running or multi-step work. When the agent
detects drift, it must preserve correct work, stop only the drifting branch,
apply the smallest useful correction, and continue the original task.

This is a user-authorized, non-product tooling addition. It does not change the
Sestina product roadmap, release evidence, or Research Room authority state.

### Decisions that must survive

- Sestina remains a local interactive research application. Skills are thin
  supporting interfaces, not the product kernel.
- The existing `sestina-research-integrity` Skill remains the MCP-backed choice
  for a project with an active Sestina Research Brief.
- The new Skill is a standalone alternative. It has no Sestina MCP, Provider,
  database, network, telemetry, background process, or persistent-memory
  dependency.
- The user remains the only authority who may redirect the requested outcome or
  approve a material scope change.
- Tool success, tests, fixtures, signatures, model self-reports, and polished
  prose do not prove a higher evidence class or user value.
- Hidden reasoning is never requested, exposed, or persisted.
- Correction follows first principles and proportionality: authority, privacy,
  explicit exclusions, irreversible actions, and evidence classes stay strict;
  equivalent implementation and verification routes stay flexible.

### Direct increment

Before this task, the repository offers only the project-connected
`sestina-research-integrity` Skill. After this task, a user can choose a
Skill-only correction workflow that works from the visible task context
without configuring Sestina or MCP.

The observable result is a complete Codex Skill bundle with discriminating
implicit discovery, explicit `$agent-corrector` invocation, detailed
on-demand rubrics, a locked bilingual evaluation corpus, deterministic
generation and validation, installation guidance, and regression coverage for
known Sestina scope-drift failures.

### In scope

- A canonical `agent-corrector` Skill and generated Codex host bundle.
- A compact task-anchor protocol and twelve Sestina-derived evaluation criteria.
- Hard-negative, unknown, intervention-budget, recovery, and completion rules.
- Deterministic bundle generation, export, drift detection, and validation.
- A balanced development/locked evaluation corpus and regression cases.
- Root, documentation-index, Codex getting-started, integration, and skills
  package documentation updates.

### Out of scope

- Research Room, Kernel, storage, migration, Provider, MCP, or UI changes.
- Multi-agent review, a second judge, correction appeals, or deliberation rooms.
- Hooks, pre-tool enforcement, a daemon, scheduled monitoring, or background
  model calls.
- Automatic reading of chat history, other projects, email, cloud storage, or
  personal files.
- Automatic authority mutation, task redirection, or installation into a
  user's project.
- Claims of external-user value or guaranteed correction accuracy.

### Authority and data flow

The Skill reads only the context already visible to the invoking Codex session
and any files or tools independently authorized by the active user task. It may
derive a non-authoritative task anchor and propose a correction. It may not
grant permissions, alter user instructions, approve a redirect, or promote a
proposal into a user decision.

The bundle contains no project Brief, account, secret, personal path, raw
conversation, benchmark answer, or Provider response. Installing or removing
the bundle does not read or change Sestina project data.

### Failure and shrink path

- If required task context is absent, return `unknown` and ask at most one
  genuinely blocking question; otherwise continue safe in-scope work.
- If a candidate action is only adjacent to the requested outcome, do not
  execute it as the new task. Return to the shortest path to the original
  deliverable.
- If the Skill causes repeated audits, excessive narration, or lower task
  completion, it is not ready to ship; narrow its description and workflow
  until the locked evaluation passes.
- If a hard guarantee is required, report that a Skill is insufficient rather
  than pretending it can replace hooks or a separate runtime.

### Verification matrix

| Claim                                        | Required evidence                                                   | Evidence class                      |
| -------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Bundle is a valid Codex Skill                | Official-format validation and generated-file drift check           | implementation                      |
| Existing Sestina Skill is unchanged          | Exact generated bundle and compatibility tests                      | implementation                      |
| Lightweight bundle has no runtime dependency | Metadata, package, and sensitive-pattern assertions                 | implementation                      |
| Triggering is discriminating                 | Explicit, implicit, and negative discovery cases                    | host or bounded behavior evaluation |
| Drift handling is useful                     | Locked positive, hard-negative, boundary, and missing-context cases | bounded behavior evaluation         |
| Historical scope failures are covered        | UI-01-to-RI-50 and other frozen regression cases                    | regression fixture                  |
| External-user value exists                   | Not established by this task                                        | unproven                            |

### Stop conditions

- Stop any change outside the listed Skill, evaluation, generator, tests, and
  documentation paths.
- Do not modify the existing research-integrity behavior merely to share code.
- Do not publish a bundle whose locked cases fail authority, scope, evidence,
  hidden-reasoning, or trivial-task non-trigger invariants.
- Do not call structural tests proof of model behavior or user value.

Start-gate result: `ready_to_start`

## Completion evidence

- The canonical and generated Codex bundles pass the official-format Skill
  validator and deterministic generated-file drift check.
- The corpus contains 48 development cases, 48 locked cases, and 6 historical
  regression cases without embedding case answers in the Skill.
- On Codex `0.151.0-alpha.7.2`, `gpt-5.6-terra`, reasoning effort `none`, the
  current Skill passed all 48 calibration cases and all 6 historical regression
  cases with complete coverage, 1.00 scored behavior metrics, and zero safety or
  result-integrity violations.
- A one-shot run of the complementary 48-case confirmation set, without further
  tuning, passed the behavioral gate: outcome accuracy `0.9792`, user-decision
  accuracy `0.9792`, allow recall `0.9286`, steer recall `1.0000`, steer-resume
  rate `1.0000`, and zero safety or result-integrity violations. The advisory
  intervention-recommendation metric was `0.8542`.
- Raw host responses remain outside Git. Only aggregate bounded-behavior
  evidence is recorded here.

These results prove the checked implementation and bounded synthetic behavior
for the stated host configuration. Because every Skill-on evaluation explicitly
named `$agent-corrector`, they do not prove implicit Skill discovery. They also
do not prove universal correction, independent enforcement, external-user
value, or semantic accuracy across all real tasks.

## Installation and usage

The canonical source is
`integrations/skills/canonical/agent-corrector/`. The installable, generated
Codex bundle is `integrations/skills/hosts/codex/agent-corrector/`. Copy the
whole generated directory to `.agents/skills/agent-corrector/` in the target
project; do not copy over an existing destination without inspecting its local
changes first. Exact PowerShell and POSIX commands are in the
[Codex getting-started guide](../getting-started/codex.md).

Reopen the target project after installation. Invoke the workflow explicitly
with `$agent-corrector` when desired. Codex may also activate it implicitly for
non-trivial work that matches the narrow discovery description. Trivial
one-step requests and explicit user-approved redirects are hard negatives: they
must not be turned into correction exercises.

The Skill uses sparse material-transition checks rather than monitoring every
action. Correct and necessary supporting work proceeds silently. A correction
preserves valid work, stops only the drifting branch, normally names one issue
and at most three independent foreground issues in ordinary work, applies the
smallest recovery, and continues the original task.

Its depth is proportional to consequence, uncertainty, and reversibility. It
does not require a named framework, exact wording, fixed implementation route,
or every anchor field when those details do not affect the result.

## Maintainer verification

From the repository root:

```text
pnpm --filter @sestina/skills generate
pnpm --filter @sestina/skills check
pnpm --filter @sestina/skills test
```

When maintaining the Skill from a Codex development environment, also run the
installed `skill-creator` validator against both the canonical and generated
`agent-corrector` directories.

The deterministic evaluation workflow and its evidence limits are documented
in `integrations/skills/evals/agent-corrector/README.md`. Passing structural
checks or bounded model cases does not establish guaranteed correction,
independent enforcement, external-user value, or semantic correctness across
all tasks.
