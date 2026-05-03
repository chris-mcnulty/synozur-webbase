/**
 * Compile-time-only assertions for {@link AppLink}. Consumed by `tsc
 * --noEmit`; never imported at runtime. Pins the prop union shape so
 * the v2 `<Link><a className/data-testid>...</a></Link>` shim cannot
 * be reintroduced and so element-child composition cannot land
 * unreviewed under the default branch.
 */
import * as React from "react";

import { AppLink, type AppLinkProps } from "./app-link";
import { Button } from "./button";

type Expect<T extends true> = T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;

// ─── default (text) branch ────────────────────────────────────────────────
// Inline text is accepted.
const _textOk = (
  <AppLink href="/x" data-testid="link-x" className="font-medium" title="x">
    plain label
  </AppLink>
);
const _textUnstyledOk = (
  <AppLink href="/x" unstyled className="text-sm">
    branding
  </AppLink>
);

// Element children are *rejected* on the default branch — this is the
// guardrail that makes `<AppLink><Button/></AppLink>` impossible without
// the explicit `asChild` opt-in.
const _rejectsButtonChild =
  // @ts-expect-error element children require explicit asChild opt-in
  <AppLink href="/x">
    <Button>x</Button>
  </AppLink>;

const _rejectsIconChild =
  // @ts-expect-error element children require explicit asChild opt-in
  <AppLink href="/x">
    <span>icon</span>
  </AppLink>;

// ─── asChild branch ───────────────────────────────────────────────────────
// Explicit opt-in for element children. The wrapper renders
// `<a>{children}</a>` (wraps, does not clone), preserving the intentional
// nested-element DOM contract.
const _asChildElementOk = (
  <AppLink href="/x" asChild data-testid="link-x">
    <Button>Button as link</Button>
  </AppLink>
);
const _asChildIconAndTextOk = (
  <AppLink href="/x" asChild unstyled>
    <>
      <span>icon</span> label
    </>
  </AppLink>
);

// ─── discriminated-union shape ────────────────────────────────────────────
type _Branches = AppLinkProps extends infer P
  ? P extends { asChild: true }
    ? "asChild"
    : "text"
  : never;
type _HasBothBranches = Expect<Equals<_Branches, "asChild" | "text">>;

void _textOk;
void _textUnstyledOk;
void _rejectsButtonChild;
void _rejectsIconChild;
void _asChildElementOk;
void _asChildIconAndTextOk;
type _Used = _HasBothBranches;
