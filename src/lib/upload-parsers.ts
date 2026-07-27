import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const REGIONS = ["North", "South", "East", "West", "Central"] as const;
export const PROPERTY_TYPES = ["Resort", "Hotel"] as const;
export const DEVELOPMENT_TYPES = ["Brownfield", "Greenfield"] as const;
export const OPERATED_BY_VALUES = ["Client", "QuickClean"] as const;
export const SITE_CATEGORIES = ["Healthcare", "Hospitality"] as const;
export const MODEL_TYPES = ["OPL", "Outsourcing", "Rental"] as const;

export const FILE_TYPES = [
  "CURRENT_SITES",
  "PROPERTIES",
  "QC_AVERAGE",
  "BRAND_AVERAGE",
  "DATA_VALIDATION",
  "LEADS_PIPELINE",
] as const;
export type FileType = (typeof FILE_TYPES)[number];

// A TAM upload spans every brand under one client group (Properties, QC
// Average, Brand Average, Data Validation all carry their own per-row
// "Brand" column) — these need a Parent Group selected at upload time.
// Current Sites and Leads Pipeline are company-wide, not scoped to one group.
export const PARENT_GROUP_SCOPED_TYPES: FileType[] = [
  "PROPERTIES",
  "QC_AVERAGE",
  "BRAND_AVERAGE",
  "DATA_VALIDATION",
];

// ---------------------------------------------------------------------------
// Shared cell/header helpers
// ---------------------------------------------------------------------------

export type ParsedRow<T> = { rowNumber: number; errors: string[]; data: T | null };

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headerRow: unknown[], headerMap: Record<string, string>): Record<number, string> {
  const map: Record<number, string> = {};
  headerRow.forEach((cell, idx) => {
    if (typeof cell !== "string") return;
    const canonical = headerMap[normalizeHeader(cell)];
    if (canonical) map[idx] = canonical;
  });
  return map;
}

function cellToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function cellToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function cellToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeEnum<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (!value) return null;
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  return match ?? null;
}

function isBlankRow(fields: Record<string, unknown>): boolean {
  return Object.keys(fields).length === 0 || Object.values(fields).every((v) => cellToString(v) === null);
}

const HEADER_SCAN_LIMIT = 15;

/**
 * Real exported spreadsheets often have a title/banner row (or a blank row)
 * above the actual column headers. Scanning blindly assumes row 1 is the
 * header, which silently produces zero rows if that assumption is wrong —
 * every "data" row gets read against the wrong header and dropped as blank.
 * Instead, scan the first few rows and pick whichever one matches the most
 * columns from this file type's known header dictionary.
 */
