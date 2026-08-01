import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/auth";
import { idParam } from "../lib/params";
import { findBrand, findOrCreateBrand } from "../lib/brand-resolve";
import {
  FILE_TYPES,
  PARENT_GROUP_SCOPED_TYPES,
  parseBrandFile,
  parseCurrentSitesFile,
  parsePipelineLeadsFile,
  type PropertyRowData,
  type ReferenceRowData,
  type ReferenceKind,
  type ParsedRow,
} from "../lib/upload-parsers";
import { putPendingUpload, getPendingUpload, deletePendingUpload, type PendingUpload } from "../lib/upload-store";
import type { Prisma } from "@prisma/client";

export const uploadsRouter = Router();
uploadsRouter.use(requireRole("admin"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ARCHIVE_SHEET_NAME: Record<ReferenceKind, Prisma.UploadReferenceArchiveCreateInput["sheetName"]> = {
  QC_Average: "QC_Average",
  Brand_Average: "Brand_Average",
  Data_Validation: "Data_Validation",
};

uploadsRouter.get("/", async (_req, res) => {
  const uploads = await prisma.upload.findMany({
    include: { brand: { select: { name: true, parentGroup: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ uploads });
});

const uploadBodySchema = z.object({
  fileType: z.enum(FILE_TYPES),
  parentGroup: z.string().min(1).max(100).optional(),
});

uploadsRouter.post("/", upload.single("file"), async (req, res) => {
  const parsedBody = uploadBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "fileType is required and must be one of: " + FILE_TYPES.join(", ") });
  }
  const { fileType, parentGroup } = parsedBody.data;

  if (PARENT_GROUP_SCOPED_TYPES.includes(fileType) && !parentGroup) {
    return res.status(400).json({ error: `${fileType} uploads require a Parent Group` });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (!/\.(csv|xlsx|xls)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: "Only .csv, .xlsx, or .xls files are supported" });
  }

  let pending: PendingUpload;
  let preview: Record<string, unknown>;

  try {
    switch (fileType) {
      case "BRAND_FILE": {
        const result = parseBrandFile(req.file.buffer);
        pending = { fileType, parentGroup: parentGroup!, properties: result.properties, reference: result.reference };
        preview = await buildBrandFilePreview(result, parentGroup!);
        break;
      }
      case "CURRENT_SITES": {
        const { rows } = parseCurrentSitesFile(req.file.buffer);
        pending = { fileType, rows };
        preview = await buildCurrentSitesPreview(rows);
        break;
      }
      case "LEADS_PIPELINE": {
        const { rows } = parsePipelineLeadsFile(req.file.buffer);
        pending = { fileType, rows };
        const validCount = rows.filter((r) => r.errors.length === 0).length;
        preview = {
          totalRows: rows.length,
          validCount,
          errorCount: rows.length - validCount,
          errorRows: rows.filter((r) => r.errors.length > 0).slice(0, 200),
        };
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this file — is it a valid CSV/XLSX?";
    return res.status(400).json({ error: message });
  }

  const uploadRow = await prisma.upload.create({
    data: {
      type: fileType,
      parentGroup: parentGroup ?? null,
      filename: req.file.originalname,
      status: "previewed",
      createdById: BigInt(req.user!.id),
    },
  });

  putPendingUpload(uploadRow.id.toString(), pending);

  res.status(201).json({
    upload: { id: uploadRow.id, filename: uploadRow.filename, status: uploadRow.status, fileType },
    preview,
  });
});

async function buildPropertiesSummary(rows: ParsedRow<PropertyRowData>[], parentGroup: string) {
  const validRows = rows.filter((r) => r.errors.length === 0 && r.data);
  const brandNames = [...new Set(validRows.map((r) => r.data!.brandName))];
  const existingBrands = brandNames.length
    ? await prisma.brand.findMany({
        where: { parentGroup, name: { in: brandNames } },
        select: { id: true, name: true },
      })
    : [];
  const brandIdByName = new Map(existingBrands.map((b) => [b.name, b.id]));

  let updateCount = 0;
  if (existingBrands.length > 0) {
    const srNos = validRows.map((r) => r.data!.srNo).filter((n): n is number => n !== null);
    if (srNos.length > 0) {
      const existingProps = await prisma.property.findMany({
        where: { brandId: { in: existingBrands.map((b) => b.id) }, srNo: { in: srNos } },
        select: { brandId: true, srNo: true },
      });
      const existingKeys = new Set(existingProps.map((p) => `${p.brandId}:${p.srNo}`));
      updateCount = validRows.filter((r) => {
        const brandId = brandIdByName.get(r.data!.brandName);
        return brandId !== undefined && r.data!.srNo !== null && existingKeys.has(`${brandId}:${r.data!.srNo}`);
      }).length;
    }
  }

  return {
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: rows.length - validRows.length,
    newCount: validRows.length - updateCount,
    updateCount,
    newBrandNames: brandNames.filter((n) => !brandIdByName.has(n)),
    errorRows: rows.filter((r) => r.errors.length > 0).slice(0, 200),
  };
}

// Reference sheets (QC Average / Brand Average / Data Validation) usually
// arrive alongside brand-new Properties rows in the same file — those
// properties don't exist in the DB yet at preview time, so a "matched
// against the DB" count would always read 0 regardless of whether the file
// is actually fine. Real matching happens at commit time, within the same
// transaction as the Properties rows being created — this is just a count.
function buildReferenceSummary(rows: ParsedRow<ReferenceRowData>[]) {
  return { totalRows: rows.length };
}

async function buildBrandFilePreview(result: Awaited<ReturnType<typeof parseBrandFile>>, parentGroup: string) {
  const reference: Record<string, unknown> = {};
  for (const r of result.reference) {
    reference[r.kind] = buildReferenceSummary(r.rows);
  }

  return {
    sheetsFound: result.sheetsFound,
    sheetsNotFound: result.sheetsNotFound,
    properties: result.properties.length > 0 ? await buildPropertiesSummary(result.properties, parentGroup) : null,
    qcAverage: reference.QC_Average ?? null,
    brandAverage: reference.Brand_Average ?? null,
    dataValidation: reference.Data_Validation ?? null,
  };
}

async function buildCurrentSitesPreview(rows: Awaited<ReturnType<typeof parseCurrentSitesFile>>["rows"]) {
  const validRows = rows.filter((r) => r.errors.length === 0 && r.data);
  const siteCodes = validRows.map((r) => r.data!.siteCode);
  // site_code alone isn't unique (same code can recur for different
  // clients) — prefilter by siteCode, then match the exact pair in JS.
  const existing = siteCodes.length
    ? await prisma.qcOperationalSite.findMany({
        where: { siteCode: { in: siteCodes } },
        select: { siteCode: true, clientCode: true },
      })
    : [];
  const existingKeys = new Set(existing.map((e) => `${e.siteCode}:${e.clientCode}`));
  const updateCount = validRows.filter((r) => existingKeys.has(`${r.data!.siteCode}:${r.data!.clientCode}`)).length;

  return {
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: rows.length - validRows.length,
    newCount: validRows.length - updateCount,
    updateCount,
    errorRows: rows.filter((r) => r.errors.length > 0).slice(0, 200),
  };
}

uploadsRouter.get("/:id/preview", async (req, res) => {
  const uploadRow = await prisma.upload.findUnique({ where: { id: idParam(req.params.id) } });
  if (!uploadRow) return res.status(404).json({ error: "Upload not found" });

  const pending = getPendingUpload(req.params.id);
  if (!pending) {
    return res.status(410).json({
      error: "Preview data is no longer available (server restarted or already committed) — please re-upload.",
    });
  }

  if (pending.fileType === "BRAND_FILE") {
    const preview = await buildBrandFilePreview(
      { sheetsFound: [], sheetsNotFound: [], properties: pending.properties, reference: pending.reference },
      pending.parentGroup
    );
    return res.json({
      upload: { id: uploadRow.id, filename: uploadRow.filename, status: uploadRow.status, fileType: uploadRow.type },
      preview,
    });
  }

  const validRows = pending.rows.filter((r) => r.errors.length === 0);
  res.json({
    upload: { id: uploadRow.id, filename: uploadRow.filename, status: uploadRow.status, fileType: uploadRow.type },
    preview: {
      totalRows: pending.rows.length,
      validCount: validRows.length,
      errorRows: pending.rows.filter((r) => r.errors.length > 0),
    },
  });
});

uploadsRouter.post("/:id/commit", async (req, res) => {
  const uploadId = idParam(req.params.id);
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

  const userId = BigInt(req.user!.id);
  let rowCount = 0;

  const result = await prisma.$transaction(
    async (tx) => {
      switch (pending.fileType) {
        case "BRAND_FILE": {
          let propertiesCreated = 0;
          let propertiesUpdated = 0;

          for (const row of pending.properties) {
            if (row.errors.length > 0 || !row.data) continue;
            const data = row.data;
            const brand = await findOrCreateBrand(tx, data.brandName, pending.parentGroup, userId);
            const existing =
              data.srNo !== null ? await tx.property.findFirst({ where: { brandId: brand.id, srNo: data.srNo } }) : null;

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
            };

            if (existing) {
              await tx.property.update({ where: { id: existing.id }, data: { ...fields, uploadId, updatedById: userId } });
              propertiesUpdated += 1;
            } else {
              await tx.property.create({
                data: { ...fields, srNo: data.srNo, brandId: brand.id, uploadId, createdById: userId },
              });
              propertiesCreated += 1;
            }
            rowCount += 1;
          }

          let referenceArchived = 0;
          let referenceMatched = 0;

          for (const group of pending.reference) {
            for (const row of group.rows) {
              if (!row.data) continue;
              const { srNo, brandName, sourceUrl, raw } = row.data;

              if (brandName && srNo !== null) {
                const brand = await findBrand(tx, brandName, pending.parentGroup);
                if (brand) {
                  const property = await tx.property.findFirst({ where: { brandId: brand.id, srNo } });
                  if (property) {
                    referenceMatched += 1;
                    if (group.kind === "Data_Validation" && sourceUrl) {
                      await tx.property.update({ where: { id: property.id }, data: { sourceUrl, updatedById: userId } });
                    }
                  }
                }
              }

              await tx.uploadReferenceArchive.create({
                data: {
                  uploadId,
                  sheetName: ARCHIVE_SHEET_NAME[group.kind],
                  srNo,
                  rawRow: raw as Prisma.InputJsonValue,
                  createdById: userId,
                },
              });
              referenceArchived += 1;
              rowCount += 1;
            }
          }

          return { propertiesCreated, propertiesUpdated, referenceArchived, referenceMatched };
        }

        case "CURRENT_SITES": {
          let created = 0;
          let updated = 0;
          for (const row of pending.rows) {
            if (row.errors.length > 0 || !row.data) continue;
            const data = row.data;
            const existing = await tx.qcOperationalSite.findUnique({
              where: { siteCode_clientCode: { siteCode: data.siteCode, clientCode: data.clientCode } },
            });

            const fields = {
              siteName: data.siteName,
              state: data.state,
              city: data.city,
              region: data.region,
              parentBrand: data.parentBrand,
              brand: data.brand,
              category: data.category,
              starCategory: data.starCategory,
              owningCompany: data.owningCompany,
              propertyStartDate: data.propertyStartDate,
              qcOpsStartDate: data.qcOpsStartDate,
              roomBedCount: data.roomBedCount,
              propertyType: data.propertyType,
              modelType: data.modelType,
            };

            if (existing) {
              await tx.qcOperationalSite.update({ where: { id: existing.id }, data: { ...fields, updatedById: userId } });
              updated += 1;
            } else {
              await tx.qcOperationalSite.create({
                data: { ...fields, siteCode: data.siteCode, clientCode: data.clientCode, createdById: userId },
              });
              created += 1;
            }
            rowCount += 1;
          }
          return { created, updated };
        }

        case "LEADS_PIPELINE": {
          let created = 0;
          for (const row of pending.rows) {
            if (row.errors.length > 0 || !row.data) continue;
            const data = row.data;
            await tx.pipelineLead.create({
              data: { ...data, uploadId, createdById: userId },
            });
            created += 1;
            rowCount += 1;
          }
          return { created };
        }
      }
    },
    { timeout: 60000 }
  );

  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: "committed", rowCount, updatedById: userId },
  });

  deletePendingUpload(req.params.id);
  res.json(result);
});

uploadsRouter.delete("/:id", async (req, res) => {
  const uploadRow = await prisma.upload.findUnique({ where: { id: idParam(req.params.id) } });
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
    where: { uploadId: idParam(req.params.id) },
    orderBy: [{ sheetName: "asc" }, { srNo: "asc" }],
  });
  res.json({ rows });
});
