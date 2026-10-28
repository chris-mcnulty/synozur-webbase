---
name: Binary upload contracts
description: Orval binary-schema limitation in the Node-only validation library.
---

Use an inline `type: string, format: binary` schema for raw octet-stream upload
bodies; keep normal object request bodies in named component schemas.

**Why:** A named binary component caused Orval to emit a `Blob` type alias into
the Node-only validation package, where the DOM type is unavailable. Codegen
finished but its chained library typecheck failed. Inline binary schemas avoid
this without introducing browser globals into the server type configuration.

**How to apply:** For raw file uploads, follow the inline binary pattern and
send file bytes with a raw fetch rather than JSON-stringifying the file.
Regenerate the API helpers and check library types after changing the contract.