function findHeaderRowIndex(grid: unknown[][], headerMap: Record<string, string>): number {
  let bestIndex = -1;
  let bestScore = 0;
  const scanLimit = Math.min(grid.length, HEADER_SCAN_LIMIT);

  for (let i = 0; i < scanLimit; i++) {
    const row = grid[i];
    const score = row.reduce<number>((acc, cell) => {
      if (typeof cell !== "string") return acc;
      return headerMap[normalizeHeader(cell)] ? acc + 1 : acc;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    const firstRowPreview = (grid[0] ?? [])
      .map((c) => cellToString(c))
      .filter((c): c is string => c !== null)
      .join(", ");
    throw new Error(
      `Could not find a recognizable header row in this file (checked the first ${scanLimit} rows). ` +
        `First row found: "${firstRowPreview || "(blank)"}". Check you picked the right file type.`
    );
  }

  return bestIndex;
}

/** Reads the first sheet, auto-detecting which row is the real header. */
function readSheet(
  buffer: Buffer,
  headerMap: Record<string, string>
): { headerRow: unknown[]; dataRows: unknown[][]; headerRowIndex: number } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("This file has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const headerRowIndex = findHeaderRowIndex(grid, headerMap);
  return { headerRow: grid[headerRowIndex], dataRows: grid.slice(headerRowIndex + 1), headerRowIndex };
}

function extractFields(row: unknown[], headerMap: Record<number, string>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  Object.entries(headerMap).forEach(([idx, field]) => {
    fields[field] = row[Number(idx)];
  });
  return fields;
}

// ---------------------------------------------------------------------------
// 1. Properties file (e.g. "IHCL Properties")
// ---------------------------------------------------------------------------

const PROPERTIES_HEADER_MAP: Record<string, string> = {
  srno: "srNo",
  sno: "srNo",
  sr: "srNo",
  region: "region",
  state: "state",
  city: "city",
  propertyname: "name",
  brand: "brand",
  type: "propertyType",
  brownfieldgreenfield: "developmentType",
  operatedby: "operatedBy",
  starcategory: "starCategory",
  numberofrooms: "roomCount",
  openingyear: "openingYear",
  capextobedeployed: "capexDeployed",
  capex: "capexDeployed",
};

export type PropertyRowData = {
  srNo: number | null;
  name: string;
  brandName: string;
  region: (typeof REGIONS)[number];
  state: string;
  city: string;
  propertyType: (typeof PROPERTY_TYPES)[number];
  developmentType: (typeof DEVELOPMENT_TYPES)[number];
  operatedBy: (typeof OPERATED_BY_VALUES)[number];
  starCategory: number;
  roomCount: number;
  openingYear: number | null;
  capexDeployed: number;
};

export function parsePropertiesFile(buffer: Buffer): { rows: ParsedRow<PropertyRowData>[] } {
  const { headerRow, dataRows, headerRowIndex } = readSheet(buffer, PROPERTIES_HEADER_MAP);
  const headerMap = mapHeaders(headerRow, PROPERTIES_HEADER_MAP);
  const rows: ParsedRow<PropertyRowData>[] = [];
  const seenSrNo = new Set<number>();

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const fields = extractFields(row, headerMap);
    if (isBlankRow(fields)) return;

    const errors: string[] = [];

    const srNo = cellToNumber(fields.srNo);
    if (srNo !== null) {
      if (seenSrNo.has(srNo)) errors.push(`Duplicate Sr. No. ${srNo} within this file`);
      seenSrNo.add(srNo);
    }

    const name = cellToString(fields.name);
    if (!name) errors.push("Property Name is required");

    const brandName = cellToString(fields.brand);
    if (!brandName) errors.push("Brand is required");

    const region = normalizeEnum(cellToString(fields.region), REGIONS);
    if (!region) errors.push("Region must be one of North/South/East/West/Central");

    const state = cellToString(fields.state);
    if (!state) errors.push("State is required");

    const city = cellToString(fields.city);
    if (!city) errors.push("City is required");

    const propertyType = normalizeEnum(cellToString(fields.propertyType), PROPERTY_TYPES);
    if (!propertyType) errors.push("Type must be Resort or Hotel");

    const developmentType = normalizeEnum(cellToString(fields.developmentType), DEVELOPMENT_TYPES);
    if (!developmentType) errors.push("Brownfield / Greenfield must be one of those two values");

    const operatedBy = normalizeEnum(cellToString(fields.operatedBy), OPERATED_BY_VALUES);
    if (!operatedBy) errors.push("Operated by must be Client or QuickClean");

    const starCategory = cellToNumber(fields.starCategory);
    if (starCategory === null || !Number.isInteger(starCategory) || starCategory < 1 || starCategory > 5) {
      errors.push("Star Category must be an integer between 1 and 5");
    }

    const roomCount = cellToNumber(fields.roomCount);
    if (roomCount === null || !Number.isInteger(roomCount) || roomCount <= 0) {
      errors.push("Number of Rooms must be a positive integer");
    }

    const openingYear = cellToNumber(fields.openingYear);
    if (openingYear !== null && (!Number.isInteger(openingYear) || openingYear < 1900 || openingYear > 2100)) {
      errors.push("Opening Year must be between 1900 and 2100");
    }

    const capexDeployed = cellToNumber(fields.capexDeployed);
    if (capexDeployed !== null && capexDeployed < 0) {
      errors.push("Capex deployed cannot be negative");
    }

    rows.push({
      rowNumber,
      errors,
      data:
        errors.length === 0
          ? {
              srNo,
              name: name!,
              brandName: brandName!,
              region: region!,
              state: state!,
              city: city!,
              propertyType: propertyType!,
              developmentType: developmentType!,
              operatedBy: operatedBy!,
              starCategory: starCategory!,
              roomCount: roomCount!,
              openingYear,
              capexDeployed: capexDeployed ?? 0,
            }
          : null,
    });
  });

  return { rows };
}

// ---------------------------------------------------------------------------
// 2/3/4. Reference files — QC Average, Brand Average, Data Validation
// (structurally identical: same identity columns, archived verbatim; Data
// Validation additionally carries the source-of-truth URL)
// ---------------------------------------------------------------------------

const REFERENCE_HEADER_MAP: Record<string, string> = {
  srno: "srNo",
  sno: "srNo",
  sr: "srNo",
  region: "region",
  state: "state",
  city: "city",
  propertyname: "name",
  brand: "brand",
  datavalidationlink: "sourceUrl",
  link: "sourceUrl",
  url: "sourceUrl",
};

