"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const queue_1 = require("../lib/queue");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// GET /campaigns
router.get("/", (async (req, res) => {
    const campaigns = await prisma_1.prisma.campaign.findMany({
        where: { tenantId: req.tenant.id },
        orderBy: { createdAt: "desc" },
        include: { group: { select: { id: true, name: true } } },
    });
    res.json(campaigns);
}));
// POST /campaigns — create and launch
router.post("/", (async (req, res) => {
    const result = zod_1.z
        .object({
        name: zod_1.z.string().min(1),
        groupId: zod_1.z.string(),
        message: zod_1.z.string().min(1).max(918),
    })
        .safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ error: result.error.flatten() });
    const { name, groupId, message } = result.data;
    // Verify group belongs to tenant
    const group = await prisma_1.prisma.group.findFirst({
        where: { id: groupId, tenantId: req.tenant.id },
        include: {
            contacts: {
                include: { contact: true },
                where: { contact: { optedOut: false } },
            },
        },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    if (group.contacts.length === 0)
        return res.status(400).json({ error: "Group has no eligible contacts" });
    // Calculate credits needed (1 per 160 chars)
    const segments = Math.ceil(message.length / 160);
    const creditsNeeded = group.contacts.length * segments;
    if (req.tenant.creditBalance < creditsNeeded) {
        return res.status(402).json({
            error: "Insufficient credits",
            required: creditsNeeded,
            available: req.tenant.creditBalance,
        });
    }
    // Deduct credits + create campaign + create messages in one transaction
    const [campaign] = await prisma_1.prisma.$transaction(async (tx) => {
        await tx.tenant.update({
            where: { id: req.tenant.id },
            data: { creditBalance: { decrement: creditsNeeded } },
        });
        await tx.creditLedger.create({
            data: {
                tenantId: req.tenant.id,
                amount: -creditsNeeded,
                type: "DEBIT",
                reason: `Campaign: ${name}`,
            },
        });
        const camp = await tx.campaign.create({
            data: {
                tenantId: req.tenant.id,
                groupId,
                name,
                message,
                status: "RUNNING",
                totalMessages: group.contacts.length,
                creditsUsed: creditsNeeded,
                messages: {
                    create: group.contacts.map((gc) => ({ phone: gc.contact.phone })),
                },
            },
            include: { messages: true },
        });
        return [camp];
    });
    // Push jobs to BullMQ (outside transaction — fire and forget)
    const jobs = campaign.messages.map((msg) => ({
        name: "send-sms",
        data: {
            messageId: msg.id,
            campaignId: campaign.id,
            tenantId: req.tenant.id,
            phone: msg.phone,
            body: message,
        },
    }));
    await queue_1.smsQueue.addBulk(jobs);
    res.status(201).json({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalMessages: campaign.totalMessages,
        creditsUsed: campaign.creditsUsed,
        message: `${campaign.totalMessages} messages queued`,
    });
}));
// GET /campaigns/:id — full detail
router.get("/:id", (async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const campaign = await prisma_1.prisma.campaign.findFirst({
        where: { id, tenantId: req.tenant.id },
        include: {
            group: { select: { id: true, name: true } },
            _count: { select: { messages: true } },
        },
    });
    if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
}));
// GET /campaigns/:id/progress — lightweight polling endpoint
router.get("/:id/progress", (async (req, res) => {
    const campaign = await prisma_1.prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
        select: {
            id: true,
            name: true,
            status: true,
            totalMessages: true,
            sentCount: true,
            failedCount: true,
            createdAt: true,
            completedAt: true,
        },
    });
    if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });
    const pending = campaign.totalMessages - campaign.sentCount - campaign.failedCount;
    const pct = campaign.totalMessages > 0
        ? Math.round(((campaign.sentCount + campaign.failedCount) /
            campaign.totalMessages) *
            100)
        : 0;
    res.json({ ...campaign, pending, progressPercent: pct });
}));
// POST /campaigns/:id/cancel
router.post("/:id/cancel", (async (req, res) => {
    const campaign = await prisma_1.prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });
    if (campaign.status !== "RUNNING") {
        return res
            .status(400)
            .json({ error: "Only running campaigns can be cancelled" });
    }
    // Refund unprocessed credits
    const processed = campaign.sentCount + campaign.failedCount;
    const unprocessed = campaign.totalMessages - processed;
    const segments = Math.ceil(campaign.message.length / 160);
    const refund = unprocessed * segments;
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "CANCELLED" },
        }),
        prisma_1.prisma.tenant.update({
            where: { id: req.tenant.id },
            data: { creditBalance: { increment: refund } },
        }),
        prisma_1.prisma.creditLedger.create({
            data: {
                tenantId: req.tenant.id,
                amount: refund,
                type: "REFUND",
                reason: `Cancelled campaign: ${campaign.name}`,
            },
        }),
    ]);
    res.json({ success: true, creditsRefunded: refund });
}));
exports.default = router;
