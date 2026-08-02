import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import type { Prisma } from "@prisma/client";

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
