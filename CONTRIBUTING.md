# Contributing

## Typechecking

### Always use the root `typecheck` command for full checks

```sh
pnpm run typecheck
```

This runs `typecheck:libs` (builds all shared lib declarations via `tsc --build`) **before** checking any leaf artifact. The CI equivalent is:

```sh
pnpm run typecheck:ci   # same, but excludes mockup-sandbox
```

### Why this matters

Shared libraries (`lib/db`, `lib/api-zod`, `lib/api-client-react`, etc.) are compiled TypeScript packages that emit `.d.ts` declaration files. Leaf artifact packages (`artifacts/*`, `scripts`) import those declarations — not the source.

If the lib source changes but the declarations are stale (not yet rebuilt), a leaf-package typecheck will either:
- pass silently while missing real errors (wrong shape is accepted from old declarations), or
- fail with confusing "module not found" / "property does not exist" errors that disappear once libs are rebuilt.

**Running `pnpm --filter @workspace/<pkg> run typecheck` directly is safe** — each leaf package either has a `pretypecheck` lifecycle hook that rebuilds libs automatically before the package's own check runs, or (like `artifacts/api-server`) chains `tsc --build` directly inside its own `typecheck` script. However, the root `typecheck` command remains the canonical path for full-workspace validation.

### Anatomy of a typecheck run

```
pnpm run typecheck
  └─ typecheck:libs          (tsc --build — rebuilds all composite lib packages)
  └─ pnpm -r --filter artifacts/** run typecheck
       └─ pretypecheck       (pnpm -w run typecheck:libs — no-op if already fresh)
       └─ tsc -p tsconfig.json --noEmit
  └─ pnpm -r --filter scripts run typecheck
       └─ pretypecheck       (same)
       └─ tsc -p tsconfig.json --noEmit
  └─ check:removed-identifiers
```

### Adding a new lib

When you add a new composite lib under `lib/`:

1. Add `composite`, `declarationMap`, and `emitDeclarationOnly` to its `tsconfig.json`.
2. Add it to the **root** `tsconfig.json` `references` array.
3. If it imports another lib, add that lib to its own `references`.

See the [pnpm-workspace skill](.local/skills/pnpm-workspace/SKILL.md) for full details.

### Adding a new artifact

New leaf artifacts must include a `pretypecheck` script so per-package runs are always safe:

```json
"scripts": {
  "pretypecheck": "pnpm -w run typecheck:libs",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}
```
