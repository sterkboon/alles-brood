import axios from "axios";
import { logger } from "./logger";

const YOCO_API_URL = "https://payments.yoco.com/api";

export interface YocoCheckout {
  id: string;
  redirectUrl: string;
}

export async function createYocoCheckout(
  amountCents: number,
  currency: string,
  metadata: Record<string, string>
): Promise<YocoCheckout> {
  const secretKey = process.env.YOCO_SECRET_KEY_DEV ?? process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("YOCO_SECRET_KEY not configured");
  }

  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  const baseUrl = domains ? `https://${domains}/api` : "https://example.com/api";
  const successUrl = `${baseUrl}/payment/success`;
  const cancelUrl = `${baseUrl}/payment/cancel`;

  const response = await axios.post(
    `${YOCO_API_URL}/checkouts`,
    {
      amount: amountCents,
      currency,
      successUrl,
      cancelUrl,
      metadata,
    },
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  logger.info({ checkoutId: response.data.id }, "Yoco checkout created");
  return { id: response.data.id, redirectUrl: response.data.redirectUrl };
}
