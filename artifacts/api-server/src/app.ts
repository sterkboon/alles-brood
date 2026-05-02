import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigin = process.env.CORS_ORIGIN;
if (!allowedOrigin) {
  logger.warn("CORS_ORIGIN not set — cross-origin requests will be blocked (same-origin only)");
}
app.use(cors({
  credentials: true,
  origin: allowedOrigin ?? false,
}));

if (process.env.NODE_ENV === "production") {
  const missingSecrets: string[] = [];
  if (!process.env.TWILIO_AUTH_TOKEN) missingSecrets.push("TWILIO_AUTH_TOKEN");
  if (!process.env.YOCO_WEBHOOK_SECRET) missingSecrets.push("YOCO_WEBHOOK_SECRET");
  if (missingSecrets.length > 0) {
    logger.error(
      { missingSecrets },
      "Required webhook secrets are not set — refusing to start in production. " +
      "Webhook signature verification would be disabled, allowing unauthenticated requests."
    );
    process.exit(1);
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
