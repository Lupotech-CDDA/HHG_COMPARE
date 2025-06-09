// src/features/comparison/core/properties.ts

import type { Item, GunSlot, AmmoSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";
import { normalizeDamageInstance } from "../../../data";
import { log } from "../utils/logger";

// --- Interfaces (no change) ---
export interface PotentialDamageInfo {
  damage: number;
  ammoName: string;
  damageType: string;
  ap: number;
  ammoItem: (Item & AmmoSlot) | null;
  ammoCritMultiplier: number;
  pelletCount?: number;
}

// --- Helper Functions (NEW ROBUST LOGIC) ---

/**
 * Gets all ammo types that a gun can fire.
 * NEW: Now inspects default_mods to handle modular weapons.
 */
function getFireableAmmoTypes(gun: Item, processor: CddaData): Set<string> {
  const gunSlot = gun as Item & GunSlot;
  const fireableAmmoTypes = new Set<string>();

  // 1. Check the gun's direct 'ammo' property
  if (gunSlot.ammo) {
    gunSlot.ammo.forEach(ammoType => fireableAmmoTypes.add(ammoType));
  }

  // 2. NEW LOGIC: Check default_mods for magazines or mods that add ammo types
  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const mod = processor.byIdMaybe("item", modId);
      if (mod && mod.type === "MAGAZINE" && mod.ammo_modifier) {
        log("DEBUG", `Found ammo_modifier on default mag '${modId}' for gun '${gun.id}'`, mod.ammo_modifier);
        mod.ammo_modifier.forEach((ammoType: string) => fireableAmmoTypes.add(ammoType));
      }
    }
  }
  
  log("DEBUG", `Final discovered ammo types for '${gun.id}'`, Array.from(fireableAmmoTypes));
  return fireableAmmoTypes;
}

/**
 * Gets all ammo items that a gun can fire, based on the discovered types.
 */
export function getFireableAmmoObjects(gun: Item, processor: CddaData): (Item & AmmoSlot)[] {
  const fireableAmmoTypes = getFireableAmmoTypes(gun, processor);
  const ammoItems: (Item & AmmoSlot)[] = [];

  for (const ammoType of fireableAmmoTypes) {
    const ammoTypeData = processor.byIdMaybe("ammunition_type", ammoType);
    if (ammoTypeData && ammoTypeData.default) {
      const ammoItem = processor.byIdMaybe("item", ammoTypeData.default) as Item & AmmoSlot;
      if (ammoItem) {
        ammoItems.push(ammoItem);
      }
    }
  }
  return ammoItems;
}

/**
 * Selects the most representative "standard" ammunition from a list.
 * (No changes here, but included for completeness)
 */
function classifyAndSelectStandardAmmo(
  possibleAmmoItems: (Item & AmmoSlot)[],
  gunId: string
): (Item & AmmoSlot) | null {
  if (possibleAmmoItems.length === 0) return null;
  if (possibleAmmoItems.length === 1) return possibleAmmoItems[0];

  const conventionalAmmo = possibleAmmoItems.filter(ammo => {
    const flags = (ammo as ItemBasicInfo).flags ?? [];
    return !flags.includes("BLACKPOWDER") && !flags.includes("NEVER_MISFIRES");
  });

  const ammoToConsider = conventionalAmmo.length > 0 ? conventionalAmmo : possibleAmmoItems;

  const ammoWithDamage = ammoToConsider.map(ammo => {
    // ADDED DEFENSIVE CHECK
    if (!ammo.damage) {
      log("WARN", `Ammo '${ammo.id}' is missing damage property, excluding from selection for gun '${gunId}'.`);
      return { ammo, totalDmg: 0 };
    }
    const normalizedDmg = normalizeDamageInstance(ammo.damage);
    const totalDmg = normalizedDmg.reduce((sum, dmg) => sum + (dmg.amount ?? 0), 0);
    return { ammo, totalDmg };
  }).filter(item => item.totalDmg > 0);

  if (ammoWithDamage.length === 0) {
    log("WARN", `No ammo with damage > 0 found for '${gunId}'.`);
    return null;
  }

  ammoWithDamage.sort((a, b) => a.totalDmg - b.totalDmg);
  const medianIndex = Math.floor(ammoWithDamage.length / 2);
  return ammoWithDamage[medianIndex].ammo;
}

// --- Main Function (with defensive checks) ---

export function getRepresentativeDPHInfo(
  gun: Item,
  processor: CddaData
): PotentialDamageInfo | null {
  const fireableAmmos = getFireableAmmoObjects(gun, processor);

  if (fireableAmmos.length === 0) {
    log("DEBUG", `No fireable ammo found for '${gun.id}' after checking base property and default mods.`);
    return null;
  }
  
  const representativeAmmo = classifyAndSelectStandardAmmo(fireableAmmos, gun.id);

  if (!representativeAmmo) {
    log("WARN", `Could not select a representative ammo for '${gun.id}' from ${fireableAmmos.length} options.`);
    return null;
  }

  // --- ADDED DEFENSIVE CHECK TO PREVENT CRASH ---
  if (!representativeAmmo.damage) {
      log("ERROR", `Representative ammo '${representativeAmmo.id}' for gun '${gun.id}' has an UNDEFINED damage property. Cannot process.`, representativeAmmo);
      return null;
  }
  // --- END OF DEFENSIVE CHECK ---

  const normalizedDmg = normalizeDamageInstance(representativeAmmo.damage);
  if (normalizedDmg.length === 0) {
    log("WARN", `Representative ammo '${representativeAmmo.id}' for gun '${gun.id}' has no valid damage instance after normalization.`);
    return null;
  }

  const primaryDamage = normalizedDmg[0];
  const totalDamage = normalizedDmg.reduce((sum, dmg) => sum + (dmg.amount ?? 0), 0);

  const result: PotentialDamageInfo = {
    damage: totalDamage,
    ammoName: (representativeAmmo as ItemBasicInfo).name?.str ?? representativeAmmo.id,
    damageType: primaryDamage.damage_type ?? "N/A",
    ap: primaryDamage.armor_penetration ?? 0,
    ammoItem: representativeAmmo,
    ammoCritMultiplier: representativeAmmo.critical_multiplier ?? 1.5,
    pelletCount: representativeAmmo.count ?? 1,
  };

  log("SUCCESS", `Successfully calculated DPH for '${gun.id}' using ammo '${result.ammoName}'`, result);
  return result;
}