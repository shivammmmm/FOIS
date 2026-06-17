// Railway Master Dictionary — FOIS short codes to readable names

// ─── ZONE → STATE MAPPING ─────────────────────────────────────────────────────
import { COMMODITY_DICTIONARY, getCommodityDisplayName } from "@/constants/commodityDictionary";

export const ZONE_STATES = {
  CR:   ["Maharashtra"],
  WR:   ["Gujarat", "Maharashtra", "Rajasthan", "Madhya Pradesh"],
  SCR:  ["Telangana", "Andhra Pradesh"],
  SR:   ["Tamil Nadu", "Kerala", "Karnataka", "Andhra Pradesh"],
  NR:   ["Delhi", "Punjab", "Haryana", "Uttar Pradesh", "Himachal Pradesh", "Jammu & Kashmir"],
  ER:   ["West Bengal", "Bihar", "Jharkhand"],
  NER:  ["Uttar Pradesh", "Bihar"],
  NFR:  ["Assam", "West Bengal", "Bihar", "Sikkim", "Arunachal Pradesh"],
  ECR:  ["Bihar", "Jharkhand", "Uttar Pradesh"],
  SER:  ["West Bengal", "Jharkhand", "Odisha"],
  ECOR: ["Odisha", "Andhra Pradesh"],
  ECoR: ["Odisha", "Andhra Pradesh"],
  WCR:  ["Madhya Pradesh", "Rajasthan", "Uttar Pradesh"],
  NCR:  ["Uttar Pradesh", "Madhya Pradesh", "Rajasthan"],
  NWR:  ["Rajasthan", "Gujarat", "Haryana", "Punjab"],
  SWR:  ["Karnataka", "Goa"],
  SECR: ["Chhattisgarh", "Madhya Pradesh", "Maharashtra"],
  KR:   ["Maharashtra", "Goa", "Karnataka"],
  MR:   ["West Bengal"],
};

// ─── DIVISION → STATE + DISTRICT MAPPING ──────────────────────────────────────
// state is stored as array for consistent multi-state divisions
export const DIVISION_META = {
  BBS:  { state: ["Odisha"],                      district: "Bhubaneswar / Khordha" },
  KUR:  { state: ["Odisha"],                      district: "Khordha / Puri" },
  SBP:  { state: ["Odisha"],                      district: "Sambalpur" },
  ROU:  { state: ["Odisha", "Jharkhand"],         district: "Rourkela / Sundargarh" },
  CKP:  { state: ["Jharkhand"],                   district: "West Singhbhum" },
  KGP:  { state: ["West Bengal"],                 district: "Paschim Medinipur" },
  ADA:  { state: ["West Bengal"],                 district: "Purulia" },
  WAT:  { state: ["Andhra Pradesh"],              district: "Visakhapatnam" },
  VZM:  { state: ["Andhra Pradesh"],              district: "Vizianagaram" },
  GNT:  { state: ["Andhra Pradesh"],              district: "Guntur" },
  SC:   { state: ["Telangana"],                   district: "Secunderabad / Hyderabad" },
  GTL:  { state: ["Andhra Pradesh"],              district: "Anantapur" },
  NED:  { state: ["Maharashtra"],                 district: "Nanded" },
  HYB:  { state: ["Telangana"],                   district: "Hyderabad" },
  BZA:  { state: ["Andhra Pradesh"],              district: "Krishna / Vijayawada" },
  HWH:  { state: ["West Bengal"],                 district: "Howrah" },
  SRC:  { state: ["West Bengal"],                 district: "Kolkata" },
  MFP:  { state: ["West Bengal"],                 district: "Malda" },
  DNR:  { state: ["Bihar"],                       district: "Patna / Danapur" },
  MGS:  { state: ["Uttar Pradesh"],               district: "Chandauli (DDU)" },
  SPJ:  { state: ["Bihar"],                       district: "Samastipur" },
  SEE:  { state: ["Bihar"],                       district: "Saran / Sonpur" },
  DHN:  { state: ["Jharkhand"],                   district: "Dhanbad" },
  BSP:  { state: ["Chhattisgarh"],                district: "Bilaspur" },
  NGP:  { state: ["Maharashtra"],                 district: "Nagpur" },
  RAD:  { state: ["Chhattisgarh"],                district: "Raipur" },
  PUNE: { state: ["Maharashtra"],                 district: "Pune" },
  SUR:  { state: ["Maharashtra"],                 district: "Solapur" },
  CSTM: { state: ["Maharashtra"],                 district: "Mumbai" },
  ADI:  { state: ["Gujarat"],                     district: "Ahmedabad" },
  BRC:  { state: ["Gujarat"],                     district: "Vadodara" },
  RTM:  { state: ["Madhya Pradesh"],              district: "Ratlam" },
  BVI:  { state: ["Maharashtra"],                 district: "Mumbai" },
  RJT:  { state: ["Gujarat"],                     district: "Rajkot" },
  DLI:  { state: ["Delhi"],                       district: "Delhi" },
  FZR:  { state: ["Punjab"],                      district: "Firozpur" },
  LKO:  { state: ["Uttar Pradesh"],               district: "Lucknow" },
  MB:   { state: ["Uttar Pradesh"],               district: "Moradabad" },
  UMB:  { state: ["Haryana"],                     district: "Ambala" },
  ALD:  { state: ["Uttar Pradesh"],               district: "Prayagraj" },
  JHS:  { state: ["Madhya Pradesh"],              district: "Jhansi" },
  AGC:  { state: ["Uttar Pradesh"],               district: "Agra" },
};

