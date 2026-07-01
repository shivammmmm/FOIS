import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Download,
  Edit2,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "@/api/apiClient";
import SearchableSelect from "@/components/SearchableSelect";

const PAGE_SIZE = 12;
const CODE_FIELDS = new Set([
  "code",
  "parent_code",
  "station_code",
  "state",
  "district",
  "zone",
  "division",
]);

const MASTER_TYPES = [
  {
    key: "state",
    label: "State Master",
    importHeaders: ["StateName", "StateCode"],
    columns: ["code", "name"],
    fields: [
      { name: "code", label: "State Code", placeholder: "MH" },
      { name: "name", label: "State Name", placeholder: "Maharashtra" },
    ],
    importMap: { code: ["StateCode"], name: ["StateName"] },
    validate: (form) => requireFields(form, [
      ["code", "State Code"],
      ["name", "State Name"],
    ]),
  },
  {
    key: "district",
    label: "District Master",
    importHeaders: ["StateCode", "DistrictName", "DistrictCode"],
    columns: ["parent_code", "code", "name"],
    fields: [
      { name: "parent_code", label: "Parent State", type: "select", source: "states" },
      { name: "code", label: "District Code", placeholder: "NGP" },
      { name: "name", label: "District Name", placeholder: "Nagpur" },
    ],
    importMap: {
      parent_code: ["StateCode"],
      code: ["DistrictCode"],
      name: ["DistrictName"],
    },
    validate: (form) => requireFields(form, [
      ["parent_code", "Parent State"],
      ["code", "District Code"],
      ["name", "District Name"],
    ]),
  },
  {
    key: "station",
    label: "Station Master",
    importHeaders: ["StationCode", "StationName", "StateCode", "DistrictCode", "ZoneCode", "DivisionCode"],
    columns: ["station_code", "station_name", "state", "district", "zone", "division"],
    fields: [
      { name: "station_code", label: "Station Code", placeholder: "BRC" },
      { name: "station_name", label: "Station Name", placeholder: "Vadodara" },
      { name: "state", label: "State", type: "select", source: "states" },
      { name: "district", label: "District", type: "select", source: "districts", dependsOn: "state" },
      { name: "zone", label: "Zone", type: "select", source: "zones" },
      { name: "division", label: "Division", type: "select", source: "divisions", dependsOn: "zone" },
    ],
    importMap: {
      station_code: ["StationCode"],
      station_name: ["StationName"],
      state: ["StateCode"],
      district: ["DistrictCode"],
      zone: ["ZoneCode"],
      division: ["DivisionCode"],
    },
    validate: (form) => requireFields(form, [
      ["station_code", "Station Code"],
      ["station_name", "Station Name"],
      ["state", "State"],
      ["district", "District"],
      ["zone", "Zone"],
      ["division", "Division"],
    ]),
  },
  {
    key: "zone",
    label: "Zone Master",
    importHeaders: ["ZoneCode", "ZoneName"],
    columns: ["code", "name"],
    fields: [
      { name: "code", label: "Zone Code", placeholder: "WR" },
      { name: "name", label: "Zone Name", placeholder: "Western Railway" },
    ],
    importMap: { code: ["ZoneCode"], name: ["ZoneName"] },
    validate: (form) => requireFields(form, [
      ["code", "Zone Code"],
      ["name", "Zone Name"],
    ]),
  },
  {
    key: "division",
    label: "Division Master",
    importHeaders: ["ZoneCode", "DivisionCode", "DivisionName"],
    columns: ["parent_code", "code", "name"],
    fields: [
      { name: "parent_code", label: "Zone", type: "select", source: "zones" },
      { name: "code", label: "Division Code", placeholder: "RTM" },
      { name: "name", label: "Division Name", placeholder: "Ratlam Division" },
    ],
    importMap: {
      parent_code: ["ZoneCode"],
      code: ["DivisionCode"],
      name: ["DivisionName"],
    },
    validate: (form) => requireFields(form, [
      ["parent_code", "Zone"],
      ["code", "Division Code"],
      ["name", "Division Name"],
    ]),
  },
  {
    key: "commodity",
    label: "Commodity Master",
    importHeaders: ["CommodityCode", "CommodityName"],
    columns: ["code", "name"],
    fields: [
      { name: "code", label: "Commodity Code", placeholder: "POL" },
      { name: "name", label: "Commodity Full Name", placeholder: "Petroleum Oil & Lubricants" },
    ],
    importMap: { code: ["CommodityCode"], name: ["CommodityName"] },
    validate: (form) => requireFields(form, [
      ["code", "Commodity Code"],
      ["name", "Commodity Full Name"],
    ]),
  },
  {
    key: "company",
    label: "Company Master",
    importHeaders: ["CompanyCode", "CompanyName"],
    columns: ["code", "name"],
    fields: [
      { name: "code", label: "Company Code", placeholder: "IOCL" },
      { name: "name", label: "Company Name", placeholder: "Indian Oil Corporation Limited" },
    ],
    importMap: { code: ["CompanyCode"], name: ["CompanyName"] },
    validate: (form) => requireFields(form, [
      ["code", "Company Code"],
      ["name", "Company Name"],
    ]),
  },
  {
    key: "product",
    label: "Product Master",
    importHeaders: ["ProductCode", "ProductName"],
    columns: ["code", "name"],
    fields: [
      { name: "code", label: "Product Code", placeholder: "HSD" },
      { name: "name", label: "Product Name", placeholder: "High Speed Diesel" },
    ],
    importMap: { code: ["ProductCode"], name: ["ProductName"] },
    validate: (form) => requireFields(form, [
      ["code", "Product Code"],
      ["name", "Product Name"],
    ]),
  },
];

