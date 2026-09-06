import { writeSync, readSync, readFileSync } from "node:fs";
import {
  migrateKernelProject,
  openKernelProject,
  restoreKernelPreMigrationBackup,
} from "@sestina/core";
import { createResearchUnitOfWork } from "@sestina/research-store";
import { kernelHash, type KernelReviewStatus } from "@sestina/research";
import {
  capability,
  at,
  draft,
  ids,
  prepare,
  decision,
} from "./kernel-fixtures.js";
import { value } from "./factory.js";
const [root, mode, point, projectId] = process.argv.slice(2);
function checkpoint(value: unknown): never {
  writeSync(1, JSON.stringify(value) + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw Error("unreachable checkpoint");
}
if (mode === "migration")
  await migrateKernelProject({
    projectRoot: root!,
    faultInjection(stage) {
      if (stage === point) checkpoint({ stage });
    },
  });
else if (mode === "downgrade")
  await restoreKernelPreMigrationBackup(root!, (stage) => {
    if (stage === point) checkpoint({ stage });
  });
else {
  const db = await openKernelProject(root!);
  const uow = createResearchUnitOfWork(db, {
    authorize: (c) => c.authorityCapability === capability,
    faultInjection(stage) {
      if (mode === "transaction" && stage === point) checkpoint({ stage });
    },
  }).kernel!;
  if (mode === "race") {
    const input = JSON.parse(readFileSync(point!, "utf8"));
    writeSync(1, JSON.stringify({ ready: true }) + "\n");
    readSync(0, Buffer.alloc(1), 0, 1, null);
    const result = uow.commitCanonical(
      { ...input.command, authorityCapability: capability },
      (repos) => {
        value(
          repos.decisions.appendTransition(input.object, input.expectedVersion),
        );
      },
    );
    writeSync(1, JSON.stringify(result) + "\n");
    db.close();
  } else if (mode === "transaction") {
    const object = decision(db, projectId!);
    const prepared = prepare(uow, projectId!, "create_decision", [
      { kind: "decision", id: object.id, version: 0 },
    ]);
    value(
      uow.commitCanonical(prepared.command, (repos) => {
        value(repos.decisions.create(object));
      }),
    );
  } else {
    const status = point as KernelReviewStatus;
    if (["draft", "cancelled"].includes(status)) {
      let r = value(
        uow.workflow((repos) => repos.reviews.create(draft(projectId!, 1))),
      );
      if (status === "cancelled")
        r = value(
          uow.workflow((repos) =>
            repos.reviews.compareAndSwap(
              { ...r, status, version: r.version + 1 },
              r.version,
            ),
          ),
        );
      checkpoint({ reviewId: r.id, status: r.status });
    }
    const object =
      status === "committed" ? decision(db, projectId!) : undefined;
    const prepared = prepare(
      uow,
      projectId!,
      status === "committed" ? "create_decision" : "record_only",
      object ? [{ kind: "decision", id: object.id, version: 0 }] : [],
      true,
      status === "manifest_prepared",
    );
    let r = prepared.review;
    if (object)
      value(
        uow.commitCanonical(prepared.command, (repos) => {
          value(repos.decisions.create(object));
        }),
      );
    if (status === "disposed")
      value(uow.commitCanonical(prepared.command, () => {}));
    else if (status === "stale")
      r = value(
        uow.workflow((repos) =>
          repos.reviews.compareAndSwap(
            {
              ...r,
              status,
              staleReason: "synthetic_stale_binding",
              version: r.version + 1,
            },
            r.version,
          ),
        ),
      );
    else if (
      status.startsWith("provider_attempt") ||
      status === "assessment_recorded"
    ) {
      let a = {
        schemaVersion: "2.0.0" as const,
        id: ids.create("rpat_"),
        projectId: projectId!,
        reviewId: r.id,
        ordinal: 1,
        manifestId: prepared.manifest.id,
        manifestIdentityHash: prepared.manifest.identityHash,
        status: "prepared" as const,
        assessment: null,
        assessmentHash: null,
        failureCode: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      value(
        uow.workflow((repos) => {
          const created = repos.attempts.create(a);
          r = repos.reviews.compareAndSwap(
            {
              ...r,
              status: "provider_attempt_prepared",
              attemptIds: [created.id],
              version: r.version + 1,
            },
            r.version,
          );
          if (status !== "provider_attempt_prepared") {
            let running = repos.attempts.compareAndSwap(
              { ...created, status: "running", version: 2 },
              1,
            );
            r = repos.reviews.compareAndSwap(
              {
                ...r,
                status: "provider_attempt_running",
                version: r.version + 1,
              },
              r.version,
            );
            if (status !== "provider_attempt_running") {
              const outcome =
                status === "assessment_recorded"
                  ? "completed"
                  : status === "provider_attempt_uncertain"
                    ? "uncertain"
                    : "failed";
              const assessment =
                outcome === "completed"
                  ? {
                      availability: "received" as const,
                      requestBound: true,
                      schemaValidated: true,
                      quotesLocated: true,
                      claimFieldsParsed: true,
                      semanticCorrectness: "unproven" as const,
                      publicSummary: "Synthetic public assessment.",
                    }
                  : null;
              repos.attempts.compareAndSwap(
                {
                  ...running,
                  status: outcome,
                  version: 3,
                  assessment,
                  assessmentHash: assessment ? kernelHash(assessment) : null,
                  failureCode: assessment ? null : "synthetic_failure",
                },
                2,
              );
              r = repos.reviews.compareAndSwap(
                { ...r, status, version: r.version + 1 },
                r.version,
              );
            }
          }
        }),
      );
    }
    const saved = uow.repositories.reviews.getById(projectId!, r.id)!;
    checkpoint({
      reviewId: r.id,
      status: saved.status,
      manifestId: saved.manifestId,
      attemptIds: saved.attemptIds,
    });
  }
}
