import { randomBytes } from "node:crypto";

// UUIDv7 (D13: "UUIDv7 everywhere, time-sortable"). Layout per RFC 9562:
// 48-bit unix ms timestamp, 4-bit version, 12-bit random, 2-bit variant,
// 62-bit random. Written directly instead of via the `uuid` package, whose
// v10 package.json exports map doesn't resolve types cleanly under
// TypeScript's NodeNext module resolution.
export function uuidv7(): string {
  const unixMs = BigInt(Date.now());
  const rand = randomBytes(10);

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(Number(unixMs & 0xffffffffffffn), 0, 6);

  bytes[6] = 0x70 | (rand[0]! & 0x0f); // version 7, high nibble of rand_a
  bytes[7] = rand[1]!;
  bytes[8] = 0x80 | (rand[2]! & 0x3f); // variant 10, high 2 bits of rand_b
  bytes[9] = rand[3]!;
  bytes[10] = rand[4]!;
  bytes[11] = rand[5]!;
  bytes[12] = rand[6]!;
  bytes[13] = rand[7]!;
  bytes[14] = rand[8]!;
  bytes[15] = rand[9]!;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
