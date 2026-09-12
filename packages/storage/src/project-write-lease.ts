import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
/** An OS-released lock contains no project content and survives no process. */
export function acquireProjectWriteLease(databasePath: string): {
  release: () => void;
} {
  const root = realpathSync(dirname(databasePath));
  const path = join(root, ".sestina-writer.sqlite");
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new SestinaError(
        SestinaErrorCode.storage_busy,
        "Project writer lease is unavailable",
      );
  }
  let lock: DatabaseSync | undefined;
  try {
    lock = new DatabaseSync(path);
    lock.exec(
      "PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS writer_lease (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE",
    );
    let released = false;
    const owned = lock;
    return {
      release: () => {
        if (!released) {
          released = true;
          owned.close();
        }
      },
    };
  } catch {
    lock?.close();
    throw new SestinaError(
      SestinaErrorCode.storage_busy,
      "Close the other project writer before continuing",
    );
  }
}
