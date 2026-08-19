import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { idParam } from "../lib/params";
import { findOrCreateBrand } from "../lib/brand-resolve";

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

const REGIONS = ["North", "South", "East", "West", "Central"] as const;
const PROPERTY_TYPES = ["Resort", "Hotel"] as const;
const DEVELOPMENT_TYPES = ["Brownfield", "Greenfield"] as const;

const propertySchema = z.object({
  brandName: z.string().min(1).max(255),
  parentGroup: z.string().min(1).max(100),
  srNo: z.number().int().nullish(),
  name: z.string().min(1).max(255),
  region: z.enum(REGIONS),
  state: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  propertyType: z.enum(PROPERTY_TYPES),
  developmentType: z.enum(DEVELOPMENT_TYPES),
  operatedBy: z.string().min(1).max(255),
  starCategory: z.number().int().min(1).max(5),
  roomCount: z.number().int().positive(),
  openingYear: z.number().int().nullish(),
  capexDeployed: z.number().nonnegative().optional(),
  carbonSavingKg: z.number().nonnegative().optional(),
  icpModel: z.string().max(50).nullish(),
  sourceUrl: z.string().max(10000).nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});

propertiesRouter.post("/", requireRole("admin", "sales_head"), async (req, res) => {
  const parsed = propertySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = BigInt(req.user!.id);
  const { brandName, parentGroup, ...fields } = parsed.data;
  const brand = await findOrCreateBrand(prisma, brandName, parentGroup, userId);

  const property = await prisma.property.create({
    data: { ...fields, brandId: brand.id, createdById: userId },
    include: { brand: { select: { id: true, name: true, parentGroup: true } } },
  });
  res.status(201).json({ property });
});

const propertyUpdateSchema = propertySchema.partial();

propertiesRouter.patch("/:id", requireRole("admin", "sales_head"), async (req, res) => {
  const parsed = propertyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = BigInt(req.user!.id);
  const { brandName, parentGroup, ...fields } = parsed.data;

  let brandId: bigint | undefined;
  if (brandName && parentGroup) {
    const brand = await findOrCreateBrand(prisma, brandName, parentGroup, userId);
    brandId = brand.id;
  }

  const property = await prisma.property.update({
    where: { id: idParam(req.params.id) },
    data: { ...fields, ...(brandId ? { brandId } : {}), updatedById: userId },
    include: { brand: { select: { id: true, name: true, parentGroup: true } } },
  });
  res.json({ property });
});

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
