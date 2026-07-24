import { X } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { getCommodityName } from "@/utils/railwayDictionary";
import { useMasterHierarchy } from "@/utils/masterHierarchy";

export default function FreightDetailsModal({ record, onClose }) {
  const { getZoneName, getDivisionName, getZoneForDivision } = useMasterHierarchy();
  if (!record) return null;

  const commodity = getCommodityName(record.commodity);
  const fromStation = record.from_station_name || record.station_from || "-";
  const toStation = record.to_station_name || record.station_to || "-";
  const district = record.to_district || record.from_district || "-";
  const state = record.to_state || record.from_state || "-";
  const divisionCode = record.to_division || record.from_division || record.division || "";
  // to_zone/from_zone come from the station's own master record when known;
  // otherwise derive zone from the division, never from the unreliable
  // movement-level "zone" field (uploaded files carry no real zone column).
  const zoneCode = record.to_zone || record.from_zone || "";
  const division = divisionCode ? getDivisionName(divisionCode) : "-";
  const zone = zoneCode ? getZoneName(zoneCode) : (getZoneForDivision(divisionCode) || "-");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Freight Details</h2>
            <p className="text-xs text-muted-foreground">ODR {record.odr_number || "-"}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Detail label="ODR Number" value={record.odr_number} mono />
          <Detail label="Commodity" value={commodity} />
          <Detail label="From Station" value={`${fromStation} (${record.station_from || "-"})`} />
          <Detail label="To Station" value={`${toStation} (${record.station_to || "-"})`} />
          <Detail label="District" value={district} />
          <Detail label="State" value={state} />
          <Detail label="Division" value={division} />
          <Detail label="Zone" value={zone} />
          <Detail label="Arrival Date" value={record.arrival_date} />
          <Detail label="Departure Date" value={record.departure_date} />
          <div>
            <div className="text-xs font-medium text-muted-foreground">Status</div>
            <div className="mt-1"><StatusBadge status={record.status || "Pending"} /></div>
          </div>
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
