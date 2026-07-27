import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { similarity } from "../lib/fuzzy-match";
import { idParam } from "../lib/params";

export const qcSitesRouter = Router();

const REGIONS = ["North", "South", "East", "West", "Central"] as const;
const CATEGORIES = ["Healthcare", "Hospitality"] as const;
const MODEL_TYPES = ["OPL", "Outsourcing", "Rental"] as const;

qcSitesRouter.get("/", requireAuth, async (req, res) => {
  const { region, category } = req.query;
  const sites = await prisma.qcOperationalSite.findMany({
    where: {
      ...(typeof region === "string" ? { region: region as (typeof REGIONS)[number] } : {}),
      ...(typeof category === "string" ? { category: category as (typeof CATEGORIES)[number] } : {}),
    },
    include: { matchedProperty: { select: { id: true, name: true, city: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ sites });
});

const qcSiteSchema = z.object({
  siteCode: z.string().min(1).max(20),
  clientCode: z.string().max(20).nullish(),
  siteName: z.string().min(1).max(255),
  state: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  region: z.enum(REGIONS),
  parentBrand: z.string().min(1).max(120),
  brand: z.string().max(120).nullish(),
  category: z.enum(CATEGORIES),
  starCategory: z.number().int().min(1).max(5).nullish(),
  owningCompany: z.string().max(255).nullish(),
  propertyStartDate: z.string().datetime().nullish().or(z.literal("").transform(() => null)),
  qcOpsStartDate: z.string().datetime().nullish().or(z.literal("").transform(() => null)),
  roomBedCount: z.number().int().positive().nullish(),
  status: z.string().max(50).optional(),
  propertyType: z.string().max(50).nullish(),
  modelType: z.enum(MODEL_TYPES),
});

qcSitesRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = qcSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const site = await prisma.qcOperationalSite.create({
      data: {
        ...parsed.data,
        propertyStartDate: parsed.data.propertyStartDate ? new Date(parsed.data.propertyStartDate) : null,
        qcOpsStartDate: parsed.data.qcOpsStartDate ? new Date(parsed.data.qcOpsStartDate) : null,
        status: parsed.data.status ?? "Operational",
        createdById: BigInt(req.user!.id),
      },
    });
    res.status(201).json({ site });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "A site with this site code already exists" });
    }
    throw err;
  }
});

const qcSiteUpdateSchema = qcSiteSchema.partial();

qcSitesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = qcSiteUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { propertyStartDate, qcOpsStartDate, ...rest } = parsed.data;

  try {
    const site = await prisma.qcOperationalSite.update({
      where: { id: idParam(req.params.id) },
      data: {
        ...rest,
        ...(propertyStartDate !== undefined
          ? { propertyStartDate: propertyStartDate ? new Date(propertyStartDate) : null }
          : {}),
        ...(qcOpsStartDate !== undefined
          ? { qcOpsStartDate: qcOpsStartDate ? new Date(qcOpsStartDate) : null }
          : {}),
        updatedById: BigInt(req.user!.id),
      },
    });
    res.json({ site });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "A site with this site code already exists" });
    }
    throw err;
  }
});

qcSitesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.qcOperationalSite.delete({ where: { id: idParam(req.params.id) } });
  res.json({ ok: true });
});

qcSitesRouter.get("/:id/match-suggestions", requireRole("admin"), async (req, res) => {
  const site = await prisma.qcOperationalSite.findUnique({ where: { id: idParam(req.params.id) } });
  if (!site) return res.status(404).json({ error: "Site not found" });

  const candidates = await prisma.property.findMany({
    where: { city: site.city },
    select: { id: true, name: true, city: true, state: true, roomCount: true },
    take: 500,
  });

  // If nothing matches on city, widen to the whole table so a typo'd city
  // doesn't hide an otherwise-obvious name match.
  const pool = candidates.length > 0 ? candidates : await prisma.property.findMany({
    select: { id: true, name: true, city: true, state: true, roomCount: true },
    take: 500,
  });

  const scored = pool
    .map((p) => ({
      property: p,
      score: similarity(site.siteName, p.name) + (p.city === site.city ? 0.15 : 0),
    }))
    .filter((s) => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  res.json({ suggestions: scored });
});

const matchSchema = z.object({
  propertyId: z.string().min(1),
});

qcSitesRouter.post("/:id/match", requireRole("admin"), async (req, res) => {
  const parsed = matchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "propertyId is required" });
  }

  const property = await prisma.property.findUnique({ where: { id: BigInt(parsed.data.propertyId) } });
  if (!property) return res.status(404).json({ error: "Property not found" });

  const site = await prisma.qcOperationalSite.update({
    where: { id: idParam(req.params.id) },
    data: { matchedPropertyId: property.id, updatedById: BigInt(req.user!.id) },
  });

  res.json({ site });
});
