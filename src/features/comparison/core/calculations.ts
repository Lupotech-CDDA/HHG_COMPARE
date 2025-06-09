// src/features/comparison/core/calculations.ts

import type { Item, GunSlot, ItemBasicInfo, AmmoSlot } from "../../../types";
import type { CddaData } from "../../../data";
import { log } from "../utils/logger";
import { classifyGunDetailed, type GunCategory } from "../utils/classify";
import { getReloadMethod, getCompatibleMagazines,getStandardMagazine, getDefaultReceiver, formatHitChances, type HitProbabilities } from "../utils/helpers";
import { getFireableAmmoObjects, getRepresentativeDPHInfo, type PotentialDamageInfo } from "./properties"; 
import { getMovesPerAttackActivation, getInherentWeaponDispersionMoa, getRecoilAbsorbFactor, getEffectiveGunRecoilQtyPerShot, getIncreaseInRecoilMoaPerShot, getHitProbabilities, estimateMovesToReachRecoil, type CombatProfile } from "./mechanics";
import { MAX_RECOIL_MOA, GOOD_HIT_DAMAGE_MULTIPLIER, GRAZE_DAMAGE_MULTIPLIER_DEFAULT } from "../constants/defaults";

export const TEST_GUY_PROFILE: CombatProfile = {
  strength: 10,
  dexterity: 10,
  perception: 10,
  weaponSkillLevel: 4,
  marksmanshipLevel: 4,
};

// --- Updated Output Data Structure ---
export interface RepresentativeCombatInfo {
  id: string;
  name: string;
  category: GunCategory;
  skillUsed: string;
  isNonStandard: boolean;
  standardAmmo: string;
  reloadMethod: string;
  compatibleMagazines: string; // <-- NEW
  defaultReceiver: string;
  theoreticalDph: number;
  effectiveDamageAt10Tiles: number;
  hitChancesAt10Tiles: string;
  hitChanceSortValue: number; // <-- NEW PROPERTY FOR SORTING
  _internal?: {
    dphInfo: PotentialDamageInfo | null;
    hitProbabilitiesAt10Tiles: HitProbabilities | null;
  };
}

// --- Main Orchestrator Wrapper (no change to this function) ---
export function processGun(
    gun: Item,
    processor: CddaData,
    profile: CombatProfile
): RepresentativeCombatInfo[] {
    const fireableAmmos = getFireableAmmoObjects(gun, processor);
    if (fireableAmmos.length <= 1) {
        const singleResult = getSingleConfigurationCombatInfo(gun, profile, processor, fireableAmmos[0] ?? null);
        return singleResult ? [singleResult] : [];
    }
    const results: RepresentativeCombatInfo[] = [];
    for (const ammo of fireableAmmos) {
        if (ammo.id === "null" && fireableAmmos.length > 1) continue;
        const configResult = getSingleConfigurationCombatInfo(gun, profile, processor, ammo);
        if (configResult) results.push(configResult);
    }
    if (results.length === 0) {
        const baseResult = getSingleConfigurationCombatInfo(gun, profile, processor, null);
        return baseResult ? [baseResult] : [];
    }
    return results;
}

// --- Core Calculation Engine (Updated) ---
function getSingleConfigurationCombatInfo(
  gun: Item,
  profile: CombatProfile,
  processor: CddaData,
  preselectedAmmo: (Item & AmmoSlot) | null
): RepresentativeCombatInfo | null {
  if (!gun || !gun.id) {
      log("ERROR", "getSingleConfigurationCombatInfo called with an invalid gun object.", { gun });
      return null;
  }

  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;
  const category = classifyGunDetailed(gun);
  const skillUsed = gunSlot.skill ?? 'N/A';
  
  let uniqueId = gun.id;
  let displayName = basicInfo.name?.str ?? gun.id;
  
  const dphInfo = preselectedAmmo ? getRepresentativeDPHInfo(gun, processor, preselectedAmmo) : null;

  if (dphInfo) {
    uniqueId = `${gun.id}_${dphInfo.ammoItem?.id ?? 'base'}`;
    displayName = preselectedAmmo ? `${displayName} (${dphInfo.ammoName})` : displayName;
  }

  const isNonStandard = category !== "Assault Rifle" && category !== "Rifle" &&
                        category !== "Pistol" && category !== "Submachine Gun" &&
                        category !== "Shotgun" && category !== "Other Firearm";

  const reloadMethod = getReloadMethod(gun, processor);
  const compatibleMagazines = getCompatibleMagazines(gun, processor);

  if (isNonStandard || !dphInfo || dphInfo.damage <= 0) {
    return {
      id: uniqueId, name: displayName, category: category, skillUsed: skillUsed,
      isNonStandard: true, standardAmmo: dphInfo?.ammoName ?? "N/A",
      reloadMethod: reloadMethod, compatibleMagazines: compatibleMagazines,
      defaultReceiver: getDefaultReceiver(gun, processor),
      theoreticalDph: 0, effectiveDamageAt10Tiles: 0, hitChancesAt10Tiles: "N/A",
      hitChanceSortValue: 0, // <-- Default value for non-standard items
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

  // --- NEW: Calculate the numerical sort value for hit chances ---
  const hitChanceSortValue = (hitProbabilitiesAt10Tiles.P_Crit * 1000) + hitProbabilitiesAt10Tiles.P_Hit;

  const result: RepresentativeCombatInfo = {
    id: uniqueId, name: displayName, category: category, skillUsed: skillUsed,
    isNonStandard: isNonStandard, standardAmmo: dphInfo.ammoName,
    reloadMethod: reloadMethod, compatibleMagazines: compatibleMagazines, // <-- UPDATED
    defaultReceiver: getDefaultReceiver(gun, processor),
    theoreticalDph: theoreticalDph,
    effectiveDamageAt10Tiles: effectiveDamageAt10Tiles,
    hitChancesAt10Tiles: formatHitChances(hitProbabilitiesAt10Tiles),
    hitChanceSortValue: hitChanceSortValue, // <-- POPULATE NEW PROPERTY
    _internal: { dphInfo: dphInfo, hitProbabilitiesAt10Tiles: hitProbabilitiesAt10Tiles },
  };

  log("SUCCESS", `Successfully processed configuration '${uniqueId}'`);
  return result;
}