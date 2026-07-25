import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: parseInt(process.env.PORT || "3000", 10),
  defaultTimezone: process.env.TZ || "America/Chicago",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  skipWebhookVerification: process.env.SKIP_WEBHOOK_VERIFICATION === "true",
  // Shared key for machine-to-machine integrations (e.g. the DTF printer agent).
  integrationApiKey: process.env.INTEGRATION_API_KEY || "",
  // DTF Monitor (production site) — for pulling warehouse split percentages.
  dtfMonitorUrl: process.env.DTF_MONITOR_URL || "",
  dtfMonitorApiKey: process.env.DTF_MONITOR_API_KEY || "",
};
