"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const apiKey_1 = require("./middleware/apiKey");
const adminAuth_1 = require("./middleware/adminAuth");
const tenants_1 = __importDefault(require("./routes/admin/tenants"));
const contacts_1 = __importDefault(require("./routes/contacts"));
const groups_1 = __importDefault(require("./routes/groups"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const credits_1 = __importDefault(require("./routes/credits"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Add this before your API routes
app.get("/", (_, res) => {
    res.sendFile(path_1.default.join(__dirname, "../public/index.html"));
});
app.use(express_1.default.static(path_1.default.join(__dirname, "../public")));
// Security
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
// Body parsing — raw for Twilio webhook signature validation
app.use("/api/v1/webhooks", express_1.default.urlencoded({ extended: false }));
app.use(express_1.default.json());
// Rate limiting
app.use("/api/v1", (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 200,
    message: { error: "Too many requests" },
}));
// Health check
app.get("/health", (_, res) => res.json({ status: "ok", ts: new Date().toISOString() }));
// Admin routes (protected by ADMIN_SECRET header)
app.use("/api/v1/admin/tenants", adminAuth_1.adminAuth, tenants_1.default);
// Tenant routes (protected by API key)
app.use("/api/v1/contacts", apiKey_1.apiKeyAuth, contacts_1.default);
app.use("/api/v1/groups", apiKey_1.apiKeyAuth, groups_1.default);
app.use("/api/v1/campaigns", apiKey_1.apiKeyAuth, campaigns_1.default);
app.use("/api/v1/credits", apiKey_1.apiKeyAuth, credits_1.default);
// Webhooks (public — validated internally)
app.use("/api/v1/webhooks", webhooks_1.default);
// 404
app.use((_, res) => res.status(404).json({ error: "Not found" }));
app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));