export function getDivisionMeta(code) {
  if (!code) return null;
  return DIVISION_META[String(code).toUpperCase().trim()] || null;
}

// Get states for a zone — case-insensitive
export function getStatesForZone(zone) {
  if (!zone) return [];
  const upper = String(zone).toUpperCase().trim();
  return ZONE_STATES[upper] || [];
}

// Get all unique districts from divisions present in a set of records
export function getDistrictsFromDivisions(divisionCodes) {
  const districts = new Set();
  divisionCodes.forEach(code => {
    const meta = getDivisionMeta(code);
    if (meta?.district) {
      // A district string may contain " / " for multi-district — split them
      meta.district.split(' / ').forEach(d => districts.add(d.trim()));
    }
  });
  return [...districts].sort();
}

// Check if a division's district matches a selected district filter
export function divisionMatchesDistrict(divisionCode, selectedDistrict) {
  const meta = getDivisionMeta(divisionCode);
  if (!meta?.district) return false;
  return meta.district.split(' / ').map(d => d.trim()).includes(selectedDistrict);
}

// ─── ZONES ────────────────────────────────────────────────────────────────────
export const ZONE_NAMES = {
  CR: "Central Railway",
  WR: "Western Railway",
  SCR: "South Central Railway",
  SR: "Southern Railway",
  NR: "Northern Railway",
  ER: "Eastern Railway",
  NER: "North Eastern Railway",
  NFR: "Northeast Frontier Railway",
  ECR: "East Central Railway",
  SER: "South Eastern Railway",
  ECOR: "East Coast Railway",
  ECoR: "East Coast Railway",
  WCR: "West Central Railway",
  NCR: "North Central Railway",
  NWR: "North Western Railway",
  SWR: "South Western Railway",
  SECR: "South East Central Railway",
  KR: "Konkan Railway",
  MR: "Metro Railway Kolkata",
};

