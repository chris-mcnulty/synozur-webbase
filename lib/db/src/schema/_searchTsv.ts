import { customType } from "drizzle-orm/pg-core";

// Custom Postgres `tsvector` type. Used for the per-table `search_tsv`
// columns powering #170 public-site search. We treat it as opaque on
// the JS side (string in/out); the actual values are computed by
// `GENERATED ALWAYS AS (...) STORED` expressions defined in
// api-server's startup migrations and mirrored on each table via
// `.generatedAlwaysAs(...)` so drizzle-kit doesn't try to drop them.
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
