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

async function generateOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const num = String(Math.floor(100000 + Math.random() * 900000));
    const [existing] = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.orderNumber, num));
    if (!existing) return num;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function expireStaleOrders(): Promise<void> {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const stale = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "pending_payment"), lt(ordersTable.createdAt, thirtyMinutesAgo)));

  for (const order of stale) {
    await db.transaction(async (tx) => {
      const abandoned = await tx
        .update(ordersTable)
        .set({ status: "abandoned", updatedAt: new Date() })
        .where(and(eq(ordersTable.id, order.id), eq(ordersTable.status, "pending_payment")))
        .returning();
      if (abandoned.length > 0) {
        await tx
          .update(bakingDaysTable)
          .set({ reservedCount: sql`GREATEST(0, ${bakingDaysTable.reservedCount} - ${order.quantity})` })
          .where(eq(bakingDaysTable.id, order.bakingDayId));
      }
    });
  }

  if (stale.length > 0) {
    logger.info({ count: stale.length }, "Expired abandoned pending orders (30-min timeout)");
  }
}

interface PendingOrderData {
  bakingDayId?: number;
  bakingDayDate?: string;
  quantity?: number;
  priceCents?: number;
  orderId?: number;
  orderNumber?: string;
  bakerCreated?: boolean;
  totalAmountCents?: number;
}

async function cancelPendingOrder(orderId: number, bakingDayId: number, quantity: number): Promise<boolean> {
  let cancelled = false;
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(ordersTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending_payment")))
      .returning();
    if (rows.length > 0) {
      cancelled = true;
      await tx
        .update(bakingDaysTable)
        .set({ reservedCount: sql`GREATEST(0, ${bakingDaysTable.reservedCount} - ${quantity})` })
        .where(eq(bakingDaysTable.id, bakingDayId));
    }
  });
  return cancelled;
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
        const ok = await cancelPendingOrder(pendingOrder.id, pendingOrder.bakingDayId, pendingOrder.quantity);
        if (ok) {
          logger.info({ orderId: pendingOrder.id, phoneNumber }, "Order cancelled by customer via WhatsApp");
        }
      }
    }

    await updateState(phoneNumber, "idle", null);
    await sendWhatsAppMessage(phoneNumber, "No problem! Your order has been cancelled. Reply *order* anytime to start a new order.");
    return;
  }

  if (state.step === "awaiting_feedback") {
    await handleFeedback(phoneNumber, body.trim(), state.pendingOrderData as PendingOrderData);
    return;
  }

  if (state.step === "awaiting_payment") {
    if (trimmed === "hi" || trimmed === "hello" || trimmed === "order") {
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
        const ok = await cancelPendingOrder(pendingOrder.id, pendingOrder.bakingDayId, pendingOrder.quantity);
        if (ok) {
          logger.info({ orderId: pendingOrder.id, phoneNumber }, "Pending order auto-cancelled: customer started a new order");
        }
      }
      await handleIdle(phoneNumber);
    } else {
      await sendWhatsAppMessage(
        phoneNumber,
        "We're still waiting for your payment. Please use the link sent earlier, or reply *cancel* to start over."
      );
    }
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

  await handleIdle(phoneNumber);
}

