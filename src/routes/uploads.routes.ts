import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/auth";
import { parseTamWorkbook } from "../lib/tam-parser";
import { putPendingUpload, getPendingUpload, deletePendingUpload } from "../lib/upload-store";
import type { Prisma } from "@prisma/client";

export const uploadsRouter = Router();
uploadsRouter.use(requireRole("admin"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const SHEET_NAME_TO_ENUM: Record<string, Prisma.UploadReferenceArchiveCreateInput["sheetName"]> = {
  "QC Average": "QC_Average",
  "IHCL Average": "IHCL_Average",
  "Data Validation": "Data_Validation",
};

uploadsRouter.get("/", async (_req, res) => {
  const uploads = await prisma.upload.findMany({
    include: { brand: { select: { name: true, parentGroup: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ uploads });
});

const tamUploadSchema = z.object({
  brandId: z.string().min(1),
});

uploadsRouter.post("/tam", upload.single("file"), async (req, res) => {
  const parsedBody = tamUploadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "brandId is required" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (!/\.(csv|xlsx|xls)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: "Only .csv, .xlsx, or .xls files are supported" });
  }

  const brandId = BigInt(parsedBody.data.brandId);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) {
    return res.status(404).json({ error: "Brand not found" });
  }

  let parsed;
  try {
    parsed = parseTamWorkbook(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read this file — is it a valid CSV/XLSX?" });
  }

  if (!parsed.propertiesSheetName) {
    return res.status(400).json({ error: "Could not find a properties sheet in this file" });
  }

  const uploadRow = await prisma.upload.create({
    data: {
      brandId,
      type: "TAM",
      filename: req.file.originalname,
      status: "previewed",
      createdById: BigInt(req.user!.id),
    },
  });

  putPendingUpload(uploadRow.id.toString(), parsed);

  const validRows = parsed.rows.filter((r) => r.errors.length === 0);
  const srNosToCheck = validRows.map((r) => r.srNo).filter((n): n is number => n !== null);
  const existing = srNosToCheck.length
    ? await prisma.property.findMany({
        where: { brandId, srNo: { in: srNosToCheck } },
        select: { srNo: true },
      })
    : [];
  const existingSrNos = new Set(existing.map((e) => e.srNo));

  const updateCount = validRows.filter((r) => r.srNo !== null && existingSrNos.has(r.srNo)).length;
  const newCount = validRows.length - updateCount;

  const referenceSummary = Object.entries(
    parsed.referenceRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.sheetName] = (acc[r.sheetName] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([sheetName, count]) => ({ sheetName, count }));

  res.status(201).json({
    upload: { id: uploadRow.id, filename: uploadRow.filename, status: uploadRow.status },
    preview: {
      propertiesSheetName: parsed.propertiesSheetName,
      totalRows: parsed.rows.length,
      validCount: validRows.length,
      errorCount: parsed.rows.length - validRows.length,
      newCount,
      updateCount,
      errorRows: parsed.rows
        .filter((r) => r.errors.length > 0)
        .slice(0, 200)
        .map((r) => ({ rowNumber: r.rowNumber, srNo: r.srNo, errors: r.errors })),
      referenceSheets: referenceSummary,
      ignoredSheetNames: parsed.ignoredSheetNames,
    },
  });
});

uploadsRouter.get("/:id/preview", async (req, res) => {
  const uploadRow = await prisma.upload.findUnique({ where: { id: BigInt(req.params.id) } });
  if (!uploadRow) return res.status(404).json({ error: "Upload not found" });

  const pending = getPendingUpload(req.params.id);
  if (!pending) {
    return res.status(410).json({
      error: "Preview data is no longer available (server restarted or already committed) — please re-upload.",
    });
  }

  const validRows = pending.rows.filter((r) => r.errors.length === 0);
  res.json({
    upload: { id: uploadRow.id, filename: uploadRow.filename, status: uploadRow.status },
    preview: {
      totalRows: pending.rows.length,
      validCount: validRows.length,
      errorRows: pending.rows.filter((r) => r.errors.length > 0),
    },
  });
});

uploadsRouter.post("/:id/commit", async (req, res) => {
  const uploadId = BigInt(req.params.id);
  const uploadRow = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!uploadRow) return res.status(404).json({ error: "Upload not found" });
  if (uploadRow.status !== "previewed") {
    return res.status(400).json({ error: `Upload is already ${uploadRow.status}` });
  }

  const pending = getPendingUpload(req.params.id);
  if (!pending) {
    return res.status(409).json({
      error: "Preview data is no longer available (server restarted) — please re-upload.",
    });
  }

  const validRows = pending.rows.filter((r) => r.errors.length === 0 && r.data);
  const userId = BigInt(req.user!.id);

  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;

    for (const row of validRows) {
      const data = row.data!;
      const sourceUrl = data.srNo !== null ? pending.sourceUrlBySrNo.get(data.srNo) ?? null : null;

      const existing =
        data.srNo !== null
          ? await tx.property.findFirst({ where: { brandId: uploadRow.brandId, srNo: data.srNo } })
          : null;

      const fields = {
        name: data.name,
        region: data.region,
        state: data.state,
        city: data.city,
        propertyType: data.propertyType,
        developmentType: data.developmentType,
        operatedBy: data.operatedBy,
        starCategory: data.starCategory,
        roomCount: data.roomCount,
        openingYear: data.openingYear,
        capexDeployed: data.capexDeployed,
        ...(sourceUrl ? { sourceUrl } : {}),
      };

      if (existing) {
        await tx.property.update({
          where: { id: existing.id },
          data: { ...fields, uploadId, updatedById: userId },
        });
        updated += 1;
      } else {
        await tx.property.create({
          data: {
            ...fields,
            srNo: data.srNo,
            brandId: uploadRow.brandId,
            uploadId,
            createdById: userId,
          },
        });
        created += 1;
      }
    }

    for (const refRow of pending.referenceRows) {
      await tx.uploadReferenceArchive.create({
        data: {
          uploadId,
          sheetName: SHEET_NAME_TO_ENUM[refRow.sheetName],
          srNo: refRow.srNo,
          rawRow: refRow.raw as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
    }

    await tx.upload.update({
      where: { id: uploadId },
      data: { status: "committed", rowCount: validRows.length, updatedById: userId },
    });

    return { created, updated, archived: pending.referenceRows.length };
  });

  deletePendingUpload(req.params.id);
  res.json(result);
});

uploadsRouter.delete("/:id", async (req, res) => {
  const uploadRow = await prisma.upload.findUnique({ where: { id: BigInt(req.params.id) } });
  if (!uploadRow) return res.status(404).json({ error: "Upload not found" });
  if (uploadRow.status !== "previewed") {
    return res.status(400).json({ error: "Only a previewed (not yet committed) upload can be discarded" });
  }

  await prisma.upload.delete({ where: { id: uploadRow.id } });
  deletePendingUpload(req.params.id);
  res.json({ ok: true });
});

uploadsRouter.get("/:id/reference", async (req, res) => {
  const rows = await prisma.uploadReferenceArchive.findMany({
    where: { uploadId: BigInt(req.params.id) },
    orderBy: [{ sheetName: "asc" }, { srNo: "asc" }],
  });
  res.json({ rows });
});
