/**
 * Utility for comparing ODR data against Matured Indent data.
 * Column mapping based on actual FOIS Excel format.
 */

export function generateBatchId() {
  return `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

const WAGON_TYPE_CODES = new Set([
  "BCN",
  "BCNA",
  "BCNAHSM1",
  "BCNHL",
  "BOBR",
  "BOBRN",
  "BOBRNHSM1",
  "BOBRNHSM2",
  "BOSM",
  "BOST",
  "BOXCL",
  "BOXN",
  "BOXNEL",
  "BOXNHA",
  "BOXNHL",
  "BOXNHL25T",
  "BOXNR",
  "BTPN",
  "NMG",
  "NMGH",
]);

function isWagonType(value) {
  if (!value) return false;
  const val = String(value).trim().toUpperCase();
  if (/^\d+$/.test(val)) return true;
  if (WAGON_TYPE_CODES.has(val)) return true;
  return /^(BOX|BOB|BOS|BCN|BTP|NMG)/.test(val);
}

/**
 * Parse a raw Excel row (ODR file) into a FreightMovement record.
 * Uses normalized FOIS column names.
 */
export function parseODRRow(row, batchId) {
  const fields = getFoisFields(row);
  if (!fields.srNo || !fields.division || !fields.indentNo) return null;

  const movementType = detectMovementType(fields.pc, fields.indentType, fields.tt);
  const status = detectStatus(fields.expectedLoadingDate);

  const rawRakeCmdt = fields.rakeCmdt || "";
  const isWagon = isWagonType(rawRakeCmdt);
  const wagonType = fields.wagonType || (isWagon ? rawRakeCmdt : "");

  return {
    odr_number: fields.indentNo,
    zone: fields.division,
    division: fields.division,
    station_from: fields.stationFrom,
    station_to: fields.destination,
    company: fields.cnsr,
    company_code: fields.cnsr,
    commodity: fields.commodity,
    product: fields.product,
    product_code: fields.product,
    rake_type: fields.product,
    wagon_type: wagonType,
    rake_cmdt: !isWagon ? rawRakeCmdt : "",
    rake_commodity_code: !isWagon ? rawRakeCmdt : "",
    wagons: parseInt(fields.suppliedUnits, 10) || parseInt(fields.indented8w, 10) || parseInt(fields.indentedUnits, 10) || 0,
    arrival_date: normalizeDate(fields.expectedLoadingDate),
    departure_date: normalizeDate(fields.indentDate),
    movement_type: movementType,
    status,
    upload_batch_id: batchId,
    is_duplicate: false,
    raw_data: buildFoisRawData(fields)
  };
}

/**
 * Parse a raw Excel row (Matured Indent file) into a MaturedIndent record.
 * Uses Matured Indent-specific FOIS column names.
 */
export function parseIndentRow(row, batchId) {
  const fields = getFoisFields(row);
  if (!fields.srNo || !fields.division || !fields.indentNo) return null;

  const rawRakeCmdt = fields.rakeCmdt || "";
  const isWagon = isWagonType(rawRakeCmdt);
  const wagonType = fields.wagonType || (isWagon ? rawRakeCmdt : "");

  return {
    indent_number: fields.indentNo,
    zone: fields.division,
    division: fields.division,
    station_from: fields.stationFrom,
    station_to: fields.destination,
    company: fields.cnsr,
    company_code: fields.cnsr,
    commodity: fields.commodity,
    product: fields.product,
    product_code: fields.product,
    rake_type: fields.product,
    wagon_type: wagonType,
    rake_cmdt: !isWagon ? rawRakeCmdt : "",
    rake_commodity_code: !isWagon ? rawRakeCmdt : "",
    wagons_demanded: parseInt(fields.indented8w, 10) || parseInt(fields.indentedUnits, 10) || 0,
    indent_date: normalizeDate(fields.indentDate),
    maturity_date: normalizeDate(fields.expectedLoadingDate),
    odr_matched: false,
    matched_odr_number: '',
    upload_batch_id: batchId,
    raw_data: buildFoisRawData(fields)
  };
}

export function getIndentRowRejectionReason(row) {
  const fields = getFoisFields(row);
  const missing = [];
  if (!fields.srNo) missing.push('S.NO.');
  if (!fields.division) missing.push('DVSN');
  if (!fields.indentNo) missing.push('NO.');
  return missing.length
    ? `Missing required Matured Indent field(s): ${missing.join(', ')}`
    : '';
}

function getFoisFields(row) {
  return {
    srNo: cell(row, 'S.NO.'),
    division: cell(row, 'DVSN').toUpperCase(),
    stationFrom: cell(row, 'STTN FROM').toUpperCase(),
    indentNo: firstCell(row, ['NO.', 'DEMAND NO.', 'INDENT NO.', 'INDENT NUMBER']),
    indentDate: firstCell(row, ['DATE', 'DEMAND DATE', 'INDENT DATE']),
    indentTime: firstCell(row, ['TIME', 'DEMAND TIME', 'INDENT TIME']),
    expectedLoadingDate: cell(row, 'EXPECTED LOADING DATE'),
    cnsr: firstCell(row, [
      'CNSR',
      'CONSIGNOR',
      'CONSIGNOR CODE',
      'CONSIGNOR NAME',
      'COMPANY',
      'COMPANY CODE',
      'COMPANY NAME',
    ]).toUpperCase(),
    cnsg: cell(row, 'CNSG').toUpperCase(),
    commodity: cell(row, 'CMDT').toUpperCase(),
    product: firstCell(row, [
      'PRODUCT CODE',
      'PRODUCT',
      'PRODUCT NAME',
      'SUB COMMODITY',
      'SUB-COMMODITY',
      'SUBCOMMODITY',
      'SUB CMDT',
      'SUB CMDT CODE',
      'SUB COMMODITY CODE',
    ]).toUpperCase(),
    tt: cell(row, 'TT'),
    pc: cell(row, 'PC'),
    pbf: cell(row, 'PBF'),
    via: cell(row, 'VIA').toUpperCase(),
    rakeCmdt: cell(row, 'RAKE CMDT').toUpperCase(),
    wagonType: firstCell(row, [
      'WAGON TYPE',
      'RAKE STOCK TYPE',
      'RAKE STOCK',
      'STOCK TYPE',
      'WAGON',
      'WAGON CODE',
    ]).toUpperCase(),
    destination: cell(row, 'DSTN').toUpperCase(),
    indentType: firstCell(row, ['TYPE', 'INDENTED TYPE']).toUpperCase(),
    indentedUnits: firstCell(row, ['INDENTED UNTS', 'INDENTED UNITS']),
    indented8w: firstCell(row, ['INDENTED 8W', '8W']),
    otsgUnits: cell(row, 'OTSG UNTS'),
    otsg8w: cell(row, 'OTSG 8W'),
    suppliedUnits: cell(row, 'SUPPLIED UNTS'),
    suppliedTime: firstCell(row, ['SUPPLIED TIME', 'METWITH DATE']),
  };
}

function cell(row, key) {
  const normalized = normalizeRow(row);
  return String(normalized[normalizeHeader(key)] ?? '').trim();
}

function firstCell(row, keys) {
  for (const key of keys) {
    const value = cell(row, key);
    if (value) return value;
  }
  return '';
}

function normalizeRow(row) {
  return Object.entries(row || {}).reduce((acc, [key, value]) => {
    acc[normalizeHeader(key)] = value;
    return acc;
  }, {});
}

function normalizeHeader(header) {
  return String(header || '').trim().toUpperCase();
}

function buildFoisRawData(fields) {
  return {
    srNo: fields.srNo,
    indent_no: fields.indentNo,
    indent_time: fields.indentTime,
    expected_loading_date: fields.expectedLoadingDate,
    cnsr: fields.cnsr,
    cnsg: fields.cnsg,
    Company: fields.cnsr,
    CMDT: fields.commodity,
    Commodity: fields.commodity,
    Product: fields.product,
    "Rake CMDT": fields.rakeCmdt,
    "Wagon Type": fields.wagonType,
    FNR: fields.indentNo,
    via: fields.via,
    pbf: fields.pbf,
    pc: fields.pc,
    tt: fields.tt,
    indent_type: fields.indentType,
    indented_units: fields.indentedUnits,
    indented_8w: fields.indented8w,
    otsg_units: fields.otsgUnits,
    otsg_8w: fields.otsg8w,
    supplied_units: fields.suppliedUnits,
    supplied_time: fields.suppliedTime,
    Time: fields.indentTime,
    UpdatedTime: fields.suppliedTime,
  };
}

/**
 * Compare ODR records with Matured Indent records.
 * Returns lists of duplicates and unmatched indents.
 */
export function compareODRwithIndents(odrRecords, indentRecords) {
  // Find duplicates within ODR batch (same Sr No)
  const srNoCounts = {};
  odrRecords.forEach(r => {
    const key = r.odr_number;
    srNoCounts[key] = (srNoCounts[key] || 0) + 1;
  });
  const duplicates = odrRecords.filter(r => srNoCounts[r.odr_number] > 1);
  const duplicateNos = new Set(duplicates.map(r => r.odr_number));

  // Match indents to ODR records by Sr No or route
  const odrSet = new Set(odrRecords.map(r => r.odr_number));
  const unmatchedIndents = indentRecords.filter(i => !odrSet.has(i.indent_number));
  const matchedIndents = indentRecords.filter(i => odrSet.has(i.indent_number));

  return { duplicates, duplicateNos, unmatchedIndents, matchedIndents };
}

function detectMovementType(category, type, flag2) {
  // Category C = Coal (typically inward), D = Departmental, Y = Container
  // Type PC/GC = Private/General Coal
  // Flag2 hints: PHC = Private Handling Coal (inward), STC = Steel (could be either)
  if (category === 'D') return 'Outward';
  if (category === 'C') return 'Inward';
  if (type === 'RM') return 'Inward';
  return 'Unknown';
}

function detectStatus(arrivalDate) {
  if (!arrivalDate) return 'Pending';
  const d = normalizeDate(arrivalDate);
  if (!d) return 'Pending';
  const arrival = new Date(d);
  const now = new Date();
  if (arrival <= now) return 'Arrived';
  return 'In Transit';
}

function normalizeDate(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }

  const s = String(val).trim();
  const serial = Number(s);
  if (
    Number.isFinite(serial) &&
    serial >= 20000 &&
    serial <= 80000 &&
    /^\d+(\.\d+)?$/.test(s)
  ) {
    const date = new Date((Math.floor(serial) - 25569) * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }

  // dd-mm-yyyy or dd-mm-yy
  const m1 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m1) {
    let [, d, mo, y] = m1;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // dd/mm/yyyy
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m2) {
    let [, d, mo, y] = m2;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}
