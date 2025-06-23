// src/features/comparison/core/properties.ts

// --- Corrected Imports ---
import type { Item, GunSlot, AmmoSlot, ItemBasicInfo, PocketData, Translation } from "../../../types";
import type { CddaData } from "../../../data";
import { normalizeDamageInstance } from "../../../data";
import { log } from "../utils/logger";
import {
  CombatProfile,
  PotentialDamageInfo,
  FiringMode,
} from "./types";
import {
  CRITICAL_HIT_DAMAGE_MULTIPLIER_DEFAULT,
} from "../constants/index";
import { getWeaponDispersionSources } from "./mechanics";

// Type alias for the inline tuple
type JsonFiringModeTuple = [string, string, number] | [string, string, number, string[] | string];

// A helper type for items that might have an ammo_modifier
type ItemWithAmmoModifier = Item & { ammo_modifier?: string[] };

/**
 * Safely gets the singular name string from a Translation object or a simple string.
 */
function getSingularName(name: Translation | string | undefined): string | undefined {
    if (typeof name === 'string') {
        return name;
    }
    return name?.str;
}

// =============================================================================
// SECTION: Helper Functions for Modular Weapons
// =============================================================================

function getChamberings(gun: Item, processor: CddaData): Set<string> {
  const gunSlot = gun as Item & GunSlot;
  const chamberings = new Set<string>();

  if (gunSlot.ammo) {
    const ammoList = Array.isArray(gunSlot.ammo) ? gunSlot.ammo : [gunSlot.ammo];
    ammoList.forEach((ammoType) => chamberings.add(ammoType));
  }

  if (gunSlot.pocket_data) {
    for (const pocket of gunSlot.pocket_data) {
      if (pocket.magazine_well && pocket.ammo_restriction) {
        for (const ammoType in pocket.ammo_restriction) {
          chamberings.add(ammoType);
        }
      }
    }
  }

  if (gunSlot.default_mods) {
    for (const modId of gunSlot.default_mods) {
      const mod = processor.byIdMaybe("item", modId) as Item & GunSlot;
      if (!mod) continue;
      
      if (mod.ammo) {
        const ammoList = Array.isArray(mod.ammo) ? mod.ammo : [mod.ammo];
        ammoList.forEach((ammoType) => chamberings.add(ammoType));
      }

      // CORRECTED: Use type assertion to access ammo_modifier
      const modWithAmmoModifier = mod as ItemWithAmmoModifier;
      if (mod.type === "MAGAZINE" && modWithAmmoModifier.ammo_modifier) {
        modWithAmmoModifier.ammo_modifier.forEach((ammoType: string) =>
          chamberings.add(ammoType)
        );
      }
    }
  }

  return chamberings;
}

export function getFireableAmmoObjects(
  gun: Item,
  processor: CddaData
): (Item & AmmoSlot)[] {
  const chamberings = getChamberings(gun, processor);
  const ammoItems: (Item & AmmoSlot)[] = [];

  for (const ammoType of chamberings) {
    const ammoTypeData = processor.byIdMaybe("ammunition_type", ammoType);
    if (ammoTypeData?.default) {
      const ammoItem = processor.byIdMaybe(
        "item",
        ammoTypeData.default
      ) as Item & AmmoSlot;
      if (ammoItem) {
        ammoItems.push(ammoItem);
      }
    }
  }

  if (ammoItems.length === 0 && chamberings.size === 0) {
    return [{ id: "null" } as Item & AmmoSlot];
  }

  return ammoItems;
}

export function getFiringModes(gun: Item & GunSlot): FiringMode[] {
  if (!gun.modes) {
    return [{ id: "DEFAULT", name: "semi-auto", shots: 1 }];
  }

  return gun.modes.map((mode: JsonFiringModeTuple) => ({
    id: mode[0],
    name: mode[1],
    shots: mode[2],
  }));
}

// =============================================================================
// SECTION: Main Calculation Function
// =============================================================================

export function getDphInfoForAmmo(
  gun: Item & GunSlot,
  ammo: Item & AmmoSlot,
  profile: CombatProfile,
  processor: CddaData
): PotentialDamageInfo | null {
  if (!ammo?.damage) {
    return null;
  }

  const normalizedDmg = normalizeDamageInstance(ammo.damage);
  if (normalizedDmg.length === 0) {
    return null;
  }

  const totalDamage = normalizedDmg.reduce(
    (sum, dmg) => sum + (dmg.amount ?? 0),
    0
  );

  const isShotgunAmmo = (ammo as { ammo_type?: string }).ammo_type === "shot";
  const pelletCount = isShotgunAmmo ? ammo.count ?? 1 : 1;

  const gunSkillId = gun.skill ?? "N/A";
  const dispersionSources = getWeaponDispersionSources(
    gun,
    ammo,
    profile,
    gunSkillId
  );
  const inherentDispersionMoa = dispersionSources.max();

  // CORRECTED: Use the helper to safely get the name
  const ammoName = getSingularName((ammo as ItemBasicInfo).name) ?? ammo.id;

  const result: PotentialDamageInfo = {
    damage: totalDamage,
    ammoName: ammoName,
    ammoRecoil: ammo.recoil ?? 0,
    inherentDispersionMoa: inherentDispersionMoa,
    ammoItem: ammo,
    pelletCount: pelletCount,
    ammoCritMultiplier:
      (ammo as any).critical_multiplier ?? CRITICAL_HIT_DAMAGE_MULTIPLIER_DEFAULT,
  };

  return result;
}