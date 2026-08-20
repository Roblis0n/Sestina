import type { ProjectReader } from "../project-reader.js";
import { toolFailure } from "../protocol-errors.js";

export async function getResearchContext(reader: ProjectReader) {
  const result = await reader.readResearchContext();
  if (!result.ok) return toolFailure(result.error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.value) }],
    structuredContent: result.value,
  };
}
