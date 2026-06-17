/**
 * Utility for comparing ODR data against Matured Indent data.
 * Column mapping based on actual FOIS Excel format:
 * Sr No, Zone, Code (= Division/Station), Seq, Date, Time, Arrival Date,
 * From, To, Commodity, Type, Category, Flag1, Flag2, Material (= Destination station),
 * Destination (= Wagon/Rake Type), Wagon Type (= Count per wagon type), Count1, Count2, Updated Time
 */

export function generateBatchId() {
  return `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * Parse a raw Excel row (ODR file) into a FreightMovement record.
 * Accepts both old field names and actual FOIS column names.
 */
export function parseODRRow(row, batchId) {
  // Support actual FOIS column names
  const srNo = row['Sr No'] || row['sr_no'] || row['Sr No.'] || '';
  const zone = (row['Zone'] || row['zone'] || '').toString().trim().toUpperCase();
  const code = (row['Code'] || row['code'] || row['division'] || '').toString().trim().toUpperCase();
  const seq = row['Seq'] || row['seq'] || '';
  const date = row['Date'] || row['date'] || '';
  const time = row['Time'] || row['time'] || '';
  const arrivalDate = row['Arrival Date'] || row['arrival_date'] || '';
  const from = (row['From'] || row['from'] || row['station_from'] || '').toString().trim().toUpperCase();
  const to = (row['To'] || row['to'] || row['station_to'] || '').toString().trim().toUpperCase();
  const commodity = (row['Commodity'] || row['commodity'] || '').toString().trim().toUpperCase();
  const type = (row['Type'] || row['type'] || '').toString().trim().toUpperCase();
  const category = (row['Category'] || row['category'] || '').toString().trim().toUpperCase();
  const flag1 = row['Flag1'] || row['flag1'] || '';
  const flag2 = row['Flag2'] || row['flag2'] || '';
  const material = (row['Material'] || row['material'] || '').toString().trim().toUpperCase(); // destination station
  const destination = (row['Destination'] || row['destination'] || '').toString().trim().toUpperCase(); // wagon/rake type
  const wagonType = row['Wagon Type'] || row['wagon_type'] || '';
  const count1 = row['Count1'] || row['count1'] || '';
  const count2 = row['Count2'] || row['count2'] || '';
  const updatedTime = row['Updated Time'] || row['updated_time'] || '';

  if (!srNo || !zone) return null;

  const movementType = detectMovementType(category, type, flag2);
  const status = detectStatus(arrivalDate);

  return {
    odr_number: String(srNo).trim(), // Sr No is the primary identifier
    zone,
    division: code,         // Code = Division/Station code
    station_from: from,
    station_to: to,
    commodity,
    rake_type: destination, // Destination column = Wagon/Rake type
    wagons: parseInt(count1) || parseInt(wagonType) || 0,
    arrival_date: normalizeDate(arrivalDate),
    departure_date: normalizeDate(date),
    movement_type: movementType,
    status,
    upload_batch_id: batchId,
    is_duplicate: false,
    raw_data: { Seq: seq, Type: type, Category: category, Flag1: flag1, Flag2: flag2, Material: material, Count2: count2, UpdatedTime: updatedTime, Time: time }
  };
}

/**
 * Parse a raw Excel row (Matured Indent file) into a MaturedIndent record.
 * Same column structure as ODR file.
 */
export function parseIndentRow(row, batchId) {
  const srNo = row['Sr No'] || row['Sr No.'] || row['sr_no'] || '';
  const zone = (row['Zone'] || row['zone'] || '').toString().trim().toUpperCase();
  const code = (row['Code'] || row['code'] || '').toString().trim().toUpperCase();
  const seq = row['Seq'] || row['seq'] || '';
  const date = row['Date'] || row['date'] || '';
  const arrivalDate = row['Arrival Date'] || row['arrival_date'] || '';
  const from = (row['From'] || row['from'] || '').toString().trim().toUpperCase();
  const to = (row['To'] || row['to'] || '').toString().trim().toUpperCase();
  const commodity = (row['Commodity'] || row['commodity'] || '').toString().trim().toUpperCase();
  const destination = (row['Destination'] || row['destination'] || '').toString().trim().toUpperCase();
  const count1 = row['Count1'] || row['count1'] || '';

  if (!srNo || !zone) return null;

  return {
    indent_number: String(srNo).trim(),
    zone,
    division: code,
    station_from: from,
    station_to: to,
    commodity,
    rake_type: destination,
    wagons_demanded: parseInt(count1) || 0,
    indent_date: normalizeDate(date),
    maturity_date: normalizeDate(arrivalDate),
    odr_matched: false,
    matched_odr_number: '',
    upload_batch_id: batchId,
    raw_data: { Seq: seq }
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
  if (!val) return '';
  const s = String(val).trim();
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