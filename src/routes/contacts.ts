// @ts-nocheck
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { z } from "zod";
import { AuthenticatedRequest } from "../types";
import csvtojson from "csvtojson";
import multer from "multer";

// npm install multer @types/multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const router = Router();

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

function isValidPhone(phone: string): boolean {
  // Allow Twilio magic test numbers
  if (ALLOWED_TEST_NUMBERS.includes(phone)) return true;
  // Allow strict Maldivian numbers: +9607xxxxxx or +9609xxxxxx
  return /^\+960[79]\d{6}$/.test(phone);
}

function normalizePhone(raw: string): string {
  let phone = raw.replace(/[\s\-\(\)]/g, "");
  if (!phone.startsWith("+")) {
    phone = phone.startsWith("960") ? `+${phone}` : `+960${phone}`;
  }
  return phone;
}

const contactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().transform(normalizePhone).refine(isValidPhone, {
    message:
      "Invalid phone number. Must be a Maldivian number (+9607xxxxxx or +9609xxxxxx) or Twilio test number",
  }),
  notes: z.string().optional(),
});

// GET /contacts
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const search = req.query.search as string;

  const where = {
    tenantId: req.tenant.id,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search } },
      ],
    }),
  };

  const [contacts, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.count({ where }),
  ]);

  res.json({ contacts, total, page, pages: Math.ceil(total / limit) });
});

// POST /contacts
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const result = contactSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  const contact = await prisma.contact.upsert({
    where: {
      tenantId_phone: { tenantId: req.tenant.id, phone: result.data.phone },
    },
    update: { name: result.data.name, notes: result.data.notes },
    create: { tenantId: req.tenant.id, ...result.data },
  });

  res.status(201).json(contact);
});

// POST /contacts/import (CSV)
router.post(
  "/import",
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rows = await csvtojson().fromString(
      req.file.buffer.toString("utf-8"),
    );

    const results = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const row of rows) {
      const raw = {
        name: row.name || row.Name,
        phone: row.phone || row.Phone || row.number || row.Number,
        notes: row.notes,
      };
      const parsed = contactSchema.safeParse(raw);

      if (!parsed.success) {
        results.skipped++;
        results.errors.push(
          `Row ${JSON.stringify(raw)}: ${parsed.error.issues[0].message}`,
        );
        continue;
      }

      try {
        await prisma.contact.upsert({
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
      } catch {
        results.skipped++;
      }
    }

    res.json(results);
  },
);

// PUT /contacts/:id
router.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
  });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  const result = contactSchema.partial().safeParse(req.body);
  if (!result.success)
    return res.status(400).json({ error: result.error.flatten() });

  const updated = await prisma.contact.update({
    where: { id: req.params.id },
    data: result.data,
  });

  res.json(updated);
});

// DELETE /contacts/:id
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
  });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  await prisma.contact.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
