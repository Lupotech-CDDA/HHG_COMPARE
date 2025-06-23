// src/features/comparison/core/reloads.ts

// NOTE: This version fixes the NaN bug by correctly parsing volume strings.

import type { Item, GunSlot, ItemBasicInfo, PocketData } from "../../../types";
import type { CddaData } from "../../../data";
// --- NEW: Import the existing utility from the main HHG app ---
import { parseVolume } from "../../../data";
import type { CombatProfile } from "./types";
import { log } from "../utils/logger";

const INVENTORY_HANDLING_PENALTY = 100;
const LOG_PREFIX = "[RELOADS]";

// --- Private Helper Functions (no change) ---

function getMagazineIdsFromItemPockets(gun: Item): string[] {
  const basicInfo = gun as ItemBasicInfo;
  if (!basicInfo.pocket_data) return [];
  const magIds: string[] = [];
  for (const pocket of basicInfo.pocket_data) {
    if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
      magIds.push(...pocket.item_restriction);
    }
  }
  return magIds;
}

function getMagazineIdsFromGunMod(mod: Item): string[] {
  const gunMod = mod as Item & { magazine_adaptor?: any; pocket_mods?: PocketData[] };
  const magIds = new Set<string>();
  if (gunMod.magazine_adaptor && Array.isArray(gunMod.magazine_adaptor)) {
    for (const entry of gunMod.magazine_adaptor) {
      if (Array.isArray(entry) && Array.isArray(entry[1])) {
        (entry[1] as string[]).forEach((id) => magIds.add(id));
      }
    }
  }
  if (gunMod.pocket_mods && Array.isArray(gunMod.pocket_mods)) {
    for (const pocket of gunMod.pocket_mods) {
      if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
        pocket.item_restriction.forEach((id: string) => magIds.add(id));
      }
    }
  }
  return Array.from(magIds);
}

// --- High-Fidelity Reload Time Calculation ---

function getBaseReloadTime(gunItem: Item & GunSlot): number {
  return gunItem.reload ?? 100;
}

function getItemReloadCost(gunItem: Item & GunSlot, magazine: Item, profile: CombatProfile): number {
  const { weaponSkillLevel, strength, handManipScore } = profile;
  
  // --- BUG FIX: Use parseVolume to correctly handle string or number volumes ---
  const magVolumeMl = parseVolume(magazine.volume) ?? 0;
  
  let mv = magVolumeMl / 20 + 0; // Simplified encumbrance
  if (magazine.flags?.includes("MAG_BULKY")) mv *= 1.5;
  
  const cost = getBaseReloadTime(gunItem);
  const skillDivisor = 1.0 + Math.min(weaponSkillLevel * 0.1, 1.0);
  mv += cost / skillDivisor;
  
  if (gunItem.flags?.includes("STR_RELOAD")) mv -= strength * 20;
  
  mv *= 1.0 / handManipScore;
  return Math.max(Math.round(mv), 25);
}

function getMagazineObtainCost(magazine: Item): number {
  const magVolumeMl = parseVolume(magazine.volume) ?? 0;
  const volumePenalty = Math.min(200, magVolumeMl / 20);
  return (INVENTORY_HANDLING_PENALTY / 2) + 250 + volumePenalty + 0;
}

function findStandardMagazine(gunItem: Item & GunSlot, processor: CddaData): Item | null {
    const defaultMagId = (gunItem as any).magazine_default as string | undefined;
    if (defaultMagId && typeof defaultMagId === 'string') {
        const mag = processor.byIdMaybe("item", defaultMagId);
        if (mag) return mag;
    }
    const allMagazineItemIds = new Set<string>();
    if (gunItem.default_mods) {
        for (const modId of gunItem.default_mods) {
            const modItem = processor.byIdMaybe("item", modId);
            if (modItem?.type === "GUNMOD") {
                getMagazineIdsFromGunMod(modItem).forEach((id) => allMagazineItemIds.add(id));
            }
        }
    }
    getMagazineIdsFromItemPockets(gunItem).forEach((id) => allMagazineItemIds.add(id));
    const legacyMags = (gunItem as any).magazines;
    if (legacyMags) {
        ((legacyMags as [string, number][])).forEach((magEntry) =>
            allMagazineItemIds.add(magEntry[0])
        );
    }
    if (allMagazineItemIds.size > 0) {
        const firstMagId = allMagazineItemIds.values().next().value;
        const mag = processor.byIdMaybe("item", firstMagId);
        if (mag) return mag;
    }
    return null;
}

/**
 * Top-level function to calculate the total time for a reload.
 * THIS FUNCTION NOW CORRECTLY HANDLES A FULL RELOAD FOR TUBE-FED WEAPONS.
 */
export function getReloadTime(
  gunItem: Item & GunSlot,
  profile: CombatProfile,
  processor: CddaData
): number {
  // --- NEW LOGIC for Tube/Gate loading ---
  if (gunItem.flags?.includes("RELOAD_ONE")) {
    const timeForOneRound = getItemReloadCost(gunItem, gunItem, profile);
    const capacity = gunItem.clip_size ?? 1;
    // The total time is the time to load one round, multiplied by the capacity.
    return timeForOneRound * capacity;
  }

  // Check for other internal magazine types that aren't RELOAD_ONE
  const reloadMechanic = (gunItem as any).reload_mechanic;
  if (reloadMechanic === "INTERNAL_MAGAZINE") {
      return getItemReloadCost(gunItem, gunItem, profile);
  }
  
  // Logic for external magazines
  const magazine = findStandardMagazine(gunItem, processor);
  if (!magazine) {
    return 0;
  }

  const obtainCost = getMagazineObtainCost(magazine);
  const reloadActionCost = getItemReloadCost(gunItem, magazine, profile);
  
  return obtainCost + reloadActionCost;
}