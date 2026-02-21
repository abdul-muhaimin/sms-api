"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
// List all tenants
router.get("/", async (req, res) => {
    const tenants = await prisma_1.prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            email: true,
            creditBalance: true,
            isActive: true,
            createdAt: true,
            _count: { select: { contacts: true, campaigns: true } },
        },
    });
    res.json(tenants);
});
// Create tenant
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    initialCredits: zod_1.z.number().int().min(0).default(0),
});
router.post("/", async (req, res) => {
    const result = createSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: result.error.flatten() });
    }
    const { name, email, initialCredits } = result.data;
    const apiKey = crypto_1.default.randomBytes(32).toString("hex");
    const tenant = await prisma_1.prisma.tenant.create({
        data: {
            name,
            email,
            apiKey,
            creditBalance: initialCredits,
            ...(initialCredits > 0 && {
                creditLedger: {
                    create: {
                        amount: initialCredits,
                        type: "CREDIT",
                        reason: "Initial credit allocation",
                    },
                },
            }),
        },
    });
    // Return the plain API key ONCE — not stored in plain text elsewhere
    res.status(201).json({
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        creditBalance: tenant.creditBalance,
        apiKey, // Only time this is returned in plain text
        createdAt: tenant.createdAt,
    });
});
// Top up credits
const topUpSchema = zod_1.z.object({
    amount: zod_1.z.number().int().min(1),
    reason: zod_1.z.string().default("Manual top-up"),
});
router.post("/:id/credits", async (req, res) => {
    const result = topUpSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: result.error.flatten() });
    }
    const { amount, reason } = result.data;
    const [ledger, tenant] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.creditLedger.create({
            data: {
                tenantId: req.params.id,
                amount,
                type: "CREDIT",
                reason,
            },
        }),
        prisma_1.prisma.tenant.update({
            where: { id: req.params.id },
            data: { creditBalance: { increment: amount } },
            select: { id: true, name: true, creditBalance: true },
        }),
    ]);
    res.json({ tenant, transaction: ledger });
});
// Rotate API key
router.post("/:id/rotate-key", async (req, res) => {
    const newKey = crypto_1.default.randomBytes(32).toString("hex");
    const tenant = await prisma_1.prisma.tenant.update({
        where: { id: req.params.id },
        data: { apiKey: newKey },
        select: { id: true, name: true },
    });
    res.json({ ...tenant, apiKey: newKey });
});
// Toggle active status
router.patch("/:id/status", async (req, res) => {
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { id: req.params.id },
    });
    if (!tenant)
        return res.status(404).json({ error: "Tenant not found" });
    const updated = await prisma_1.prisma.tenant.update({
        where: { id: req.params.id },
        data: { isActive: !tenant.isActive },
        select: { id: true, name: true, isActive: true },
    });
    res.json(updated);
});
exports.default = router;
