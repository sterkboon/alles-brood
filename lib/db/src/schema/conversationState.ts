import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationStepEnum = pgEnum("conversation_step", [
  "idle",
  "awaiting_date",
  "awaiting_quantity",
  "awaiting_payment",
  "awaiting_feedback",
]);

export const conversationStateTable = pgTable("conversation_state", {
  whatsappNumber: text("whatsapp_number").primaryKey(),
  step: conversationStepEnum("step").notNull().default("idle"),
  pendingOrderData: jsonb("pending_order_data"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConversationStateSchema = createInsertSchema(conversationStateTable);
export type InsertConversationState = z.infer<typeof insertConversationStateSchema>;
export type ConversationState = typeof conversationStateTable.$inferSelect;
