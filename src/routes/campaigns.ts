import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { smsQueue } from "../lib/queue";
import { z } from "zod";

const router = Router();

interface TenantRequest extends Request {
  tenant: {
    id: string;
    creditBalance: number;
  };
}

// GET /campaigns
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const { tenant } = req as TenantRequest;
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      include: { group: { select: { id: true, name: true } } },
    });
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// POST /campaigns
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { tenant } = req as TenantRequest;

  const schema = z.object({
    name: z.string().min(1),
    groupId: z.string(),
    message: z.string().min(1).max(918),
  });

  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return;
  }

  const { name, groupId, message } = result.data;

  try {
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId: tenant.id },
      include: {
        contacts: {
          include: { contact: true },
          where: { contact: { optedOut: false } },
        },
      },
    });

    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    if (group.contacts.length === 0) {
      res.status(400).json({ error: "Group has no eligible contacts" });
      return;
    }

    const segments = Math.ceil(message.length / 160);
    const creditsNeeded = group.contacts.length * segments;

    if (tenant.creditBalance < creditsNeeded) {
      res.status(402).json({
        error: "Insufficient credits",
        required: creditsNeeded,
        available: tenant.creditBalance,
      });
      return;
    }

    // Transaction — deduct credits, create campaign + messages
    const campaign = await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { creditBalance: { decrement: creditsNeeded } },
      });

      await tx.creditLedger.create({
        data: {
          tenantId: tenant.id,
          amount: -creditsNeeded,
          type: "DEBIT",
          reason: `Campaign: ${name}`,
        },
      });

      const camp = await tx.campaign.create({
        data: {
          tenantId: tenant.id,
          groupId,
          name,
          message,
          status: "RUNNING",
          totalMessages: group.contacts.length,
          creditsUsed: creditsNeeded,
          messages: {
            create: group.contacts.map((gc) => ({
              phone: gc.contact.phone,
            })),
          },
        },
        include: { messages: true },
      });

      return camp;
    });

    // Queue jobs after transaction commits
    try {
      const jobs = campaign.messages.map((msg) => ({
        name: "send-sms",
        data: {
          messageId: msg.id,
          campaignId: campaign.id,
          tenantId: tenant.id,
          phone: msg.phone,
          body: message,
        },
      }));

      await smsQueue.addBulk(jobs);
      console.log(`✅ Queued ${jobs.length} jobs for campaign ${campaign.id}`);
    } catch (queueErr) {
      console.error("❌ Failed to queue jobs:", queueErr);
      // Campaign is created but jobs failed to queue — mark as failed
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED" },
      });
      res
        .status(500)
        .json({ error: "Campaign created but failed to queue messages" });
      return;
    }

    res.status(201).json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalMessages: campaign.totalMessages,
      creditsUsed: campaign.creditsUsed,
      message: `${campaign.totalMessages} messages queued`,
      group: {
        id: groupId,
        name: group.name,
      },
    });
  } catch (err) {
    console.error("Campaign creation error:", err);
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// GET /campaigns/:id
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const { tenant } = req as TenantRequest;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, tenantId: tenant.id },
      include: {
        group: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch campaign" });
  }
});

// GET /campaigns/:id/progress
router.get(
  "/:id/progress",
  async (req: Request, res: Response): Promise<void> => {
    const { tenant } = req as TenantRequest;
    try {
      const campaign = await prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: tenant.id },
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

      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      const pending =
        campaign.totalMessages - campaign.sentCount - campaign.failedCount;
      const progressPercent =
        campaign.totalMessages > 0
          ? Math.round(
              ((campaign.sentCount + campaign.failedCount) /
                campaign.totalMessages) *
                100,
            )
          : 0;

      res.json({ ...campaign, pendingCount: pending, progressPercent });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch progress" });
    }
  },
);

// POST /campaigns/:id/cancel
router.post(
  "/:id/cancel",
  async (req: Request, res: Response): Promise<void> => {
    const { tenant } = req as TenantRequest;
    try {
      const campaign = await prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: tenant.id },
      });

      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }

      if (campaign.status !== "RUNNING" && campaign.status !== "PENDING") {
        res
          .status(400)
          .json({ error: "Only running campaigns can be cancelled" });
        return;
      }

      const processed = campaign.sentCount + campaign.failedCount;
      const unprocessed = campaign.totalMessages - processed;
      const segments = Math.ceil(campaign.message.length / 160);
      const refund = unprocessed * segments;

      await prisma.$transaction([
        prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "CANCELLED" },
        }),
        prisma.message.updateMany({
          where: { campaignId: campaign.id, status: "PENDING" },
          data: { status: "FAILED", errorMessage: "Campaign cancelled" },
        }),
        prisma.tenant.update({
          where: { id: tenant.id },
          data: { creditBalance: { increment: refund } },
        }),
        prisma.creditLedger.create({
          data: {
            tenantId: tenant.id,
            amount: refund,
            type: "REFUND",
            reason: `Cancelled campaign: ${campaign.name}`,
          },
        }),
      ]);

      res.json({ success: true, creditsRefunded: refund });
    } catch (err) {
      console.error("Cancel error:", err);
      res.status(500).json({ error: "Failed to cancel campaign" });
    }
  },
);

export default router;
