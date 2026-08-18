import { prisma } from "./prisma";
import type { PropertyType } from "@prisma/client";

const HOURS_PER_YEAR_DAYS = 365;

// Real "Expected Load" (from the original design doc) needs avg_occupancy
// from client_group_benchmarks, which isn't populated for any real parent
// group yet (no Settings UI to enter it). Rather than block this number
// entirely, this computes load at an explicit, documented 100% occupancy
// assumption — genuinely derived from configured per_room_load_kg rates
// (which ARE seeded), just not occupancy-adjusted. Callers must surface the
// assumption in the UI, not present this as a finished figure.
export async function getPerRoomLoadKg(
  parentGroup: string,
  starCategory: number,
  propertyType: PropertyType
): Promise<number | null> {
  const specific = await prisma.roomLoadBenchmark.findUnique({
    where: { parentGroup_starCategory_propertyType: { parentGroup, starCategory, propertyType } },
  });
  if (specific) return Number(specific.perRoomLoadKg);

  const fallback = await prisma.roomLoadBenchmark.findUnique({
    where: { parentGroup_starCategory_propertyType: { parentGroup: "GLOBAL", starCategory, propertyType } },
  });
  return fallback ? Number(fallback.perRoomLoadKg) : null;
}

export async function loadBenchmarkTable(parentGroup: string) {
  const rows = await prisma.roomLoadBenchmark.findMany({
    where: { parentGroup: { in: [parentGroup, "GLOBAL"] } },
  });
  const map = new Map<string, number>();
  // GLOBAL first, then parent-group-specific overrides on top, so the
  // more specific row wins when both exist.
  for (const r of rows.filter((r) => r.parentGroup === "GLOBAL")) {
    map.set(`${r.starCategory}:${r.propertyType}`, Number(r.perRoomLoadKg));
  }
  for (const r of rows.filter((r) => r.parentGroup === parentGroup)) {
    map.set(`${r.starCategory}:${r.propertyType}`, Number(r.perRoomLoadKg));
  }
  return map;
}

/** Annual load in metric tonnes, assuming 100% occupancy every day of the year. */
export function annualLoadMT(roomCount: number, perRoomLoadKg: number): number {
  return (roomCount * perRoomLoadKg * HOURS_PER_YEAR_DAYS) / 1000;
}

export function agingBucket(openingYear: number | null): string {
  if (openingYear === null) return "Unknown";
  const age = new Date().getFullYear() - openingYear;
  if (age < 0) return "Unknown";
  if (age <= 2) return "0-2 years";
  if (age <= 5) return "2-5 years";
  if (age <= 10) return "5-10 years";
  return "10+ years";
}

// Separate bucket boundaries for the Rollout Timeline page specifically —
// different breakdown than agingBucket's 4-bucket one used on QC
// Operations, so changing this can't silently affect that page.
export const ROLLOUT_PHASE_ORDER = ["13+ years", "10-13 years", "8-10 years", "0-8 years"] as const;

export function rolloutPhaseBucket(openingYear: number | null): (typeof ROLLOUT_PHASE_ORDER)[number] | null {
  if (openingYear === null) return null;
  const age = new Date().getFullYear() - openingYear;
  if (age < 0) return null;
  if (age <= 8) return "0-8 years";
  if (age <= 10) return "8-10 years";
  if (age <= 13) return "10-13 years";
  return "13+ years";
}

export type RateBenchmarkRow = {
  starCategory: number;
  siteCount: number;
  avgPricePerKg: number | null;
  avgWaterPerKg: number | null;
  avgLpgPerKg: number | null;
  lpgSiteCount: number;
  avgPngPerKg: number | null;
  pngSiteCount: number;
  avgElectricityPerKg: number | null;
  electricitySiteCount: number;
  avgEnergyKwhPerKg: number | null;
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;
}

// Shared by both the "QC Average" and "Brand Average" sheets — same real
// per-site columns (Price/Cost per kg, Water, LPG, PNG, Electricity, Energy
// Consumption, Star Category), no Business/Residential split (that's a
// reference-mockup assumption the actual uploaded data doesn't have). Excel's
// multi-line header cells land here with literal newlines in the key (e.g.
// "Water\n(kL)..."), the two sheets don't even agree on a column name for
// the same thing ("Price / kg" vs "Cost/Kg"), and pivot-table "Grand Total"
// rows / blank-star rows get archived verbatim too — so this matches keys by
// substring and filters rows defensively rather than by exact header string.
// Sentinel key for the blended "all star categories combined" bucket —
// real Star Category values are always 1-7, so 0 can't collide.
export const BLENDED_STAR_CATEGORY = 0;

