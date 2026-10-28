# Booking share-image regression checks

Run both layers before shipping changes to the booking editor or its API:

```sh
pnpm --filter @workspace/api-server run test:booking-share-image
pnpm --filter @workspace/synozur exec playwright install chromium
E2E_BASE_URL=http://localhost:80 pnpm --filter @workspace/synozur run test:booking-share-image
```

The browser command requires the managed Synozur web workflow to be running.
It does **not** require an API server, admin credentials, or a seeded account.
For another development stack, set `E2E_BASE_URL` to that stack's preview URL.
Its dedicated configuration uses one browser worker and a longer timeout so
it can run alongside the project's CPU-intensive typechecks without spurious
page-load timeouts. No behavioral assertions are relaxed.

## Coverage

- Only images appear in the picker, even when its response includes documents.
- Selecting an image preserves its original resolved URL (including existing
  query parameters), not the thumbnail or 1200-pixel JPEG preview URL.
- Both `publicUrl` and storage-key-only Media Library records work.
- Reopening uses the saved API URL without an image ID, including legacy
  external URLs.
- Cancelling the picker or leaving after an unsaved clear makes no write.
- A saved clear sends explicit `null`; reopening uses the configured site
  image and description.
- API create, image-only PATCH, omitted-image PATCH, admin/public read, and
  crawler metadata resolution have consistent URL/null semantics.
- Business ID, service ID, timezone, embed URL, scope, visibility dates,
  display order, and active state remain unchanged during image saves.

## Isolation and safety

The browser suite uses the real editor, Media Library picker, social preview,
and mutation code. Every API request is intercepted with fresh, per-test
fixtures; no requests reach the real API. Appointment/Graph operations and
unexpected writes fail the test. The list's read-only Graph status request
and analytics requests are also fulfilled locally.

The API suite mounts only the actual bookings router on an ephemeral Express
test server. It never loads the full app or its startup jobs. Admin middleware
is replaced for this isolated server only. Graph, authorization, and
appointment dependencies are replaced with throwing spies.

The API suite requires the development database and refuses `NODE_ENV=production`.
All booking/media fixtures and configured-default changes use one transaction
that always rolls back, including on assertion failure. No mail or Graph
appointment APIs are invoked.