// ─── DIVISIONS ────────────────────────────────────────────────────────────────
export const DIVISION_NAMES = {
  // East Coast Railway (ECoR)
  BBS: "Bhubaneswar",
  KUR: "Khurda Road",
  SBP: "Sambalpur",
  // South Eastern Railway (SER)
  ROU: "Rourkela",
  CKP: "Chakradharpur",
  KGP: "Kharagpur",
  ADA: "Adra",
  // Waltair Division (ECoR)
  WAT: "Waltair",
  VZM: "Vizianagaram",
  // South Central Railway (SCR)
  GNT: "Guntur",
  SC: "Secunderabad",
  GTL: "Guntakal",
  NED: "Nanded",
  HYB: "Hyderabad",
  BZA: "Vijayawada",
  // Eastern Railway (ER)
  HWH: "Howrah",
  SRC: "Sealdah",
  MFP: "Malda",
  // East Central Railway (ECR)
  DNR: "Danapur",
  MGS: "Mughalsarai",
  SPJ: "Samastipur",
  SEE: "Sonpur",
  DHN: "Dhanbad",
  // South East Central Railway (SECR)
  BSP: "Bilaspur",
  NGP: "Nagpur",
  RAD: "Raipur",
  // Central Railway (CR)
  PUNE: "Pune",
  SUR: "Solapur",
  CSTM: "Mumbai CST",
  // Western Railway (WR)
  ADI: "Ahmedabad",
  BRC: "Vadodara",
  RTM: "Ratlam",
  BVI: "Mumbai Central",
  RJT: "Rajkot",
  // Northern Railway (NR)
  DLI: "Delhi",
  FZR: "Firozpur",
  LKO: "Lucknow",
  MB: "Moradabad",
  UMB: "Ambala",
  // North Central Railway (NCR)
  ALD: "Prayagraj",
  JHS: "Jhansi",
  AGC: "Agra",
};

// ─── STATIONS ────────────────────────────────────────────────────────────────
export const STATION_NAMES = {
  // East Coast / Odisha / AP
  BBS: "Bhubaneswar",
  PURI: "Puri",
  CTC: "Cuttack",
  BZA: "Vijayawada",
  VSKP: "Visakhapatnam",
  RJY: "Rajahmundry",
  GNT: "Guntur",
  NDL: "Nidadavolu",
  EE: "Eluru",
  MTM: "Machilipatnam",
  OGL: "Ongole",
  NLR: "Nellore",
  GDR: "Gudur",
  TPTY: "Tirupati",
  RU: "Renigunta",
  KI: "Kurnool City",
  GTL: "Guntakal",
  DMM: "Dharmavaram",
  BAY: "Ballari",
  HYB: "Hyderabad",
  SC: "Secunderabad",
  KZJ: "Kazipet",
  WL: "Warangal",
  BIDR: "Bidar",
  PAU: "Parli Vaijnath",
  NED: "Nanded",
  MUE: "Mudkhed",
  AWB: "Aurangabad",
  // Steel / Industrial hubs
  SDAH: "Sealdah",
  HWH: "Howrah",
  KGP: "Kharagpur",
  CKP: "Chakradharpur",
  ROU: "Rourkela",
  TATA: "Tatanagar",
  BSP: "Bilaspur",
  R: "Raipur",
  DRZ: "Dongargaon Road",
  SDL: "Saldanha",
  BKSC: "Bokaro Steel City",
  DHN: "Dhanbad",
  // Common freight hubs
  MGS: "Mughalsarai (Pt. Deen Dayal Upadhyaya)",
  PNBE: "Patna",
  DNR: "Danapur",
  GYA: "Gaya",
  PRLI: "Parli",
  // Western
  ADI: "Ahmedabad",
  BRC: "Vadodara",
  ST: "Surat",
  BCT: "Mumbai Central",
  CSTM: "Mumbai CST",
  PUNE: "Pune",
  SUR: "Solapur",
  // Northern
  NDLS: "New Delhi",
  DLI: "Delhi",
  CNB: "Kanpur Central",
  LKO: "Lucknow",
  BSB: "Varanasi",
  ALD: "Prayagraj",
  AGC: "Agra Cantt",
  // Coal belt / Jharkhand / West Bengal
  RNC: "Ranchi",
  HZB: "Hazaribagh Road",
  PTRU: "Patratu",
  MCL: "Mahanadi Coalfields Siding",
  ADRA: "Adra Junction (West Bengal, SER)",
  KKBK: "Kanksa Block Cabin (West Bengal)",
  BCCL: "Bharat Coking Coal Ltd. Siding",
  JHPL: "Jaiprakash Power Ventures Ltd. Siding",
  GMO: "Gomo Junction (Jharkhand)",
  JSME: "Jasidih Junction",
  PKU: "Pakur",
  MDP: "Madhupore",
  BRKA: "Baraka (Jharkhand)",
  SGRL: "Singrauli",
  RNPR: "Ranipur Road",
  BRWD: "Barwadih Junction",
  GAD: "Garwa Road",
  // Odisha
  JKTP: "Jakhapura Junction (Odisha)",
  TLHR: "Talcher Road",
  TLR: "Talcher Junction",
  ANGR: "Angul",
  DSPG: "Daspalla Road",
  KRPU: "Koraput",
  RGDA: "Rayagada",
  JPUR: "Jeypore",
  NPTR: "Naupada Junction",
  JSG: "Jharsuguda Junction",
  IB: "Ib (Odisha — Coal hub)",
  BSPD: "Barsuan Road",
  KIRI: "Kiriburu (Iron Ore)",
  MJHD: "Majhaudihi Siding",
  // AP / Telangana
  KDPM: "Khurda Road–Puri Main",
  MRGA: "Muragachha",
  KZJ: "Kazipet Junction",
  WL: "Warangal",
  MBNR: "Mahbubnagar",
  PAK: "Pakala Junction",
  GY: "Giddalur",
  NDKD: "Nidadavolu Road",
  // Private sidings commonly seen in FOIS
  RSPN: "Rashtriya Ispat Nigam Ltd. (RINL) Siding",
  RINL: "RINL Vizag Steel Plant Siding",
  HPCL: "HPCL Petroleum Siding",
  IOCL: "Indian Oil Corp. Siding",
  BPCL: "BPCL Petroleum Siding",
  NTPC: "NTPC Power Plant Siding",
  SAIL: "SAIL Steel Plant Siding",
  TISCO: "Tata Steel (TISCO) Siding",
  JSW: "JSW Steel Siding",
  JSPL: "Jindal Steel & Power Siding",
  AMNS: "ArcelorMittal Nippon Steel Siding",
  CCL: "Central Coalfields Ltd. Siding",
  NCL: "Northern Coalfields Ltd. Siding",
  SECL: "South Eastern Coalfields Ltd. Siding",
  WCL: "Western Coalfields Ltd. Siding",
  MAHAGENCO: "Maharashtra Power Generation Siding",
  TANGEDCO: "Tamil Nadu Power Generation Siding",
};

