"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const prisma_1 = require("../lib/prisma");
async function apiKeyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing API key" });
    }
    const apiKey = authHeader.split(" ")[1];
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { apiKey },
    });
    if (!tenant || !tenant.isActive) {
        return res.status(401).json({ error: "Invalid or inactive API key" });
    }
    req.tenant = tenant;
    next();
}
