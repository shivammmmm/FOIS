import fs from "node:fs/promises";
import { PDFParse } from "pdf-parse";

const STATION_PDF_SOURCE = {
  name: "Indian Railways station name master PDF",
  url: "https://indianrailways.gov.in/station_name.pdf",
};

const RCT_STATION_HELP_SOURCE = {
  name: "Railway Claims Tribunal station/siding help",
  url: "https://rct.indianrail.gov.in/rct/casedata.stnhelp?btnGo=Go&txtlo=&txtstnname=",
};

const SOURCES = [
  {
    name: "Central Railway station categories",
    url: "https://cr.indianrailways.gov.in/view_section.jsp?id=0%2C6%2C287%2C1924%2C1926&lang=0",
    stateful: true,
  },
  {
    name: "South Eastern Railway station categories",
    url: "https://ser.indianrailways.gov.in/view_section.jsp?backgroundColor=LIGHTSTEELBLUE&fontColor=black&id=0%2C2%2C406%2C2246%2C2247&lang=0",
    stateful: true,
  },
  {
    name: "North Central Railway station list",
    url: "https://ncr.indianrailways.gov.in/view_section.jsp?backgroundColor=LIGHTSTEELBLUE&fontColor=black&id=0%2C6%2C1409%2C1410&lang=0",
    stateful: false,
  },
  {
    name: "North Central Railway station list 2",
    url: "https://ncr.indianrailways.gov.in/view_section.jsp?backgroundColor=LIGHTSTEELBLUE&fontColor=black&id=0%2C6%2C1409%2C1412&lang=0",
    stateful: false,
  },
  {
    name: "Eastern Railway Asansol division",
    url: "https://er.indianrailways.gov.in/print_section.jsp?id=0%2C6%2C443%2C528%2C537&lang=0",
    stateful: false,
  },
];

const STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const OUTPUT = new URL("../src/data/stationMaster.generated.js", import.meta.url);

const htmlToText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const cleanName = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+JN\.?$/i, " Junction")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .trim();

const normalizeCode = (value) => String(value || "").trim().toUpperCase();

function upsert(master, code, data) {
  const upper = normalizeCode(code);
  if (!upper || upper.length < 2 || upper.length > 6) return;
  if (/^\d+$/.test(upper)) return;

  master[upper] = {
    ...(master[upper] || {}),
    code: upper,
    ...Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    ),
  };
}

function parseStatefulRows(text, sourceName, master) {
  const statePattern = STATES.join("|").replace(/\s/g, "\\s+");
  const rowRegex = new RegExp(
    String.raw`\b\d{1,4}\s+(.{2,80}?)\s+([A-Z][A-Z0-9]{1,5})\s+([A-Za-z][A-Za-z0-9 .&/-]{1,30})\s+(${statePattern})\s+(NSG|SG|HG)-?\s*\d`,
    "gi"
  );

  let match;
  while ((match = rowRegex.exec(text))) {
    upsert(master, match[2], {
      name: cleanName(match[1]),
      division: cleanName(match[3]),
      state: cleanName(match[4]),
      source: sourceName,
    });
  }
}

function parseNameCodeRows(text, sourceName, master) {
  const rowRegex = /\b\d{1,4}\s+([A-Z][A-Z .,'()/-]{2,80}?)\s+([A-Z][A-Z0-9]{1,5})(?=\s+\d|\s+[A-Z]{2,}\b|$)/g;
  let match;
  while ((match = rowRegex.exec(text))) {
    const name = cleanName(match[1]);
    const code = normalizeCode(match[2]);
    if (name.length < 3 || STATES.includes(name)) continue;
    upsert(master, code, { name, source: sourceName });
  }
}

async function parseRctStationHelp(master) {
  const response = await fetch(RCT_STATION_HELP_SOURCE.url, {
    headers: {
      "user-agent": "FoisStationMasterImporter/1.0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const text = htmlToText(await response.text());
  const rowRegex = /\b([A-Z0-9]{1,6})-(.+?)\s+\(\s*([A-Za-z0-9]+)\s*\)/g;
  let match;

  while ((match = rowRegex.exec(text))) {
    const [, code, name, zone] = match;
    upsert(master, code, {
      name: cleanName(name),
      zone: normalizeCode(zone),
      source: RCT_STATION_HELP_SOURCE.name,
    });
  }
}

async function parseStationPdf(master) {
  const parser = new PDFParse({ url: STATION_PDF_SOURCE.url });
  try {
    const result = await parser.getText();
    const lines = result.text.split(/\r?\n/);

    for (const line of lines) {
      if (!/^\s*\d+\s+/.test(line)) continue;

      const cols = line
        .split(/\t+/)
        .map((col) => col.trim())
        .filter(Boolean);

      if (cols.length < 8) continue;

      const serialAndName = cols[0];
      const name = serialAndName.replace(/^\d+\s+/, "").trim();
      const code = cols[1];
      const oldCategory = cols[2];
      const newCategory = cols[3];
      const division = cols[4];
      const zone = cols[5];
      const district = cols[6];
      const state = cols[7];

      upsert(master, code, {
        name: cleanName(name),
        division: normalizeCode(division),
        zone: normalizeCode(zone),
        district: cleanName(district),
        state: cleanName(state),
        category: newCategory || oldCategory,
        source: STATION_PDF_SOURCE.name,
      });
    }
  } finally {
    await parser.destroy?.();
  }
}

async function fetchText(source) {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": "FoisStationMasterImporter/1.0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return htmlToText(await response.text());
}

async function main() {
  const master = {};

  try {
    await parseRctStationHelp(master);
    console.log(`[ok] ${RCT_STATION_HELP_SOURCE.name}`);
  } catch (error) {
    console.warn(`[skip] ${RCT_STATION_HELP_SOURCE.name}: ${error.message}`);
  }

  try {
    await parseStationPdf(master);
    console.log(`[ok] ${STATION_PDF_SOURCE.name}`);
  } catch (error) {
    console.warn(`[skip] ${STATION_PDF_SOURCE.name}: ${error.message}`);
  }

  for (const source of SOURCES) {
    try {
      const text = await fetchText(source);
      if (source.stateful) parseStatefulRows(text, source.name, master);
      parseNameCodeRows(text, source.name, master);
      console.log(`[ok] ${source.name}`);
    } catch (error) {
      console.warn(`[skip] ${source.name}: ${error.message}`);
    }
  }

  const sorted = Object.fromEntries(Object.entries(master).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.keys(sorted).length === 0) {
    throw new Error("No stations were imported. Existing generated file was left unchanged.");
  }

  const js = `// Generated by scripts/import-station-master.mjs.\n// Source: official Indian Railways public pages listed in the importer.\nexport const GENERATED_STATION_MASTER = ${JSON.stringify(sorted, null, 2)};\n`;
  await fs.writeFile(OUTPUT, js, "utf8");
  console.log(`Wrote ${Object.keys(sorted).length} stations to ${OUTPUT.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
