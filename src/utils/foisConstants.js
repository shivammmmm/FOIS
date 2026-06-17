/**
 * FOIS Standard Divisions List
 * Indian Railways - 12 divisions commonly tracked in FOIS
 * Use these wherever division filters/dropdowns are needed.
 */

export const FOIS_DIVISIONS = [
  'BBS',  // Bhubaneswar
  'KUR',  // Khurda Road
  'SBP',  // Sambalpur
  'ROU',  // Rourkela
  'WAT',  // Waltair
  'VZM',  // Vizianagaram
  'GNT',  // Guntur
  'SC',   // Secunderabad
  'GTL',  // Guntakal
  'NED',  // Nanded
  'HYB',  // Hyderabad
  'BZA',  // Vijayawada
];

export const FOIS_DIVISION_LABELS = {
  BBS: 'Bhubaneswar',
  KUR: 'Khurda Road',
  SBP: 'Sambalpur',
  ROU: 'Rourkela',
  WAT: 'Waltair',
  VZM: 'Vizianagaram',
  GNT: 'Guntur',
  SC:  'Secunderabad',
  GTL: 'Guntakal',
  NED: 'Nanded',
  HYB: 'Hyderabad',
  BZA: 'Vijayawada',
};

/**
 * Returns the full name of a division code.
 * Falls back to the code itself if not found.
 */
export function getDivisionLabel(code) {
  return FOIS_DIVISION_LABELS[code?.toUpperCase()] || code || '—';
}

/**
 * Options array for dropdowns/selects (with "All" prepended).
 */
export const DIVISION_FILTER_OPTIONS = ['All', ...FOIS_DIVISIONS];