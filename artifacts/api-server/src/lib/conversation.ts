import { eq, gte, and, sql } from "drizzle-orm";
import {
  db,
  conversationStateTable,
  bakingDaysTable,
  productsTable,
  ordersTable,
} from "@workspace/db";
import { sendWhatsAppMessage } from "./twilio";
import { createYocoCheckout } from "./yoco";
import { logger } from "./logger";

interface PendingOrderData {
  bakingDayId?: number;
  bakingDayDate?: string;
  quantity?: number;
  priceCents?: number;
}

export async function handleIncomingMessage(from: string, body: string): Promise<void> {
  const phoneNumber = from.replace("whatsapp:", "");
  const trimmed = body.trim().toLowerCase();

  let state = await db
    .select()
    .from(conversationStateTable)
    .where(eq(conversationStateTable.whatsappNumber, phoneNumber))
    .then((rows) => rows[0]);

  if (!state) {
    await db.insert(conversationStateTable).values({
      whatsappNumber: phoneNumber,
      step: "idle",
      pendingOrderData: null,
      updatedAt: new Date(),
    });
    state = { whatsappNumber: phoneNumber, step: "idle", pendingOrderData: null, updatedAt: new Date() };
  }

  if (trimmed === "cancel" || trimmed === "stop") {
    await updateState(phoneNumber, "idle", null);
    await sendWhatsAppMessage(phoneNumber, "No problem! Your order has been cancelled. Reply *order* anytime to start a new order.");
    return;
  }

  if (trimmed === "hi" || trimmed === "hello" || trimmed === "order" || state.step === "idle") {
    await handleIdle(phoneNumber);
    return;
  }

  if (state.step === "awaiting_date") {
    await handleDateSelection(phoneNumber, body.trim(), state.pendingOrderData as PendingOrderData);
    return;
  }

  if (state.step === "awaiting_quantity") {
    await handleQuantitySelection(phoneNumber, body.trim(), state.pendingOrderData as PendingOrderData);
    return;
  }

  if (state.step === "awaiting_payment") {
    await sendWhatsAppMessage(
      phoneNumber,
      "We're still waiting for your payment. Please use the link sent earlier, or reply *cancel* to start over."
    );
    return;
  }

  await handleIdle(phoneNumber);
}

async function handleIdle(phoneNumber: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  const availableDays = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, today),
        sql`${bakingDaysTable.total_available} > ${bakingDaysTable.reserved_count}`
      )
    )
    .orderBy(bakingDaysTable.date)
    .limit(7);

  if (!availableDays.length) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Hi! 👋 Thanks for reaching out to *Sourdough by [Baker]*.\n\nUnfortunately we don't have any available baking days right now. Please check back soon!"
    );
    return;
  }

  const daysList = availableDays
    .map((d, i) => {
      const date = new Date(d.date + "T00:00:00");
      const formatted = date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
      const remaining = d.totalAvailable - d.reservedCount;
      return `${i + 1}. *${formatted}* — ${remaining} loaf(ves) available`;
    })
    .join("\n");

  await sendWhatsAppMessage(
    phoneNumber,
    `Hi! 👋 Welcome to *Sourdough by [Baker]*!\n\nHere are the upcoming baking days:\n\n${daysList}\n\nReply with the *number* of the date you'd like to order for.\n\n_Reply *cancel* anytime to stop._`
  );

  await updateState(phoneNumber, "awaiting_date", { availableDays });
}

