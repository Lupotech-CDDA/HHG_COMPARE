// This file acts as an adapter between HHG's CddaData and Item types,
// and the simpler, flattened inputs expected by our CDDA simulation logic.

import {
  Item,
  Gun,
  Ammo,
  GunMod,
  Magazine,
  DamageUnit,
  DamageInstance,
  isItemSubtype,
  // Assuming these are from HHG's types.ts
  volume,
  mass,
} from "../../../types";
import { CddaData, parseVolume, parseMass, normalizeDamageInstance } from "../../../data"; // Assuming these are exposed by data.ts
import { GunProfile, OpticalSightModInfo } from "../utils/cddaTypes";
import { debugLogger } from "../utils/debugLogger";

// --- Helper Types (if not already in HHG types.ts, or for our specific use) ---
export interface FiringModeDetail {
  mode: string; // e.g., "semi", "burst", "auto"
  rateOfFire: number; // rounds per minute or turn equivalent
  // Other relevant details like burst size, energy consumption etc.
}

// Placeholder for basic damage info (similar to PotentialDamageInfo)
export interface RepresentativeDPHInfo {
  dph: number; // Damage Per Hit (average across damage types, potentially with pellets)
  totalPellets: number; // For shotguns, etc.
  rawDamage: number; // Sum of raw damage amounts before any modifiers
}

// --- HHG Data to Simplified Profile Mappers ---

/**
 * Extracts all possible chamberings for a gun, considering magazine wells and gun mods.
 * NOTE: This is a simplified stub. A full implementation would require detailed parsing of
 * gun.magazine_well and gunmod.magazine_adaptor from HHG's types.
 * For now, it returns dummy chamberings.
 */
export function getGunChamberings(gun: Gun, cddaData: CddaData): string[] {
  const chamberings: Set<string> = new Set();

  // Primary magazine well chamberings
  if (gun.magazine_well && Array.isArray(gun.magazine_well)) {
    for (const mw of gun.magazine_well) {
      if (mw[0] === "ANY") {
        // If "ANY" specified, we need to get all ammo types compatible with gun.ammo_type
        // This is complex and depends on ammo_type definitions
      } else {
        chamberings.add(mw[0]);
      }
    }
  }

  // Also need to check gunmods that might adapt magazine wells or change chamberings
  // This is complex and relies on item.gunmods being available and correctly typed
  // and gunmod.magazine_adaptor structure.

  debugLogger.log(
    `[gunProperties] Stub: getGunChamberings for ${gun.id} returns dummy.`
  );
  // Return dummy for now, needs full HHG type parsing
  return ["9mm", ".223"]; // Dummy example
}

/**
 * Gets the effective barrel length of a gun in millimeters.
 * Assumes gun.length is available in mm.
 * NOTE: This is a simplified stub. Real implementation might need to account for barrel mods.
 */
