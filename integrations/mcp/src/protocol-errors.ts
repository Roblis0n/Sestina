import {
  INTERNAL_ERROR,
  ProtocolError,
  ResourceNotFoundError,
} from "@modelcontextprotocol/server";

export type SestinaMcpErrorCode =
  | "missing_project_root"
  | "invalid_project_root"
  | "project_not_initialized"
  | "project_state_unavailable"
  | "project_binding_inconsistent"
  | "no_active_brief"
  | "response_too_large"
  | "query_timeout"
  | "invalid_arguments";

export interface SestinaMcpError {
  readonly code: SestinaMcpErrorCode;
  readonly message: string;
}

export type SestinaMcpResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SestinaMcpError };

const ERROR_MESSAGES: Readonly<Record<SestinaMcpErrorCode, string>> = Object.freeze({
  missing_project_root: "An explicit project root is required.",
  invalid_project_root: "The explicit project root is not a readable directory.",
  project_not_initialized: "The explicit project root has no initialized Sestina state database.",
  project_state_unavailable: "The read-only Sestina project state is unavailable.",
  project_binding_inconsistent: "The Sestina state database must contain exactly one Research Project.",
  no_active_brief: "No active Research Brief exists for the explicit project root.",
  response_too_large: "The active Research Brief exceeds the configured response budget.",
  query_timeout: "The read-only project query timed out.",
  invalid_arguments: "The server arguments are invalid.",
});

export function mcpOk<T>(value: T): SestinaMcpResult<T> {
  return { ok: true, value };
}

export function mcpError(code: SestinaMcpErrorCode): SestinaMcpError {
  return Object.freeze({ code, message: ERROR_MESSAGES[code] });
}

export function mcpErr<T = never>(code: SestinaMcpErrorCode): SestinaMcpResult<T> {
  return { ok: false, error: mcpError(code) };
}

export interface ToolFailurePayload {
  readonly schemaVersion: "1.0";
  readonly ok: false;
  readonly error: SestinaMcpError;
}

export function toolFailure(error: SestinaMcpError): {
  readonly isError: true;
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: ToolFailurePayload;
} {
  const structuredContent = Object.freeze({
    schemaVersion: "1.0" as const,
    ok: false as const,
    error,
  });
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

export function resourceFailure(uri: string, error: SestinaMcpError): ProtocolError {
  if (error.code === "no_active_brief") {
    return new ResourceNotFoundError(uri, error.code);
  }
  return new ProtocolError(INTERNAL_ERROR, error.code, { sestinaCode: error.code });
}
