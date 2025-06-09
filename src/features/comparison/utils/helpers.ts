// src/features/comparison/utils/helpers.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";

/**
 * Finds and returns the name of a default receiver mod, if any.
 * A receiver is identified as a GUNMOD with the location "receiver".
 *
 * @param gun - The gun item to inspect.
 * @param processor - The CddaData instance for looking up mods.
 * @returns The name of the receiver or "N/A".
 */
export function getDefaultReceiver(gun: Item, processor: CddaData): string {
  const defaultMods = (gun as Item & GunSlot).default_mods;
  if (!defaultMods) {
    return "N/A";
  }

  for (const modId of defaultMods) {
    const mod = processor.byIdMaybe("item", modId);
    if (mod) {
      const gunMod = mod as Item & { location?: string };
      if (gunMod.type === "GUNMOD" && gunMod.location === "receiver") {
        return (mod as ItemBasicInfo).name?.str ?? mod.id;
      }
    }
  }

  return "N/A";
}

/**
 * Identifies a "standard" magazine for a gun for display purposes.
 * Heuristic:
 * 1. Prefers a magazine found in the gun's `default_mods`.
 * 2. Falls back to the first compatible magazine found via `pocket_data`.
 * 3. Finally, describes the gun's internal `clip_size` if no external mag is found.
 *
 * @param gun - The gun item to inspect.
 * @param processor - The CddaData instance for looking up mods/mags.
 * @returns A string describing the standard magazine.
 */
export function getStandardMagazine(gun: Item, processor: CddaData): string {
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;

  // 1. Check default_mods first
  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const mod = processor.byIdMaybe("item", modId);
      if (mod && mod.type === "MAGAZINE") {
        return (mod as ItemBasicInfo).name?.str ?? mod.id;
      }
    }
  }

  // 2. Check pocket_data for magazine wells
  if (basicInfo.pocket_data) {
    for (const pocket of basicInfo.pocket_data) {
      if (pocket.magazine_well) {
        // In a full implementation, you'd look up compatible mags.
        // For this helper, we'll just indicate a well is present.
        return "Magazine Well";
      }
    }
  }
  
  // 3. Fallback to internal clip size
  if (gunSlot.clip_size && gunSlot.clip_size > 0) {
    return `Internal (${gunSlot.clip_size} rounds)`;
  }

  return "N/A";
}


/**
 * The structure representing calculated hit probabilities.
 */
export interface HitProbabilities {
  P_Crit: number;
  P_Hit: number;
  P_Graze: number;
  P_Miss: number;
}

/**
 * Formats hit probability data into a concise string for table display.
 * Example: "C:30% H:50% G:10%"
 *
 * @param hitProbs - The HitProbabilities object.
 * @returns A formatted string, or "N/A".
 */
export function formatHitChances(hitProbs?: HitProbabilities): string {
  if (!hitProbs) {
    return "N/A";
  }

  const crit = `C:${(hitProbs.P_Crit * 100).toFixed(0)}%`;
  const hit = `H:${(hitProbs.P_Hit * 100).toFixed(0)}%`;
  const graze = `G:${(hitProbs.P_Graze * 100).toFixed(0)}%`;

  return `${crit} ${hit} ${graze}`;
}