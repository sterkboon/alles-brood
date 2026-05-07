import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bakingDaysTable } from "./bakingDays";

export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "cancelled",
  "abandoned",
]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number"),
  whatsappNumber: text("whatsapp_number").notNull(),
  customerName: text("customer_name"),
  bakingDayId: integer("baking_day_id")
    .notNull()
    .references(() => bakingDaysTable.id),
  quantity: integer("quantity").notNull(),
  status: orderStatusEnum("status").notNull().default("pending_payment"),
  yocoPaymentId: text("yoco_payment_id"),
  yocoCheckoutId: text("yoco_checkout_id"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
