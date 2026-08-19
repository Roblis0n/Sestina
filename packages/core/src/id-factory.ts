import { randomBytes } from "node:crypto";
import type { Clock, IdFactory } from "@sestina/research";

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

export class RandomIdFactory implements IdFactory {
  create(prefix: string): string {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let value = BigInt(`0x${randomBytes(16).toString("hex")}`);
    let suffix = "";
    for (let index = 0; index < 26; index += 1) {
      suffix = alphabet.charAt(Number(value % 32n)) + suffix;
      value /= 32n;
    }
    return `${prefix}${suffix}`;
  }
}