async function handleFeedback(phoneNumber: string, message: string, pendingData: PendingOrderData | null): Promise<void> {
  await updateState(phoneNumber, "idle", null);

  if (message.toLowerCase() === "skip") {
    await sendWhatsAppMessage(phoneNumber, "No problem! See you on collection day. 🍞");
    return;
  }

  const orderId = pendingData?.orderId;
  if (orderId) {
    await db
      .update(ordersTable)
      .set({ feedback: message, updatedAt: new Date() })
      .where(eq(ordersTable.id, orderId));
    logger.info({ orderId, phoneNumber }, "Customer feedback saved");
  }

  await sendWhatsAppMessage(phoneNumber, "Thank you for your feedback! We really appreciate it. See you on collection day! 🍞");
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
  const greeting = customerName ? `Hi ${customerName}! ` : "Hi! ";

  await sendWhatsAppMessage(
    phoneNumber,
    `${greeting}👋 Your sourdough order has been placed by the baker!\n\n📅 *Pickup: ${formatted}*\n🍞 *${quantity}* sourdough loaves\n💰 *R${totalFormatted}* total\n\n⚠️ Your order will only be *confirmed once payment is received*. The pickup address will be shared after payment.\n\nPlease complete your payment here:\n${paymentLink}\n\n_Reply *cancel* to cancel, or *order* to start a new order._`
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
      pendingLoaves: sql<number>`COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'pending_payment'), 0)`,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, cutoff48h),
        sql`${bakingDaysTable.totalAvailable} > COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'pending_payment'), 0) + COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`
      )
    )
    .orderBy(bakingDaysTable.date)
    .limit(7);

  if (!availableDays.length) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Hi! 👋 Thanks for reaching out to *Christian se Brot*.\n\nUnfortunately we don't have any available baking days right now. Please check back soon!"
    );
    return;
  }

  const daysList = availableDays
    .map((d, i) => {
      const date = new Date(d.date + "T00:00:00");
      const formatted = date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
      const available = d.totalAvailable - Number(d.pendingLoaves) - Number(d.paidLoaves);
      return `${i + 1}. *${formatted}* — ${available} loaves available`;
    })
    .join("\n");

  await sendWhatsAppMessage(
    phoneNumber,
    `Hi! 👋 Welcome to *Christian se Brot*!\n\nHere are the upcoming baking days:\n\n${daysList}\n\nReply with the *number* of the date you'd like to order for.\n\n_Reply *cancel* anytime to stop._`
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
      pendingLoaves: sql<number>`COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'pending_payment'), 0)`,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(
      and(
        gte(bakingDaysTable.date, cutoff48h),
        sql`${bakingDaysTable.totalAvailable} > COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'pending_payment'), 0) + COALESCE((SELECT SUM(quantity) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'paid'), 0)`
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
  const available = chosen.totalAvailable - Number(chosen.pendingLoaves) - Number(chosen.paidLoaves);
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
    `Great choice! 🍞 You've selected *${formatted}*.\n\n*${chosen.productName}* — R${priceFormatted} each\n\nHow many loaves would you like? (max ${available} available)\n\nReply with a *number*.`
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
      pendingLoaves: sql<number>`COALESCE((SELECT SUM(${ordersTable.quantity}) FROM ${ordersTable} WHERE ${ordersTable.bakingDayId} = ${bakingDaysTable.id} AND ${ordersTable.status} = 'pending_payment'), 0)`,
    })
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, pendingBakingDayId));

  if (!bakingDay) {
    await sendWhatsAppMessage(phoneNumber, "Sorry, that baking day is no longer available. Please start over.");
    await updateState(phoneNumber, "idle", null);
    return;
  }

  const remaining = bakingDay.totalAvailable - Number(bakingDay.pendingLoaves) - Number(bakingDay.paidLoaves);
  if (quantity > remaining) {
    await sendWhatsAppMessage(
      phoneNumber,
      `Sorry, only *${remaining}* loaves are still available for that day. Please choose a smaller quantity.`
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

  const orderNumber = await generateOrderNumber();

  const [order] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ordersTable)
      .values({
        orderNumber,
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

  logger.info({ orderId: order.id, orderNumber, phoneNumber }, "Order created, awaiting payment");

  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Almost done! Here's your order summary:\n\n🔖 *Order #${orderNumber}*\n📅 *${pendingBakingDayDate ?? bakingDay.date}*\n🍞 *${quantity}* sourdough loaves\n💰 *R${totalFormatted}* total\n\nThe pickup address will be shared once payment is confirmed.\n\nPlease complete your payment here:\n${paymentLink}\n\n_Your spot is held for 30 minutes. Reply *cancel* to cancel._`
  );
}

async function updateState(phoneNumber: string, step: string, data: unknown): Promise<void> {
  await db
    .insert(conversationStateTable)
    .values({
      whatsappNumber: phoneNumber,
      step: step as "idle" | "awaiting_date" | "awaiting_quantity" | "awaiting_payment" | "awaiting_feedback",
      pendingOrderData: data as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: conversationStateTable.whatsappNumber,
      set: {
        step: step as "idle" | "awaiting_date" | "awaiting_quantity" | "awaiting_payment" | "awaiting_feedback",
        pendingOrderData: data as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}
