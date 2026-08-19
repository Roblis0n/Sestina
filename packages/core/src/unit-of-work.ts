import type { StorageDatabase } from "@sestina/storage";
import { withTransaction } from "@sestina/storage";
import { coreErr, type CoreResult } from "./errors.js";

class CoreTransactionFailure extends Error {
  constructor(readonly result: CoreResult<unknown>) { super("core transaction failed"); }
}

export class CoreUnitOfWork {
  constructor(private readonly database: StorageDatabase) {}

  commit<T>(work: () => CoreResult<T>): CoreResult<T> {
    try {
      return withTransaction(this.database, () => {
        const result = work();
        if (!result.ok) throw new CoreTransactionFailure(result);
        return result;
      });
    } catch (error) {
      if (error instanceof CoreTransactionFailure) return error.result as CoreResult<T>;
      return coreErr("infrastructure_failure");
    }
  }
}
