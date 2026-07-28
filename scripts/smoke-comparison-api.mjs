import "../server/loadEnv.js";
import jwt from "jsonwebtoken";

const base = "http://127.0.0.1:3000";
const secret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const adminToken = jwt.sign({ sub: "smoke-admin", username: "Smoke Admin", role: "super_admin" }, secret, { expiresIn: "5m" });
const userToken = jwt.sign({ sub: "smoke-user", username: "Smoke User", role: "user" }, secret, { expiresIn: "5m" });

async function call(path, { token = adminToken, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  return { status: response.status, contentType, payload };
}

const summary = await call("/api/admin/comparison/summary");
const records = await call("/api/admin/comparison/records?page=1&page_size=2&sort_by=confidence&sort_order=desc");
const options = await call("/api/admin/comparison/options");
const firstState = options.payload?.states?.[0]?.value;
const districtOptions = firstState ? await call(`/api/admin/comparison/options?state=${encodeURIComponent(firstState)}`) : null;
const runs = await call("/api/admin/comparison/runs");
const rules = await call("/api/admin/comparison/rules");
const detailId = records.payload?.records?.[0]?.comparison_id;
const detail = detailId ? await call(`/api/admin/comparison/${detailId}`) : null;
const forbidden = await call("/api/admin/comparison/summary", { token: userToken });
const resetForbidden = await call("/api/admin/comparison/reset-manual-decisions", { token: userToken, method: "POST" });
const reprocessForbidden = await call("/api/admin/comparison/reprocess", { token: userToken, method: "POST", body: { scope: "all" } });
const invalidResolve = detailId
  ? await call(`/api/admin/comparison/${detailId}/resolve`, { method: "POST", body: {} })
  : null;

console.log(JSON.stringify({
  summary: { status: summary.status, content_type: summary.contentType, total_odr: summary.payload?.total_odr, total_matured: summary.payload?.total_matured },
  records: { status: records.status, count: records.payload?.records?.length, total: records.payload?.total, pages: records.payload?.total_pages },
  options: { status: options.status, states: options.payload?.states?.length, divisions: options.payload?.divisions?.length, filtered_districts: districtOptions?.payload?.districts?.length },
  runs: { status: runs.status, count: runs.payload?.runs?.length },
  rules: { status: rules.status, version: rules.payload?.version },
  detail: detail && { status: detail.status, comparison_id: detail.payload?.match_id },
  normal_user_admin_api: forbidden.status,
  normal_user_reset_api: resetForbidden.status,
  normal_user_reprocess_api: reprocessForbidden.status,
  resolve_validation: invalidResolve?.status,
}, null, 2));