// ─── RAKE TYPES ──────────────────────────────────────────────────────────────
export const RAKE_TYPE_NAMES = {
  BOXN: "Box Wagon Normal (BOXN)",
  BOXNHL: "Box Wagon High Load (BOXNHL)",
  BOXNEL: "Box Wagon Electric Loco",
  BOXNR: "Box Wagon Reinforced",
  BOXNHL25T: "Box Wagon HL 25T",
  BOXNLW: "Box Wagon Light Weight",
  BCN: "Box Covered Normal (BCN)",
  BCNA: "Box Covered High Cap (BCNA)",
  BCNHL: "Box Covered High Load",
  BCNAHSM1: "Box Covered HSM-1",
  BRN: "Box Reinforced New",
  BOBR: "Bottom Open Barrel (BOBR)",
  BOBRN: "Bottom Open Barrel New",
  BOBRNHSM1: "BOBRN HSM-1 (Steel Plant)",
  BOBRNHSM2: "BOBRN HSM-2 (Steel Plant)",
  BOST: "Bottom Open Steel Tippler",
  BOSM: "Bottom Open Steel Medium",
  BOBSN: "Bottom Open BS New",
  BOBSNM1: "Bottom Open BS New M1",
  BFNS: "Bottom Flat Narrow Steel",
  BFNS22: "Bottom Flat Narrow Steel 22.9T",
  BFNSM: "BFNS Medium",
  BLCA: "Box Low Container A",
  BLCB: "Box Low Container B",
  BLCSA: "Box Low Container SA",
  BLCSB: "Box Low Container SB",
  BOYEL: "Box Open Yellow",
  BTPN: "Tank Wagon Petroleum",
  BTPGL: "Tank Wagon LPG",
  BVZC: "Flat Wagon Vehicular",
  BFNV: "Flat Wagon Vehicular",
  AUTO: "Automobile Carrier",
  LPG: "LPG Tank Wagon",
  BALT: "Ballast Hopper",
  RMC: "Ready Mix Concrete Wagon",
  NMG: "Not Modified Goods Wagon",
  CONT: "Container Flat Wagon",
};

