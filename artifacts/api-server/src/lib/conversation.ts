import { eq, gte, and, lt, sql } from "drizzle-orm";
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

// Cancel pending_payment orders older than 2 hours so failed/abandoned payments
// don't permanently inflate reservedCount and reduce visible availability.
async function expireStaleOrders(): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "pending_payment"), lt(ordersTable.createdAt, twoHoursAgo)));

  for (const order of stale) {
    await db.transaction(async (tx) => {
      const cancelled = await tx
        .update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(ordersTable.id, order.id), eq(ordersTable.status, "pending_payment")))
        .returning();
      if (cancelled.length > 0) {
        await tx
          .update(bakingDaysTable)
          .set({ reservedCount: sql`${bakingDaysTable.reservedCount} - ${order.quantity}` })
          .where(eq(bakingDaysTable.id, order.bakingDayId));
      }
    });
  }

  if (stale.length > 0) {
    logger.info({ count: stale.length }, "Expired stale pending orders");
  }
}

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
    if (state.step === "awaiting_payment") {
      const pendingOrder = await db
        .select()
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.whatsappNumber, phoneNumber),
            eq(ordersTable.status, "pending_payment")
          )
        )
        .orderBy(sql`${ordersTable.createdAt} DESC`)
        .limit(1)
        .then((rows) => rows[0]);

      if (pendingOrder) {
        const { id: orderId, bakingDayId: dayId, quantity: qty } = pendingOrder;
        await db.transaction(async (tx) => {
          // Guard with status check to prevent double-cancel race condition.
          const cancelled = await tx
            .update(ordersTable)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending_payment")))
            .returning();
          if (cancelled.length > 0) {
            await tx
              .update(bakingDaysTable)
              .set({ reservedCount: sql`${bakingDaysTable.reservedCount} - ${qty}` })
              .where(eq(bakingDaysTable.id, dayId));
          }
        });
        logger.info({ orderId, phoneNumber }, "Order cancelled by customer via WhatsApp");
      }
    }

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

export async function notifyCustomerManualOrder({
  phoneNumber,
  customerName,
  bakingDayDate,
  quantity,
  totalAmountCents,
  paymentLink,
}: {
  phoneNumber: string;
  customerName: string | null | undefined;
  bakingDayDate: string;
  quantity: number;
  totalAmountCents: number;
  paymentLink: string;
}): Promise<void> {
  const date = new Date(bakingDayDate + "T00:00:00");
  const formatted = date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const totalFormatted = (totalAmountCents / 100).toFixed(2);
  const pickupAddress = process.env.PICKUP_ADDRESS || "baker's address (to be confirmed)";
  const greeting = customerName ? `Hi ${customerName}! ` : "Hi! ";

  await sendWhatsAppMessage(
    phoneNumber,
    `${greeting}👋 Your sourdough order has been placed by the baker!\n\n📅 *Pickup: ${formatted}*\n📍 *${pickupAddress}*\n🍞 *${quantity}* sourdough loaf(ves)\n💰 *R${totalFormatted}* total\n\n⚠️ Your order will only be *confirmed once payment is received*.\n\nPlease complete your payment here:\n${paymentLink}\n\n_Reply *order* anytime to place a new order._`
  );

  await updateState(phoneNumber, "awaiting_payment", {
    bakerCreated: true,
    totalAmountCents,
  });
}

