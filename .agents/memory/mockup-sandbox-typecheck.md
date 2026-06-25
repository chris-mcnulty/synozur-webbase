---
name: mockup-sandbox pre-existing typecheck failures
description: Why `pnpm --filter @workspace/mockup-sandbox run typecheck` fails out of the box, and what is safe to ignore.
---

# mockup-sandbox typecheck baseline

`pnpm --filter @workspace/mockup-sandbox run typecheck` fails with a large batch of
`TS2322` errors of the form `Type '{ ...; ease: string }' is not assignable to ...
Transition` across the redesign mockup pages (the framer-motion `ease: "easeOut"`
literal widens to `string`).

**These are pre-existing and unrelated to nav/footer/content edits.** The mockup
sandbox renders via Vite (no typecheck at runtime), so the preview is unaffected and
these never block the Canvas previews.

**Why:** the tsconfig does not pin the ease literals (`as const`) and the framer-motion
types reject a widened `string`. `noUnusedLocals` is also `false`, so unused imports
do NOT error here.

**How to apply:** when validating a mockup-sandbox change, filter typecheck output with
`rg -v TS2322` to see only *new* errors your change introduced. Do not "fix" the ease
errors as part of an unrelated task — it expands scope. If a future task is explicitly
about cleaning these up, the fix is `ease: "easeOut" as const` (or typed easing arrays).
