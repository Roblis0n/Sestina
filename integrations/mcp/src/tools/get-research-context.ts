import type { ProjectReader } from "../project-reader.js";
import { toolFailure } from "../protocol-errors.js";
import { serializeMcpResult } from "../security/output-limits.js";

export async function getResearchContext<TPayload extends object>(reader: ProjectReader<TPayload>) {
  const result = await reader.readSerializedResearchContext();
  if (!result.ok) return toolFailure(result.error);
  const response = {
    content: [{ type: "text" as const, text: result.value.json }],
    structuredContent: result.value.payload,
  };
  const bounded = serializeMcpResult(response);
  return bounded.ok ? bounded.value.value : toolFailure(bounded.error);
}
