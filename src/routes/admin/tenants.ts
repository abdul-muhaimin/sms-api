import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

// List all tenants
router.get("/", async (req, res) => {
  const tenants = await prisma.tenant.findMany({
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
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  initialCredits: z.number().int().min(0).default(0),
});

router.post("/", async (req, res) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  const { name, email, initialCredits } = result.data;
  const apiKey = crypto.randomBytes(32).toString("hex");

  const tenant = await prisma.tenant.create({
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
const topUpSchema = z.object({
  amount: z.number().int().min(1),
  reason: z.string().default("Manual top-up"),
});

router.post("/:id/credits", async (req, res) => {
  const result = topUpSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  const { amount, reason } = result.data;

  const [ledger, tenant] = await prisma.$transaction([
    prisma.creditLedger.create({
      data: {
        tenantId: req.params.id,
        amount,
        type: "CREDIT",
        reason,
      },
    }),
    prisma.tenant.update({
      where: { id: req.params.id },
      data: { creditBalance: { increment: amount } },
      select: { id: true, name: true, creditBalance: true },
    }),
  ]);

  res.json({ tenant, transaction: ledger });
});

// Rotate API key
router.post("/:id/rotate-key", async (req, res) => {
  const newKey = crypto.randomBytes(32).toString("hex");

  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { apiKey: newKey },
    select: { id: true, name: true },
  });

  res.json({ ...tenant, apiKey: newKey });
});

// Toggle active status
router.patch("/:id/status", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
  });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const updated = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { isActive: !tenant.isActive },
    select: { id: true, name: true, isActive: true },
  });

  res.json(updated);
});

export default router;
