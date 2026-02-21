import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import twilio from "twilio";

const router = Router();

router.post("/twilio", async (req: Request, res: Response) => {
  // Validate the request is genuinely from Twilio
  const signature = req.headers["x-twilio-signature"] as string;
  const url = `${process.env.APP_URL}/api/v1/webhooks/twilio`;
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    req.body,
  );

  if (!isValid && process.env.NODE_ENV === "production") {
    return res.status(403).send("Forbidden");
  }

  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

  if (!MessageSid) return res.sendStatus(400);

  const message = await prisma.message.findFirst({
    where: { twilioSid: MessageSid },
  });

  if (!message) return res.sendStatus(200); // Not our message, ignore

  const statusMap: Record<string, string> = {
    sent: "SENT",
    delivered: "DELIVERED",
    failed: "FAILED",
    undelivered: "UNDELIVERED",
  };

  const newStatus = statusMap[MessageStatus] ?? message.status;

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: newStatus as any,
      errorCode: ErrorCode || null,
      errorMessage: ErrorMessage || null,
    },
  });

  // Check if campaign is now fully complete
  if (
    newStatus === "DELIVERED" ||
    newStatus === "FAILED" ||
    newStatus === "UNDELIVERED"
  ) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: message.campaignId },
      select: {
        id: true,
        totalMessages: true,
        sentCount: true,
        failedCount: true,
        status: true,
      },
    });

    if (campaign && campaign.status === "RUNNING") {
      const processed = campaign.sentCount + campaign.failedCount;
      if (processed >= campaign.totalMessages) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
    }
  }

  res.sendStatus(200);
});

export default router;
