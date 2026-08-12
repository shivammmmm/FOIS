import { X } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { getCommodityName } from "@/utils/railwayDictionary";
import { useMasterHierarchy } from "@/utils/masterHierarchy";
import {
  getDemandUnits,
  getSuppliedUnits,
  getSuppliedCombinedText,
  getMaturedDateText,
} from "@/utils/foisLifecycle";
import { formatFoisDate, formatFoisTime } from "@/utils/foisDateTime";

function isNumericCode(val) {
  const s = String(val || "").trim();
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return false;
  const num = Number(s);
  if (num >= 40000 && num <= 60000) return false;
  return true;
}

export default function FreightDetailsModal({ record, onClose }) {
  const { getZoneName, getDivisionName, getZoneForDivision } = useMasterHierarchy();
  if (!record) return null;

  const rawData = record.raw_data || {};
  const commodity = getCommodityName(record.commodity);
  const fromStation = record.from_station_name || record.station_from || "-";
  const toStation = record.to_station_name || record.station_to || "-";
  const district = record.to_district || record.from_district || "-";
  const state = record.to_state || record.from_state || "-";
  const divisionCode = record.to_division || record.from_division || record.division || "";
  const zoneCode = record.to_zone || record.from_zone || "";
  const division = divisionCode ? getDivisionName(divisionCode) : "-";
  const zone = zoneCode ? getZoneName(zoneCode) : (getZoneForDivision(divisionCode) || "-");

  // Demand Date & Time
  const rawDemandDate = record.departure_date || record.indent_date || rawData['DATE'] || rawData['DEMAND DATE'] || rawData['INDENT DATE'];
  const demandDateVal = isNumericCode(rawDemandDate) ? "" : formatFoisDate(rawDemandDate);
  const demandTimeVal = formatFoisTime(record.indent_time || record.demand_time || rawData['Time'] || rawData['indent_time'] || rawData['TIME'] || rawData['DEMAND TIME']);
  let demandCombined = "-";
  if (demandDateVal && demandDateVal !== "-") {
    demandCombined = demandDateVal + (demandTimeVal && demandTimeVal !== "-" ? `, ${demandTimeVal}` : "");
  }

  const lineItemsList = Array.isArray(record.line_items) ? record.line_items : [];

  // Supplied Units & Date
  const lineItemsSuppliedSum = lineItemsList.length > 0
    ? lineItemsList.reduce((acc, item) => acc + (Number(item.supplied_units) || 0), 0)
    : 0;
  const demandedUnits = getDemandUnits(record);
  const suppliedCombined = getSuppliedCombinedText(record);
  const maturedCombined = getMaturedDateText(record);

  const lineItems = Array.isArray(record.line_items) ? record.line_items : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Freight Details</h2>
            <p className="text-xs text-muted-foreground">ODR {record.odr_number || record.indent_no || "-"}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="ODR Number" value={record.odr_number || record.indent_no || "-"} mono />
            <Detail label="Commodity" value={commodity} />
            <Detail label="From Station" value={`${fromStation} (${record.station_from || "-"})`} />
            <Detail label="To Station" value={`${toStation} (${record.station_to || "-"})`} />
            <Detail label="District" value={district} />
            <Detail label="State" value={state} />
            <Detail label="Division" value={division} />
            <Detail label="Zone" value={zone} />
            <Detail label="Demanded Units" value={`${demandedUnits}`} />
            <Detail label="Demand Date & Time" value={demandCombined} />
            <Detail label="Supplied Date & Units" value={suppliedCombined} />
            <Detail label="Matured Date" value={maturedCombined} />
            <div>
              <div className="text-xs font-medium text-muted-foreground">Status</div>
              <div className="mt-1"><StatusBadge status={record.status || "Pending"} /></div>
            </div>
          </div>

          {lineItems.length > 1 && (
            <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">Demand Line Items ({lineItems.length})</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-1 px-2">Destination</th>
                      <th className="py-1 px-2">Commodity</th>
                      <th className="py-1 px-2 text-right">Demanded</th>
                      <th className="py-1 px-2 text-right">Supplied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-muted/40">
                        <td className="py-1 px-2 font-mono">{item.station_to || item.destination || "-"}</td>
                        <td className="py-1 px-2">{item.commodity || "-"}</td>
                        <td className="py-1 px-2 text-right font-medium">{item.indented_units || 0}</td>
                        <td className="py-1 px-2 text-right font-medium">{item.supplied_units || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value || "-"}</div>
    </div>
  );
}