export function computeRateBenchmarks(rawRows: Record<string, unknown>[]): RateBenchmarkRow[] {
  type Bucket = {
    star: number;
    rowCount: number;
    price: number[];
    water: number[];
    lpg: number[];
    png: number[];
    electricity: number[];
    energy: number[];
  };
  const newBucket = (star: number): Bucket => ({
    star,
    rowCount: 0,
    price: [],
    water: [],
    lpg: [],
    png: [],
    electricity: [],
    energy: [],
  });
  const buckets = new Map<number, Bucket>();
  const blended = newBucket(BLENDED_STAR_CATEGORY);

  for (const raw of rawRows) {
    const norm: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) norm[normalizeKey(key)] = value;

    const star = toPositiveNumber(norm["starcategory"]);
    if (star === null || !Number.isInteger(star) || star > 7) continue; // drops "Grand Total" / blank pivot rows

    const bucket = buckets.get(star) ?? newBucket(star);
    bucket.rowCount += 1;
    blended.rowCount += 1;

    const priceKey = Object.keys(norm).find((k) => k.includes("price") || k.includes("cost"));
    const price = priceKey ? toPositiveNumber(norm[priceKey]) : null;
    if (price !== null) {
      bucket.price.push(price);
      blended.price.push(price);
    }

    const waterKey = Object.keys(norm).find((k) => k.includes("water"));
    const water = waterKey ? toPositiveNumber(norm[waterKey]) : null;
    if (water !== null) {
      bucket.water.push(water);
      blended.water.push(water);
    }

    const lpg = toPositiveNumber(norm["lpgperkgperday"]);
    if (lpg !== null) {
      bucket.lpg.push(lpg);
      blended.lpg.push(lpg);
    }

    const png = toPositiveNumber(norm["pngperkgperday"]);
    if (png !== null) {
      bucket.png.push(png);
      blended.png.push(png);
    }

    const electricityKey = Object.keys(norm).find((k) => k.includes("electric"));
    const electricity = electricityKey ? toPositiveNumber(norm[electricityKey]) : null;
    if (electricity !== null) {
      bucket.electricity.push(electricity);
      blended.electricity.push(electricity);
    }

    const energy = toPositiveNumber(norm["energyconsumptionkwhkg"]);
    if (energy !== null) {
      bucket.energy.push(energy);
      blended.energy.push(energy);
    }

    buckets.set(star, bucket);
  }

  if (blended.rowCount > 0) buckets.set(BLENDED_STAR_CATEGORY, blended);

  return [...buckets.values()]
    .sort((a, b) => b.star - a.star)
    .map((b) => ({
      starCategory: b.star,
      siteCount: b.rowCount,
      avgPricePerKg: average(b.price),
      avgWaterPerKg: average(b.water),
      avgLpgPerKg: average(b.lpg),
      lpgSiteCount: b.lpg.length,
      avgPngPerKg: average(b.png),
      pngSiteCount: b.png.length,
      avgElectricityPerKg: average(b.electricity),
      electricitySiteCount: b.electricity.length,
      avgEnergyKwhPerKg: average(b.energy),
    }));
}

// Same "no upsert on the archive table" dedup rule as the reference-data and
// qc-benchmarks routes — re-committing a Brand File archives the same
// property's row again, so keep only the most recent per Sr. No.
async function getRateBenchmarkMap(
  parentGroup: string,
  sheetName: "QC_Average" | "Brand_Average"
): Promise<Map<number, RateBenchmarkRow>> {
  const rows = await prisma.uploadReferenceArchive.findMany({
    where: { sheetName, upload: { parentGroup, status: "committed" } },
    select: { srNo: true, rawRow: true },
    orderBy: { id: "desc" },
  });

  const seenSrNo = new Set<number>();
  const deduped: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (r.srNo !== null) {
      if (seenSrNo.has(r.srNo)) continue;
      seenSrNo.add(r.srNo);
    }
    deduped.push(r.rawRow as Record<string, unknown>);
  }

  const benchmarks = computeRateBenchmarks(deduped);
  return new Map(benchmarks.map((b) => [b.starCategory, b]));
}

