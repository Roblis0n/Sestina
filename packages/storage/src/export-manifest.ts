import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { assertInsideRoot } from "./backup.js";
import { mapFsError } from "./maintenance-domain.js";

// ── Export manifest (docs/22 Task 6 fix) ──
// Every published export directory carries a manifest.json describing
// exactly which files belong to it. Retention purge and
// clearExportByMetadata both require the manifest to match the export
// record before any file is deleted — validation failures fail safe and
// never touch user files.

/** File names are plain basenames: no separators, no traversal. */
const EXPORT_FILE_NAME = /^[A-Za-z0-9._-]+$/;

export const ExportManifestSchema = z.object({
  exportId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["minimal", "full"]),
  createdAt: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(
    z.object({
      name: z.string().regex(EXPORT_FILE_NAME),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ).min(1),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

/**
 * Verifies that `outputPath` names the export directory for `exportId`
 * (the final path component must be the export id) and that it lives
 * inside the given data root. Returns the resolved directory.
 */
export function assertExportPathContained(
  exportId: string,
  dataRoot: string,
  outputPath: string,
): string {
  const dir = resolve(outputPath);
  if (basename(dir) !== exportId) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Export output path does not match the export record",
    );
  }
  assertInsideRoot(dataRoot, dir, "export output");
  return dir;
}

/**
 * Reads and validates the manifest.json inside `dir`: it must parse to the
 * manifest schema, belong to `exportId` and list only files that exist.
 * Any failure throws validation_failed — callers fail safe on it.
 */
export function readValidatedExportManifest(exportId: string, dir: string): ExportManifest {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Export manifest not found",
    );
  }
  let manifest: ExportManifest;
  try {
    manifest = ExportManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    );
  } catch (err) {
    if (err instanceof SestinaError) throw err;
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Export manifest failed validation",
    );
  }
  if (manifest.exportId !== exportId) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Export manifest does not match the export record",
    );
  }
  for (const file of manifest.files) {
    if (!existsSync(join(dir, file.name))) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "Export manifest lists a missing file",
      );
    }
  }
  return manifest;
}

/** Removes a validated export directory (best effort, idempotent). */
export function deleteExportDirectory(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    throw mapFsError(err, "Failed to delete the export directory");
  }
}
