import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { env } from "./env";
import { prisma } from "./db";
import { webhookRouter } from "./routes/webhooks";
import { authRouter } from "./routes/auth";
import { orderRouter } from "./routes/orders";
import { storeRouter } from "./routes/stores";
import { dropdownRouter } from "./routes/dropdowns";
import { userRouter } from "./routes/users";
import { eventRouter } from "./routes/events";
import { configRouter } from "./routes/config";
import { integrationRouter } from "./routes/integrations";
import { reportRouter } from "./routes/reports";
import { sheetRouter } from "./routes/sheets";

const app = express();

app.use(cors({ origin: env.corsOrigins, credentials: true }));

// IMPORTANT: webhooks are mounted BEFORE express.json so the raw body survives
// for HMAC verification (the webhook router uses express.raw internally).
app.use("/webhooks", webhookRouter);

// All other routes use JSON parsing.
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", authRouter);
app.use("/orders", orderRouter);
app.use("/stores", storeRouter);
app.use("/dropdowns", dropdownRouter);
app.use("/users", userRouter);
app.use("/events", eventRouter);
app.use("/config", configRouter);
app.use("/integrations", integrationRouter);
app.use("/reports", reportRouter);
app.use("/sheets", sheetRouter);

// In production, serve the built React app from the same origin (single-service deploy).
// API routes are registered above, so they win; everything else falls back to index.html.
const clientDir = process.env.CLIENT_DIR || path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(path.join(clientDir, "index.html"))) {
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  console.log(`Serving frontend from ${clientDir}`);
}

const server = app.listen(env.port, () => {
  console.log(`Order Tracker API listening on port ${env.port}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Never let a stray async error take the whole server down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
