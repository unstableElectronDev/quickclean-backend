import { prisma } from "./prisma";
import type { SessionPayload } from "./jwt";

export const FILTER_KEYS = [
  "parentGroup",
  "region",
  "state",
  "city",
  "starCategory",
  "aging",
  "operatedBy",
  "developmentType",
  "icpModel",
  "name",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

// Admin is always allowed, in code — never gated by the stored config.
export async function getAllowedFilterKeys(role: SessionPayload["role"]): Promise<Set<string>> {
  if (role === "admin") return new Set(FILTER_KEYS);

  const rows = await prisma.filterPermission.findMany();
  const allowed = new Set<string>();
  for (const row of rows) {
    const roles = row.allowedRoles as string[];
    if (roles.includes(role)) allowed.add(row.filterKey);
  }
  return allowed;
}
