// src/features/comparison/core/calculations.ts

import type { Item, GunSlot, ItemBasicInfo, AmmoSlot } from "../../../types";
import type { CddaData } from "../../../data";
import { log } from "../utils/logger";

// --- Imports from our other feature files ---
import { classifyGunDetailed, type GunCategory } from "../utils/classify";
import { getStandardMagazine, getDefaultReceiver, formatHitChances, type HitProbabilities } from "../utils/helpers";
import { getFireableAmmoObjects, getRepresentativeDPHInfo, type PotentialDamageInfo } from "./properties";
import { 
    getMovesPerAttackActivation,
    getInherentWeaponDispersionMoa,
    getRecoilAbsorbFactor,
    getEffectiveGunRecoilQtyPerShot,
    getIncreaseInRecoilMoaPerShot,
    getHitProbabilities,
    estimateMovesToReachRecoil,
    type CombatProfile
} from "./mechanics";
import { 
    MAX_RECOIL_MOA,
    GOOD_HIT_DAMAGE_MULTIPLIER,
    GRAZE_DAMAGE_MULTIPLIER_DEFAULT
} from "../constants/defaults";

// --- Configuration and Profiles ---
export const TEST_GUY_PROFILE: CombatProfile = {
  strength: 10,
  dexterity: 10,
  perception: 10,
  weaponSkillLevel: 4,
  marksmanshipLevel: 4,
};

// --- Output Data Structure ---
export interface RepresentativeCombatInfo {
  id: string;
  name: string;
  category: GunCategory;
  isNonStandard: boolean;
  standardAmmo: string;
  standardMagazine: string;
  defaultReceiver: string;
  theoreticalDph: number;
  effectiveDamageAt10Tiles: number;
  hitChancesAt10Tiles: string;
  _internal?: {
    dphInfo: PotentialDamageInfo | null;
    hitProbabilitiesAt10Tiles: HitProbabilities | null;
  };
}


// --- Main Orchestrator: Wrapper for Modular Weapons ---

/**
 * Processes a gun item, handling modular weapons by creating a distinct entry
 * for each valid ammo configuration. This is the main entry point for the page.
 *
 * @param gun - The base gun item to process.
 * @param processor - The CddaData instance.
 * @param profile - The character profile for calculations.
 * @returns An array of RepresentativeCombatInfo objects, empty if no valid configs are found.
 */
// --- Main Orchestrator (NEW LOGIC TO PREVENT DUPLICATES) ---
export function processGun(
    gun: Item,
    processor: CddaData,
    profile: CombatProfile
): RepresentativeCombatInfo[] {
  // This is the first line of defense. If an undefined gun is passed, stop immediately.
    if (!gun) {
        log("ERROR", "processGun was called with an undefined gun object. Skipping.");
        return [];
    }
    const fireableAmmos = getFireableAmmoObjects(gun, processor);
    
    // If there are no fireable ammos, process the base gun once.
    if (fireableAmmos.length === 0) {
        log("DEBUG", `Gun '${gun.id}' has no fireable ammos. Processing base gun state.`);
        const singleResult = getSingleConfigurationCombatInfo(gun, profile, processor, null);
        return singleResult ? [singleResult] : [];
    }

    // If there are multiple ammo options, process each one.
    log("INFO", `Modular weapon detected or multiple ammo types for '${gun.id}'. Processing ${fireableAmmos.length} configs.`);
    const results: RepresentativeCombatInfo[] = [];
    for (const ammo of fireableAmmos) {
        // Prevent creating entries for the placeholder "null" ammo if other valid options exist.
        if (ammo.id === "null" && fireableAmmos.length > 1) {
            continue;
        }
        const configResult = getSingleConfigurationCombatInfo(gun, profile, processor, ammo);
        if (configResult) {
            results.push(configResult);
        }
    }
    // If after filtering out 'null' we have no results, process the base gun state once.
    if (results.length === 0) {
        const baseResult = getSingleConfigurationCombatInfo(gun, profile, processor, null);
        return baseResult ? [baseResult] : [];
    }
    return results;
}