export function getQcAverageBenchmarkMap(parentGroup: string): Promise<Map<number, RateBenchmarkRow>> {
  return getRateBenchmarkMap(parentGroup, "QC_Average");
}

// The brand's own baseline rate — "what this property/star category
// consumes and costs without QuickClean." Comparing this against
// getQcAverageBenchmarkMap's real measured QC rate, at the same Star
// Category, is a genuine before/after saving — not a fabricated number.
export function getBrandAverageBenchmarkMap(parentGroup: string): Promise<Map<number, RateBenchmarkRow>> {
  return getRateBenchmarkMap(parentGroup, "Brand_Average");
}

// Exact Star-Category value if present, else the parent group's blended
// (all-star) average — per FIELD, since a real uploaded row can have some
// fields populated and others blank (e.g. a Star Category with a Price but
// no Energy Consumption reading at all).
export function pickWithFallback(
  exact: number | null | undefined,
  blended: number | null | undefined
): { value: number | null; usedFallback: boolean } {
  if (exact !== null && exact !== undefined) return { value: exact, usedFallback: false };
  if (blended !== null && blended !== undefined) return { value: blended, usedFallback: true };
  return { value: null, usedFallback: false };
}

export type PropertyRateCalc = {
  loadMT: number;
  qcWaterKl: number | null;
  qcEnergyKwh: number | null;
  qcCostInr: number | null;
  brandWaterKl: number | null;
  brandEnergyKwh: number | null;
  brandCostInr: number | null;
  usedFallback: boolean;
};

// One property's full real-data-derived picture: load (via room_load_benchmarks),
// QuickClean's own rate (QC Average sheet) and the brand's baseline rate
// (Brand Average sheet) applied to that load, both with the same per-field
// blended-average fallback. Shared by the Overview and Savings Analysis
// endpoints so the two never quietly drift on what counts as "covered."
export function computePropertyRates(
  roomCount: number,
  starCategory: number,
  perRoomLoadKg: number | null,
  qcTable: Map<number, RateBenchmarkRow> | undefined,
  brandTable: Map<number, RateBenchmarkRow> | undefined
): PropertyRateCalc | null {
  if (perRoomLoadKg === null) return null;
  const loadMT = annualLoadMT(roomCount, perRoomLoadKg);
  const loadKg = loadMT * 1000;

  const qcExact = qcTable?.get(starCategory);
  const qcBlend = qcTable?.get(BLENDED_STAR_CATEGORY);
  const water = pickWithFallback(qcExact?.avgWaterPerKg, qcBlend?.avgWaterPerKg);
  const energy = pickWithFallback(qcExact?.avgEnergyKwhPerKg, qcBlend?.avgEnergyKwhPerKg);
  const price = pickWithFallback(qcExact?.avgPricePerKg, qcBlend?.avgPricePerKg);

  const brandExact = brandTable?.get(starCategory);
  const brandBlend = brandTable?.get(BLENDED_STAR_CATEGORY);
  const bWater = pickWithFallback(brandExact?.avgWaterPerKg, brandBlend?.avgWaterPerKg);
  const bEnergy = pickWithFallback(brandExact?.avgEnergyKwhPerKg, brandBlend?.avgEnergyKwhPerKg);
  const bPrice = pickWithFallback(brandExact?.avgPricePerKg, brandBlend?.avgPricePerKg);

  return {
    loadMT,
    qcWaterKl: water.value !== null ? loadKg * water.value : null,
    qcEnergyKwh: energy.value !== null ? loadKg * energy.value : null,
    qcCostInr: price.value !== null ? loadKg * price.value : null,
    brandWaterKl: bWater.value !== null ? loadKg * bWater.value : null,
    brandEnergyKwh: bEnergy.value !== null ? loadKg * bEnergy.value : null,
    brandCostInr: bPrice.value !== null ? loadKg * bPrice.value : null,
    usedFallback: water.usedFallback || energy.usedFallback || price.usedFallback || bWater.usedFallback || bEnergy.usedFallback || bPrice.usedFallback,
  };
}