// ─── COMMODITY FULL NAMES ────────────────────────────────────────────────────
export const COMMODITY_NAMES = {
  COAL: "Coal",
  IS: "Iron & Steel",
  IORE: "Iron Ore",
  IOP: "Iron Ore Pellets",
  ORES: "Iron Ore",
  EXOR: "Export Iron Ore",
  RMSP: "Raw Material (Steel Plant)",
  CEMT: "Cement",
  CLKR: "Clinker",
  ASH: "Fly Ash",
  SLPR: "Sleeper",
  POL: "Petroleum Oil & Lubricants",
  HSD: "High Speed Diesel",
  LPG: "LPG",
  FERT: "Fertilizer",
  FOOD: "Food Grains",
  SUGR: "Sugar",
  SALT: "Salt",
  LIME: "Limestone",
  GRAV: "Gravel / Ballast",
  SAND: "Sand",
  CONT: "Containers",
  FCI: "Food Corp of India",
  STEE: "Steel Products",
  COKE: "Coke",
  MN: "Manganese",
  CHR: "Chrome Ore",
  BAX: "Bauxite",
  FLY: "Fly Ash",
  GDS: "General Goods",
  EH: "Empty Hopper",
  DOL: "Dolomite",
};

// ─── UNIFIED DICTIONARY (backwards compat) ───────────────────────────────────
export const RAILWAY_DICTIONARY = {
  ...ZONE_NAMES,
  ...DIVISION_NAMES,
  ...STATION_NAMES,
  ...RAKE_TYPE_NAMES,
  ...COMMODITY_NAMES,
  ...COMMODITY_DICTIONARY,
};

// ─── LOOKUP HELPERS ──────────────────────────────────────────────────────────
export function resolveCode(code) {
  if (!code) return code;
  const upper = String(code).toUpperCase().trim();
  return RAILWAY_DICTIONARY[upper] || code;
}

export function getZoneName(code) {
  if (!code) return '—';
  const upper = String(code).toUpperCase().trim();
  return ZONE_NAMES[upper] || code;
}

export function getDivisionName(code) {
  if (!code) return '—';
  const upper = String(code).toUpperCase().trim();
  return DIVISION_NAMES[upper] || code;
}

export function getStationName(code) {
  if (!code) return '—';
  const upper = String(code).toUpperCase().trim();
  return STATION_NAMES[upper] || code;
}

export function getRakeTypeName(code) {
  if (!code) return '—';
  const upper = String(code).toUpperCase().trim();
  return RAKE_TYPE_NAMES[upper] || code;
}

export function getCommodityName(code) {
  if (!code) return '—';
  const upper = String(code).toUpperCase().trim();
  return COMMODITY_DICTIONARY[upper] || COMMODITY_NAMES[upper] || getCommodityDisplayName(code);
}

// ─── COMMODITY COLORS ────────────────────────────────────────────────────────
export const COMMODITY_COLORS = {
  Coal: "#6B7280",
  "Iron Ore": "#F97316",
  "Iron & Steel": "#94A3B8",
  Cement: "#84CC16",
  Petroleum: "#F59E0B",
  Fertilizer: "#10B981",
  Containers: "#14B8A6",
  Steel: "#64748B",
  "Fly Ash": "#A78BFA",
  Clinker: "#FCD34D",
  default: "#3B82F6",
};

export function getCommodityColor(commodity) {
  if (!commodity) return COMMODITY_COLORS.default;
  const name = getCommodityName(commodity);
  return COMMODITY_COLORS[name] || COMMODITY_COLORS[commodity] || COMMODITY_COLORS.default;
}
