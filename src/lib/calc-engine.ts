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
