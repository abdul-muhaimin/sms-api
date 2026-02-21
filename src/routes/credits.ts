import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../types";

const router = Router();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenant.id },
    select: { creditBalance: true },
  });
  res.json({ balance: tenant?.creditBalance ?? 0, currency: "credits" });
});

router.get("/ledger", async (req: AuthenticatedRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const [entries, total] = await prisma.$transaction([
    prisma.creditLedger.findMany({
      where: { tenantId: req.tenant.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.creditLedger.count({ where: { tenantId: req.tenant.id } }),
  ]);

  res.json({ entries, total, page, pages: Math.ceil(total / limit) });
});

export default router;
