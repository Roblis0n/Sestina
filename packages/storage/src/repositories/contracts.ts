import {
  TaskContractSchema,
  SestinaErrorCode,
  SestinaError,
  generateId,
  type TaskContract,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, toMs } from "./shared.js";

export interface ContractRepository {
  /** Inserts the contract plus its first version in one transaction. */
  insert(contract: TaskContract): void;
  get(contractId: string): TaskContract | undefined;
  getCurrentByTask(taskId: string): TaskContract | undefined;
  addVersion(contract: TaskContract, expectedVersion: number): void;
  listVersions(contractId: string): TaskContract[];
}

interface ContractRow {
  contract_id: string;
  task_id: string;
  status: string;
  data: string;
}

function assembleContract(row: ContractRow): TaskContract {
  const data = JSON.parse(row.data) as TaskContract;
  return TaskContractSchema.parse({
    ...data,
    contractId: row.contract_id,
    taskId: row.task_id,
    status: row.status,
  });
}

export function createContractRepository(tx: StorageTransaction): ContractRepository {
  return {
    insert(contract) {
      assertInTransaction(tx);
      tx.run(
        "INSERT INTO contracts (contract_id, task_id, status, data) VALUES (?, ?, ?, ?)",
        contract.contractId,
        contract.taskId,
        contract.status,
        validateJson(TaskContractSchema, contract, "TaskContract"),
      );
      tx.run(
        "INSERT INTO contract_versions (contract_version_id, contract_id, version, created_at, data) VALUES (?, ?, ?, ?, ?)",
        generateId(),
        contract.contractId,
        contract.version,
        toMs(contract.createdAt),
        validateJson(TaskContractSchema, contract, "TaskContract"),
      );
    },

    get(contractId) {
      const row = tx.get<ContractRow>(
        "SELECT contract_id, task_id, status, data FROM contracts WHERE contract_id = ?",
        contractId,
      );
      return row ? assembleContract(row) : undefined;
    },

    getCurrentByTask(taskId) {
      const row = tx.get<ContractRow>(
        "SELECT contract_id, task_id, status, data FROM contracts WHERE task_id = ?",
        taskId,
      );
      return row ? assembleContract(row) : undefined;
    },

    addVersion(contract, expectedVersion) {
      assertInTransaction(tx);
      const existing = tx.get<{ version: number }>(
        "SELECT MAX(version) AS version FROM contract_versions WHERE contract_id = ?",
        contract.contractId,
      );
      const currentVersion = existing?.version ?? 0;
      if (contract.version !== currentVersion + 1 || expectedVersion !== currentVersion) {
        throw new SestinaError(
          SestinaErrorCode.contract_version_mismatch,
          "Contract version conflict",
        );
      }
      tx.run(
        "UPDATE contracts SET status = ?, data = ? WHERE contract_id = ?",
        contract.status,
        validateJson(TaskContractSchema, contract, "TaskContract"),
        contract.contractId,
      );
      tx.run(
        "INSERT INTO contract_versions (contract_version_id, contract_id, version, created_at, data) VALUES (?, ?, ?, ?, ?)",
        generateId(),
        contract.contractId,
        contract.version,
        toMs(contract.createdAt),
        validateJson(TaskContractSchema, contract, "TaskContract"),
      );
    },

    listVersions(contractId) {
      const rows = tx.all<{ data: string }>(
        "SELECT data FROM contract_versions WHERE contract_id = ? ORDER BY version",
        contractId,
      );
      return rows.map((r) => TaskContractSchema.parse(JSON.parse(r.data) as unknown));
    },
  };
}
