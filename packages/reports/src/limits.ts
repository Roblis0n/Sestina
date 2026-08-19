export const DEFAULT_CAPSULE_MAX_BYTES = 65_536;
export const DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION = 100;
export const DEFAULT_CAPSULE_TEXT_MAX_BYTES = 2_048;
export const DEFAULT_RESPONSE_MAX_BYTES = 65_536;

export interface Utf8Truncation { readonly text: string; readonly omittedBytes: number; }

export function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }

export function truncateUtf8(value: string, maxBytes: number): Utf8Truncation {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { text: value, omittedBytes: 0 };
  let end = Math.max(0, Math.floor(maxBytes));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end > 0) {
    try { return { text: decoder.decode(bytes.slice(0, end)), omittedBytes: bytes.byteLength - end }; }
    catch { end -= 1; }
  }
  return { text: "", omittedBytes: bytes.byteLength };
}
