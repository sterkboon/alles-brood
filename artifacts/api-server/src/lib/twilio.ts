import twilio from "twilio";
import { logger } from "./logger";

let twilioClient: ReturnType<typeof twilio> | null = null;

export function getTwilioClient(): ReturnType<typeof twilio> {
  if (!twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      logger.warn("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — WhatsApp integration disabled");
      throw new Error("Twilio credentials not configured");
    }
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) {
    logger.warn("TWILIO_WHATSAPP_NUMBER not set");
    return;
  }
  try {
    const client = getTwilioClient();
    const formattedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
    const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    await client.messages.create({
      from: formattedFrom,
      to: formattedTo,
      body,
    });
  } catch (err) {
    logger.error({ err }, "Failed to send WhatsApp message");
  }
}
