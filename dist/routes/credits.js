"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { id: req.tenant.id },
        select: { creditBalance: true },
    });
    res.json({ balance: tenant?.creditBalance ?? 0, currency: "credits" });
});
router.get("/ledger", async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const [entries, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.creditLedger.findMany({
            where: { tenantId: req.tenant.id },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma_1.prisma.creditLedger.count({ where: { tenantId: req.tenant.id } }),
    ]);
    res.json({ entries, total, page, pages: Math.ceil(total / limit) });
});
exports.default = router;