async function handleDateSelection(phoneNumber: string, input: string, _pending: PendingOrderData | null): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  const availableDays = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, today),
        sql`${bakingDaysTable.total_available} > ${bakingDaysTable.reserved_count}`
      )
    )
    .orderBy(bakingDaysTable.date)
    .limit(7);

  const idx = parseInt(input, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= availableDays.length) {
    const validRange = `1${availableDays.length > 1 ? ` to ${availableDays.length}` : ""}`;
    await sendWhatsAppMessage(phoneNumber, `Please reply with a number between ${validRange} to choose your date.`);
    return;
  }

  const chosen = availableDays[idx];
  const remaining = chosen.totalAvailable - chosen.reservedCount;
  const date = new Date(chosen.date + "T00:00:00");
  const formatted = date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const priceFormatted = (chosen.priceCents / 100).toFixed(2);

  await updateState(phoneNumber, "awaiting_quantity", {
    bakingDayId: chosen.id,
    bakingDayDate: formatted,
    priceCents: chosen.priceCents,
  });

  await sendWhatsAppMessage(
    phoneNumber,
    `Great choice! 🍞 You've selected *${formatted}*.\n\n*${chosen.productName}* — R${priceFormatted} each\n\nHow many loaves would you like? (max ${remaining} available)\n\nReply with a *number*.`
  );
}

async function handleQuantitySelection(phoneNumber: string, input: string, pending: PendingOrderData | null): Promise<void> {
  if (!pending?.bakingDayId || !pending.priceCents) {
    await handleIdle(phoneNumber);
    return;
  }

  const quantity = parseInt(input, 10);
  if (isNaN(quantity) || quantity < 1) {
    await sendWhatsAppMessage(phoneNumber, "Please reply with a valid number of loaves (e.g. 1, 2, 3...).");
    return;
  }

  const [bakingDay] = await db
    .select()
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, pending.bakingDayId));

  if (!bakingDay) {
    await sendWhatsAppMessage(phoneNumber, "Sorry, that baking day is no longer available. Please start over.");
    await updateState(phoneNumber, "idle", null);
    return;
  }

  const remaining = bakingDay.totalAvailable - bakingDay.reservedCount;
  if (quantity > remaining) {
    await sendWhatsAppMessage(
      phoneNumber,
      `Sorry, only *${remaining}* loaf(ves) are still available for that day. Please choose a smaller quantity.`
    );
    return;
  }

  const totalCents = quantity * pending.priceCents;
  const totalFormatted = (totalCents / 100).toFixed(2);

  let paymentLink = "";
  let checkoutId = "";

  try {
    const checkout = await createYocoCheckout(totalCents, "ZAR", {
      phoneNumber,
      bakingDayId: String(pending.bakingDayId),
      quantity: String(quantity),
    });
    paymentLink = checkout.redirectUrl;
    checkoutId = checkout.id;
  } catch (err) {
    logger.error({ err }, "Failed to create Yoco checkout");
    await sendWhatsAppMessage(
      phoneNumber,
      "Sorry, we couldn't generate a payment link right now. Please try again in a few minutes."
    );
    return;
  }

  const [order] = await db
    .insert(ordersTable)
    .values({
      whatsappNumber: phoneNumber,
      bakingDayId: pending.bakingDayId,
      quantity,
      status: "pending_payment",
      yocoCheckoutId: checkoutId,
    })
    .returning();

  await db
    .update(bakingDaysTable)
    .set({ reservedCount: sql`${bakingDaysTable.reservedCount} + ${quantity}` })
    .where(eq(bakingDaysTable.id, pending.bakingDayId));

  await updateState(phoneNumber, "awaiting_payment", {
    bakingDayId: pending.bakingDayId,
    quantity,
    priceCents: pending.priceCents,
  });

  logger.info({ orderId: order.id, phoneNumber }, "Order created, awaiting payment");

  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Almost done! Here's your order summary:\n\n📅 *${pending.bakingDayDate}*\n🍞 *${quantity}* sourdough loaf(ves)\n💰 *R${totalFormatted}* total\n\nPlease complete your payment here:\n${paymentLink}\n\n_Your spot is reserved for 24 hours. Reply *cancel* to cancel._`
  );
}

async function updateState(phoneNumber: string, step: string, data: unknown): Promise<void> {
  await db
    .insert(conversationStateTable)
    .values({
      whatsappNumber: phoneNumber,
      step: step as "idle" | "awaiting_date" | "awaiting_quantity" | "awaiting_payment",
      pendingOrderData: data as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: conversationStateTable.whatsappNumber,
      set: {
        step: step as "idle" | "awaiting_date" | "awaiting_quantity" | "awaiting_payment",
        pendingOrderData: data as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}
