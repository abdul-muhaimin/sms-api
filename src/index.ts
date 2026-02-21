import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { apiKeyAuth } from "./middleware/apiKey";
import { adminAuth } from "./middleware/adminAuth";
import tenantsRouter from "./routes/admin/tenants";
import contactsRouter from "./routes/contacts";
import groupsRouter from "./routes/groups";
import campaignsRouter from "./routes/campaigns";
import creditsRouter from "./routes/credits";
import webhooksRouter from "./routes/webhooks";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));

// Add this before your API routes
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});
app.use(express.static(path.join(__dirname, "../public")));

// Security
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));

// Body parsing — raw for Twilio webhook signature validation
app.use("/api/v1/webhooks", express.urlencoded({ extended: false }));
app.use(express.json());

// Rate limiting
app.use(
  "/api/v1",
  rateLimit({
    windowMs: 60_000,
    max: 200,
    message: { error: "Too many requests" },
  }),
);

// Health check
app.get("/health", (_, res) =>
  res.json({ status: "ok", ts: new Date().toISOString() }),
);

// Admin routes (protected by ADMIN_SECRET header)
app.use("/api/v1/admin/tenants", adminAuth, tenantsRouter);

// Tenant routes (protected by API key)
app.use("/api/v1/contacts", apiKeyAuth, contactsRouter);
app.use("/api/v1/groups", apiKeyAuth, groupsRouter);
app.use("/api/v1/campaigns", apiKeyAuth, campaignsRouter);
app.use("/api/v1/credits", apiKeyAuth, creditsRouter);

// Webhooks (public — validated internally)
app.use("/api/v1/webhooks", webhooksRouter);

// 404
app.use((_, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));