async function handleIdle(phoneNumber: string): Promise<void> {
  await expireStaleOrders();
  const cutoff48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split("T")[0];

  const availableDays = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      paidLoaves: sql<number>`COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, cutoff48h),
        sql`${bakingDaysTable.totalAvailable} > ${bakingDaysTable.reservedCount} + COALESCE((SELECT SUM(${ordersTable.quantity}) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`
      )
    )
    .orderBy(bakingDaysTable.date)
    .limit(7);

  if (!availableDays.length) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Hi! 👋 Thanks for reaching out to *Sourdough by Alles van Afrika*.\n\nUnfortunately we don't have any available baking days right now. Please check back soon!"
    );
    return;
  }

  const daysList = availableDays
    .map((d, i) => {
      const date = new Date(d.date + "T00:00:00");
      const formatted = date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
      const visible = d.totalAvailable - Number(d.paidLoaves);
      return `${i + 1}. *${formatted}* — ${visible} loaf(ves) available`;
    })
    .join("\n");

  await sendWhatsAppMessage(
    phoneNumber,
    `Hi! 👋 Welcome to *Sourdough by Alles van Afrika*!\n\nHere are the upcoming baking days:\n\n${daysList}\n\nReply with the *number* of the date you'd like to order for.\n\n_Reply *cancel* anytime to stop._`
  );

  await updateState(phoneNumber, "awaiting_date", { availableDays });
}

async function handleDateSelection(phoneNumber: string, input: string, _pending: PendingOrderData | null): Promise<void> {
  const cutoff48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split("T")[0];

  const availableDays = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      paidLoaves: sql<number>`COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, cutoff48h),
        sql`${bakingDaysTable.totalAvailable} > ${bakingDaysTable.reservedCount} + COALESCE((SELECT SUM(${ordersTable.quantity}) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`
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
  const visible = chosen.totalAvailable - Number(chosen.paidLoaves);
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
    `Great choice! 🍞 You've selected *${formatted}*.\n\n*${chosen.productName}* — R${priceFormatted} each\n\nHow many loaves would you like? (max ${visible} available)\n\nReply with a *number*.`
  );
}

async function handleQuantitySelection(phoneNumber: string, input: string, pending: PendingOrderData | null): Promise<void> {
  if (!pending?.bakingDayId || !pending.priceCents) {
    await handleIdle(phoneNumber);
    return;
  }

  const pendingBakingDayId: number = pending.bakingDayId;
  const pendingPriceCents: number = pending.priceCents;
  const pendingBakingDayDate: string | undefined = pending.bakingDayDate;

  const quantity = parseInt(input, 10);
  if (isNaN(quantity) || quantity < 1) {
    await sendWhatsAppMessage(phoneNumber, "Please reply with a valid number of loaves (e.g. 1, 2, 3...).");
    return;
  }

  const [bakingDay] = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      paidLoaves: sql<number>`COALESCE((SELECT SUM(${ordersTable.quantity}) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`,
    })
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, pendingBakingDayId));

  if (!bakingDay) {
    await sendWhatsAppMessage(phoneNumber, "Sorry, that baking day is no longer available. Please start over.");
    await updateState(phoneNumber, "idle", null);
    return;
  }

  // reserved_count = pending only; also subtract paid loaves from remaining capacity.
  const remaining = bakingDay.totalAvailable - bakingDay.reservedCount - Number(bakingDay.paidLoaves);
  if (quantity > remaining) {
    await sendWhatsAppMessage(
      phoneNumber,
      `Sorry, only *${remaining}* loaf(ves) are still available for that day. Please choose a smaller quantity.`
    );
    return;
  }

  const totalCents = quantity * pendingPriceCents;
  const totalFormatted = (totalCents / 100).toFixed(2);

  let paymentLink = "";
  let checkoutId = "";

  try {
    const checkout = await createYocoCheckout(totalCents, "ZAR", {
      phoneNumber,
      bakingDayId: String(pendingBakingDayId),
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

  const [order] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ordersTable)
      .values({
        whatsappNumber: phoneNumber,
        bakingDayId: pendingBakingDayId,
        quantity,
        status: "pending_payment",
        yocoCheckoutId: checkoutId,
      })
      .returning();
    await tx
      .update(bakingDaysTable)
      .set({ reservedCount: sql`${bakingDaysTable.reservedCount} + ${quantity}` })
      .where(eq(bakingDaysTable.id, pendingBakingDayId));
    return [inserted];
  });

  await updateState(phoneNumber, "awaiting_payment", {
    bakingDayId: pendingBakingDayId,
    quantity,
    priceCents: pendingPriceCents,
  });

  logger.info({ orderId: order.id, phoneNumber }, "Order created, awaiting payment");

  const pickupAddress = process.env.PICKUP_ADDRESS || "baker's address (to be confirmed)";

  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Almost done! Here's your order summary:\n\n📅 *${pendingBakingDayDate ?? bakingDay.date}*\n📍 *${pickupAddress}*\n🍞 *${quantity}* sourdough loaf(ves)\n💰 *R${totalFormatted}* total\n\nPlease complete your payment here:\n${paymentLink}\n\n_Your spot is reserved for 24 hours. Reply *cancel* to cancel._`
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
