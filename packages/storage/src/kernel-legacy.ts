import { createHash } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import shapes from "./migrations/kernel-legacy-shapes.json" with { type: "json" };
import target from "./migrations/kernel-target-shape.json" with { type: "json" };

export function verifyKernelTargetShape(db: StorageDatabase): void {
  const rows = db.all(
    "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name",
  );
  if (
    target.schema !== 25 ||
    createHash("sha256").update(JSON.stringify(rows)).digest("hex") !==
      target.sha256
  )
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      "Unrecognized Kernel schema structure",
    );
}

/** Pinned schema structure, not authority over research content. */
export function verifyKernelLegacyShape(
  db: StorageDatabase,
  version: number,
): void {
  const expected = (shapes.schemas as Readonly<Record<string, string>>)[
    version
  ];
  const schema = db.all(
    "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name",
  );
  if (
    !expected ||
    createHash("sha256").update(JSON.stringify(schema)).digest("hex") !==
      expected
  )
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      "Unrecognized legacy schema structure",
    );
}
/** Exact row-content preservation proof; order-independent, duplicate-sensitive. */
export function kernelTableFingerprint(
  db: StorageDatabase,
  table: string,
): { rows: number; contentHash: string } {
  if (!/^[a-z0-9_]+$/.test(table))
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Invalid table identifier",
    );
  const hashes: string[] = [];
  for (const row of db.raw.prepare(`SELECT * FROM ${table}`).iterate()) {
    const encoded = JSON.stringify(row, (_key, value: unknown) =>
      value instanceof Uint8Array
        ? { blobBase64: Buffer.from(value).toString("base64") }
        : typeof value === "bigint"
          ? { sqliteInteger: value.toString() }
          : value,
    );
    hashes.push(createHash("sha256").update(encoded).digest("hex"));
  }
  return {
    rows: hashes.length,
    contentHash: createHash("sha256")
      .update(hashes.sort().join("\n"))
      .digest("hex"),
  };
}
