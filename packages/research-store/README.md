# @sestina/research-store

SQLite persistence adapters for the pure `@sestina/research` domain.

- Validates every value before writing and after reading.
- Uses project-scoped queries, stable keyset pagination and database CAS.
- Keeps immutable revisions, snapshots and ledger transitions append-only.
- Provides a synchronous, short-lived research unit of work.
- Does not write legacy product tables and does not perform semantic review.