// --- Core Calculation Engine (NEW UNIQUE ID LOGIC) ---
function getSingleConfigurationCombatInfo(
  gun: Item,
  profile: CombatProfile,
  processor: CddaData,
  preselectedAmmo: (Item & AmmoSlot) | null
): RepresentativeCombatInfo | null {
  // --- NEW ROBUST GUARD CLAUSE ---
  // This is the true fix. If the base gun object is invalid, we can't proceed.
  if (!gun || !gun.id) {
      log("ERROR", "getSingleConfigurationCombatInfo called with an invalid gun object.", { gun });
      return null;
  }
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;
  
  const category = classifyGunDetailed(gun);
  
  // --- This is the key change to prevent duplicate IDs ---
  let uniqueId = gun.id;
  let displayName = basicInfo.name?.str ?? gun.id;
  
  const dphInfo = preselectedAmmo ? getRepresentativeDPHInfo(gun, processor, preselectedAmmo) : null;

  if (dphInfo) {
    // Only append ammo type to ID and name if it's a distinct, valid configuration
    uniqueId = `${gun.id}_${dphInfo.ammoItem?.id ?? 'base'}`;
    displayName = `${displayName} (${dphInfo.ammoName})`;
  }

  const isNonStandard = category !== "Assault Rifle" && category !== "Rifle" &&
                        category !== "Pistol" && category !== "Submachine Gun" &&
                        category !== "Shotgun" && category !== "Other Firearm";

  if (isNonStandard || !dphInfo || dphInfo.damage <= 0) {
    if (isNonStandard) log("DEBUG", `Treating '${uniqueId}' as Non-Standard because category is '${category}'`);
    else log("WARN", `No valid DPH for configuration '${uniqueId}'. Treating as non-damaging.`);
    
    return {
      id: uniqueId, name: displayName, category: category, isNonStandard: true,
      standardAmmo: dphInfo?.ammoName ?? "N/A",
      standardMagazine: getStandardMagazine(gun, processor),
      defaultReceiver: getDefaultReceiver(gun, processor),
      theoreticalDph: 0, effectiveDamageAt10Tiles: 0, hitChancesAt10Tiles: "N/A",
    };
  }
  
  const { damage: theoreticalDph, ammoItem, ammoCritMultiplier } = dphInfo;
  const inherentDispersion = getInherentWeaponDispersionMoa(gunSlot, ammoItem, profile);
  const targetAngularSizeAt10Tiles = Math.atan(0.5 / 10) * (180 / Math.PI) * 60;
  const movesForFirstShotAim = estimateMovesToReachRecoil(gunSlot, 150, MAX_RECOIL_MOA, profile);
  const recoilAfterFirstAim = 150;
  const effectiveDispersionForFirstShot = inherentDispersion + recoilAfterFirstAim;
  const hitProbabilitiesAt10Tiles = getHitProbabilities(effectiveDispersionForFirstShot, targetAngularSizeAt10Tiles);
  
  const effectiveDamageAt10Tiles = theoreticalDph * (
      (hitProbabilitiesAt10Tiles.P_Crit * (ammoCritMultiplier ?? 1.5)) +
      (hitProbabilitiesAt10Tiles.P_Hit * GOOD_HIT_DAMAGE_MULTIPLIER) +
      (hitProbabilitiesAt10Tiles.P_Graze * GRAZE_DAMAGE_MULTIPLIER_DEFAULT)
    );

  const result: RepresentativeCombatInfo = {
    id: uniqueId, name: displayName, category: category, isNonStandard: isNonStandard,
    standardAmmo: dphInfo.ammoName, standardMagazine: getStandardMagazine(gun, processor),
    defaultReceiver: getDefaultReceiver(gun, processor), theoreticalDph: theoreticalDph,
    effectiveDamageAt10Tiles: effectiveDamageAt10Tiles, hitChancesAt10Tiles: formatHitChances(hitProbabilitiesAt10Tiles),
    _internal: { dphInfo: dphInfo, hitProbabilitiesAt10Tiles: hitProbabilitiesAt10Tiles },
  };

  log("SUCCESS", `Successfully processed configuration '${uniqueId}'`, result);
  return result;
}