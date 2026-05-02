import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const bakerEmail = process.env.BAKER_EMAIL;

if (!bakerEmail) {
  logger.warn(
    "BAKER_EMAIL environment variable is not set. All baker routes will return 503 until it is configured."
  );
}

export async function requireBakerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!bakerEmail) {
    res.status(503).json({ error: "Baker access not configured. Set BAKER_EMAIL environment variable." });
    return;
  }

  const auth = getAuth(req);
  const userId = auth?.userId;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = user.emailAddresses.map((e: { emailAddress: string }) => e.emailAddress.toLowerCase());
    if (!emails.includes(bakerEmail.toLowerCase())) {
      logger.warn({ userId, emails }, "Unauthorized access attempt to baker route");
      res.status(403).json({ error: "Forbidden: baker-only access" });
      return;
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch Clerk user for authorization check");
    res.status(500).json({ error: "Authorization check failed" });
    return;
  }

  next();
}
