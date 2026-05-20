import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { solutionsTable } from "./services";
import { collateralTable } from "./collateral";

export const solutionHighlightsTable = pgTable(
  "solution_highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutionsTable.id, { onDelete: "cascade" }),
    collateralId: uuid("collateral_id")
      .notNull()
      .references(() => collateralTable.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("solution_highlights_solution_collateral_key").on(
      t.solutionId,
      t.collateralId,
    ),
    index("solution_highlights_solution_idx").on(t.solutionId),
    index("solution_highlights_display_order_idx").on(t.displayOrder),
  ],
);

export type SolutionHighlight = typeof solutionHighlightsTable.$inferSelect;
