import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { idParam } from "../lib/params";

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

propertiesRouter.get("/", async (req, res) => {
  const { parentGroup, brandId, region, propertyType, q } = req.query;

  const properties = await prisma.property.findMany({
    where: {
      ...(typeof parentGroup === "string" && parentGroup ? { brand: { parentGroup } } : {}),
      ...(typeof brandId === "string" && brandId ? { brandId: idParam(brandId) } : {}),
      ...(typeof region === "string" && region ? { region: region as never } : {}),
      ...(typeof propertyType === "string" && propertyType ? { propertyType: propertyType as never } : {}),
      ...(typeof q === "string" && q
        ? { OR: [{ name: { contains: q } }, { city: { contains: q } }, { state: { contains: q } }] }
        : {}),
    },
    include: { brand: { select: { id: true, name: true, parentGroup: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 20000,
  });

  res.json({ properties });
});

propertiesRouter.get("/:id/reference", async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { id: idParam(req.params.id) },
    include: { brand: true },
  });
  if (!property) return res.status(404).json({ error: "Property not found" });

  if (property.srNo === null) {
    return res.json({ rows: [] });
  }

  const rows = await prisma.uploadReferenceArchive.findMany({
    where: {
      srNo: property.srNo,
      upload: { parentGroup: property.brand.parentGroup },
    },
    orderBy: [{ sheetName: "asc" }, { createdAt: "desc" }],
  });

  // A re-uploaded Brand File archives this property's row again under each
  // sheet — keep only the most recent row per sheet (rows are already
  // grouped by sheetName then newest-first within the group).
  const seenSheet = new Set<string>();
  const deduped = rows.filter((r) => {
    if (seenSheet.has(r.sheetName)) return false;
    seenSheet.add(r.sheetName);
    return true;
  });

  res.json({ rows: deduped });
});

propertiesRouter.get("/:id", async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { id: idParam(req.params.id) },
    include: { brand: { select: { id: true, name: true, parentGroup: true } } },
  });
  if (!property) return res.status(404).json({ error: "Property not found" });
  res.json({ property });
});
