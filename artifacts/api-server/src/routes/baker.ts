import { Router, type IRouter } from "express";
import { eq, gte, sql, and } from "drizzle-orm";
import { db, ordersTable, bakingDaysTable, productsTable } from "@workspace/db";
import { requireBakerAuth } from "../middlewares/requireBakerAuth";

const router: IRouter = Router();

router.get("/baker/summary", requireBakerAuth, async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];

  const [todayOrders] = await db
    .select({
      totalOrders: sql<number>`COUNT(*)::int`,
      paid: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'paid' THEN 1 END)::int`,
      pending: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'pending_payment' THEN 1 END)::int`,
    })
    .from(ordersTable)
    .innerJoin(bakingDaysTable, eq(ordersTable.bakingDayId, bakingDaysTable.id))
    .where(eq(bakingDaysTable.date, today));

  const upcomingDays = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      productId: bakingDaysTable.productId,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      productName: productsTable.name,
      paidCount: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'paid' THEN 1 END)::int`,
      pendingCount: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'pending_payment' THEN 1 END)::int`,
      paidLoaves: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} = 'paid' THEN ${ordersTable.quantity} ELSE 0 END), 0)::int`,
    })
    .from(bakingDaysTable)
    .innerJoin(productsTable, eq(bakingDaysTable.productId, productsTable.id))
    .leftJoin(
      ordersTable,
      and(
        eq(ordersTable.bakingDayId, bakingDaysTable.id),
        sql`${ordersTable.status} != 'cancelled'`
      )
    )
    .where(gte(bakingDaysTable.date, today))
    .groupBy(bakingDaysTable.id, productsTable.name)
    .orderBy(bakingDaysTable.date)
    .limit(10);

  const upcomingWithRemaining = upcomingDays.map((d) => ({
    ...d,
    remaining: d.totalAvailable - d.reservedCount - d.paidLoaves,
  }));

  const recentOrderRows = await db
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
    .orderBy(sql`${ordersTable.createdAt} DESC`)
    .limit(10);

  const recentOrders = recentOrderRows.map((r) => ({
    ...r,
    totalAmountCents: r.quantity * r.priceCents,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  res.json({
    totalOrdersToday: todayOrders?.totalOrders ?? 0,
    paidToday: todayOrders?.paid ?? 0,
    pendingToday: todayOrders?.pending ?? 0,
    upcomingDays: upcomingWithRemaining,
    recentOrders,
  });
});

export default router;
