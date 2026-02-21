"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const zod_1 = require("zod");
const csvtojson_1 = __importDefault(require("csvtojson"));
const multer_1 = __importDefault(require("multer"));
// npm install multer @types/multer
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
const router = (0, express_1.Router)();
const ALLOWED_TEST_NUMBERS = [
    "+15005550001",
    "+15005550002",
    "+15005550003",
    "+15005550004",
    "+15005550006",
    "+15005550007",
    "+15005550008",
    "+15005550009",
];
function isValidPhone(phone) {
    // Allow Twilio magic test numbers
    if (ALLOWED_TEST_NUMBERS.includes(phone))
        return true;
    // Allow strict Maldivian numbers: +9607xxxxxx or +9609xxxxxx
    return /^\+960[79]\d{6}$/.test(phone);
}
function normalizePhone(raw) {
    let phone = raw.replace(/[\s\-\(\)]/g, "");
    if (!phone.startsWith("+")) {
        phone = phone.startsWith("960") ? `+${phone}` : `+960${phone}`;
    }
    return phone;
}
const contactSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    phone: zod_1.z.string().transform(normalizePhone).refine(isValidPhone, {
        message: "Invalid phone number. Must be a Maldivian number (+9607xxxxxx or +9609xxxxxx) or Twilio test number",
    }),
    notes: zod_1.z.string().optional(),
});
// GET /contacts
router.get("/", async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search;
    const where = {
        tenantId: req.tenant.id,
        ...(search && {
            OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
            ],
        }),
    };
    const [contacts, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.contact.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: "desc" },
        }),
        prisma_1.prisma.contact.count({ where }),
    ]);
    res.json({ contacts, total, page, pages: Math.ceil(total / limit) });
});
// POST /contacts
router.post("/", async (req, res) => {
    const result = contactSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: result.error.flatten() });
    }
    const contact = await prisma_1.prisma.contact.upsert({
        where: {
            tenantId_phone: { tenantId: req.tenant.id, phone: result.data.phone },
        },
        update: { name: result.data.name, notes: result.data.notes },
        create: { tenantId: req.tenant.id, ...result.data },
    });
    res.status(201).json(contact);
});
// POST /contacts/import (CSV)
router.post("/import", upload.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: "No file uploaded" });
    const rows = await (0, csvtojson_1.default)().fromString(req.file.buffer.toString("utf-8"));
    const results = { imported: 0, skipped: 0, errors: [] };
    for (const row of rows) {
        const raw = {
            name: row.name || row.Name,
            phone: row.phone || row.Phone || row.number || row.Number,
            notes: row.notes,
        };
        const parsed = contactSchema.safeParse(raw);
        if (!parsed.success) {
            results.skipped++;
            results.errors.push(`Row ${JSON.stringify(raw)}: ${parsed.error.issues[0].message}`);
            continue;
        }
        try {
            await prisma_1.prisma.contact.upsert({
                where: {
                    tenantId_phone: {
                        tenantId: req.tenant.id,
                        phone: parsed.data.phone,
                    },
                },
                update: { name: parsed.data.name, notes: parsed.data.notes },
                create: { tenantId: req.tenant.id, ...parsed.data },
            });
            results.imported++;
        }
        catch {
            results.skipped++;
        }
    }
    res.json(results);
});
// PUT /contacts/:id
router.put("/:id", async (req, res) => {
    const contact = await prisma_1.prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!contact)
        return res.status(404).json({ error: "Contact not found" });
    const result = contactSchema.partial().safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ error: result.error.flatten() });
    const updated = await prisma_1.prisma.contact.update({
        where: { id: req.params.id },
        data: result.data,
    });
    res.json(updated);
});
// DELETE /contacts/:id
router.delete("/:id", async (req, res) => {
    const contact = await prisma_1.prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!contact)
        return res.status(404).json({ error: "Contact not found" });
    await prisma_1.prisma.contact.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});
exports.default = router;
