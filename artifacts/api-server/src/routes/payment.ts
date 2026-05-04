import { Router, type IRouter } from "express";

const router: IRouter = Router();

const page = (title: string, emoji: string, heading: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .emoji { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 12px; }
    p { font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 24px; }
    a.btn {
      display: inline-block;
      background: #25D366;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      padding: 12px 28px;
      border-radius: 50px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <a class="btn" href="https://wa.me/">Open WhatsApp</a>
  </div>
</body>
</html>`;

router.get("/payment/success", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(page(
    "Payment Successful",
    "🎉",
    "Payment received!",
    "Your sourdough order is confirmed. You'll receive a WhatsApp message with your order details shortly. You can close this page."
  ));
});

router.get("/payment/cancel", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(page(
    "Payment Cancelled",
    "↩️",
    "Payment cancelled",
    "No worries — your order hasn't been placed. Return to WhatsApp and reply <strong>order</strong> whenever you're ready to try again."
  ));
});

export default router;
