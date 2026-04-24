import { pgTable, serial, date, integer, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const bakingDaysTable = pgTable("baking_days", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id),
  totalAvailable: integer("total_available").notNull(),
  reservedCount: integer("reserved_count").notNull().default(0),
});

export const insertBakingDaySchema = createInsertSchema(bakingDaysTable).omit({
  id: true,
  reservedCount: true,
});
export type InsertBakingDay = z.infer<typeof insertBakingDaySchema>;
export type BakingDay = typeof bakingDaysTable.$inferSelect;
