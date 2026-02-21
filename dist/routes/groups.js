"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// GET /groups
router.get("/", async (req, res) => {
    const groups = await prisma_1.prisma.group.findMany({
        where: { tenantId: req.tenant.id },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { contacts: true } } },
    });
    res.json(groups);
});
// POST /groups
router.post("/", async (req, res) => {
    const result = zod_1.z.object({ name: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ error: result.error.flatten() });
    const group = await prisma_1.prisma.group.create({
        data: { tenantId: req.tenant.id, name: result.data.name },
    });
    res.status(201).json(group);
});
// GET /groups/:id/contacts
router.get("/:id/contacts", async (req, res) => {
    const group = await prisma_1.prisma.group.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const [items, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.groupContact.findMany({
            where: { groupId: group.id },
            skip: (page - 1) * limit,
            take: limit,
            include: { contact: true },
            orderBy: { addedAt: "desc" },
        }),
        prisma_1.prisma.groupContact.count({ where: { groupId: group.id } }),
    ]);
    res.json({
        contacts: items.map((i) => i.contact),
        total,
        page,
        pages: Math.ceil(total / limit),
    });
});
// POST /groups/:id/contacts
router.post("/:id/contacts", async (req, res) => {
    const group = await prisma_1.prisma.group.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    const result = zod_1.z
        .object({ contactIds: zod_1.z.array(zod_1.z.string()).min(1) })
        .safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ error: result.error.flatten() });
    // Verify all contacts belong to this tenant
    const contacts = await prisma_1.prisma.contact.findMany({
        where: { id: { in: result.data.contactIds }, tenantId: req.tenant.id },
    });
    await prisma_1.prisma.groupContact.createMany({
        data: contacts.map((c) => ({ groupId: group.id, contactId: c.id })),
        skipDuplicates: true,
    });
    res.json({ added: contacts.length });
});
// DELETE /groups/:id/contacts
router.delete("/:id/contacts", async (req, res) => {
    const group = await prisma_1.prisma.group.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    const result = zod_1.z
        .object({ contactIds: zod_1.z.array(zod_1.z.string()).min(1) })
        .safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ error: result.error.flatten() });
    await prisma_1.prisma.groupContact.deleteMany({
        where: { groupId: group.id, contactId: { in: result.data.contactIds } },
    });
    res.json({ success: true });
});
// DELETE /groups/:id
router.delete("/:id", async (req, res) => {
    const group = await prisma_1.prisma.group.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    await prisma_1.prisma.group.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});
exports.default = router;
