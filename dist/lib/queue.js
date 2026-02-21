"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsQueue = exports.redis = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
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
exports.redis = new ioredis_1.default({
    ...redisConfig,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 500, 3000),
});
exports.redis.on("connect", () => console.log("✅ Redis connected"));
exports.redis.on("error", (err) => console.error("Redis error:", err.message));
exports.smsQueue = new bullmq_1.Queue("sms-jobs", {
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
