import type { Clock } from "../clock.js";
import type { ResearchIdPrefix } from "../identity/research-id.js";

/**
 * Deterministic fakes for tests. They never read the system clock,
 * randomness or the environment.
 */

/** Clock pinned to one instant; every call returns an independent copy. */
export class FixedClock implements Clock {
  readonly #epochMillis: number;

  constructor(instant: Date | string | number) {
    this.#epochMillis = new Date(instant).getTime();
  }

  now(): Date {
    return new Date(this.#epochMillis);
  }
}

// Crockford base32 alphabet (excludes I, L, O, U), ascending code points so
// fixed-width encodings also sort lexicographically.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SUFFIX_LENGTH = 26;

/**
 * IdFactory fake that encodes a monotonically increasing counter into a
 * 26 character Crockford base32 suffix. Same seed, same sequence.
 */
export class SequenceIdFactory {
  #counter: number;

  constructor(seed = 0) {
    this.#counter = seed;
  }

  create(prefix: ResearchIdPrefix): string {
    this.#counter += 1;
    return prefix + encodeCounter(this.#counter);
  }
}

function encodeCounter(counter: number): string {
  let remaining = counter;
  let encoded = "";
  while (remaining > 0) {
    encoded = CROCKFORD_ALPHABET.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded.padStart(SUFFIX_LENGTH, "0");
}
