import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import type { Prisma } from "@prisma/client";

export const referenceDataRouter = Router();
referenceDataRouter.use(requireAuth);

const SHEET_NAMES = ["QC_Average", "Brand_Average", "Data_Validation"] as const;

referenceDataRouter.get("/", async (req, res) => {
  const { sheetName, parentGroup } = req.query;
  if (typeof sheetName !== "string" || !SHEET_NAMES.includes(sheetName as (typeof SHEET_NAMES)[number])) {
    return res.status(400).json({ error: "sheetName must be one of: " + SHEET_NAMES.join(", ") });
  }

  const rows = await prisma.uploadReferenceArchive.findMany({
    where: {
      sheetName: sheetName as Prisma.UploadReferenceArchiveWhereInput["sheetName"],
      ...(typeof parentGroup === "string" && parentGroup ? { upload: { parentGroup } } : {}),
    },
    include: { upload: { select: { filename: true, parentGroup: true, createdAt: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 20000,
  });

  // Re-uploading the same Brand File archives a fresh set of reference rows
  // each time (no upsert on this table, unlike Properties) — a property
  // uploaded twice shows up here twice. Since rows are already ordered
  // newest-first, keep only the first (most recent) row per Sr. No.; rows
  // with no Sr. No. (summary/pivot rows) have no dedup key and pass through.
  const seenSrNo = new Set<number>();
  const deduped = rows.filter((r) => {
    if (r.srNo === null) return true;
    if (seenSrNo.has(r.srNo)) return false;
    seenSrNo.add(r.srNo);
    return true;
  });

  res.json({ rows: deduped });
});
