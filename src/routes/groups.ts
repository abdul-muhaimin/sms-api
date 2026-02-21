// @ts-nocheck
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { z } from "zod";
import { AuthenticatedRequest } from "../types";

const router = Router();

// GET /groups
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const groups = await prisma.group.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { contacts: true } } },
  });
  res.json(groups);
});

// POST /groups
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const result = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!result.success)
    return res.status(400).json({ error: result.error.flatten() });

  const group = await prisma.group.create({
    data: { tenantId: req.tenant.id, name: result.data.name },
  });
  res.status(201).json(group);
});

// GET /groups/:id/contacts
router.get(
  "/:id/contacts",
  async (req: AuthenticatedRequest, res: Response) => {
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const [items, total] = await prisma.$transaction([
      prisma.groupContact.findMany({
        where: { groupId: group.id },
        skip: (page - 1) * limit,
        take: limit,
        include: { contact: true },
        orderBy: { addedAt: "desc" },
      }),
      prisma.groupContact.count({ where: { groupId: group.id } }),
    ]);

    res.json({
      contacts: items.map((i) => i.contact),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  },
);

// POST /groups/:id/contacts
router.post(
  "/:id/contacts",
  async (req: AuthenticatedRequest, res: Response) => {
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });

    const result = z
      .object({ contactIds: z.array(z.string()).min(1) })
      .safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.flatten() });

    // Verify all contacts belong to this tenant
    const contacts = await prisma.contact.findMany({
      where: { id: { in: result.data.contactIds }, tenantId: req.tenant.id },
    });

    await prisma.groupContact.createMany({
      data: contacts.map((c) => ({ groupId: group.id, contactId: c.id })),
      skipDuplicates: true,
    });

    res.json({ added: contacts.length });
  },
);

// DELETE /groups/:id/contacts
router.delete(
  "/:id/contacts",
  async (req: AuthenticatedRequest, res: Response) => {
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });

    const result = z
      .object({ contactIds: z.array(z.string()).min(1) })
      .safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.flatten() });

    await prisma.groupContact.deleteMany({
      where: { groupId: group.id, contactId: { in: result.data.contactIds } },
    });

    res.json({ success: true });
  },
);

// DELETE /groups/:id
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const group = await prisma.group.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
  });
  if (!group) return res.status(404).json({ error: "Group not found" });

  await prisma.group.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
