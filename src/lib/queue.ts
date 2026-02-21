import { Queue } from "bullmq";
import IORedis from "ioredis";

import { URL } from "url";

const redisUrl = new URL(process.env.REDIS_URL!);
export const redis = new IORedis({
  host: redisUrl.hostname,
  port: Number(redisUrl.port),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const smsQueue = new Queue("sms-jobs", {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port),
    password: redisUrl.password || undefined,
    username: redisUrl.username || undefined,
  },
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
