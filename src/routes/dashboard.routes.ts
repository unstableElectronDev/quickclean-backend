import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { getAllowedFilterKeys } from "../lib/filter-permissions";
import type { Prisma } from "@prisma/client";
import {
  loadBenchmarkTable,
  annualLoadMT,
  agingBucket,
  getQcAverageBenchmarkMap,
  getBrandAverageBenchmarkMap,
  BLENDED_STAR_CATEGORY,
  pickWithFallback,
  computePropertyRates,
  rolloutPhaseBucket,
  ROLLOUT_PHASE_ORDER,
} from "../lib/calc-engine";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/overview", async (req, res) => {
  const allowedFilters = await getAllowedFilterKeys(req.user!.role);
  // parentGroup and brandId are scope selectors, not restrictable filters —
  // every role needs them to pick which portfolio they're even looking at.
  const {
    parentGroup,
    brandId,
    region,
    state,
    city,
    starCategory,
    operatedBy,
    propertyType,
    developmentType,
    icpModel,
    aging,
    name,
  } = req.query;

  const where: Prisma.PropertyWhereInput = {
    ...(typeof parentGroup === "string" && parentGroup ? { brand: { parentGroup } } : {}),
    ...(typeof brandId === "string" && brandId ? { brandId: BigInt(brandId) } : {}),
    ...(allowedFilters.has("region") && typeof region === "string" && region
      ? { region: region as Prisma.EnumRegionFilter["equals"] }
      : {}),
    ...(allowedFilters.has("state") && typeof state === "string" && state ? { state } : {}),
    ...(allowedFilters.has("city") && typeof city === "string" && city ? { city } : {}),
    ...(allowedFilters.has("starCategory") && typeof starCategory === "string" && starCategory
      ? { starCategory: Number(starCategory) }
      : {}),
    ...(allowedFilters.has("operatedBy") && typeof operatedBy === "string" && operatedBy ? { operatedBy } : {}),
    // propertyType isn't a gated UI filter (no dashboard control for it today) — always honored, like parentGroup/brandId.
    ...(typeof propertyType === "string" && propertyType
      ? { propertyType: propertyType as Prisma.EnumPropertyTypeFilter["equals"] }
      : {}),
    ...(allowedFilters.has("developmentType") && typeof developmentType === "string" && developmentType
      ? { developmentType: developmentType as Prisma.EnumDevelopmentTypeFilter["equals"] }
      : {}),
    ...(allowedFilters.has("icpModel") && typeof icpModel === "string" && icpModel ? { icpModel } : {}),
    ...(allowedFilters.has("name") && typeof name === "string" && name ? { name } : {}),
  };

  const allMatching = await prisma.property.findMany({
    where,
    select: {
      id: true,
      city: true,
      state: true,
      region: true,
      roomCount: true,
      developmentType: true,
      starCategory: true,
      propertyType: true,
      openingYear: true,
      brand: { select: { id: true, name: true, parentGroup: true } },
    },
  });

  // Aging is a computed bucket (agingBucket, the same 4-bucket breakdown
  // used on QC Operations), not a stored column, so it's filtered in
  // memory after the DB query rather than in the Prisma where clause.
  const properties =
    allowedFilters.has("aging") && typeof aging === "string" && aging
      ? allMatching.filter((p) => agingBucket(p.openingYear) === aging)
      : allMatching;

  // Load uses room_load_benchmarks (parent-group-specific row if configured,
  // else the seeded GLOBAL fallback) at an explicit 100% occupancy
  // assumption. Water / Energy / Cost then apply QuickClean's own measured
  // per-kg rates (from each parent group's uploaded QC Average sheet, by
  // Star Category) to that load — i.e. "what QC's real rates project this
  // load would cost/consume," not a fabricated number and not a comparison.
  // A property only contributes if both its load AND a matching Star
  // Category rate are available — coverage is reported so the UI doesn't
  // imply full-portfolio precision it doesn't have.
  const distinctParentGroups = [...new Set(properties.map((p) => p.brand.parentGroup))];
  const loadTables = new Map(
    await Promise.all(distinctParentGroups.map(async (pg) => [pg, await loadBenchmarkTable(pg)] as const))
  );
  const qcRateTables = new Map(
    await Promise.all(distinctParentGroups.map(async (pg) => [pg, await getQcAverageBenchmarkMap(pg)] as const))
  );
  // Energy Saving = the brand's own baseline energy rate (Brand Average
  // sheet, per Star Category) minus QC's real measured rate, applied to
  // load. Only counts properties whose Star Category has BOTH a QC Average
  // and a Brand Average rate for this parent group — most parent groups
  // will have far fewer of these than the Water/Energy/Cost coverage above,
  // since Brand Average sheets are typically uploaded for fewer sites.
  const brandRateTables = new Map(
    await Promise.all(
      distinctParentGroups.map(async (pg) => [pg, await getBrandAverageBenchmarkMap(pg)] as const)
    )
  );

  let loadMT = 0;
  let loadCoveredProperties = 0;
  let waterKl = 0;
  let energyKwh = 0;
  let costInr = 0;
  let rateExactProperties = 0;
  let rateFallbackProperties = 0;
  let energySavingKwh = 0;
  let savingExactProperties = 0;
  let savingFallbackProperties = 0;

  for (const p of properties) {
    const perRoomLoadKg = loadTables.get(p.brand.parentGroup)?.get(`${p.starCategory}:${p.propertyType}`) ?? null;
    if (perRoomLoadKg === null) continue;
    loadCoveredProperties += 1;
    const propertyLoadMT = annualLoadMT(p.roomCount, perRoomLoadKg);
    loadMT += propertyLoadMT;
    const loadKg = propertyLoadMT * 1000;

    // Exact Star Category rate if this parent group's QC Average sheet has
    // one, else the blended (all-star) average — per FIELD, not per row,
    // since a real star's row can have some fields populated and others
    // blank (e.g. IHCL's 4-star QC Average rows have a Price but no
    // Energy Consumption reading at all). This is what gets every property
    // with a Load figure a Water/Energy/Cost figure too.
    const rateTable = qcRateTables.get(p.brand.parentGroup);
    const exactRates = rateTable?.get(p.starCategory);
    const blendedRates = rateTable?.get(BLENDED_STAR_CATEGORY);
    const water = pickWithFallback(exactRates?.avgWaterPerKg, blendedRates?.avgWaterPerKg);
    const energy = pickWithFallback(exactRates?.avgEnergyKwhPerKg, blendedRates?.avgEnergyKwhPerKg);
    const price = pickWithFallback(exactRates?.avgPricePerKg, blendedRates?.avgPricePerKg);
    if (water.value !== null || energy.value !== null || price.value !== null) {
      if (water.usedFallback || energy.usedFallback || price.usedFallback) rateFallbackProperties += 1;
      else rateExactProperties += 1;
      if (water.value !== null) waterKl += loadKg * water.value;
      if (energy.value !== null) energyKwh += loadKg * energy.value;
      if (price.value !== null) costInr += loadKg * price.value;
    }

    const brandTable = brandRateTables.get(p.brand.parentGroup);
    const exactBrandRates = brandTable?.get(p.starCategory);
    const blendedBrandRates = brandTable?.get(BLENDED_STAR_CATEGORY);
    const brandEnergy = pickWithFallback(exactBrandRates?.avgEnergyKwhPerKg, blendedBrandRates?.avgEnergyKwhPerKg);
    if (brandEnergy.value !== null && energy.value !== null) {
      if (brandEnergy.usedFallback || energy.usedFallback) savingFallbackProperties += 1;
      else savingExactProperties += 1;
      energySavingKwh += loadKg * (brandEnergy.value - energy.value);
    }
  }

  const totals = {
    properties: properties.length,
    rooms: properties.reduce((sum, p) => sum + p.roomCount, 0),
    loadMT: Math.round(loadMT),
    waterKl: Math.round(waterKl),
    energyKwh: Math.round(energyKwh),
    costInr: Math.round(costInr),
    energySavingKwh: Math.round(energySavingKwh),
  };
  const coverage = {
    load: { properties: loadCoveredProperties, total: properties.length },
    rates: {
      properties: rateExactProperties + rateFallbackProperties,
      exact: rateExactProperties,
      fallback: rateFallbackProperties,
      total: properties.length,
    },
    savings: {
      properties: savingExactProperties + savingFallbackProperties,
      exact: savingExactProperties,
      fallback: savingFallbackProperties,
      total: properties.length,
    },
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

  res.json({
    totals,
    byRegion,
    byCity,
    byBrand,
    brandsByStar: brandsByStarSorted,
    coverage,
    loadAssumption:
      "100% occupancy. Water/Energy/Cost apply QuickClean's own measured per-kg rates (from the uploaded QC Average sheet, by Star Category) to that load; Energy Saving compares that rate against the brand's own baseline (uploaded Brand Average sheet, same Star Category). Where a property's own Star Category has no uploaded rate, these fall back to a blended average across that parent group's other uploaded rates (coverage.rates.fallback / coverage.savings.fallback) — real data, just not Star-Category-specific.",
  });
});

