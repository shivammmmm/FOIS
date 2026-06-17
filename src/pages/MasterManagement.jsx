import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

/**
 * This file is intentionally written with explicit types to avoid strict TS errors.
 */

export default function MasterManagement() {
  const tabs = useMemo(() => ["state", "district", "commodity"], []);

  const [activeTab, setActiveTab] = useState("state");
  const [uploading, setUploading] = useState(false);

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
    commodity_code: "",
    commodity_name: "",
    commodity_group_code: "",
    commodity_group_name: "",
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
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/masters/states", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch states");
      const data = await res.json();
      setStates(Array.isArray(data) ? data : data?.items || []);
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: "Unable to load state master list.",
      });
      console.error("Failed to load states matrix:", err);
    }
  };

  useEffect(() => {
    loadStates();
  }, []);

  // Convert possible XLSX fields to expected casing
  const readRowFields = (row) => {
    // Expected Columns: StateName, StateCode, DistrictName
    const stateName = row.StateName ?? row.state_name ?? row.State;
    const stateCode = row.StateCode ?? row.state_code ?? row.Code;
    const districtName = row.DistrictName ?? row.district_name ?? row.District;
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

        let successStates = 0;
        let successDistricts = 0;
        let skippedRows = 0;
        let errorRows = 0;

        for (const [idx, row] of data.entries()) {
          const { stateName, stateCode, districtName } = readRowFields(row);

          if (!stateName || !stateCode) {
            skippedRows += 1;
            continue;
          }

          try {
            // 1) Create state
            const token = localStorage.getItem("token");

            const stateRes = await fetch("/api/masters/states", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ name: stateName, code: stateCode }),
            });

            if (!stateRes.ok) {
              // Duplicate/409 should not kill import; skip further district call if state not created
              continue;
            }

            const stateData = await stateRes.json();
            const activeStateId = stateData?.id;
            successStates += 1;

            // 2) Create district (optional)
            if (districtName && activeStateId) {
              const token = localStorage.getItem("token") || "";

              const dRes = await fetch("/api/masters/districts", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  name: districtName,
                  // backend contract: district_master.parent_code must be the parent state's code
                  parent_code: stateCode,
                }),
              });

              if (dRes.ok) successDistricts += 1;
            }
          } catch (err) {
            errorRows += 1;
            console.warn(`Bulk import row failed at index ${idx}:`, err);
          }
        }

        setUiMessage({
          kind: "success",
          text: `Bulk import finished. States: ${successStates}, Districts: ${successDistricts}, Skipped: ${skippedRows}, Errors: ${errorRows}.`,
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
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/masters/states", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: stateForm.name.trim(),
          code: stateForm.code.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error creating state");

      setUiMessage({ kind: "success", text: "State Created Successfully!" });
      setStateForm({ name: "", code: "" });
      await loadStates();
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: err?.message || "Failed to create state.",
      });
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
      !commodityForm.commodity_code.trim() ||
      !commodityForm.commodity_name.trim()
    ) {
      setUiMessage({
        kind: "warning",
        text: "Commodity code and descriptive name are required.",
      });
      return;
    }

    setUploading(true);
    try {
      const payload = {
        commodity_code: commodityForm.commodity_code.trim(),
        commodity_name: commodityForm.commodity_name.trim(),
        commodity_group_code: commodityForm.commodity_group_code?.trim() || "",
        commodity_group_name: commodityForm.commodity_group_name?.trim() || "",
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
      if (!res.ok) throw new Error(data?.error || "Error creating commodity");

      setUiMessage({
        kind: "success",
        text: "Commodity Registered Successfully!",
      });
      setCommodityForm({
        commodity_code: "",
        commodity_name: "",
        commodity_group_code: "",
        commodity_group_name: "",
      });
    } catch (err) {
      setUiMessage({
        kind: "error",
        text: err?.message || "Failed to register commodity.",
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
              {tab} Master
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
                <select
                  value={districtForm.parent_code}
                  onChange={(e) =>
                    setDistrictForm({
                      ...districtForm,
                      parent_code: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg bg-white w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                >
                  <option value="">-- Choose State --</option>
                  {states.map((st) => (
                    <option key={st.id || st.code} value={st.code}>
                      {st.name} ({st.code})
                    </option>
                  ))}
                </select>
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
              Add Production Commodity Master
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Commodity Code (Unique)
                </label>
                <input
                  type="text"
                  placeholder="e.g. COAL"
                  value={commodityForm.commodity_code}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      commodity_code: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Commodity Descriptive Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Steam Coal Grade A"
                  value={commodityForm.commodity_name}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      commodity_name: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Group Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. MIN"
                  value={commodityForm.commodity_group_code}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      commodity_group_code: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Group Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. MINERALS"
                  value={commodityForm.commodity_group_name}
                  onChange={(e) =>
                    setCommodityForm({
                      ...commodityForm,
                      commodity_group_name: e.target.value,
                    })
                  }
                  className="border p-2.5 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={uploading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full md:w-48 self-end bg-blue-600 text-white font-bold p-2.5 rounded-lg mt-2 shadow hover:bg-blue-700 disabled:opacity-60"
            >
              Register Commodity
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
