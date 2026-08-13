import { SestinaError, SestinaErrorCode } from "@sestina/schema";

export interface SchemaLike {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

/**
 * Validates a value against its Zod schema before it may enter a JSON
 * column (docs/09 §21: JSON columns are schema-validated before writing),
 * then serialises the parsed (canonical) form.
 */
export function validateJson(schema: SchemaLike, value: unknown, label: string): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `${label} failed schema validation`,
    );
  }
  return JSON.stringify(result.data);
}