// "QC at <client>" — how much of a client group's portfolio QuickClean
// actually operates today. A property counts as QC-operated if either: (a)
// it has a matching row in the uploaded QC Average sheet (joined by srNo +
// parentGroup, same as every other reference-sheet lookup in this app — the
// QC Average sheet IS QuickClean's own operated-site list), or (b) it has a
// confirmed matched_property_id from the Current Sites fuzzy-match flow.
// (a) is the primary signal since it needs no manual work; (b) fills in
// anything not covered by an uploaded QC Average sheet.
// Real distinct values for the Dashboard filter panel's dropdowns — State,
// City, Operated By, and ICP are free-text/varchar columns with no fixed
// enum, so their real options depend on what's actually been uploaded for
// this parent group.
dashboardRouter.get("/filter-options", async (req, res) => {
  const allowedFilters = await getAllowedFilterKeys(req.user!.role);
  const { parentGroup } = req.query;
  const where: Prisma.PropertyWhereInput =
    typeof parentGroup === "string" && parentGroup ? { brand: { parentGroup } } : {};

  const properties = await prisma.property.findMany({
    where,
    select: { state: true, city: true, operatedBy: true, icpModel: true, name: true },
  });

  const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort();

  res.json({
    states: allowedFilters.has("state") ? distinct(properties.map((p) => p.state)) : [],
    cities: allowedFilters.has("city") ? distinct(properties.map((p) => p.city)) : [],
    operatedBy: allowedFilters.has("operatedBy") ? distinct(properties.map((p) => p.operatedBy)) : [],
    icpModels: allowedFilters.has("icpModel") ? distinct(properties.map((p) => p.icpModel)) : [],
    names: allowedFilters.has("name") ? distinct(properties.map((p) => p.name)) : [],
  });
});

