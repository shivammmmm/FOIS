import { validateStateDistrictCombination } from "./mastersCrudApi.js";

export async function validateStationHierarchy({ state, district }) {
  // Task requirement: reject invalid state/district combos server-side.
  await validateStateDistrictCombination({ state, district });
  return true;
}

