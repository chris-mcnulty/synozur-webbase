---
name: Mockup sandbox has no router
description: The mockup-sandbox artifact does not include wouter/react-router; mockups must use plain anchors.
---

# Mockup sandbox has no router

DESIGN subagents building Synozur mockups habitually `import { Link } from "wouter"` (because the real `artifacts/synozur` app uses wouter). The `artifacts/mockup-sandbox` artifact does **not** have `wouter` (or any router) installed, so this throws a Vite `Failed to resolve import "wouter"` error and the preview iframe goes blank.

**Why:** mockup-sandbox is an isolated prototyping artifact with its own minimal deps (React, Tailwind, shadcn/ui, lucide-react, framer-motion). It does not inherit the main app's dependency set.

**How to apply:** When delegating mockup builds, tell the subagent to use plain `<a href>` instead of router `<Link>`. If a mockup comes back broken, grep the new component for `wouter`/`react-router` and swap `<Link>` → `<a>`, remove the import. Don't add the router dep to the sandbox just for a mockup.
