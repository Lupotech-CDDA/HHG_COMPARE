// src/features/comparison/utils/classify.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import { log } from "./logger";

export type GunCategory =
  | "Assault Rifle" | "Rifle" | "Pistol" | "Submachine Gun" | "Shotgun"
  | "Bow" | "Energy" | "CBM/Mutation" | "Chemical" | "Launcher" // <-- Added Launcher
  | "Other Firearm" | "Other Non-Standard";

export function classifyGunDetailed(gun: Item): GunCategory {
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;
  const skill = gunSlot.skill;
  const flags = basicInfo.flags ?? [];
  
  let category: GunCategory;

  // --- Priority Checks for Non-Standard Types ---
  if (gun.id.includes("chemical_thrower") || flags.includes("FLAMETHROWER")) {
    category = "Chemical";
  } else if (skill === "archery") {
    category = "Bow";
  } else if (skill === "launcher") { // <-- NEW: Specific check for launchers
    category = "Launcher";
  } else if (flags.includes("PSEUDO") || flags.includes("BIONIC_WEAPON")) {
    category = "CBM/Mutation";
  } else if (flags.includes("NEVER_JAMS") && flags.includes("NO_AMMO")) {
    category = "Energy";
  } else if (gunSlot.ups_charges || flags.includes("USE_UPS")) {
    category = "Energy";
  // --- Standard Firearm Classification ---
  } else if (skill === "pistol") {
    category = "Pistol";
  } else if (skill === "smg") {
    category = "Submachine Gun";
  } else if (skill === "shotgun") {
    category = "Shotgun";
  } else if (skill === "rifle") { // <-- REMOVED: No longer includes launcher
    const firingModes = gunSlot.modes ?? [];
    const hasBurstMode = firingModes.some(mode => mode[0] === "BURST" && (mode[1] ?? 0) > 1);
    category = hasBurstMode ? "Assault Rifle" : "Rifle";
  } else if (skill) {
    category = "Other Firearm";
  } else {
    category = "Other Non-Standard";
  }

  log("DEBUG", `Classifying '${gun.id}' -> Result: ${category}`);
  return category;
}