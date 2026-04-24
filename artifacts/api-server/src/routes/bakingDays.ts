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
  }));

  res.json(result);
});

router.post("/baker/baking-days", requireBakerAuth, async (req, res): Promise<void> => {
  const parsed = CreateBakingDayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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
  const [day] = await db
    .update(bakingDaysTable)
    .set(parsed.data)
    .where(eq(bakingDaysTable.id, params.data.id))
    .returning();
  if (!day) {
    res.status(404).json({ error: "Baking day not found" });
    return;
  }
  res.json(day);
});

router.delete("/baker/baking-days/:id", requireBakerAuth, async (req, res): Promise<void> => {
  const params = DeleteBakingDayParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [day] = await db
    .delete(bakingDaysTable)
    .where(eq(bakingDaysTable.id, params.data.id))
    .returning();
  if (!day) {
    res.status(404).json({ error: "Baking day not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
