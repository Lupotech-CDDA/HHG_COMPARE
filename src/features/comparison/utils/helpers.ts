// src/features/comparison/utils/helpers.ts

import type { Item, GunSlot, ItemBasicInfo, PocketData, Translation } from "../../../types";
import type { CddaData } from "../../../data";
import { log } from "./logger";
import type { HitProbabilities } from "../core/types";

// =============================================================================
// SECTION: Private Helper Functions
// =============================================================================

/**
 * Safely gets the singular name string from a Translation object or a simple string.
 */
function getSingularName(name: Translation | string | undefined): string | undefined {
    if (typeof name === 'string') {
        return name;
    }
    return name?.str;
}

function getMagazineIdsFromItemPockets(gun: Item): string[] {
  const basicInfo = gun as ItemBasicInfo;
  if (!basicInfo.pocket_data) {
    return [];
  }

  const magIds: string[] = [];
  for (const pocket of basicInfo.pocket_data) {
    if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
      magIds.push(...pocket.item_restriction);
    }
  }
  return magIds;
}

function getMagazineIdsFromGunMod(mod: Item): string[] {
  const gunMod = mod as Item & {
    magazine_adaptor?: any;
    pocket_mods?: PocketData[];
  };
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

// =============================================================================
// SECTION: Exported Public Helper Functions
// =============================================================================

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
        // CORRECTED: Use the helper to safely get the name
        return getSingularName((mod as ItemBasicInfo).name) ?? mod.id;
      }
    }
  }
  return "N/A";
}

export function formatHitChances(hitProbs?: HitProbabilities): string {
  if (!hitProbs) {
    return "N/A";
  }

  const crit = `C:${(hitProbs.Critical * 100).toFixed(0)}%`;
  const hit = `H:${(hitProbs.Good * 100).toFixed(0)}%`;
  const graze = `G:${(hitProbs.Graze * 100).toFixed(0)}%`;

  return `${crit} ${hit} ${graze}`;
}

export function getReloadMethod(gun: Item, processor: CddaData): string {
  const gunSlot = gun as Item & GunSlot;

  if (gun.flags?.includes("RELOAD_ONE")) {
    const capacity = gunSlot.clip_size ?? 0;
    return capacity > 0 ? `Tube/Gate Load (${capacity}rds)` : "Tube/Gate Load";
  }

  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const mod = processor.byIdMaybe("item", modId);
      if (mod?.type === "MAGAZINE") {
        return `Default Mag`;
      }
    }
  }

  if (gun.pocket_data) {
    for (const pocket of gun.pocket_data) {
      if (pocket.pocket_type === "MAGAZINE_WELL") return "Magazine Well";
      // CORRECTED: Cast to `any` to allow comparison with a value not in the enum
      if ((pocket.pocket_type as any) === "helical_mag_well") return "Helical Mag";
    }
  }

  if (gunSlot.clip_size && gunSlot.clip_size > 0) {
    return `Internal (${gunSlot.clip_size}rds)`;
  }

  return "Direct Load";
}

export function getCompatibleMagazines(
  gun: Item,
  processor: CddaData
): string {
  const gunSlot = gun as Item & GunSlot;
  const allMagazineItemIds = new Set<string>();

  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const modItem = processor.byIdMaybe("item", modId);
      if (modItem?.type === "GUNMOD") {
        getMagazineIdsFromGunMod(modItem).forEach((id) =>
          allMagazineItemIds.add(id)
        );
      }
    }
  }

  getMagazineIdsFromItemPockets(gun).forEach((id) => allMagazineItemIds.add(id));

  if ((gunSlot as any).magazines) {
    ((gunSlot as any).magazines as [string, number][]).forEach((magEntry) =>
      allMagazineItemIds.add(magEntry[0])
    );
  }

  if (allMagazineItemIds.size === 0) {
    return "N/A";
  }

  const magNames = Array.from(allMagazineItemIds)
    .map((id) => {
      const magItem = processor.byIdMaybe("item", id);
      // CORRECTED: Use the helper to safely get the name
      return magItem ? getSingularName((magItem as ItemBasicInfo).name) ?? id : id;
    })
    .sort();

  return magNames.join(", ");
}