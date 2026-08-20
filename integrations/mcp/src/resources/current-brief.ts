import type { ProjectReader } from "../project-reader.js";
import { resourceFailure } from "../protocol-errors.js";

export async function readCurrentBriefResource(reader: ProjectReader, uri: URL): Promise<{
  readonly contents: { readonly uri: string; readonly mimeType: "application/json"; readonly text: string }[];
}> {
  const result = await reader.readResearchContext();
  if (!result.ok) throw resourceFailure(uri.href, result.error);
  return {
    contents: [{
      uri: uri.href,
      mimeType: "application/json" as const,
      text: JSON.stringify(result.value),
    }],
  };
}
