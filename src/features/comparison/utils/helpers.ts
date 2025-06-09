// src/features/comparison/utils/helpers.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";
import { log } from "./logger";
import { getMagazineIdsFromItemPockets, getMagazineIdsFromGunMod } from "./magazineLogic";

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

// --- ENHANCED getReloadMethod FUNCTION ---
/**
 * Determines a gun's primary reload method for display purposes.
 * @param gun - The gun item to inspect.
 * @param processor - The CddaData instance.
 * @returns A string describing the reload method.
 */
export function getReloadMethod(gun: Item, processor: CddaData): string {
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;

  // 1. Check for special reload flags first
  if (basicInfo.flags?.includes("RELOAD_ONE")) {
    // --- THIS IS THE ENHANCED LOGIC ---
    const capacity = gunSlot.clip_size ?? 0;
    if (capacity > 0) {
        return `Tube/Gate Load (${capacity} rounds)`;
    }
    return "Tube/Gate Load";
    // --- END OF ENHANCEMENT ---
  }

  // 2. Check for default mods that are magazines
  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const mod = processor.byIdMaybe("item", modId);
      if (mod && mod.type === "MAGAZINE") {
        return `Default Mag (${(mod as ItemBasicInfo).name?.str ?? mod.id})`;
      }
    }
  }

  // 3. Check pocket_data for magazine wells
  if (basicInfo.pocket_data) {
    for (const pocket of basicInfo.pocket_data) {
      if (pocket.pocket_type === "MAGAZINE_WELL") {
        log("DEBUG", `Identified reload method for '${gun.id}' as 'Magazine Well' via pocket_type.`);
        return "Magazine Well";
      }
      if (pocket.pocket_type === "helical_mag_well") {
          return "Helical Magazine";
      }
    }
  }
  
  // 4. Fallback to internal clip size
  if (gunSlot.clip_size && gunSlot.clip_size > 0) {
    return `Internal (${gunSlot.clip_size} rounds)`;
  }

  return "Direct Load"; // e.g., break-action shotguns
}

// --- NEW ROBUST & LOGGED getCompatibleMagazines FUNCTION ---
/**
 * Gets a formatted string of all compatible magazines for a gun.
 * This version correctly inspects pocket_data for magazine wells.
 * @param gun - The gun item to inspect.
 * @param processor - The CddaData instance.
 * @returns A comma-separated string of magazine names, or "N/A".
 */

// --- NEW ROBUST getCompatibleMagazines FUNCTION ---
/**
 * Gets a formatted string of all compatible magazines for a gun.
 * This orchestrator function uses helpers to check all known locations for magazine definitions.
 * @param gun - The gun item to inspect.
 * @param processor - The CddaData instance.
 * @returns A comma-separated string of magazine names, or "N/A".
 */
export function getCompatibleMagazines(gun: Item, processor: CddaData): string {
    const gunSlot = gun as Item & GunSlot;
    const allMagazineItemIds = new Set<string>();

    // 1. Check default_mods, as they can override base gun properties.
    if (gunSlot.default_mods) {
        for (const modId of gunSlot.default_mods) {
            const modItem = processor.byIdMaybe("item", modId);
            if (modItem && modItem.type === "GUNMOD") {
                const magsFromMod = getMagazineIdsFromGunMod(modItem);
                magsFromMod.forEach(id => allMagazineItemIds.add(id));
            }
        }
    }

    // 2. Check the gun's own pockets.
    const magsFromGunPockets = getMagazineIdsFromItemPockets(gun);
    magsFromGunPockets.forEach(id => allMagazineItemIds.add(id));

    // 3. Check the legacy `magazines` property as a fallback.
    if (gunSlot.magazines) {
        gunSlot.magazines.forEach(magEntry => allMagazineItemIds.add(magEntry[0]));
    }

    if (allMagazineItemIds.size === 0) {
        log("DEBUG", `No compatible external magazines found for '${gun.id}'.`);
        return "N/A";
    }

    const magNames = Array.from(allMagazineItemIds).map(id => {
        const magItem = processor.byIdMaybe("item", id);
        return magItem ? ((magItem as ItemBasicInfo).name?.str ?? id) : id;
    }).sort();
    
    log("SUCCESS", `Final list of compatible magazines for '${gun.id}':`, magNames);

    return magNames.join(', ');
}
