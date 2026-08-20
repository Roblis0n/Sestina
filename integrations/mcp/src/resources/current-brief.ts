import type { ProjectReader } from "../project-reader.js";
import { resourceFailure } from "../protocol-errors.js";
import { serializeMcpResult } from "../security/output-limits.js";

export async function readCurrentBriefResource(reader: ProjectReader, uri: URL): Promise<{
  readonly contents: { readonly uri: string; readonly mimeType: "application/json"; readonly text: string }[];
}> {
  const result = await reader.readSerializedResearchContext();
  if (!result.ok) throw resourceFailure(uri.href, result.error);
  const response = {
    contents: [{
      uri: uri.href,
      mimeType: "application/json" as const,
      text: result.value.json,
    }],
  };
  const bounded = serializeMcpResult(response);
  if (!bounded.ok) throw resourceFailure(uri.href, bounded.error);
  return bounded.value.value;
}
