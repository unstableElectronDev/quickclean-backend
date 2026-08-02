import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import type { Prisma } from "@prisma/client";
import { loadBenchmarkTable, annualLoadMT, agingBucket } from "../lib/calc-engine";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/overview", async (req, res) => {
  const { parentGroup, brandId, region, state, city, starCategory, operatedBy, propertyType, developmentType } =
    req.query;

  const where: Prisma.PropertyWhereInput = {
    ...(typeof parentGroup === "string" && parentGroup ? { brand: { parentGroup } } : {}),
    ...(typeof brandId === "string" && brandId ? { brandId: BigInt(brandId) } : {}),
    ...(typeof region === "string" && region ? { region: region as Prisma.EnumRegionFilter["equals"] } : {}),
    ...(typeof state === "string" && state ? { state } : {}),
    ...(typeof city === "string" && city ? { city } : {}),
    ...(typeof starCategory === "string" && starCategory ? { starCategory: Number(starCategory) } : {}),
    ...(typeof operatedBy === "string" && operatedBy ? { operatedBy } : {}),
    ...(typeof propertyType === "string" && propertyType
      ? { propertyType: propertyType as Prisma.EnumPropertyTypeFilter["equals"] }
      : {}),
    ...(typeof developmentType === "string" && developmentType
      ? { developmentType: developmentType as Prisma.EnumDevelopmentTypeFilter["equals"] }
      : {}),
  };

  const properties = await prisma.property.findMany({
    where,
    select: {
      id: true,
      city: true,
      state: true,
      region: true,
      roomCount: true,
      developmentType: true,
      starCategory: true,
      brand: { select: { id: true, name: true, parentGroup: true } },
    },
  });

  const totals = {
    properties: properties.length,
    rooms: properties.reduce((sum, p) => sum + p.roomCount, 0),
  };

  const byRegionMap = new Map<string, number>();
  for (const p of properties) {
    byRegionMap.set(p.region, (byRegionMap.get(p.region) ?? 0) + 1);
  }
  const byRegion = [...byRegionMap.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  const cityKey = (city: string, state: string) => `${city}::${state}`;
  const byCityMap = new Map<
    string,
    { city: string; state: string; region: string; brownfield: number; greenfield: number; total: number; rooms: number }
  >();
  for (const p of properties) {
    const key = cityKey(p.city, p.state);
    const entry = byCityMap.get(key) ?? {
      city: p.city,
      state: p.state,
      region: p.region,
      brownfield: 0,
      greenfield: 0,
      total: 0,
      rooms: 0,
    };
    if (p.developmentType === "Brownfield") entry.brownfield += 1;
    else entry.greenfield += 1;
    entry.total += 1;
    entry.rooms += p.roomCount;
    byCityMap.set(key, entry);
  }
  const byCity = [...byCityMap.values()].sort((a, b) => b.total - a.total);

  const byBrandMap = new Map<string, { brand: string; parentGroup: string; count: number; starCounts: Map<number, number> }>();
  for (const p of properties) {
    const key = p.brand.name;
    const entry = byBrandMap.get(key) ?? {
      brand: p.brand.name,
      parentGroup: p.brand.parentGroup,
      count: 0,
      starCounts: new Map<number, number>(),
    };
    entry.count += 1;
    entry.starCounts.set(p.starCategory, (entry.starCounts.get(p.starCategory) ?? 0) + 1);
    byBrandMap.set(key, entry);
  }
  const byBrand = [...byBrandMap.values()]
    .map((b) => {
      // Dominant star category for this brand (most common among its properties).
      let dominantStar = 0;
      let bestCount = -1;
      for (const [star, count] of b.starCounts) {
        if (count > bestCount) {
          bestCount = count;
          dominantStar = star;
        }
      }
      return { brand: b.brand, parentGroup: b.parentGroup, count: b.count, starCategory: dominantStar };
    })
    .sort((a, b) => b.count - a.count);

  const brandsByStar = new Map<number, Array<{ brand: string; count: number }>>();
  for (const b of byBrand) {
    const list = brandsByStar.get(b.starCategory) ?? [];
    list.push({ brand: b.brand, count: b.count });
    brandsByStar.set(b.starCategory, list);
  }
  const brandsByStarSorted = [...brandsByStar.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([starCategory, brands]) => ({
      starCategory,
      brands: brands.sort((a, b) => b.count - a.count),
    }));

  res.json({ totals, byRegion, byCity, byBrand, brandsByStar: brandsByStarSorted });
});

// "QC at <client>" — how much of a client group's portfolio QuickClean
// actually operates today, using the real matched_property_id link (set via
// the Current Sites fuzzy-match flow), not a guess.
dashboardRouter.get("/qc-penetration", async (req, res) => {
  const { parentGroup } = req.query;
  if (typeof parentGroup !== "string" || !parentGroup) {
    return res.status(400).json({ error: "parentGroup is required" });
  }

  const benchmarks = await loadBenchmarkTable(parentGroup);

  const properties = await prisma.property.findMany({
    where: { brand: { parentGroup } },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      roomCount: true,
      propertyType: true,
      developmentType: true,
      operatedBy: true,
      starCategory: true,
      openingYear: true,
      brand: { select: { name: true } },
      qcSitesMatched: { select: { id: true } },
    },
  });

  const withLoad = properties.map((p) => {
    const perRoomLoadKg = benchmarks.get(`${p.starCategory}:${p.propertyType}`) ?? null;
    const loadMT = perRoomLoadKg !== null ? annualLoadMT(p.roomCount, perRoomLoadKg) : null;
    return { ...p, loadMT, isQcOperated: p.qcSitesMatched.length > 0 };
  });

  const totals = {
    properties: withLoad.length,
    rooms: withLoad.reduce((sum, p) => sum + p.roomCount, 0),
    loadMT: withLoad.reduce((sum, p) => sum + (p.loadMT ?? 0), 0),
  };

  const qcOperated = withLoad.filter((p) => p.isQcOperated);
  const qc = {
    properties: qcOperated.length,
    rooms: qcOperated.reduce((sum, p) => sum + p.roomCount, 0),
    loadMT: qcOperated.reduce((sum, p) => sum + (p.loadMT ?? 0), 0),
  };

  const cityKey = (city: string, state: string) => `${city}::${state}`;
  const byCityMap = new Map<
    string,
    { city: string; state: string; brownfield: number; greenfield: number; total: number }
  >();
  for (const p of qcOperated) {
    const key = cityKey(p.city, p.state);
    const entry = byCityMap.get(key) ?? { city: p.city, state: p.state, brownfield: 0, greenfield: 0, total: 0 };
    if (p.developmentType === "Brownfield") entry.brownfield += 1;
    else entry.greenfield += 1;
    entry.total += 1;
    byCityMap.set(key, entry);
  }
  const byCity = [...byCityMap.values()].sort((a, b) => b.total - a.total);

  const directory = qcOperated
    .map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand.name,
      propertyType: p.propertyType,
      developmentType: p.developmentType,
      starCategory: p.starCategory,
      city: p.city,
      state: p.state,
      roomCount: p.roomCount,
      loadMT: p.loadMT !== null ? Math.round(p.loadMT) : null,
      operatedBy: p.operatedBy,
      aging: agingBucket(p.openingYear),
    }))
    .sort((a, b) => (b.loadMT ?? 0) - (a.loadMT ?? 0));

  res.json({ totals, qc, byCity, directory, loadAssumption: "100% occupancy (real occupancy rates not configured)" });
});