dashboardRouter.get("/qc-penetration", async (req, res) => {
  const { parentGroup } = req.query;
  if (typeof parentGroup !== "string" || !parentGroup) {
    return res.status(400).json({ error: "parentGroup is required" });
  }

  const benchmarks = await loadBenchmarkTable(parentGroup);

  const [properties, qcAverageRows] = await Promise.all([
    prisma.property.findMany({
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
        srNo: true,
        brand: { select: { name: true } },
        qcSitesMatched: { select: { id: true } },
      },
    }),
    prisma.uploadReferenceArchive.findMany({
      where: { sheetName: "QC_Average", upload: { parentGroup, status: "committed" } },
      select: { srNo: true },
    }),
  ]);

  const qcAverageSrNos = new Set(qcAverageRows.map((r) => r.srNo).filter((n): n is number => n !== null));

  const withLoad = properties.map((p) => {
    const perRoomLoadKg = benchmarks.get(`${p.starCategory}:${p.propertyType}`) ?? null;
    const loadMT = perRoomLoadKg !== null ? annualLoadMT(p.roomCount, perRoomLoadKg) : null;
    const isQcOperated = (p.srNo !== null && qcAverageSrNos.has(p.srNo)) || p.qcSitesMatched.length > 0;
    return { ...p, loadMT, isQcOperated };
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

// "QC Operational Benchmarks" — real per-site rates from the uploaded QC
// Average sheet (Price/kg, Water, LPG, PNG, Electricity), grouped by Star
// Category. This is QuickClean's own operated-site data, not a comparison
// against the wider portfolio.
dashboardRouter.get("/qc-benchmarks", async (req, res) => {
  const { parentGroup } = req.query;
  if (typeof parentGroup !== "string" || !parentGroup) {
    return res.status(400).json({ error: "parentGroup is required" });
  }

  const benchmarkMap = await getQcAverageBenchmarkMap(parentGroup);
  const benchmarks = [...benchmarkMap.values()]
    .filter((b) => b.starCategory !== BLENDED_STAR_CATEGORY) // the blended row is a fallback for other calcs, not a real Star Category to display
    .sort((a, b) => b.starCategory - a.starCategory);
  const sampleSize = benchmarks.reduce((sum, b) => sum + b.siteCount, 0);
  res.json({ benchmarks, sampleSize });
});

// "Savings Analysis" — QuickClean's real rate (QC Average sheet) vs. the
// brand's own baseline rate (Brand Average sheet), by Star Category, rolled
// up into portfolio-wide Water/Energy/Cost savings. CAPEX and CO2 Savings
// are different: both are real, direct per-property columns from the
// Properties sheet ("Capex to be deployed" and "Total CO2 Emission Savings
// (Yearly)") summed as-is, not derived from a rate comparison.
dashboardRouter.get("/savings-analysis", async (req, res) => {
  const { parentGroup } = req.query;
  if (typeof parentGroup !== "string" || !parentGroup) {
    return res.status(400).json({ error: "parentGroup is required" });
  }

  const [properties, loadTable, qcTable, brandTable] = await Promise.all([
    prisma.property.findMany({
      where: { brand: { parentGroup } },
      select: {
        roomCount: true,
        starCategory: true,
        propertyType: true,
        region: true,
        capexDeployed: true,
        carbonSavingKg: true,
        brand: { select: { name: true } },
      },
    }),
    loadBenchmarkTable(parentGroup),
    getQcAverageBenchmarkMap(parentGroup),
    getBrandAverageBenchmarkMap(parentGroup),
  ]);

  let totalQcWaterKl = 0;
  let totalQcEnergyKwh = 0;
  let totalQcCostInr = 0;
  let totalBrandWaterKl = 0;
  let totalBrandEnergyKwh = 0;
  let totalBrandCostInr = 0;
  let coveredProperties = 0;
  let fallbackProperties = 0;
  let totalCapexInr = 0;
  let totalCarbonSavingKg = 0;

  const capexByRegion = new Map<string, number>();
  const costByRegion = new Map<string, { marriottCostInr: number; qcplCostInr: number }>();
  const savingsByBrand = new Map<string, number>();

  for (const p of properties) {
    const capex = Number(p.capexDeployed);
    totalCapexInr += capex;
    capexByRegion.set(p.region, (capexByRegion.get(p.region) ?? 0) + capex);
    totalCarbonSavingKg += Number(p.carbonSavingKg);

    const perRoomLoadKg = loadTable.get(`${p.starCategory}:${p.propertyType}`) ?? null;
    const calc = computePropertyRates(p.roomCount, p.starCategory, perRoomLoadKg, qcTable, brandTable);
    if (!calc) continue;
    coveredProperties += 1;
    if (calc.usedFallback) fallbackProperties += 1;

    if (calc.qcWaterKl !== null) totalQcWaterKl += calc.qcWaterKl;
    if (calc.qcEnergyKwh !== null) totalQcEnergyKwh += calc.qcEnergyKwh;
    if (calc.qcCostInr !== null) totalQcCostInr += calc.qcCostInr;
    if (calc.brandWaterKl !== null) totalBrandWaterKl += calc.brandWaterKl;
    if (calc.brandEnergyKwh !== null) totalBrandEnergyKwh += calc.brandEnergyKwh;
    if (calc.brandCostInr !== null) totalBrandCostInr += calc.brandCostInr;

    const regionCost = costByRegion.get(p.region) ?? { marriottCostInr: 0, qcplCostInr: 0 };
    if (calc.brandCostInr !== null) regionCost.marriottCostInr += calc.brandCostInr;
    if (calc.qcCostInr !== null) regionCost.qcplCostInr += calc.qcCostInr;
    costByRegion.set(p.region, regionCost);

    if (calc.brandCostInr !== null && calc.qcCostInr !== null) {
      const saving = calc.brandCostInr - calc.qcCostInr;
      savingsByBrand.set(p.brand.name, (savingsByBrand.get(p.brand.name) ?? 0) + saving);
    }
  }

  const waterSavingKl = totalBrandWaterKl - totalQcWaterKl;
  const energySavingKwh = totalBrandEnergyKwh - totalQcEnergyKwh;
  const costSavingInr = totalBrandCostInr - totalQcCostInr;

  res.json({
    kpis: {
      waterSavingPct: totalBrandWaterKl > 0 ? Math.round((waterSavingKl / totalBrandWaterKl) * 1000) / 10 : null,
      energySavingPct: totalBrandEnergyKwh > 0 ? Math.round((energySavingKwh / totalBrandEnergyKwh) * 1000) / 10 : null,
      costReductionPct: totalBrandCostInr > 0 ? Math.round((costSavingInr / totalBrandCostInr) * 1000) / 10 : null,
      annualSavingsInr: Math.round(costSavingInr),
      capexDeployedInr: Math.round(totalCapexInr),
      waterSavingKl: Math.round(waterSavingKl),
      energySavingKwh: Math.round(energySavingKwh),
      co2SavingsTonnes: Math.round((totalCarbonSavingKg / 1000) * 10) / 10,
    },
    capexByRegion: [...capexByRegion.entries()]
      .map(([region, capexInr]) => ({ region, capexInr: Math.round(capexInr) }))
      .sort((a, b) => b.capexInr - a.capexInr),
    costByRegion: [...costByRegion.entries()].map(([region, v]) => ({
      region,
      marriottCostInr: Math.round(v.marriottCostInr),
      qcplCostInr: Math.round(v.qcplCostInr),
    })),
    topBrandsBySavings: [...savingsByBrand.entries()]
      .map(([brand, savingsInr]) => ({ brand, savingsInr: Math.round(savingsInr) }))
      .sort((a, b) => b.savingsInr - a.savingsInr)
      .slice(0, 10),
    coverage: { properties: coveredProperties, fallback: fallbackProperties, total: properties.length },
    notes: {
      loadAssumption: "100% occupancy. Rates are QuickClean's own measured rates (QC Average sheet) vs. the brand's own baseline (Brand Average sheet), by Star Category, falling back to a blended parent-group average per field where a specific Star Category has no uploaded rate.",
      co2: "CO2 Savings is the Properties sheet's own \"Total CO2 Emission Savings (Yearly)\" column (its \"CARBON SAVINGS\" banner group), summed as-is — not derived from a QC vs. brand rate comparison like the other savings figures.",
    },
  });
});

// "QCPL Rollout Timeline" — phases Brownfield properties into 5 real aging
// buckets (oldest first, since older sites are the rollout priority) and
// keeps Greenfield as one combined bucket (new-build sites aren't "aging"
// the same way, so they're not phased by age). CAPEX per phase is real,
// from properties.capex_deployed; Annual Load reuses the same
// room_load_benchmarks calc as every other page.
dashboardRouter.get("/rollout-timeline", async (req, res) => {
  const { parentGroup } = req.query;
  if (typeof parentGroup !== "string" || !parentGroup) {
    return res.status(400).json({ error: "parentGroup is required" });
  }

  const [properties, loadTable] = await Promise.all([
    prisma.property.findMany({
      where: { brand: { parentGroup } },
      select: {
        roomCount: true,
        starCategory: true,
        propertyType: true,
        developmentType: true,
        openingYear: true,
        capexDeployed: true,
      },
    }),
    loadBenchmarkTable(parentGroup),
  ]);

  type Bucket = { properties: number; rooms: number; capexInr: number; loadMT: number };
  const emptyBucket = (): Bucket => ({ properties: 0, rooms: 0, capexInr: 0, loadMT: 0 });
  const brownfieldBuckets = new Map<string, Bucket>();
  const greenfield = emptyBucket();
  let unclassifiedBrownfield = 0;

  for (const p of properties) {
    const perRoomLoadKg = loadTable.get(`${p.starCategory}:${p.propertyType}`) ?? null;
    const loadMT = perRoomLoadKg !== null ? annualLoadMT(p.roomCount, perRoomLoadKg) : 0;
    const capex = Number(p.capexDeployed);

    if (p.developmentType === "Greenfield") {
      greenfield.properties += 1;
      greenfield.rooms += p.roomCount;
      greenfield.capexInr += capex;
      greenfield.loadMT += loadMT;
      continue;
    }

    const bucketLabel = rolloutPhaseBucket(p.openingYear);
    if (bucketLabel === null) {
      unclassifiedBrownfield += 1;
      continue;
    }
    const bucket = brownfieldBuckets.get(bucketLabel) ?? emptyBucket();
    bucket.properties += 1;
    bucket.rooms += p.roomCount;
    bucket.capexInr += capex;
    bucket.loadMT += loadMT;
    brownfieldBuckets.set(bucketLabel, bucket);
  }

  const totalProperties = properties.length;
  const share = (count: number) => (totalProperties > 0 ? Math.round((count / totalProperties) * 1000) / 10 : 0);

  const brownfieldPhases = ROLLOUT_PHASE_ORDER.map((label, i) => {
    const b = brownfieldBuckets.get(label) ?? emptyBucket();
    return {
      phase: i + 1,
      agingLabel: label,
      properties: b.properties,
      rooms: b.rooms,
      capexInr: Math.round(b.capexInr),
      loadMT: Math.round(b.loadMT),
      sharePct: share(b.properties),
    };
  });

  res.json({
    brownfieldPhases,
    greenfield: {
      properties: greenfield.properties,
      rooms: greenfield.rooms,
      capexInr: Math.round(greenfield.capexInr),
      loadMT: Math.round(greenfield.loadMT),
      sharePct: share(greenfield.properties),
    },
    totals: { properties: totalProperties, rooms: properties.reduce((sum, p) => sum + p.roomCount, 0) },
    unclassifiedBrownfield, // Brownfield properties with no Opening Year — not shown in any phase (none in real IHCL data today)
  });
});
