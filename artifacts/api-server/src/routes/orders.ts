import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, ordersTable, bakingDaysTable, productsTable } from "@workspace/db";
import { ListOrdersQueryParams, CancelOrderParams } from "@workspace/api-zod";
import { requireBakerAuth } from "../middlewares/requireBakerAuth";

const router: IRouter = Router();

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

  if (order.status === "paid") {
    await db
      .update(bakingDaysTable)
      .set({ reservedCount: sql`${bakingDaysTable.reservedCount} - ${order.quantity}` })
      .where(eq(bakingDaysTable.id, order.bakingDayId));
  }

  const [updated] = await db
    .update(ordersTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(ordersTable.id, params.data.id))
    .returning();

  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

export default router;
