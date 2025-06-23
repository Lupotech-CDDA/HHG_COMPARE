// src/features/comparison/utils/classify.ts

import type { Item, GunSlot } from "../../../types";
import { log } from "./logger";
import { getFiringModes } from "../core/properties";

// --- New Structured Category Type ---
export type GunCategory = {
  type: "Firearm" | "Archery" | "Energy" | "Launcher" | "Other";
  subType:
    | "Pistol"
    | "SMG"
    | "Shotgun"
    | "Rifle"
    | "Assault Rifle"
    | "Bow / Crossbow"
    | "Energy Weapon"
    | "Grenade / Rocket"
    | "Chemical"
    | "Bionic / Mutation"
    | "Other";
};

/**
 * Classifies a gun into a structured category based on its properties.
 */
export function classifyGunDetailed(gun: Item): GunCategory {
  // --- ADDED GUARD CLAUSE TO FIX RUNTIME ERROR ---
  if (!gun) {
    log("ERROR", "classifyGunDetailed was called with an undefined gun object.", { stack: new Error().stack });
    return { type: "Other", subType: "Other" };
  }
  // --- END OF FIX ---

  const gunSlot = gun as Item & GunSlot;
  const skill = gunSlot.skill;
  const flags = gun.flags ?? [];

  if (gun.id.includes("chemical_thrower") || flags.includes("FLAMETHROWER")) {
    return { type: "Other", subType: "Chemical" };
  }
  if (skill === "archery") {
    return { type: "Archery", subType: "Bow / Crossbow" };
  }
  if (skill === "launcher") {
    return { type: "Launcher", subType: "Grenade / Rocket" };
  }
  if (flags.includes("PSEUDO") || flags.includes("BIONIC_WEAPON")) {
    return { type: "Other", subType: "Bionic / Mutation" };
  }
  if (
    (flags.includes("NEVER_JAMS") && flags.includes("NO_AMMO")) ||
    gunSlot.ups_charges ||
    flags.includes("USE_UPS")
  ) {
    return { type: "Energy", subType: "Energy Weapon" };
  }

  if (skill === "pistol") {
    return { type: "Firearm", subType: "Pistol" };
  }
  if (skill === "smg") {
    return { type: "Firearm", subType: "SMG" };
  }
  if (skill === "shotgun") {
    return { type: "Firearm", subType: "Shotgun" };
  }
  if (skill === "rifle") {
    const firingModes = getFiringModes(gunSlot);
    const hasBurstMode = firingModes.some((mode) => mode.shots > 1);
    const subType = hasBurstMode ? "Assault Rifle" : "Rifle";
    return { type: "Firearm", subType: subType };
  }

  if (skill) {
    return { type: "Firearm", subType: "Other" };
  }

  return { type: "Other", subType: "Other" };
}