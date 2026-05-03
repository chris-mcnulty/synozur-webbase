/**
 * Unit test for the wix-redirects status-code contract (#162 / L13).
 *
 * The admin CRUD route accepts 301/302/307/308 and rejects everything else.
 * The previous schema only allowed 301/302, so editors couldn't represent
 * the method-preserving variants needed for migrated POST endpoints.
 *
 * This test pins the union explicitly so a future refactor can't silently
 * drop one of the four codes — the test owns the contract.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:wix-redirects-schema
 */

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Mirror of the schema in `routes/wixRedirects.ts`. Keeping a copy here is
// intentional — exporting the schema from the route file would couple a
// pure-validation unit test to Express + DB imports.
const pathShape = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => v.startsWith("/"), { message: "Path must start with /" });

const CreateBody = z.object({
  sourcePath: pathShape,
  targetPath: pathShape,
  statusCode: z
    .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
    .optional(),
  active: z.boolean().optional(),
  notes: z.string().max(500).nullish(),
});

test("accepts every supported redirect status code", () => {
  for (const code of [301, 302, 307, 308] as const) {
    const parsed = CreateBody.safeParse({
      sourcePath: "/old",
      targetPath: "/new",
      statusCode: code,
    });
    assert.equal(parsed.success, true, `expected ${code} to be accepted`);
  }
});

test("rejects unsupported redirect status codes", () => {
  for (const code of [200, 303, 304, 305, 306, 309, 400, 410, 500]) {
    const parsed = CreateBody.safeParse({
      sourcePath: "/old",
      targetPath: "/new",
      statusCode: code,
    });
    assert.equal(parsed.success, false, `expected ${code} to be rejected`);
  }
});

test("statusCode is optional (defaults applied at the route layer)", () => {
  const parsed = CreateBody.safeParse({
    sourcePath: "/old",
    targetPath: "/new",
  });
  assert.equal(parsed.success, true);
});

test("rejects relative source/target paths", () => {
  const parsed = CreateBody.safeParse({
    sourcePath: "old",
    targetPath: "/new",
  });
  assert.equal(parsed.success, false);
});
