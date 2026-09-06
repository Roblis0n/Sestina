import { it, expect } from "vitest";
import { parseKernelObjectRef } from "@sestina/research";
import { ids } from "../kernel-fixtures.js";
it.each([
  { kind: "decision", id: "not-a-canonical-id", version: 1 },
  { kind: "unknown_kind", id: ids.create("rdec_"), version: 1 },
  { kind: "evidence", id: ids.create("rdec_"), version: 1 },
  {
    kind: "claim_evidence_link",
    id: `${ids.create("rclm_")}:${ids.create("rdec_")}`,
    version: 1,
  },
])(
  "G3: corrupt canonical reference $kind / $id is rejected at decode",
  (input) => {
    expect(() => parseKernelObjectRef(input)).toThrow();
  },
);
