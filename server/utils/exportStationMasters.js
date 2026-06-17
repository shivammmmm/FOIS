import * as XLSX from "xlsx";

function toRow(item) {
  return {
    station_code: item.station_code,
    station_name: item.station_name,
    district: item.district || "",
    state: item.state || "",
    division: item.division || "",
    zone: item.zone || "",
    is_active: item.is_active ? "TRUE" : "FALSE",
  };
}

export function buildStationMastersWorkbook(items) {
  const rows = items.map(toRow);
  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0] || {}) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "station_master");
  return wb;
}

