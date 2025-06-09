// src/features/comparison/utils/magazineLogic.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import { log } from "./logger";

/**
 * Finds compatible magazine IDs from a gun's own `pocket_data`.
 * @param gun The gun item to inspect.
 * @returns An array of magazine item IDs.
 */
export function getMagazineIdsFromItemPockets(gun: Item): string[] {
    const basicInfo = gun as ItemBasicInfo;
    if (!basicInfo.pocket_data) {
        return [];
    }

    const magIds: string[] = [];
    for (const pocket of basicInfo.pocket_data) {
        if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
            log("DEBUG", `Found magazine well on gun '${gun.id}' with restrictions`, pocket.item_restriction);
            magIds.push(...pocket.item_restriction);
        }
    }
    return magIds;
}

/**
 * Finds compatible magazine IDs from a GUNMOD item.
 * This checks for the high-precedence `magazine_adaptor` and also `pocket_mods`.
 * @param mod The GUNMOD item to inspect.
 * @returns An array of magazine item IDs.
 */
export function getMagazineIdsFromGunMod(mod: Item): string[] {
    const gunMod = mod as Item & { magazine_adaptor?: any, pocket_mods?: any[] };
    const magIds = new Set<string>();

    // 1. Check for `magazine_adaptor`, which takes precedence.
    if (gunMod.magazine_adaptor && Array.isArray(gunMod.magazine_adaptor)) {
        log("DEBUG", `Found magazine_adaptor on mod '${mod.id}'`, gunMod.magazine_adaptor);
        // This handles structures like [["ammo_type", ["mag1", "mag2"]]]
        for (const entry of gunMod.magazine_adaptor) {
            if (Array.isArray(entry) && Array.isArray(entry[1])) {
                entry[1].forEach(id => magIds.add(id));
            }
        }
    }

    // 2. Check for `pocket_mods` that define a magazine well.
    if (gunMod.pocket_mods && Array.isArray(gunMod.pocket_mods)) {
        for (const pocket of gunMod.pocket_mods) {
            if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
                log("DEBUG", `Found magazine well in pocket_mods on mod '${mod.id}'`, pocket.item_restriction);
                pocket.item_restriction.forEach((id: string) => magIds.add(id));
            }
        }
    }
    
    return Array.from(magIds);
}