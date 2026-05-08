import { Router, type IRouter } from "express";
import twilio from "twilio";
import { handleIncomingMessage } from "../lib/conversation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/whatsapp/webhook", async (req, res): Promise<void> => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (authToken) {
    const twilioSignature = req.headers["x-twilio-signature"] as string;
    const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
    const url = domains
      ? `https://${domains}/api/whatsapp/webhook`
      : `https://localhost/api/whatsapp/webhook`;

    const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body);
    if (!isValid) {
      req.log.warn("Invalid Twilio signature");
      res.status(403).send("Forbidden");
      return;
    }
  }

  const from: string = req.body?.From ?? "";
  const to: string = req.body?.To ?? "";
  const body: string = req.body?.Body ?? "";

  if (!from) {
    res.status(400).send("Missing From");
    return;
  }

  const phoneNumber = from.replace("whatsapp:", "");
  logger.info({ from: phoneNumber, to, body: body.slice(0, 50) }, "Incoming WhatsApp message");

  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  setImmediate(async () => {
    try {
      await handleIncomingMessage(from, body, to);
    } catch (err) {
      logger.error({ err }, "Error handling WhatsApp message");
    }
  });
});

export default router;
