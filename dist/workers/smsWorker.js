"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const client_1 = require("@prisma/client");
const twilio_1 = __importDefault(require("twilio"));
const url_1 = require("url");
function parseRedisUrl(urlString) {
    const url = new url_1.URL(urlString);
    return {
        host: url.hostname,
        port: Number(url.port) || 6379,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        username: url.username ? decodeURIComponent(url.username) : undefined,
    };
}
const redisConfig = parseRedisUrl(process.env.REDIS_URL);
const redis = new ioredis_1.default({
    ...redisConfig,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 500, 3000),
});
redis.on("connect", () => console.log("✅ Worker Redis connected"));
redis.on("error", (err) => console.error("Worker Redis error:", err.message));
const prisma = new client_1.PrismaClient();
const twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
async function processJob(job) {
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
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: phone,
        statusCallback: `${process.env.APP_URL}/api/v1/webhooks/twilio`,
    });
    console.log(`📱 Sent to ${phone} — SID: ${result.sid}`);
    await prisma.message.update({
        where: { id: messageId },
        data: { status: "SENT", twilioSid: result.sid },
    });
    await prisma.campaign.update({
        where: { id: campaignId },
        data: { sentCount: { increment: 1 } },
    });
}
const worker = new bullmq_1.Worker("sms-jobs", processJob, {
    connection: redisConfig,
    concurrency: 10,
    limiter: {
        max: 100,
        duration: 1000,
    },
});
worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed — ${job.data.phone}`);
});
worker.on("failed", async (job, err) => {
    if (!job)
        return;
    console.error(`❌ Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
        const { messageId, campaignId, tenantId, phone } = job.data;
        try {
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
            console.log(`💰 Refunded 1 credit for failed message to ${phone}`);
        }
        catch (refundErr) {
            console.error("Failed to process refund:", refundErr);
        }
    }
});
worker.on("error", (err) => {
    console.error("Worker error:", err.message);
});
// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("SIGTERM received — closing worker...");
    await worker.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
});
console.log("🚀 SMS Worker running...");
