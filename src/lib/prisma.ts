import { PrismaClient } from "@prisma/client";

// BigInt isn't JSON-serializable by default; every id in this schema is BigInt.
// Internal tool, no untrusted consumers of this format — stringify is fine.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function (this: bigint) {
    return this.toString();
  };
}

export const prisma = new PrismaClient();
