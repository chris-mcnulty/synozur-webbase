import * as React from "react";
import { Link, type Path } from "wouter";

import { cn } from "@/lib/utils";

/**
 * Wraps wouter's `Link`. The default (text) branch only accepts inline
 * text children, so element children must opt in via `asChild`. Inner
 * `<a>` children are forbidden and enforced via `assertNoInnerAnchor`
 * (dev-mode throw) plus the `no-restricted-syntax` ESLint rule in
 * `eslint.config.js`. A pure-type guard is not feasible because React
 * 19's `JSX.Element` widens intrinsic elements to `ReactElement<any, any>`.
 *
 * NOTE: `asChild` here is a *type-level* opt-in only — it widens the
 * allowed `children` type from inline text to arbitrary `ReactNode`.
 * It does NOT implement Radix `Slot` semantics: the child is not
 * cloned, no props are forwarded onto it, and the rendered DOM is
 * always `<a>{children}</a>`.
 */

type InlineText =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<InlineText>;

type AnchorAttrs = Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "className" | "children"
>;

type AppLinkTextProps = AnchorAttrs & {
  href: Path;
  asChild?: false;
  className?: string;
  unstyled?: boolean;
  children?: InlineText;
};

type AppLinkAsChildProps = AnchorAttrs & {
  href: Path;
  asChild: true;
  className?: string;
  unstyled?: boolean;
  children: React.ReactNode;
};

export type AppLinkProps = AppLinkTextProps | AppLinkAsChildProps;

function assertNoInnerAnchor(children: React.ReactNode): void {
  if (process.env.NODE_ENV === "production") return;
  const visit = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      if (el.type === "a") {
        throw new Error(
          "[AppLink] Inner <a> children are forbidden — wouter v3 already " +
            "renders an <a>. Move className/data-testid onto <AppLink> " +
            "itself instead of nesting an anchor inside it.",
        );
      }
      // Recurse into fragments / nested wrappers so
      // `<AppLink asChild><><a/></></AppLink>` is also caught.
      if (el.type === React.Fragment && el.props && "children" in el.props) {
        visit(el.props.children);
      }
    });
  };
  visit(children);
}

export function AppLink(props: AppLinkProps): React.ReactElement {
  const {
    unstyled,
    className,
    asChild: _asChild,
    children,
    href,
    ...rest
  } = props;
  assertNoInnerAnchor(children as React.ReactNode);
  return (
    <Link
      href={href}
      {...rest}
      className={cn(!unstyled && "hover:underline", className)}
    >
      {children as React.ReactNode}
    </Link>
  );
}

AppLink.displayName = "AppLink";
