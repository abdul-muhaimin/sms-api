"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsQueue = exports.redis = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const url_1 = require("url");
const redisUrl = new url_1.URL(process.env.REDIS_URL);
exports.redis = new ioredis_1.default({
    host: redisUrl.hostname,
    port: Number(redisUrl.port),
    password: redisUrl.password || undefined,
    username: redisUrl.username || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
exports.smsQueue = new bullmq_1.Queue("sms-jobs", {
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
