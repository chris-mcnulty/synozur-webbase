export const CAPABILITIES = [
  "content.view",
  "content.author",
  "content.publish",
  "content.moderate",
  "users.manage",
  "site.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  admin: ["content.view", "content.author", "content.publish", "content.moderate", "users.manage"],
  editor: ["content.view", "content.author", "content.publish", "content.moderate"],
  author: ["content.view", "content.author"],
  contributor: ["content.view", "content.author"],
};

export function computeCapabilities(
  roles: readonly string[],
  allowListed: boolean,
): Set<Capability> {
  const caps = new Set<Capability>();
  for (const role of roles) {
    const granted = ROLE_CAPABILITIES[role];
    if (!granted) continue;
    for (const cap of granted) caps.add(cap);
  }
  if (allowListed) caps.add("site.manage");
  return caps;
}
