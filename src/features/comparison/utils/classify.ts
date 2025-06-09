// src/features/comparison/utils/classify.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";

/**
 * The detailed classification for a weapon, used for display and filtering.
 */
export type GunCategory =
  | "Assault Rifle"
  | "Rifle"
  | "Pistol"
  | "Submachine Gun"
  | "Shotgun"
  | "Bow"
  | "Energy"
  | "CBM/Mutation"
  | "Chemical"
  | "Other Firearm"
  | "Other Non-Standard";

/**
 * Classifies a gun item into a detailed category.
 * This is used to determine if a gun is "standard" and for the category column.
 *
 * @param gun - The gun item to classify.
 * @returns A GunCategory string.
 */
export function classifyGunDetailed(gun: Item): GunCategory {
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;

  const skill = gunSlot.skill;
  const flags = basicInfo.flags ?? [];

  // Non-firearm checks
  if (flags.includes("PSEUDO") || flags.includes("BIONIC_WEAPON")) {
    return "CBM/Mutation";
  }
  if (flags.includes("FLAMETHROWER")) {
    return "Chemical";
  }
  if (skill === "archery") {
    return "Bow";
  }
  if (flags.includes("NEVER_JAMS") && flags.includes("NO_AMMO")) {
    return "Energy";
  }
  if (gunSlot.ups_charges || flags.includes("USE_UPS")) {
    return "Energy";
  }


  // Standard firearm classification
  if (skill === "pistol") {
    return "Pistol";
  }
  if (skill === "smg") {
    return "Submachine Gun";
  }
  if (skill === "shotgun") {
    return "Shotgun";
  }
  if (skill === "rifle" || skill === "launcher") {
    // Check for burst fire to distinguish assault rifles
    const firingModes = gunSlot.modes ?? [];
    const hasBurstMode = firingModes.some(
      (mode) => mode[0] === "BURST" && (mode[1] ?? 0) > 1
    );

    if (hasBurstMode) {
      return "Assault Rifle";
    }
    return "Rifle";
  }
  
  // If it has a skill but doesn't fit the above, it's a generic firearm
  if (skill) {
      return "Other Firearm";
  }

  // Fallback for anything else
  return "Other Non-Standard";
}