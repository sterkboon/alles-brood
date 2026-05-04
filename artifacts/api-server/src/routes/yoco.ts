import { Router, type IRouter } from "express";
import { Webhook } from "standardwebhooks";
import { eq, sql } from "drizzle-orm";
import { db, ordersTable, bakingDaysTable, conversationStateTable } from "@workspace/db";
import { sendWhatsAppMessage } from "../lib/twilio";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/yoco/webhook", async (req, res): Promise<void> => {
  const webhookSecret = process.env.YOCO_WEBHOOK_SECRET;

  if (webhookSecret) {
    const rawBody: Buffer | undefined = (req as unknown as { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      logger.error("Raw body not captured for Yoco webhook — cannot verify signature");
      res.status(400).json({ error: "Cannot verify webhook: raw body unavailable" });
      return;
    }

    try {
      const wh = new Webhook(webhookSecret);
      wh.verify(rawBody, req.headers as Record<string, string>);
    } catch (err) {
      logger.warn({ err }, "Yoco webhook signature verification failed");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  } else {
    logger.warn("YOCO_WEBHOOK_SECRET not set — skipping signature verification (configure for production)");
  }

  const payload = req.body;

  logger.info({ type: payload?.type }, "Yoco webhook received");

  if (payload?.type !== "payment.succeeded" && payload?.type !== "checkout.succeeded") {
    res.json({ received: true });
    return;
  }

  const checkoutId: string | undefined =
    payload?.payload?.checkoutId ?? payload?.payload?.metadata?.checkoutId ?? payload?.id;

  if (!checkoutId) {
    logger.warn({ payload }, "Yoco webhook missing checkout ID");
    res.json({ received: true });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.yocoCheckoutId, checkoutId));

  if (!order) {
    logger.warn({ checkoutId }, "No order found for Yoco checkout ID");
    res.json({ received: true });
    return;
  }

  if (order.status === "paid") {
    res.json({ received: true });
    return;
  }

  const paymentId = payload?.payload?.id ?? checkoutId;

  await db.transaction(async (tx) => {
    await tx
      .update(ordersTable)
      .set({ status: "paid", yocoPaymentId: paymentId, updatedAt: new Date() })
      .where(eq(ordersTable.id, order.id));
    // reserved_count tracks pending orders only; decrement now that payment is confirmed.
    await tx
      .update(bakingDaysTable)
      .set({ reservedCount: sql`${bakingDaysTable.reservedCount} - ${order.quantity}` })
      .where(eq(bakingDaysTable.id, order.bakingDayId));
    await tx
      .update(conversationStateTable)
      .set({ step: "idle", pendingOrderData: null, updatedAt: new Date() })
      .where(eq(conversationStateTable.whatsappNumber, order.whatsappNumber));
  });

  logger.info({ orderId: order.id, phoneNumber: order.whatsappNumber }, "Order marked as paid");

  const [bakingDay] = await db
    .select()
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, order.bakingDayId));

  const dateFormatted = bakingDay
    ? new Date(bakingDay.date + "T00:00:00").toLocaleDateString("en-ZA", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "your baking day";

  try {
    await sendWhatsAppMessage(
      order.whatsappNumber,
      `🎉 Payment received! Your order is confirmed.\n\n📅 *${dateFormatted}*\n🍞 *${order.quantity}* sourdough loaf(ves)\n\nWe'll see you then! Thank you for your order. 🙏`
    );
  } catch (err) {
    logger.error({ err }, "Failed to send payment confirmation WhatsApp");
  }

  res.json({ received: true });
});

export default router;
