import * as XLSX from 'xlsx';

/**
 * Split a single CSV line with quote awareness.
 */
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Auto-detect format and parse raw pasted text into a 2D Array of strings (AOA).
 * Handles:
 * - Tab-separated (TSV / copied Excel cells)
 * - Comma-separated (CSV)
 * - Space-separated FOIS exports (2+ spaces or whitespace tokens)
 * Ignores empty lines, duplicate blank rows, and trailing spaces.
 */
export function parsePastedTextToAOA(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { rows: [], detectedFormat: 'None', charCount: 0, lineCount: 0, parsedRowCount: 0 };
  }

  const charCount = rawText.length;

  // Split lines, trim trailing whitespace per line, ignore empty lines / duplicate blank rows
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const lineCount = rawText ? rawText.split(/\r?\n/).length : 0;

  if (lines.length === 0) {
    return { rows: [], detectedFormat: 'None', charCount, lineCount, parsedRowCount: 0 };
  }

  // Count delimiter occurrences across non-empty lines
  let tabLineCount = 0;
  let csvLineCount = 0;
  let multiSpaceLineCount = 0;

  for (const line of lines) {
    if (line.includes('\t')) tabLineCount += 1;
    if (line.includes(',')) csvLineCount += 1;
    if (/\s{2,}/.test(line)) multiSpaceLineCount += 1;
  }

  let detectedFormat = 'Space-separated';
  let parseLine = (line) => line.split(/\s+/).map((cell) => cell.trim());

  if (tabLineCount > 0 && tabLineCount >= lines.length * 0.3) {
    detectedFormat = 'Tab-separated (TSV)';
    parseLine = (line) => line.split('\t').map((cell) => cell.trim());
  } else if (csvLineCount > 0 && csvLineCount >= lines.length * 0.3) {
    detectedFormat = 'Comma-separated (CSV)';
    parseLine = (line) => splitCsvLine(line);
  } else if (multiSpaceLineCount > 0) {
    detectedFormat = 'Space-separated';
    parseLine = (line) => line.split(/\s{2,}/).map((cell) => cell.trim());
  }

  const rawRows = lines.map(parseLine);
  // Filter out FOIS Web Portal filter search box rows (e.g. Searc, Search..., fn)
  const rows = rawRows.filter((row) => {
    const searchCells = row.filter((cell) => {
      const norm = String(cell || '').trim().toLowerCase();
      return norm.startsWith('searc') || norm === 'fn' || norm === 'search...' || norm === 'search';
    });
    return searchCells.length < 2;
  });

  const parsedRowCount = rows.length > 1 ? rows.length - 1 : 0;

  return { rows, detectedFormat, charCount, lineCount, parsedRowCount };
}

export const DEFAULT_ODR_HEADERS = [
  'S.NO.', 'DVSN', 'STTN FROM', 'NO.', 'DATE', 'TIME',
  'EXPECTED LOADING DATE', 'CNSR', 'CNSG', 'CMDT',
  'TT', 'PC', 'PBF', 'VIA', 'RAKE CMDT',
  'DSTN', 'TYPE', 'INDENTED UNTS', 'INDENTED 8W', 'OTSG UNTS',
  'OTSG 8W', 'SUPPLIED UNTS', 'SUPPLIED TIME'
];

export const DEFAULT_MATURED_HEADERS = [
  'S.NO.', 'DVSN', 'STTN FROM', 'DEMAND NO.', 'DEMAND DATE', 'DEMAND TIME',
  'EXPECTED LOADING DATE', 'CONSIGNOR', 'CNSG', 'CMDT',
  'TT', 'PC', 'PBF', 'VIA', 'RAKE CMDT',
  'DSTN', 'TYPE', 'INDENTED UNTS', 'INDENTED 8W', 'OTSG UNTS',
  'OTSG 8W', 'SUPPLIED UNTS', 'SUPPLIED TIME'
];

/**
 * Validate presence of FOIS mandatory header columns in parsed rows.
 * If header columns are missing, automatically auto-inject standard FOIS header row
 * so that raw pasted data parses seamlessly without user intervention.
 */
export function validatePastedFoisHeaders(rows, fileType = 'ODR') {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Pasted FOIS data is empty or contains no lines.');
  }

  const baseAliases = ['S.NO.', 'S NO', 'SR NO', 'SR.NO.'];
  const dvsnAliases = ['DVSN', 'DIVISION'];
  const numberAliases = fileType === 'ODR' 
    ? ['NO.', 'NO'] 
    : ['NO.', 'NO', 'DEMAND NO.', 'DEMAND NO', 'INDENT NO.', 'INDENT NO'];

  let foundHeaderIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const normalizedCells = rows[i].map((cell) => String(cell || '').trim().toUpperCase());
    const hasSNo = baseAliases.some((alias) => normalizedCells.includes(alias));
    const hasDvsn = dvsnAliases.some((alias) => normalizedCells.includes(alias));
    const hasNo = numberAliases.some((alias) => normalizedCells.includes(alias));

    if (hasSNo && hasDvsn && hasNo) {
      foundHeaderIndex = i;
      break;
    }
  }

  const defaultHeaders = fileType === 'ODR' ? DEFAULT_ODR_HEADERS : DEFAULT_MATURED_HEADERS;

  if (foundHeaderIndex < 0) {
    // If no header row was found in pasted text, unshift default FOIS headers
    rows.unshift(defaultHeaders);
  } else if (foundHeaderIndex === 0) {
    // Replace raw header row with standard FOIS headers to unify column names
    rows[0] = defaultHeaders;
  }

  return true;
}

/**
 * Convert raw pasted FOIS text into a standard browser File object (.xlsx format)
 * so it can seamlessly pass through the exact same preview and incremental upload pipeline.
 */
export function createExcelFileFromText(rawText, fileType = 'ODR') {
  const { rows } = parsePastedTextToAOA(rawText);
  if (!rows || rows.length === 0) {
    throw new Error('Pasted FOIS data is empty. Please paste valid data before proceeding.');
  }

  // Pre-validate mandatory header columns for fast user feedback
  validatePastedFoisHeaders(rows, fileType);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'FOIS_Data');

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const fileName = `pasted_fois_${fileType.toLowerCase()}_${Date.now()}.xlsx`;

  return new File([arrayBuffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
