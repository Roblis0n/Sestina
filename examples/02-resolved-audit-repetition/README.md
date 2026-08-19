# Demo 2 — resolved audit repetition

The first review records a scope Issue and the user resolves it. A second
Episode reviews the same unchanged candidate against the same lineage. The
existing Issue matcher must retain the repeated Finding in audit history as
`suppressed`, remove it from the foreground, and return a non-blocking CLI exit.

The live Markdown report is also checked for its suppressed-audit count. No
prebuilt database or ReviewRun is used.
