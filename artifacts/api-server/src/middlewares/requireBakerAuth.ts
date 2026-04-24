import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export function requireBakerAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