export type ReferenceRowData = {
  srNo: number | null;
  brandName: string | null;
  sourceUrl: string | null;
  raw: Record<string, unknown>;
};

export function parseReferenceFile(buffer: Buffer): { rows: ParsedRow<ReferenceRowData>[] } {
  const { headerRow, dataRows, headerRowIndex } = readSheet(buffer, REFERENCE_HEADER_MAP);
  const headerMap = mapHeaders(headerRow, REFERENCE_HEADER_MAP);
  const rawHeaders = headerRow.map((h) => cellToString(h) ?? "");
  const rows: ParsedRow<ReferenceRowData>[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const raw: Record<string, unknown> = {};
    rawHeaders.forEach((h, idx) => {
      if (h) raw[h] = row[idx] ?? null;
    });
    if (Object.values(raw).every((v) => cellToString(v) === null)) return;

    const fields = extractFields(row, headerMap);
    const srNo = cellToNumber(fields.srNo);
    const brandName = cellToString(fields.brand);
    const sourceUrl = cellToString(fields.sourceUrl);

    // Archival is best-effort — a row missing Sr. No./Brand still gets
    // archived, it just won't be matchable to a specific property.
    rows.push({ rowNumber, errors: [], data: { srNo, brandName, sourceUrl, raw } });
  });

  return { rows };
}

// ---------------------------------------------------------------------------
// 5. Current Sites file ("CURRENT SITES LIST.xlsx")
// ---------------------------------------------------------------------------

const CURRENT_SITES_HEADER_MAP: Record<string, string> = {
  sitecode: "siteCode",
  clientcode: "clientCode",
  sitename: "siteName",
  state: "state",
  city: "city",
  region: "region",
  parentbrand: "parentBrand",
  brand: "brand",
  category: "category",
  starcategory: "starCategory",
  owningcompany: "owningCompany",
  propertystartdate: "propertyStartDate",
  startofqcoperations: "qcOpsStartDate",
  roombedcount: "roomBedCount",
  propertytype: "propertyType",
  modeltype: "modelType",
};

export type CurrentSiteRowData = {
  siteCode: string;
  clientCode: string;
  siteName: string;
  state: string;
  city: string;
  region: (typeof REGIONS)[number];
  parentBrand: string | null;
  brand: string | null;
  category: (typeof SITE_CATEGORIES)[number] | null;
  starCategory: number | null;
  owningCompany: string | null;
  propertyStartDate: Date | null;
  qcOpsStartDate: Date | null;
  roomBedCount: number | null;
  propertyType: string | null;
  modelType: (typeof MODEL_TYPES)[number] | null;
};

export function parseCurrentSitesFile(buffer: Buffer): { rows: ParsedRow<CurrentSiteRowData>[] } {
  const { headerRow, dataRows, headerRowIndex } = readSheet(buffer, CURRENT_SITES_HEADER_MAP);
  const headerMap = mapHeaders(headerRow, CURRENT_SITES_HEADER_MAP);
  const rows: ParsedRow<CurrentSiteRowData>[] = [];
  // The same site_code can recur for different clients (e.g. site_code 1043
  // for client C104A vs. client C1043B) — the real identity is the pair.
  const seenKeys = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const fields = extractFields(row, headerMap);
    if (isBlankRow(fields)) return;

    const errors: string[] = [];

    const siteCode = cellToString(fields.siteCode);
    if (!siteCode) errors.push("Site Code is required");

    const clientCode = cellToString(fields.clientCode);
    if (!clientCode) errors.push("Client Code is required");

    if (siteCode && clientCode) {
      const key = `${siteCode}:${clientCode}`;
      if (seenKeys.has(key)) errors.push(`Duplicate Site Code + Client Code (${siteCode} / ${clientCode}) within this file`);
      seenKeys.add(key);
    }

    const siteName = cellToString(fields.siteName);
    if (!siteName) errors.push("Site Name is required");

    const state = cellToString(fields.state);
    if (!state) errors.push("State is required");

    const city = cellToString(fields.city);
    if (!city) errors.push("City is required");

    const region = normalizeEnum(cellToString(fields.region), REGIONS);
    if (!region) errors.push("Region must be one of North/South/East/West/Central");

    // Everything below is optional in the real file.
    const parentBrand = cellToString(fields.parentBrand);
    const category = normalizeEnum(cellToString(fields.category), SITE_CATEGORIES);
    const modelType = normalizeEnum(cellToString(fields.modelType), MODEL_TYPES);

    const starCategory = cellToNumber(fields.starCategory);
    if (starCategory !== null && (!Number.isInteger(starCategory) || starCategory < 1 || starCategory > 5)) {
      errors.push("Star Category must be an integer between 1 and 5");
    }

    const roomBedCount = cellToNumber(fields.roomBedCount);
    if (roomBedCount !== null && (!Number.isInteger(roomBedCount) || roomBedCount <= 0)) {
      errors.push("Room/Bed Count must be a positive integer");
    }

    rows.push({
      rowNumber,
      errors,
      data:
        errors.length === 0
          ? {
              siteCode: siteCode!,
              clientCode: clientCode!,
              siteName: siteName!,
              state: state!,
              city: city!,
              region: region!,
              parentBrand,
              brand: cellToString(fields.brand),
              category,
              starCategory,
              owningCompany: cellToString(fields.owningCompany),
              propertyStartDate: cellToDate(fields.propertyStartDate),
              qcOpsStartDate: cellToDate(fields.qcOpsStartDate),
              roomBedCount,
              propertyType: cellToString(fields.propertyType),
              modelType,
            }
          : null,
    });
  });

  return { rows };
}

