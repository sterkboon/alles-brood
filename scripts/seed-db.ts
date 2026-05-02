import { db, productsTable } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const existing = await db.select().from(productsTable).limit(1);
  if (existing.length > 0) {
    console.log("Products already seeded, skipping.");
    process.exit(0);
  }

  await db.insert(productsTable).values({
    name: "Sourdough Loaf",
    description: "Traditional sourdough bread, baked fresh to order",
    priceCents: 8500,
    active: true,
  });

  console.log("Seeded: Sourdough Loaf @ R85.00");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