export default function MasterManagement() {
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { masterKey } = useParams();
  const activeKey = MASTER_TYPES.some((master) => master.key === masterKey)
    ? masterKey
    : "state";
  const [rows, setRows] = useState([]);
  const [references, setReferences] = useState({
    states: [],
    districts: [],
    zones: [],
    divisions: [],
  });
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ kind: "info", text: "" });

  const activeMaster = useMemo(
    () => MASTER_TYPES.find((master) => master.key === activeKey) || MASTER_TYPES[0],
    [activeKey]
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (masterKey !== activeKey) {
      navigate(`/admin/master-management/${activeKey}`, { replace: true });
    }
  }, [activeKey, masterKey, navigate]);

  useEffect(() => {
    resetFormFor(activeMaster);
    setSearch("");
    setPage(1);
  }, [activeMaster]);

  useEffect(() => {
    loadRows();
  }, [activeKey, page, search]);

  useEffect(() => {
    loadReferences();
  }, []);

  async function loadRows() {
    setLoading(true);
    try {
      const data = await apiClient.masterCatalog.list(activeKey, {
        search,
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      setRows(data?.items || []);
      setTotal(data?.total || 0);
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "Failed to load master records." });
    } finally {
      setLoading(false);
    }
  }

  async function loadReferences() {
    try {
      const [states, districts, zones, divisions] = await Promise.all([
        apiClient.masterCatalog.list("state", { limit: 10000 }),
        apiClient.masterCatalog.list("district", { limit: 10000 }),
        apiClient.masterCatalog.list("zone", { limit: 10000 }),
        apiClient.masterCatalog.list("division", { limit: 10000 }),
      ]);
      setReferences({
        states: states?.items || [],
        districts: districts?.items || [],
        zones: zones?.items || [],
        divisions: divisions?.items || [],
      });
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "Failed to load dropdown masters." });
    }
  }

  function resetFormFor(master = activeMaster) {
    setForm(Object.fromEntries(master.fields.map((field) => [field.name, ""])));
    setEditingId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validation = activeMaster.validate(form);
    if (validation) {
      setMessage({ kind: "error", text: validation });
      return;
    }

    setSaving(true);
    setMessage({ kind: "info", text: "" });
    try {
      if (editingId) {
        await apiClient.masterCatalog.update(activeKey, editingId, normalizePayload(form, activeMaster));
        setMessage({ kind: "success", text: `${activeMaster.label} updated.` });
      } else {
        await apiClient.masterCatalog.create(activeKey, normalizePayload(form, activeMaster));
        setMessage({ kind: "success", text: `${activeMaster.label} saved.` });
      }
      resetFormFor(activeMaster);
      await Promise.all([loadRows(), loadReferences()]);
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "Failed to save master record." });
    } finally {
      setSaving(false);
    }
  }

  function editRow(row) {
    setEditingId(row.id);
    setForm(
      Object.fromEntries(
        activeMaster.fields.map((field) => [field.name, row[field.name] || ""])
      )
    );
    setMessage({ kind: "info", text: "" });
  }

  async function deleteRow(row) {
    if (!window.confirm(`Delete ${row.code || row.station_code || row.name}?`)) return;
    setMessage({ kind: "info", text: "" });
    try {
      await apiClient.masterCatalog.delete(activeKey, row.id);
      await Promise.all([loadRows(), loadReferences()]);
      setMessage({ kind: "success", text: `${activeMaster.label} deleted.` });
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "Failed to delete master record." });
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSaving(true);
    setMessage({ kind: "info", text: "Importing records..." });
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const records = workbook.SheetNames.flatMap((sheetName) =>
        XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" })
      );

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      for (const record of records) {
        const payload = buildPayloadFromImport(record, activeMaster);
        const validation = activeMaster.validate(payload);
        if (validation) {
          skipped += 1;
          continue;
        }

        try {
          await apiClient.masterCatalog.create(activeKey, normalizePayload(payload, activeMaster));
          imported += 1;
        } catch {
          failed += 1;
        }
      }

      await Promise.all([loadRows(), loadReferences()]);
      setMessage({
        kind: failed > 0 ? "warning" : "success",
        text: `Import finished. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}.`,
      });
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "Import failed." });
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  }

  function exportRows() {
    const exportData = rows.map((row) =>
      Object.fromEntries(activeMaster.columns.map((column) => [columnLabel(column), row[column] || ""]))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportData), activeMaster.label);
    XLSX.writeFile(workbook, `${activeMaster.label.replace(/\s+/g, "_")}_${Date.now()}.xlsx`);
  }

  const messageClass =
    message.kind === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : message.kind === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-border bg-card text-muted-foreground";
  const activeMasterName = activeMaster.label.replace(" Master", "");

  return (
    <div className="min-h-full bg-background p-4 lg:p-6 animate-fade-in">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Master Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage state, district, station, zone, division, commodity, company and product masters.
          </p>
        </div>
      </div>

      <main className="min-w-0 space-y-5">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-foreground">{activeMaster.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create, search, edit and delete {activeMasterName.toLowerCase()} records in one workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={exportRows}
                  disabled={rows.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeMaster.importHeaders.map((header) => (
                <span key={header} className="rounded border border-primary/20 bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
                  {header}
                </span>
              ))}
            </div>
          </section>

          {message.text && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${messageClass}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">
                  {editingId ? `Edit ${activeMasterName}` : `Create ${activeMasterName}`}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Dropdown values are loaded from master records.
                </p>
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={() => resetFormFor(activeMaster)}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeMaster.fields.map((field) => (
                <MasterField
                  key={field.name}
                  field={field}
                  value={form[field.name] || ""}
                  form={form}
                  references={references}
                  disabled={saving}
                  onChange={(value) =>
                    setForm((prev) => updateDependentForm(prev, activeKey, field.name, value))
                  }
                />
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {editingId ? `Update ${activeMasterName}` : `Create ${activeMasterName}`}
              </button>
            </div>
          </form>

          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 className="font-semibold text-foreground">Existing {activeMasterName} Records</h3>
                <p className="text-xs text-muted-foreground">{total} record(s)</p>
              </div>
              <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 sm:w-80">
                <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by name/code"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-blue-700 text-white">
                    {activeMaster.columns.map((column) => (
                      <th key={column} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                        {columnLabel(column)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-border/50">
                        {[...Array(activeMaster.columns.length + 1)].map((__, colIndex) => (
                          <td key={colIndex} className="px-4 py-3">
                            <div className="h-4 animate-pulse rounded bg-muted" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={activeMaster.columns.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        No {activeMasterName.toLowerCase()} records found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 bg-white hover:bg-blue-50/60">
                        {activeMaster.columns.map((column) => (
                          <td key={column} className="px-4 py-3 text-foreground">
                            {row[column] || "-"}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editRow(row)}
                              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Edit"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRow(row)}
                              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages} - {total} record(s)
              </span>
              <div className="flex gap-2">
                <PageButton disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Prev</PageButton>
                <PageButton disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</PageButton>
              </div>
            </div>
          </section>
      </main>
    </div>
  );
}

function MasterField({ field, value, form, references, disabled, onChange }) {
  if (field.type === "select") {
    return (
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {field.label}
        </span>
        <SearchableSelect
          value={value}
          onChange={onChange}
          options={selectOptions(field, form, references)}
          placeholder={`Select ${field.label}`}
          disabled={disabled}
          inputClassName="bg-background"
        />
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {field.label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        disabled={disabled}
      />
    </label>
  );
}

function PageButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border bg-muted px-3 py-1 text-xs text-foreground hover:bg-muted/80 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function selectOptions(field, form, references) {
  if (field.source === "states") return toOptions(references.states);
  if (field.source === "zones") return toOptions(references.zones);
  if (field.source === "districts") {
    const state = String(form.state || "").trim().toUpperCase();
    const rows = state
      ? references.districts.filter((row) => row.parent_code === state)
      : references.districts;
    return toOptions(rows);
  }
  if (field.source === "divisions") {
    const zone = String(form.zone || "").trim().toUpperCase();
    const rows = zone
      ? references.divisions.filter((row) => row.parent_code === zone)
      : references.divisions;
    return toOptions(rows);
  }
  return [];
}

function toOptions(rows) {
  return rows.map((row) => ({
    value: row.code,
    label: `${row.name || row.code} (${row.code})`,
  }));
}

function updateDependentForm(prev, activeKey, fieldName, rawValue) {
  const value = normalizeFieldValue(fieldName, rawValue);
  const next = { ...prev, [fieldName]: value };
  if (activeKey === "station" && fieldName === "state") next.district = "";
  if (activeKey === "station" && fieldName === "zone") next.division = "";
  return next;
}

function requireFields(form, fields) {
  const missing = fields
    .filter(([name]) => !String(form[name] || "").trim())
    .map(([, label]) => label);
  return missing.length ? `${missing.join(", ")} required.` : "";
}

function normalizePayload(form, master) {
  return Object.fromEntries(
    master.fields.map((field) => [
      field.name,
      normalizeFieldValue(field.name, form[field.name]),
    ])
  );
}

function normalizeFieldValue(fieldName, value) {
  const text = String(value || "").trim();
  return CODE_FIELDS.has(fieldName) ? text.toUpperCase() : text;
}

function columnLabel(column) {
  return column
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPayloadFromImport(row, master) {
  const payload = {};
  for (const [fieldName, headers] of Object.entries(master.importMap)) {
    payload[fieldName] = firstImportValue(row, headers);
  }
  return payload;
}

function firstImportValue(row, headers) {
  for (const header of headers) {
    const value =
      row[header] ??
      row[header.toLowerCase()] ??
      row[header.toUpperCase()] ??
      row[columnLabel(header)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}
