import {
  ContractPatchProposalSchema,
  SestinaError,
  SestinaErrorCode,
  type ContractPatchOperation,
  type ContractPatchProposal,
  type TaskContract,
} from "@sestina/schema";

/**
 * A semantic extractor is a local capability (e.g. a configured Provider
 * adapter) that reads a contract and its source text and produces a patch
 * PROPOSAL. Extractors never modify contracts directly: their output is
 * validated here and then either surfaced as a proposal or rejected.
 */
export interface ContractSemanticExtractor {
  readonly extractorId: string;
  propose(context: {
    contract: TaskContract;
    sourceText: string;
    now: string;
  }): ContractPatchProposal | undefined;
}

export const DEFAULT_MAX_EXTRACTOR_INPUT_CHARS = 200_000;
export const DEFAULT_MAX_EXTRACTOR_OUTPUT_BYTES = 64_000;

/**
 * The single, non-forkable operation-level fence for inferred-tier proposal
 * content. Shared by runSemanticExtractor, the proposeContractPatch
 * extractor fallback, and applyContractPatch (defense-in-depth), so an
 * inferred proposal can never claim - regardless of which path built or
 * delivered it:
 *
 * - boundary ownership above "inferred" (user/system boundaries included);
 * - hard severity or non-overridable boundaries;
 * - authority boundaries;
 * - authority policy writes (set_field on authority.*);
 * - preauthorizations.
 *
 * The schema refine on ContractPatchProposal constrains only the ENVELOPE
 * owner; every operation is checked here because a schema-valid inferred
 * envelope can still smuggle forbidden per-operation content.
 */
export function assertInferredOperationsAdmissible(
  operations: readonly ContractPatchOperation[],
): void {
  const invalid = (message: string): never => {
    throw new SestinaError(SestinaErrorCode.validation_failed, message);
  };
  for (const operation of operations) {
    if (operation.op === "add_boundary") {
      if (operation.boundary.owner !== "inferred") {
        invalid("inferred extractor output must carry inferred boundary ownership");
      }
      if (operation.boundary.severity === "hard") {
        invalid("inferred extractor output must not create hard boundaries");
      }
      if (!operation.boundary.overridable) {
        invalid("inferred extractor output must not create non-overridable boundaries");
      }
      if (operation.boundary.kind === "authority") {
        invalid("inferred extractor output must not create authority boundaries");
      }
    } else if (operation.op === "set_field" && operation.path.section === "authority") {
      invalid("inferred extractor output must not alter the authority policy");
    } else if (operation.op === "add_preauthorization") {
      invalid("inferred extractor output must not create preauthorizations");
    }
  }
}

/**
 * Runs a semantic extractor against the given context and validates its
 * output. Rejects invalid, oversized or malicious output with SestinaError:
 * schema parse failures and semantic violations (identity/version/tier/
 * owner/authority) are validation_failed; size violations are limit_exceeded.
 * A thrown error from the extractor propagates as-is — only `undefined` is
 * the legitimate "no proposal" signal.
 */
export function runSemanticExtractor(
  extractor: ContractSemanticExtractor,
  context: { contract: TaskContract; sourceText: string; now: string },
  opts?: { maxInputChars?: number; maxOutputBytes?: number },
): ContractPatchProposal | undefined {
  const maxInputChars = opts?.maxInputChars ?? DEFAULT_MAX_EXTRACTOR_INPUT_CHARS;
  const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_EXTRACTOR_OUTPUT_BYTES;

  if (context.sourceText.length > maxInputChars) {
    throw new SestinaError(
      SestinaErrorCode.limit_exceeded,
      `semantic extractor input exceeds the ${maxInputChars} character limit`,
      undefined,
      { limit: maxInputChars, actual: context.sourceText.length },
    );
  }

  const proposal = extractor.propose(context);
  if (proposal === undefined) return undefined;

  const parsed = ContractPatchProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "semantic extractor returned a proposal that fails schema validation",
      undefined,
      { issues: parsed.error.issues.slice(0, 10) },
    );
  }
  const valid = parsed.data;

  const invalid = (message: string, details?: unknown): never => {
    throw new SestinaError(SestinaErrorCode.validation_failed, message, undefined, details);
  };

  if (valid.contractId !== context.contract.contractId) {
    invalid("semantic extractor proposal targets a different contract", {
      actual: valid.contractId,
      expected: context.contract.contractId,
    });
  }
  if (valid.taskId !== context.contract.taskId) {
    invalid("semantic extractor proposal targets a different task", {
      actual: valid.taskId,
      expected: context.contract.taskId,
    });
  }
  if (valid.expectedVersion !== context.contract.version) {
    invalid("semantic extractor proposal targets a different contract version", {
      actual: valid.expectedVersion,
      expected: context.contract.version,
    });
  }
  if (valid.sourceTier !== "inferred") {
    invalid("semantic extractor proposals must stay at the inferred source tier", {
      actual: valid.sourceTier,
      expected: "inferred",
    });
  }
  if (valid.owner !== "inferred") {
    invalid("semantic extractor proposals must carry inferred ownership", {
      actual: valid.owner,
      expected: "inferred",
    });
  }
  assertInferredOperationsAdmissible(valid.operations);

  const outputBytes = new TextEncoder().encode(JSON.stringify(valid)).length;
  if (outputBytes > maxOutputBytes) {
    throw new SestinaError(
      SestinaErrorCode.limit_exceeded,
      `semantic extractor output exceeds the ${maxOutputBytes} byte limit`,
      undefined,
      { limit: maxOutputBytes, actual: outputBytes },
    );
  }

  return valid;
}
