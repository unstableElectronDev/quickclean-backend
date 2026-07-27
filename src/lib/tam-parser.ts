import * as XLSX from "xlsx";

export const REGIONS = ["North", "South", "East", "West", "Central"] as const;
export const PROPERTY_TYPES = ["Resort", "Hotel"] as const;
export const DEVELOPMENT_TYPES = ["Brownfield", "Greenfield"] as const;
export const OPERATED_BY_VALUES = ["Client", "QuickClean"] as const;

export type ParsedPropertyRow = {
  rowNumber: number;
  srNo: number | null;
  errors: string[];
  data: {
    srNo: number | null;
    name: string;
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
  } | null;
};

export type ReferenceSheetRow = {
  sheetName: "QC Average" | "IHCL Average" | "Data Validation";
  srNo: number | null;
  raw: Record<string, unknown>;
};

export type ParsedUpload = {
  propertiesSheetName: string | null;
  rows: ParsedPropertyRow[];
  referenceRows: ReferenceSheetRow[];
  sourceUrlBySrNo: Map<number, string>;
  ignoredSheetNames: string[];
};

// Header text -> canonical field name. Keys are normalized (lowercased,
// non-alphanumeric stripped) before lookup, so "Star Category", "star_category"
// and "Stars" all resolve the same way.
const HEADER_MAP: Record<string, string> = {
  srno: "srNo",
  sno: "srNo",
  sr: "srNo",
  name: "name",
  propertyname: "name",
  hotelname: "name",
  region: "region",
  state: "state",
  city: "city",
  propertytype: "propertyType",
  type: "propertyType",
  developmenttype: "developmentType",
  operatedby: "operatedBy",
  operator: "operatedBy",
  starcategory: "starCategory",
  star: "starCategory",
  stars: "starCategory",
  roomcount: "roomCount",
  rooms: "roomCount",
  noofrooms: "roomCount",
  openingyear: "openingYear",
  year: "openingYear",
  capexdeployed: "capexDeployed",
  capex: "capexDeployed",
  sourceurl: "sourceUrl",
  url: "sourceUrl",
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headerRow: unknown[]): Record<number, string> {
  const map: Record<number, string> = {};
  headerRow.forEach((cell, idx) => {
    if (typeof cell !== "string") return;
    const canonical = HEADER_MAP[normalizeHeader(cell)];
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

function normalizeEnum<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (!value) return null;
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  return match ?? null;
}

function findPropertiesSheet(sheetNames: string[]): string | null {
  const byName = sheetNames.find((n) => /propert/i.test(n));
  if (byName) return byName;
  return sheetNames.find((n) => !/average|validat/i.test(n)) ?? sheetNames[0] ?? null;
}

function classifyReferenceSheet(name: string): ReferenceSheetRow["sheetName"] | null {
  if (/qc.*average/i.test(name)) return "QC Average";
  if (/ihcl.*average/i.test(name)) return "IHCL Average";
  if (/data.*valid/i.test(name)) return "Data Validation";
  return null;
}

export function parseTamWorkbook(buffer: Buffer): ParsedUpload {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;

  const propertiesSheetName = findPropertiesSheet(sheetNames);
  const rows: ParsedPropertyRow[] = [];
  const seenSrNo = new Set<number>();

  if (propertiesSheetName) {
    const sheet = workbook.Sheets[propertiesSheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const [headerRow, ...dataRows] = grid;
    const headerMap = headerRow ? mapHeaders(headerRow) : {};

    dataRows.forEach((row, i) => {
      const rowNumber = i + 2; // +1 for header row, +1 for 1-based indexing
      const fields: Record<string, unknown> = {};
      Object.entries(headerMap).forEach(([idx, field]) => {
        fields[field] = row[Number(idx)];
      });

      const errors: string[] = [];

      const srNo = cellToNumber(fields.srNo);
      if (srNo !== null && seenSrNo.has(srNo)) {
        errors.push(`Duplicate Sr. No. ${srNo} within this file`);
      }
      if (srNo !== null) seenSrNo.add(srNo);

      const name = cellToString(fields.name);
      if (!name) errors.push("Name is required");

      const region = normalizeEnum(cellToString(fields.region), REGIONS);
      if (!region) errors.push("Region must be one of North/South/East/West/Central");

      const state = cellToString(fields.state);
      if (!state) errors.push("State is required");

      const city = cellToString(fields.city);
      if (!city) errors.push("City is required");

      const propertyType = normalizeEnum(cellToString(fields.propertyType), PROPERTY_TYPES);
      if (!propertyType) errors.push("Property type must be Resort or Hotel");

      const developmentType = normalizeEnum(cellToString(fields.developmentType), DEVELOPMENT_TYPES);
      if (!developmentType) errors.push("Development type must be Brownfield or Greenfield");

      const operatedBy = normalizeEnum(cellToString(fields.operatedBy), OPERATED_BY_VALUES);
      if (!operatedBy) errors.push("Operated by must be Client or QuickClean");

      const starCategory = cellToNumber(fields.starCategory);
      if (starCategory === null || !Number.isInteger(starCategory) || starCategory < 1 || starCategory > 5) {
        errors.push("Star category must be an integer between 1 and 5");
      }

      const roomCount = cellToNumber(fields.roomCount);
      if (roomCount === null || !Number.isInteger(roomCount) || roomCount <= 0) {
        errors.push("Room count must be a positive integer");
      }

      const openingYearRaw = cellToNumber(fields.openingYear);
      if (openingYearRaw !== null && (!Number.isInteger(openingYearRaw) || openingYearRaw < 1900 || openingYearRaw > 2100)) {
        errors.push("Opening year must be between 1900 and 2100");
      }

      const capexRaw = cellToNumber(fields.capexDeployed);
      if (capexRaw !== null && capexRaw < 0) {
        errors.push("Capex deployed cannot be negative");
      }

      // Skip fully blank rows (e.g. trailing empty rows in the sheet).
      const isBlank = Object.keys(fields).length === 0 || Object.values(fields).every((v) => cellToString(v) === null);
      if (isBlank) return;

      rows.push({
        rowNumber,
        srNo,
        errors,
        data:
          errors.length === 0
            ? {
                srNo,
                name: name!,
                region: region!,
                state: state!,
                city: city!,
                propertyType: propertyType!,
                developmentType: developmentType!,
                operatedBy: operatedBy!,
                starCategory: starCategory!,
                roomCount: roomCount!,
                openingYear: openingYearRaw,
                capexDeployed: capexRaw ?? 0,
              }
            : null,
      });
    });
  }

  const referenceRows: ReferenceSheetRow[] = [];
  const sourceUrlBySrNo = new Map<number, string>();
  const ignoredSheetNames: string[] = [];

  for (const sheetName of sheetNames) {
    if (sheetName === propertiesSheetName) continue;
    const kind = classifyReferenceSheet(sheetName);
    if (!kind) {
      ignoredSheetNames.push(sheetName);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const [headerRow, ...dataRows] = grid;
    if (!headerRow) continue;

    const headerMap = mapHeaders(headerRow);
    const rawHeaders = headerRow.map((h) => cellToString(h) ?? "");

    dataRows.forEach((row) => {
      const raw: Record<string, unknown> = {};
      rawHeaders.forEach((h, idx) => {
        if (h) raw[h] = row[idx] ?? null;
      });
      if (Object.values(raw).every((v) => cellToString(v) === null)) return;

      let srNo: number | null = null;
      let sourceUrl: string | null = null;
      Object.entries(headerMap).forEach(([idx, field]) => {
        if (field === "srNo") srNo = cellToNumber(row[Number(idx)]);
        if (field === "sourceUrl") sourceUrl = cellToString(row[Number(idx)]);
      });

      if (kind === "Data Validation" && srNo !== null && sourceUrl) {
        sourceUrlBySrNo.set(srNo, sourceUrl);
      }

      referenceRows.push({ sheetName: kind, srNo, raw });
    });
  }

  return { propertiesSheetName, rows, referenceRows, sourceUrlBySrNo, ignoredSheetNames };
}
