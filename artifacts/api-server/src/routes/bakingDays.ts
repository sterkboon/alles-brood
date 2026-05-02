import { Router, type IRouter } from "express";
import { eq, gte, sql, and } from "drizzle-orm";
import { db, bakingDaysTable, productsTable, ordersTable } from "@workspace/db";
import {
  CreateBakingDayBody,
  UpdateBakingDayBody,
  UpdateBakingDayParams,
  DeleteBakingDayParams,
} from "@workspace/api-zod";
import { requireBakerAuth } from "../middlewares/requireBakerAuth";

const router: IRouter = Router();

function isAtLeast48HoursAway(dateStr: string): boolean {
  const bakeDate = new Date(dateStr + "T00:00:00");
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return bakeDate >= cutoff;
}

router.get("/baker/baking-days", requireBakerAuth, async (req, res): Promise<void> => {
  const upcoming = req.query.upcoming === "true";
  const today = new Date().toISOString().split("T")[0];

  const rows = await db
    .select({
      id: bakingDaysTable.id,
      date: bakingDaysTable.date,
      productId: bakingDaysTable.productId,
      totalAvailable: bakingDaysTable.totalAvailable,
      reservedCount: bakingDaysTable.reservedCount,
      productName: productsTable.name,
      paidCount: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'paid' THEN 1 END)::int`,
      pendingCount: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'pending_payment' THEN 1 END)::int`,
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
    .where(upcoming ? gte(bakingDaysTable.date, today) : undefined)
    .groupBy(bakingDaysTable.id, productsTable.name)
    .orderBy(bakingDaysTable.date);

  const result = rows.map((row) => ({
    ...row,
    remaining: row.totalAvailable - row.reservedCount,
    editable: isAtLeast48HoursAway(row.date),
  }));

  res.json(result);
});

router.post("/baker/baking-days", requireBakerAuth, async (req, res): Promise<void> => {
  const parsed = CreateBakingDayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!isAtLeast48HoursAway(parsed.data.date)) {
    res.status(422).json({ error: "Baking days must be at least 48 hours in the future." });
    return;
  }

  const [day] = await db.insert(bakingDaysTable).values(parsed.data).returning();
  res.status(201).json(day);
});

router.patch("/baker/baking-days/:id", requireBakerAuth, async (req, res): Promise<void> => {
  const params = UpdateBakingDayParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBakingDayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Baking day not found" });
    return;
  }

  if (!isAtLeast48HoursAway(existing.date)) {
    res.status(422).json({ error: "Cannot modify a baking day that is less than 48 hours away." });
    return;
  }

  const targetDate = parsed.data.date ?? existing.date;
  if (parsed.data.date && !isAtLeast48HoursAway(parsed.data.date)) {
    res.status(422).json({ error: "Cannot move a baking day to a date less than 48 hours away." });
    return;
  }

  if (parsed.data.totalAvailable !== undefined && parsed.data.totalAvailable < existing.reservedCount) {
    res.status(422).json({
      error: `Cannot reduce availability below the number already reserved (${existing.reservedCount}).`,
    });
    return;
  }

  const [day] = await db
    .update(bakingDaysTable)
    .set({ ...parsed.data, ...(targetDate !== existing.date ? { date: targetDate } : {}) })
    .where(eq(bakingDaysTable.id, params.data.id))
    .returning();

  res.json(day);
});

router.delete("/baker/baking-days/:id", requireBakerAuth, async (req, res): Promise<void> => {
  const params = DeleteBakingDayParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(bakingDaysTable)
    .where(eq(bakingDaysTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Baking day not found" });
    return;
  }

  if (!isAtLeast48HoursAway(existing.date)) {
    res.status(422).json({ error: "Cannot delete a baking day that is less than 48 hours away." });
    return;
  }

  const [linkedOrders] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.bakingDayId, params.data.id),
      sql`${ordersTable.status} NOT IN ('cancelled')`
    ));

  if (Number(linkedOrders?.count ?? 0) > 0) {
    res.status(422).json({ error: "Cannot delete a baking day that has active orders. Cancel all orders first." });
    return;
  }

  await db.delete(bakingDaysTable).where(eq(bakingDaysTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
