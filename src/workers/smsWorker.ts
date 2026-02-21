import "dotenv/config";
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";
import { URL } from "url";
import { SmsJobData } from "../lib/queue";

const redis = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// BullMQ expects its own connection object due to dependency duplication issues
const redisUrl = new URL(process.env.REDIS_URL!);
const bullmqRedisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
};

const prisma = new PrismaClient();
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const worker = new Worker<SmsJobData>(
  "sms-jobs",
  async (job: Job<SmsJobData>) => {
    const { messageId, campaignId, phone, body } = job.data;

    // Check if campaign was cancelled before processing
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });

    if (campaign?.status === "CANCELLED") {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: "FAILED", errorMessage: "Campaign cancelled" },
      });
      return;
    }

    const result = await twilioClient.messages.create({
      body,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID!,
      to: phone,
      statusCallback: `${process.env.APP_URL}/api/v1/webhooks/twilio`,
    });

    await prisma.message.update({
      where: { id: messageId },
      data: { status: "SENT", twilioSid: result.sid },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });
  },
  {
    connection: bullmqRedisConnection,
    concurrency: 10,
    limiter: { max: 100, duration: 1000 },
  },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`❌ Job ${job.id} failed:`, err.message);

  // On final failure (no more retries), mark message as failed and refund credit
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    const { messageId, campaignId, tenantId, phone } = job.data;
    await prisma.$transaction([
      prisma.message.update({
        where: { id: messageId },
        data: { status: "FAILED", errorMessage: err.message },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 } },
      }),
      prisma.tenant.update({
        where: { id: tenantId },
        data: { creditBalance: { increment: 1 } },
      }),
      prisma.creditLedger.create({
        data: {
          tenantId,
          amount: 1,
          type: "REFUND",
          reason: `Failed message refund: ${phone}`,
        },
      }),
    ]);
  }
});

worker.on("completed", (job) => console.log(`✅ Job ${job.id} done`));

console.log("🚀 SMS Worker running...");
