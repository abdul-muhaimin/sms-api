import { Queue } from "bullmq";
import IORedis from "ioredis";
import { URL } from "url";

function parseRedisUrl(urlString: string) {
  const url = new URL(urlString);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
}

const redisConfig = parseRedisUrl(process.env.REDIS_URL!);

export const redis = new IORedis({
  ...redisConfig,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 500, 3000),
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

export const smsQueue = new Queue("sms-jobs", {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export interface SmsJobData {
  messageId: string;
  campaignId: string;
  tenantId: string;
  phone: string;
  body: string;
}
