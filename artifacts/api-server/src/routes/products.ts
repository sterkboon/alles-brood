import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { CreateProductBody, UpdateProductBody, UpdateProductParams } from "@workspace/api-zod";
import { requireBakerAuth } from "../middlewares/requireBakerAuth";

const router: IRouter = Router();

router.get("/baker/products", requireBakerAuth, async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable);
  res.json(products);
});

router.post("/baker/products", requireBakerAuth, async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db.insert(productsTable).values(parsed.data).returning();
  res.status(201).json(product);
});

router.patch("/baker/products/:id", requireBakerAuth, async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db
    .update(productsTable)
    .set(parsed.data)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});

export default router;