// ---------------------------------------------------------------------------
// 6. Leads in Pipeline file (Sheet0)
// ---------------------------------------------------------------------------

const PIPELINE_LEADS_HEADER_MAP: Record<string, string> = {
  fullname: "fullName",
  category: "category",
  city: "city",
  state: "state",
  region: "region",
  noofkeysornoofbeds: "keysOrBeds",
  leadcreator: "leadCreator",
  leadowner: "leadOwner",
  regionalsaleslead: "regionalSalesLead",
  industry: "industry",
  leadqualification: "leadQualification",
  leadtype: "leadType",
  leadstatus: "leadStatus",
  propertytype: "propertyType",
  estimatedrevenuerecordcurrency: "estimatedRevenue",
  estimatedrevenue: "estimatedRevenue",
};

export type PipelineLeadRowData = {
  fullName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  region: (typeof REGIONS)[number] | null;
  keysOrBeds: number | null;
  leadCreator: string | null;
  leadOwner: string | null;
  regionalSalesLead: string | null;
  industry: string | null;
  leadQualification: string | null;
  leadType: string | null;
  leadStatus: string | null;
  propertyType: string | null;
  estimatedRevenue: number | null;
};

export function parsePipelineLeadsFile(buffer: Buffer): { rows: ParsedRow<PipelineLeadRowData>[] } {
  const { headerRow, dataRows, headerRowIndex } = readSheet(buffer, PIPELINE_LEADS_HEADER_MAP);
  const headerMap = mapHeaders(headerRow, PIPELINE_LEADS_HEADER_MAP);
  const rows: ParsedRow<PipelineLeadRowData>[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const fields = extractFields(row, headerMap);
    if (isBlankRow(fields)) return;

    const errors: string[] = [];

    const fullName = cellToString(fields.fullName);
    if (!fullName) errors.push("Full Name is required");

    const estimatedRevenue = cellToNumber(fields.estimatedRevenue);
    if (estimatedRevenue !== null && estimatedRevenue < 0) {
      errors.push("Estimated Revenue cannot be negative");
    }

    const keysOrBeds = cellToNumber(fields.keysOrBeds);
    if (keysOrBeds !== null && (!Number.isInteger(keysOrBeds) || keysOrBeds <= 0)) {
      errors.push("No Of Keys / No of Beds must be a positive integer");
    }

    // Region is informational here — an unrecognized value is dropped, not
    // treated as invalid (this file isn't gated behind the strict enum the
    // way Properties/Current Sites are).
    const region = normalizeEnum(cellToString(fields.region), REGIONS);

    rows.push({
      rowNumber,
      errors,
      data:
        errors.length === 0
          ? {
              fullName: fullName!,
              category: cellToString(fields.category),
              city: cellToString(fields.city),
              state: cellToString(fields.state),
              region,
              keysOrBeds,
              leadCreator: cellToString(fields.leadCreator),
              leadOwner: cellToString(fields.leadOwner),
              regionalSalesLead: cellToString(fields.regionalSalesLead),
              industry: cellToString(fields.industry),
              leadQualification: cellToString(fields.leadQualification),
              leadType: cellToString(fields.leadType),
              leadStatus: cellToString(fields.leadStatus),
              propertyType: cellToString(fields.propertyType),
              estimatedRevenue,
            }
          : null,
    });
  });

  return { rows };
}
