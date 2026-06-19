import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import SearchableSelect from "@/components/SearchableSelect";

const STATE_MASTER_API = "/api/state-master";
const DISTRICT_MASTER_API = "/api/district-master";
const DISTRICT_LOOKUP_API = "/api/masters/districts";

const normalizeStateName = (value) => String(value || "").trim();
const normalizeStateCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();
const normalizeDistrictName = (value) => String(value || "").trim();

const authHeaders = (withJson = false) => {
  const token = localStorage.getItem("token") || "";
  return {
    ...(withJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const readApiError = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  return data?.error || data?.message || `${fallback} (${res.status})`;
};

export default function MasterManagement() {
  const tabs = useMemo(() => ["state", "district", "commodity"], []);

  const [activeTab, setActiveTab] = useState("state");
  const [uploading, setUploading] = useState(false);
  const didLoadStates = useRef(false);

  // Centralized UI feedback
  const [uiMessage, setUiMessage] = useState({
    kind: "info", // info | success | warning | error
    text: "",
  });

  const [states, setStates] = useState([]);

  // Individual Form States
  const [stateForm, setStateForm] = useState({ name: "", code: "" });
  const [districtForm, setDistrictForm] = useState({
    name: "",
    code: "",
    parent_code: "",
  });

  const [commodityForm, setCommodityForm] = useState({
    code: "",
    full_name: "",
    type: "Commodity",
  });

  const toastClass = useMemo(() => {
    const base = "text-sm px-3 py-2 rounded-lg border";
    if (uiMessage.kind === "success")
      return `${base} bg-emerald-50 border-emerald-200 text-emerald-800`;
    if (uiMessage.kind === "warning")
      return `${base} bg-amber-50 border-amber-200 text-amber-800`;
    if (uiMessage.kind === "error")
      return `${base} bg-red-50 border-red-200 text-red-800`;
    return `${base} bg-blue-50 border-blue-200 text-blue-800`;
  }, [uiMessage.kind]);

  // Fetch States using Native Fetch API (auth-protected)
  const loadStates = async () => {
    try {
      console.info("[StateMaster] Loading states", {
        endpoint: STATE_MASTER_API,
      });
      const res = await fetch(STATE_MASTER_API, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to fetch states"));
      }
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.items || [];
      setStates(items);
      console.info("[StateMaster] States loaded", { count: items.length });
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: err?.message || "Unable to load state master list.",
      });
      console.error("[StateMaster] Failed to load states:", err);
    }
  };

  useEffect(() => {
    if (didLoadStates.current) return;
    didLoadStates.current = true;
    loadStates();
  }, []);

  // Convert possible XLSX fields to expected casing
  const readRowFields = (row) => {
    // Expected Columns: StateName, StateCode, DistrictName
    const stateName = normalizeStateName(
      row.StateName ?? row.state_name ?? row.State ?? row.name ?? row.Name
    );
    const stateCode = normalizeStateCode(
      row.StateCode ?? row.state_code ?? row.Code ?? row.code
    );
    const districtName = normalizeDistrictName(
      row.DistrictName ??
        row.district_name ??
        row.District ??
        row.district ??
        row.District_Name
    );
    return { stateName, stateCode, districtName };
  };

  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUiMessage({ kind: "info", text: "Reading Excel workbook..." });

    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        // XLSX read supports binary string
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames?.[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (!Array.isArray(data) || data.length === 0) {
          setUiMessage({
            kind: "warning",
            text: "Excel file is empty (no rows found).",
          });
          return;
        }

        setUiMessage({
          kind: "info",
          text: `Processing ${data.length} rows...`,
        });

        const knownCodes = new Set(
          states.map((state) => normalizeStateCode(state?.code)).filter(Boolean)
        );
        let successStates = 0;
        let successDistricts = 0;
        let duplicateDistricts = 0;
        const existingStatesUsed = new Set();
        let skippedRows = 0;
        let errorRows = 0;
        const districtNamesByState = new Map();

        const loadDistrictNamesForState = async (stateCode) => {
          if (districtNamesByState.has(stateCode)) {
            return districtNamesByState.get(stateCode);
          }

          try {
            const res = await fetch(
              `${DISTRICT_LOOKUP_API}?state_code=${encodeURIComponent(
                stateCode
              )}`,
              { headers: authHeaders() }
            );
            if (!res.ok) {
              throw new Error(
                await readApiError(res, "Failed to fetch districts")
              );
            }

            const data = await res.json();
            const items = Array.isArray(data) ? data : data?.items || [];
            const districtNames = new Set(
              items
                .map((district) =>
                  normalizeDistrictName(district?.name).toUpperCase()
                )
                .filter(Boolean)
            );
            districtNamesByState.set(stateCode, districtNames);
            return districtNames;
          } catch (err) {
            console.warn("[DistrictMaster import] District lookup failed", {
              stateCode,
              error: err,
            });
            const districtNames = new Set();
            districtNamesByState.set(stateCode, districtNames);
            return districtNames;
          }
        };

        for (const [idx, row] of data.entries()) {
          const { stateName, stateCode, districtName } = readRowFields(row);

          if (!stateName || !stateCode) {
            skippedRows += 1;
            console.warn("[Master import] Skipping row with missing state data", {
              rowNumber: idx + 2,
              row,
            });
            continue;
          }

          if (knownCodes.has(stateCode)) {
            existingStatesUsed.add(stateCode);
            console.info("[DistrictMaster import] Using existing state", {
              rowNumber: idx + 2,
              name: stateName,
              code: stateCode,
            });
          } else {
            try {
              const payload = { name: stateName, code: stateCode };
              console.info("[StateMaster import] Creating state", {
                rowNumber: idx + 2,
                endpoint: STATE_MASTER_API,
                payload,
              });

              const stateRes = await fetch(STATE_MASTER_API, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify(payload),
              });

              if (!stateRes.ok) {
                const message = await readApiError(
                  stateRes,
                  "Error creating state"
                );
                if (
                  stateRes.status === 409 ||
                  /already exists/i.test(message)
                ) {
                  knownCodes.add(stateCode);
                  existingStatesUsed.add(stateCode);
                  console.info(
                    "[DistrictMaster import] Existing state reported by API",
                    {
                      rowNumber: idx + 2,
                      name: stateName,
                      code: stateCode,
                      message,
                    }
                  );
                } else {
                  errorRows += 1;
                  console.warn("[StateMaster import] API rejected row", {
                    rowNumber: idx + 2,
                    name: stateName,
                    code: stateCode,
                    status: stateRes.status,
                    message,
                  });
                  continue;
                }
              } else {
                const stateData = await stateRes.json().catch(() => ({}));
                successStates += 1;
                knownCodes.add(normalizeStateCode(stateData?.code || stateCode));
                console.info(
                  "[StateMaster import] State created",
                  {
                    rowNumber: idx + 2,
                    name: stateName,
                    code: stateCode,
                  }
                );
              }
            } catch (err) {
              errorRows += 1;
              console.warn("[StateMaster import] Row failed", {
                rowNumber: idx + 2,
                row,
                error: err,
              });
              continue;
            }
          }

          if (!districtName) {
            continue;
          }

          try {
            const existingDistrictNames = await loadDistrictNamesForState(
              stateCode
            );
            const districtKey = districtName.toUpperCase();

            if (existingDistrictNames.has(districtKey)) {
              duplicateDistricts += 1;
              console.info("[DistrictMaster import] Duplicate district skipped", {
                rowNumber: idx + 2,
                stateCode,
                districtName,
              });
              continue;
            }

            const payload = {
              name: districtName,
              parent_code: stateCode,
            };
            console.info("[DistrictMaster import] Creating district", {
              rowNumber: idx + 2,
              endpoint: DISTRICT_MASTER_API,
              payload,
            });

            const districtRes = await fetch(DISTRICT_MASTER_API, {
              method: "POST",
              headers: authHeaders(true),
              body: JSON.stringify(payload),
            });

            if (!districtRes.ok) {
              const message = await readApiError(
                districtRes,
                "Error creating district"
              );
              if (
                districtRes.status === 409 ||
                /already exists/i.test(message)
              ) {
                duplicateDistricts += 1;
                existingDistrictNames.add(districtKey);
                console.info(
                  "[DistrictMaster import] Duplicate district reported by API",
                  {
                    rowNumber: idx + 2,
                    stateCode,
                    districtName,
                    message,
                  }
                );
                continue;
              }

              errorRows += 1;
              console.warn("[DistrictMaster import] API rejected row", {
                rowNumber: idx + 2,
                stateCode,
                districtName,
                status: districtRes.status,
                message,
              });
              continue;
            }

            await districtRes.json().catch(() => ({}));
            successDistricts += 1;
            existingDistrictNames.add(districtKey);
          } catch (err) {
            errorRows += 1;
            console.warn("[DistrictMaster import] Row failed", {
              rowNumber: idx + 2,
              row,
              error: err,
            });
          }
        }

        setUiMessage({
          kind: "success",
          text: `Bulk import finished. States created: ${successStates}, Existing states used: ${existingStatesUsed.size}, Districts created: ${successDistricts}, Duplicate districts: ${duplicateDistricts}, Skipped: ${skippedRows}, Errors: ${errorRows}.`,
        });
        await loadStates();
      } catch (error) {
        console.error("Excel mapping breakdown:", error);
        setUiMessage({
          kind: "error",
          text: "Failed to read excel layout structure.",
        });
      } finally {
        setUploading(false);
        // reset input
        e.target.value = "";
      }
    };

    reader.readAsBinaryString(file);
  };

  // Individual Form Submissions using native fetch
  const handleCreateState = async (e) => {
    e.preventDefault();

    if (!stateForm.name.trim() || !stateForm.code.trim()) {
      setUiMessage({
        kind: "warning",
        text: "State name and code are required.",
      });
      return;
    }

    setUploading(true);
    try {
      const payload = {
        name: normalizeStateName(stateForm.name),
        code: normalizeStateCode(stateForm.code),
      };
      console.info("[StateMaster] Creating state", {
        endpoint: STATE_MASTER_API,
        payload,
      });

      const res = await fetch(STATE_MASTER_API, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.error || "Error creating state");
        err.kind = res.status === 409 ? "warning" : "error";
        throw err;
      }

      setUiMessage({ kind: "success", text: "State Created Successfully!" });
      setStateForm({ name: "", code: "" });
      await loadStates();
    } catch (err) {
      setUiMessage({
        kind: err?.kind || "error",
        text: err?.message || "Failed to create state.",
      });
      console.error("[StateMaster] Failed to create state:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateDistrict = async (e) => {
    e.preventDefault();

    if (!districtForm.name.trim() || !districtForm.parent_code) {
      setUiMessage({
        kind: "warning",
        text: "District name and parent state are required.",
      });
      return;
    }

    setUploading(true);
    try {
      const token = localStorage.getItem("token") || "";
      const parent_code = String(districtForm.parent_code || "").trim();
      const payload = {
        name: districtForm.name.trim(),
        code: districtForm.code?.trim() || "",
        parent_code,
      };

      console.log("[createDistrict] final payload:", payload);

      const res = await fetch("/api/masters/districts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error creating district");

      setUiMessage({ kind: "success", text: "District Mapped Successfully!" });
      setDistrictForm({ name: "", code: "", parent_code: "" });
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: err?.message || "Failed to map district.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCreateCommodity = async (e) => {
    e.preventDefault();

    if (
      !commodityForm.code.trim() ||
      !commodityForm.full_name.trim()
    ) {
      setUiMessage({
        kind: "warning",
        text: "Code and full name are required.",
      });
      return;
    }

    setUploading(true);
    try {
      const payload = {
        code: commodityForm.code.trim(),
        full_name: commodityForm.full_name.trim(),
        type: commodityForm.type,
      };

      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/masters/commodities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error creating dictionary entry");

      setUiMessage({
        kind: "success",
        text: "Code Dictionary Entry Registered Successfully!",
      });
      setCommodityForm({
        code: "",
        full_name: "",
        type: "Commodity",
      });
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: err?.message || "Failed to register code.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen rounded-xl shadow-inner">
      {/* HEADER & EXCEL WIDGET */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b pb-3 mb-6 gap-4">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          ⚙️ Core Master Management Panel
        </h2>

        <div className="bg-white p-3 rounded-xl shadow-sm border border-dashed border-blue-400 flex flex-col gap-1 text-left w-full md:w-auto">
          <span className="text-xs font-bold text-blue-700">
            ⚡ Bulk Import (Excel)
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelImport}
            disabled={uploading}
            className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
          {uploading ? (
            <span className="text-[10px] text-orange-500 font-medium animate-pulse">
              Processing... Please wait.
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Columns: StateName, StateCode, DistrictName
            </span>
          )}
        </div>
      </div>

      {/* Response message */}
      {uiMessage.text && (
        <div className="mb-4">
          <div className={toastClass} role="status" aria-live="polite">
            {uiMessage.text}
          </div>
        </div>
      )}

      {/* TABS CONTROL LAYOUT */}
      <div className="flex border-b mb-6 bg-white rounded-t-lg p-1 shadow-sm">
        {tabs.map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setUiMessage({ kind: "info", text: "" });
              }}
              className={`flex-1 py-2.5 text-sm font-bold uppercase rounded-md transition-all ${
                active
                  ? "bg-blue-600 text-white shadow-md ring-1 ring-blue-200"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              }`}
              aria-pressed={active}
            >
              {tab === "commodity" ? "Commodity Master" : `${tab} Master`}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        {/* STATE FORM */}
        {activeTab === "state" && (
          <form onSubmit={handleCreateState} className="flex flex-col gap-4">
            <h3 className="text-lg font-bold text-blue-700">
              Add New Geographical State
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  State Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Goa"
                  value={stateForm.name}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, name: e.target.value })
                  }
                  className="border p-2.5 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  State Code (Unique)
                </label>
                <input
                  type="text"
                  placeholder="e.g. GA"
                  maxLength={2}
                  value={stateForm.code}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, code: e.target.value })
                  }
                  className="border p-2.5 rounded-lg w-full uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full md:w-48 self-end bg-blue-600 text-white font-bold p-2.5 rounded-lg mt-2 shadow hover:bg-blue-700 disabled:opacity-60"
            >
              Save State Master
            </button>
          </form>
        )}

        {/* DISTRICT FORM */}
        {activeTab === "district" && (
          <form onSubmit={handleCreateDistrict} className="flex flex-col gap-4">
            <h3 className="text-lg font-bold text-blue-700">
              Add New District Boundary
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Select Parent State
                </label>
                <SearchableSelect
                  placeholder="-- Choose State --"
                  value={districtForm.parent_code}
                  options={states.map((st) => ({
                    value: st.code,
                    label: `${st.name} (${st.code})`,
                  }))}
                  onChange={(val) =>
                    setDistrictForm({
                      ...districtForm,
                      parent_code: val,
                    })
                  }
                  disabled={uploading}
                  inputClassName="border p-2.5 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  District Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. South Goa"
                  value={districtForm.name}
                  onChange={(e) =>
                    setDistrictForm({ ...districtForm, name: e.target.value })
                  }
                  className="border p-2.5 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  District Operational Code (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. SGA"
                  value={districtForm.code}
                  onChange={(e) =>
                    setDistrictForm({ ...districtForm, code: e.target.value })
                  }
                  className="border p-2.5 rounded-lg w-full uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full md:w-48 self-end bg-blue-600 text-white font-bold p-2.5 rounded-lg mt-2 shadow hover:bg-blue-700 disabled:opacity-60"
            >
              Map District Master
            </button>
          </form>
        )}

        {/* COMMODITY FORM */}
        {activeTab === "commodity" && (
          <form
            onSubmit={handleCreateCommodity}
            className="flex flex-col gap-4"
          >
            <h3 className="text-lg font-bold text-blue-700">
              Add Code Dictionary Entry
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Code (Unique)
                </label>
                <input
                  type="text"
                  placeholder="e.g. HSD or BOXN"
                  value={commodityForm.code}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      code: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Full Name / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. High Speed Diesel"
                  value={commodityForm.full_name}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      full_name: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Type
                </label>
                <select
                  value={commodityForm.type}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      type: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                >
                  <option value="Commodity">Commodity</option>
                  <option value="Rake CMDT">Rake CMDT</option>
                  <option value="Wagon Type">Wagon Type</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full md:w-48 self-end bg-blue-600 text-white font-bold p-2.5 rounded-lg mt-2 shadow hover:bg-blue-700 disabled:opacity-60"
            >
              Register Code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
