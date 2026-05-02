import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, ordersTable, bakingDaysTable, productsTable } from "@workspace/db";
import { ListOrdersQueryParams, CancelOrderParams } from "@workspace/api-zod";
import { requireBakerAuth } from "../middlewares/requireBakerAuth";
import { createYocoCheckout } from "../lib/yoco";
import { notifyCustomerManualOrder } from "../lib/conversation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isAtLeast48HoursAway(dateStr: string): boolean {
  const bakeDate = new Date(dateStr + "T00:00:00");
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return bakeDate >= cutoff;
}

function parseCreateOrderBody(body: unknown): { whatsappNumber: string; customerName?: string | null; bakingDayId: number; quantity: number } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.whatsappNumber !== "string" || b.whatsappNumber.trim().length < 7) return null;
  if (typeof b.bakingDayId !== "number" || b.bakingDayId < 1) return null;
  if (typeof b.quantity !== "number" || b.quantity < 1) return null;
  return {
    whatsappNumber: b.whatsappNumber.trim(),
    customerName: typeof b.customerName === "string" ? b.customerName.trim() || null : null,
    bakingDayId: Math.floor(b.bakingDayId),
    quantity: Math.floor(b.quantity),
  };
}

router.get("/baker/orders", requireBakerAuth, async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { bakingDayId, status } = query.data;

  const conditions = [];
  if (bakingDayId) conditions.push(eq(ordersTable.bakingDayId, bakingDayId));
  if (status) conditions.push(eq(ordersTable.status, status as "pending_payment" | "paid" | "cancelled"));

  const rows = await db
    .select({
      id: ordersTable.id,
      whatsappNumber: ordersTable.whatsappNumber,
      customerName: ordersTable.customerName,
      bakingDayId: ordersTable.bakingDayId,
      bakingDayDate: bakingDaysTable.date,
      quantity: ordersTable.quantity,
      status: ordersTable.status,
      yocoPaymentId: ordersTable.yocoPaymentId,
      yocoCheckoutId: ordersTable.yocoCheckoutId,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .innerJoin(bakingDaysTable, eq(ordersTable.bakingDayId, bakingDaysTable.id))
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${ordersTable.createdAt} DESC`);

  const result = rows.map((r) => ({
    ...r,
    totalAmountCents: r.quantity * r.priceCents,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  res.json(result);
});

router.get("/baker/orders/:id", requireBakerAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id) || id < 1) {
    res.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const [row] = await db
    .select({
      id: ordersTable.id,
      whatsappNumber: ordersTable.whatsappNumber,
      customerName: ordersTable.customerName,
      bakingDayId: ordersTable.bakingDayId,
      bakingDayDate: bakingDaysTable.date,
      quantity: ordersTable.quantity,
      status: ordersTable.status,
      yocoPaymentId: ordersTable.yocoPaymentId,
      yocoCheckoutId: ordersTable.yocoCheckoutId,
      productName: productsTable.name,
      priceCents: productsTable.priceCents,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .innerJoin(bakingDaysTable, eq(ordersTable.bakingDayId, bakingDaysTable.id))
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .where(eq(ordersTable.id, id));

  if (!row) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json({
    ...row,
    totalAmountCents: row.quantity * row.priceCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

router.post("/baker/orders", requireBakerAuth, async (req, res): Promise<void> => {
  const parsed = parseCreateOrderBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid request body. Required: whatsappNumber (string), bakingDayId (number), quantity (number)." });
    return;
  }

  const { whatsappNumber, customerName, bakingDayId, quantity } = parsed;

  const [bakingDay] = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      productId: bakingDaysTable.productId,
      paidLoaves: sql<number>`COALESCE((SELECT SUM(quantity) FROM orders WHERE baking_day_id = ${bakingDaysTable.id} AND status = 'paid'), 0)`,
    })
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, bakingDayId));

  if (!bakingDay) {
    res.status(404).json({ error: "Baking day not found" });
    return;
  }

  if (!isAtLeast48HoursAway(bakingDay.date)) {
    res.status(422).json({ error: "Cannot create an order for a baking day that is less than 48 hours away." });
    return;
  }

  const remaining = bakingDay.totalAvailable - bakingDay.reservedCount - Number(bakingDay.paidLoaves);
  if (quantity > remaining) {
    res.status(422).json({ error: `Only ${remaining} loaf(ves) remaining for that day.` });
    return;
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, bakingDay.productId));

  if (!product) {
    res.status(500).json({ error: "Product not found for baking day." });
    return;
  }

  const totalAmountCents = quantity * product.priceCents;

  let paymentLink = "";
  let checkoutId = "";

  try {
    const checkout = await createYocoCheckout(totalAmountCents, "ZAR", {
      phoneNumber: whatsappNumber,
      bakingDayId: String(bakingDayId),
      quantity: String(quantity),
      bakerCreated: "true",
    });
    paymentLink = checkout.redirectUrl;
    checkoutId = checkout.id;
  } catch (err) {
    logger.error({ err }, "Failed to create Yoco checkout for manual order");
    res.status(502).json({ error: "Could not generate payment link. Check YOCO_SECRET_KEY." });
    return;
  }

  const [order] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ordersTable)
      .values({
        whatsappNumber,
        customerName: customerName ?? null,
        bakingDayId,
        quantity,
        status: "pending_payment",
        yocoCheckoutId: checkoutId,
      })
      .returning();
    await tx
      .update(bakingDaysTable)
      .set({ reservedCount: sql`${bakingDaysTable.reservedCount} + ${quantity}` })
      .where(eq(bakingDaysTable.id, bakingDayId));
    return [inserted];
  });

  try {
    await notifyCustomerManualOrder({
      phoneNumber: whatsappNumber,
      customerName,
      bakingDayDate: bakingDay.date,
      quantity,
      totalAmountCents,
      paymentLink,
    });
  } catch (err) {
    logger.error({ err }, "Failed to send WhatsApp notification for manual order (order still created)");
  }

  logger.info({ orderId: order.id, whatsappNumber }, "Manual order created by baker");

  res.status(201).json({
    ...order,
    totalAmountCents,
    productName: product.name,
    bakingDayDate: bakingDay.date,
    paymentLink,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  });
});

router.patch("/baker/orders/:id/cancel", requireBakerAuth, async (req, res): Promise<void> => {
  const params = CancelOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (order.status === "cancelled") {
    res.status(422).json({ error: "Order is already cancelled." });
    return;
  }

  const [updated] = await db.transaction(async (tx) => {
    // Only decrement reserved_count if cancelling a pending order.
    // Paid orders were already decremented from reserved_count at payment time.
    if (order.status === "pending_payment") {
      await tx
        .update(bakingDaysTable)
        .set({ reservedCount: sql`${bakingDaysTable.reservedCount} - ${order.quantity}` })
        .where(eq(bakingDaysTable.id, order.bakingDayId));
    }
    return tx
      .update(ordersTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(ordersTable.id, params.data.id))
      .returning();
  });

  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

export default router;
