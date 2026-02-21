"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const twilio_1 = __importDefault(require("twilio"));
const router = (0, express_1.Router)();
router.post("/twilio", async (req, res) => {
    // Validate the request is genuinely from Twilio
    const signature = req.headers["x-twilio-signature"];
    const url = `${process.env.APP_URL}/api/v1/webhooks/twilio`;
    const isValid = twilio_1.default.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
    if (!isValid && process.env.NODE_ENV === "production") {
        return res.status(403).send("Forbidden");
    }
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    if (!MessageSid)
        return res.sendStatus(400);
    const message = await prisma_1.prisma.message.findFirst({
        where: { twilioSid: MessageSid },
    });
    if (!message)
        return res.sendStatus(200); // Not our message, ignore
    const statusMap = {
        sent: "SENT",
        delivered: "DELIVERED",
        failed: "FAILED",
        undelivered: "UNDELIVERED",
    };
    const newStatus = statusMap[MessageStatus] ?? message.status;
    await prisma_1.prisma.message.update({
        where: { id: message.id },
        data: {
            status: newStatus,
            errorCode: ErrorCode || null,
            errorMessage: ErrorMessage || null,
        },
    });
    // Check if campaign is now fully complete
    if (newStatus === "DELIVERED" ||
        newStatus === "FAILED" ||
        newStatus === "UNDELIVERED") {
        const campaign = await prisma_1.prisma.campaign.findUnique({
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
                await prisma_1.prisma.campaign.update({
                    where: { id: campaign.id },
                    data: { status: "COMPLETED", completedAt: new Date() },
                });
            }
        }
    }
    res.sendStatus(200);
});
exports.default = router;