export function getEffectiveBarrelLengthMm(
  gun: Gun,
  cddaData: CddaData
): number {
  // HHG's Item.length should be in mm if `data.ts`'s parsing handles it.
  // The `_flatten` method handles `proportional` and `relative` properties.
  // Assuming `gun.length` is already the effective length.
  if (typeof gun.length === "number") {
    return gun.length; // Assuming HHG already parsed it to number in mm
  } else if (typeof gun.length === "string") {
    // If length is still a string (e.g., "177 mm"), parse it.
    // HHG's `parseDuration` handles `mm`, but `parseVolume` and `parseMass` don't have `mm` unit.
    // Let's assume gun.length is already numerical by the time we get the flattened object,
    // or add a new parser if needed. For now, a simple regex.
    const match = gun.length.match(/^(\d+(\.\d+)?)\s*mm$/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  debugLogger.log(
    `[gunProperties] Warning: Could not determine effective barrel length for ${gun.id}. Defaulting to 0.`
  );
  return 0; // Default or error case
}

/**
 * Finds all compatible ammo objects for a given gun.
 * NOTE: This is a simplified stub. A full implementation requires detailed
 * understanding of gun.ammo_type (can be string or array), ammo.type, and item_group lookups.
 */
export function getFireableAmmoObjects(
  gun: Gun,
  cddaData: CddaData
): Ammo[] {
  const compatibleAmmo: Ammo[] = [];
  const gunAmmoTypes = Array.isArray(gun.ammo_type)
    ? gun.ammo_type
    : [gun.ammo_type];

  // This would need to iterate through all ammo items in CddaData and check compatibility
  // Very heavy operation without proper indexing.
  // For now, return a dummy list.
  debugLogger.log(
    `[gunProperties] Stub: getFireableAmmoObjects for ${gun.id} returns dummy.`
  );
  // Simulating fetching actual ammo:
  // const allAmmo = cddaData.byType("item").filter(item => isItemSubtype("AMMO", item)) as Ammo[];
  // For dummy:
  const dummyAmmo9mm: Ammo = {
    id: "9mm_fmj",
    type: "AMMO",
    name: "9mm FMJ",
    volume: parseVolume("5ml"),
    weight: parseMass("10g"),
    ammo_type: "9mm",
    damage: [{ amount: 10, damage_type: "bullet" }],
    recoil: 500,
    dispersion: 10,
    stack_size: 20,
    count: 1, // Not pellets
  } as Ammo;
  const dummyAmmo223: Ammo = {
    id: ".223_fmj",
    type: "AMMO",
    name: ".223 FMJ",
    volume: parseVolume("8ml"),
    weight: parseMass("12g"),
    ammo_type: ".223",
    damage: [{ amount: 15, damage_type: "bullet" }],
    recoil: 800,
    dispersion: 5,
    stack_size: 20,
    count: 1,
  } as Ammo;
  compatibleAmmo.push(dummyAmmo9mm, dummyAmmo223);

  return compatibleAmmo;
}

/**
 * Selects a "representative" standard ammunition for baseline calculations.
 * This is a heuristic. For now, it picks the first available ammo.
 * A more robust version would prefer common rounds, lowest dispersion, etc.
 */
export function classifyAndSelectStandardAmmo(
  gun: Gun,
  availableAmmo: Ammo[],
  cddaData: CddaData
): Ammo | undefined {
  if (!availableAmmo || availableAmmo.length === 0) {
    debugLogger.log(
      `[gunProperties] No available ammo found for ${gun.id}.`
    );
    return undefined;
  }
  // Simplified heuristic: just pick the first one
  debugLogger.log(
    `[gunProperties] Stub: classifyAndSelectStandardAmmo for ${gun.id} selects first available.`
  );
  return availableAmmo[0];
}

/**
 * Calculates the Damage Per Hit (DPH) for a given ammunition,
 * considering its damage instances and pellet count.
 * Assumes `ammo.damage` is already flattened by HHG's `_flatten` function.
 */
export function getAdjustedAmmoDamage(
  ammo: Ammo,
  barrelLengthMm: number, // May not be directly used for DPH in our current model, but kept for signature
  gunSkillIdStr: string, // Not directly used for DPH in our current model, but kept for signature
  cddaData: CddaData // Not directly used here, but may be in future
): RepresentativeDPHInfo {
  let totalRawDamage = 0;
  let totalPellets = 1; // Default to 1 for non-shotgun ammo

  // Handle damage instances. `normalizeDamageInstance` ensures it's an array.
  const damageInstances = normalizeDamageInstance(ammo.damage);

  for (const du of damageInstances) {
    totalRawDamage += du.amount ?? 0;
  }

  // Check for projectile pellet count if `proj.count` exists and `ammo_type` is related to shotguns
  // The Python `_flatten` had a specific fix for erroneous `count` fields.
  // Here, we explicitly check `ammo.proj?.count` if available, and if `ammo_type` is typical for shotguns.
  // HHG's `Ammo` interface does not explicitly list `proj.count`.
  // Assuming `ammo.count` directly reflects pellets for shotgun-like ammo, or we need to find `ammo.proj.count` in `types.ts`.
  // For now, let's use a heuristic based on ammo_type.
  if (
    ammo.ammo_type &&
    (ammo.ammo_type.includes("shot") ||
      ammo.ammo_type.includes("buckshot") ||
      ammo.ammo_type.includes("slug"))
  ) {
    // If HHG provides `ammo.count` for this purpose, use it.
    // Otherwise, we'd need to fetch raw JSON to confirm `proj.count`.
    // Assuming `ammo.count` is available and relevant for pellets.
    if (ammo.count !== undefined && typeof ammo.count === "number" && ammo.count > 0) {
      totalPellets = ammo.count;
    } else {
        // Fallback or warning if a shotgun ammo type doesn't have a count.
        debugLogger.log(`[gunProperties] Warning: Shotgun ammo ${ammo.id} missing explicit pellet count. Assuming 1.`);
    }
  }

  // Barrel length typically affects dispersion, not raw DPH directly for bullets.
  // For shotguns, more pellets might hit, but the DPH for *each pellet* doesn't change.
  // The logic for 'explosion/shrapnel damage for DPH' would involve parsing specific item flags/properties.
  // For this initial pass, we focus on basic summed damage.

  const dph = totalRawDamage * totalPellets; // Total DPH is sum of raw damage * pellets

  return { dph: dph, totalPellets: totalPellets, rawDamage: totalRawDamage };
}

/**
 * Creates a GunProfile object from HHG's Gun and Ammo types,
 * flattening relevant properties for our calculation modules.
 * This is the primary adapter function in this file.
 */
export function createGunProfile(
  gun: Gun,
  selectedAmmo: Ammo,
  relevantMods: GunMod[],
  cddaData: CddaData
): GunProfile {
  // Extract and parse volume/length using HHG's utility functions
  const gunVolumeMl = parseVolume(gun.volume);
  const gunLengthMm = parseVolume(gun.length) / 1000; // Assuming HHG's parseVolume gives ml, convert to L then to mm (e.g. 1L = 1000mm in CDDA context for length)
  // Re-evaluating length: `parseVolume` expects 'ml' or 'L'. `gun.length` is `mm` in JSON.
  // The Python `calculate_aim_factor_from_length` took `gun_length_mm` directly as a float.
  // HHG's `types.ts` summary indicates `length` is `number | string`.
  // If `gun.length` is a string like "177 mm", parse it directly.
  let gunLengthMmCorrected: number;
  if (typeof gun.length === "number") {
    gunLengthMmCorrected = gun.length;
  } else {
    const match = gun.length.match(/^(\d+(\.\d+)?)\s*mm$/);
    gunLengthMmCorrected = match ? parseFloat(match[1]) : 0; // Default to 0 if parsing fails
    if (!match) debugLogger.log(`[gunProperties] Warning: Could not parse gun length '${gun.length}' for ${gun.id}.`);
  }

  // Extract optical sight info from relevantMods
  const gunModsSightsInfo: OpticalSightModInfo[] = [];
  for (const mod of relevantMods) {
    // HHG's GunMod interface does not have a direct `gunmod.sight_dispersion` or `gunmod.aim_speed`
    // The summary mentioned `gunmod.dispersion`, `gunmod.sight_dispersion`, `gunmod.aim_speed`.
    // Assuming these are directly on the `mod` object for simplicity for now.
    // Also assuming `is_zoomed` and `is_laser` would be flags on the mod or derived.
    if (mod.type === "GUNMOD" && mod.gunmod) { // Assuming `mod.gunmod` exists as a sub-object for gunmods
      if (mod.gunmod.sight_dispersion !== undefined && mod.gunmod.sight_dispersion >= 0) {
        gunModsSightsInfo.push({
          base_disp: mod.gunmod.sight_dispersion,
          is_zoomed: mod.flags?.includes("ZOOM") ?? false, // Assuming ZOOM is a flag
          intrinsic_aim_speed: mod.gunmod.aim_speed ?? 0, // Assuming aim_speed is available
          fov: mod.gunmod.field_of_view ?? 0, // Assuming field_of_view is available
          is_laser: mod.flags?.includes("LASER") ?? false, // Assuming LASER is a flag
        });
      }
    }
  }


  const gunProfile: GunProfile = {
    name: gun.name?.str ?? gun.id, // Use pluralName for display, but here just name
    gun_skill_id_str: gun.skill ?? "none", // Assuming `gun.skill` is the primary skill ID (e.g., "pistol")
    gun_volume_ml: gunVolumeMl,
    gun_length_mm: gunLengthMmCorrected,
    has_collapsible_stock: gun.flags?.includes("COLLAPSIBLE_STOCK") ?? false,
    collapsed_volume_delta_ml: gun.collapsed_volume_delta_ml ?? 0, // Assuming this property exists on Gun
    has_iron_sights: gun.sight_dispersion !== undefined && gun.sight_dispersion >= 0, // Assuming gun.sight_dispersion indicates iron sights
    gun_iron_sight_base_disp_moa: gun.sight_dispersion ?? 99999.0, // Default to very high if no iron sights
    gun_mods_sights_info: gunModsSightsInfo,
    ammo_source_is_external_and_used_for_this_shot: gun.flags?.includes("USES_EXTERNAL_AMMO") ?? false, // Example flag for bows
    external_ammo_reload_option_moves: gun.reload_time ?? 0, // Simplified: using reload_time as proxy for RAS_time if external
    // Properties for base dispersion and hit chance calculations
    gun_base_disp_json: gun.dispersion ?? 0, // Gun's "dispersion" from JSON (MOA)
    gun_mod_disp_sum_json: relevantMods.reduce((sum, mod) => sum + (mod.gunmod?.dispersion ?? 0), 0), // Sum of gunmod dispersion
    gun_damage_level: 0, // Assuming pristine gun for now; HHG Item type doesn't typically track damage_level
    ammo_base_disp_json: selectedAmmo.dispersion ?? 0, // Ammo's "dispersion" from JSON (MOA)
    ammo_shot_spread_val: selectedAmmo.proj?.shot_spread ?? 0, // Assuming proj.shot_spread from Ammo
  };

  return gunProfile;
}

// NOTE: Other HHG-specific utility functions like getMagazineIdsFromItemPockets,
// getMagazineIdsFromGunMod, getFiringModeDetails would go here if needed.
// Their implementation depends heavily on the specific structure of Item, Gun, Magazine, etc.
// as defined in src/types.ts and how complex properties are handled in HHG's CddaData.