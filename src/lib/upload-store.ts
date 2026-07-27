import type {
  ParsedRow,
  PropertyRowData,
  ReferenceRowData,
  CurrentSiteRowData,
  PipelineLeadRowData,
} from "./upload-parsers";

export type PendingUpload =
  | { fileType: "PROPERTIES"; parentGroup: string; rows: ParsedRow<PropertyRowData>[] }
  | { fileType: "QC_AVERAGE" | "BRAND_AVERAGE" | "DATA_VALIDATION"; parentGroup: string; rows: ParsedRow<ReferenceRowData>[] }
  | { fileType: "CURRENT_SITES"; rows: ParsedRow<CurrentSiteRowData>[] }
  | { fileType: "LEADS_PIPELINE"; rows: ParsedRow<PipelineLeadRowData>[] };

// The design doc calls for "in-memory parse only... no S3" — the uploaded
// file itself is never persisted. That means the parsed rows have to live
// somewhere between the preview call and the commit call; this process-memory
// map is that bridge. It does NOT survive a server restart — if the process
// restarts between preview and commit, `commit` will 409 and the admin has
// to re-upload. Fine for a single-instance deployment; would need Redis (or
// similar) behind a load balancer.
const store = new Map<string, PendingUpload>();

export function putPendingUpload(uploadId: string, data: PendingUpload) {
  store.set(uploadId, data);
}

export function getPendingUpload(uploadId: string): PendingUpload | undefined {
  return store.get(uploadId);
}

export function deletePendingUpload(uploadId: string) {
  store.delete(uploadId);
}
