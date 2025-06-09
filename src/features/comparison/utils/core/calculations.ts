// src/features/comparison/core/calculations.ts

import type { Item, GunSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";

// Helpers we just defined
import { classifyGunDetailed, type GunCategory } from "../utils/classify";
import {
  getStandardMagazine,
  getDefaultReceiver,
  formatHitChances,
  type HitProbabilities,
} from "../utils/helpers";

// Logic ported from V1's combatMechanics.ts
// In a real project, these would be in `core/mechanics.ts`
import {
  getMovesPerAttackActivation,
  getInherentWeaponDispersionMoa,
  getRecoilAbsorbFactor,
  getEffectiveGunRecoilQtyPerShot,
  getIncreaseInRecoilMoaPerShot,
  getHitProbabilities,
  estimateMovesToReachRecoil,
} from "./mechanics"; // Assuming we've ported this

// Logic from V1's gunProperties.ts that we will need
// We will assume these exist in `core/properties.ts`
import {
  getRepresentativeDPHInfo,
  type PotentialDamageInfo,
} from "./properties";

// --- Configuration and Profiles ---

// The profile of our test character
export interface CombatProfile {
  strength: number;
  dexterity: number;
  perception: number;
  weaponSkillLevel: number;
  marksmanshipLevel: number;
}
export const TEST_GUY_PROFILE: CombatProfile = {
  strength: 10,
  dexterity: 10,
  perception: 10,
  weaponSkillLevel: 4,
  marksmanshipLevel: 4,
};

// --- Output Data Structure ---

// This is the definitive structure for a fully processed gun object.
export interface RepresentativeCombatInfo {
  // Classification & Identification
  id: string;
  name: string;
  category: GunCategory;
  isNonStandard: boolean;

  // New Table Columns
  standardAmmo: string;
  standardMagazine: string;
  defaultReceiver: string;
  theoreticalDph: number; // Damage per bullet before hit chance
  effectiveDamageAt10Tiles: number; // Expected damage for one shot at 10 tiles
  hitChancesAt10Tiles: string; // Formatted string of hit chances

  // Internal data for potential future use
  _internal: {
    dphInfo: PotentialDamageInfo | null;
    hitProbabilities: HitProbabilities | null;
  };
}

// --- Main Orchestrator Function ---

/**
 * Takes a raw gun item and returns a rich object with all calculated
 * combat statistics required for the comparison table.
 * This is the main calculation engine for the feature.
 *
 * @param gun - The gun item to process.
 * @param processor - The CddaData instance.
 * @param profile - The character profile to use for calculations.
 * @returns A RepresentativeCombatInfo object, or null if the gun cannot be processed.
 */
export function getRepresentativeCombatInfo(
  gun: Item,
  processor: CddaData,
  profile: CombatProfile
): RepresentativeCombatInfo | null {
  const gunSlot = gun as Item & GunSlot;
  const basicInfo = gun as ItemBasicInfo;

  // 1. CLASSIFY & GATHER BASIC HELPERS
  const category = classifyGunDetailed(gun);
  const isNonStandard = category !== "Assault Rifle" && category !== "Rifle" &&
                        category !== "Pistol" && category !== "Submachine Gun" &&
                        category !== "Shotgun" && category !== "Other Firearm";

  const standardMagazine = getStandardMagazine(gun, processor);
  const defaultReceiver = getDefaultReceiver(gun, processor);

  // For non-standard guns, we return minimal info for the table
  if (isNonStandard) {
    return {
      id: gun.id,
      name: (basicInfo.name?.str ?? gun.id),
      category: category,
      isNonStandard: true,
      standardAmmo: "N/A",
      standardMagazine: standardMagazine,
      defaultReceiver: defaultReceiver,
      theoreticalDph: 0,
      effectiveDamageAt10Tiles: 0,
      hitChancesAt10Tiles: "N/A",
      _internal: { dphInfo: null, hitProbabilities: null },
    };
  }

  // 2. GET REPRESENTATIVE AMMO & DAMAGE
  // This function (from gunProperties) finds the best standard ammo and its base stats.
  const dphInfo = getRepresentativeDPHInfo(gun, processor);

  if (!dphInfo || dphInfo.damage <= 0) {
    // If we can't find valid ammo for a standard gun, we can't process it.
    return null;
  }

  const {
    damage: theoreticalDph,
    ammoName,
    ammoItem,
    ammoCritMultiplier,
    pelletCount,
  } = dphInfo;

  // 3. PRE-CALCULATE SIMULATION CONSTANTS
  // These values do not change during the simulation loop.
  const inherentWeaponDispersionMoa = getInherentWeaponDispersionMoa(
    gunSlot,
    ammoItem,
    profile,
    0 // Assuming no active mod bonuses for this fresh implementation
  );
  
  const targetAngularSizeAt10Tiles = Math.atan(0.5 / 10) * (180 / Math.PI) * 60; // Approx. 172 MOA

  // 4. SIMULATE A SINGLE SHOT AT 10 TILES
  // This calculates the "Effective Damage @ 10t" column.

  // Simulate aiming down from max recoil to a steady state.
  const movesForFirstShotAim = estimateMovesToReachRecoil(gunSlot, 150, 500, profile, false);
  const recoilAfterFirstAim = 150; // The target of our aim simulation

  // Total dispersion for this single shot
  const effectiveDispersionForFirstShot = inherentWeaponDispersionMoa + recoilAfterFirstAim;

  // Get hit probabilities for this single shot
  const hitProbabilitiesAt10Tiles = getHitProbabilities(
    effectiveDispersionForFirstShot,
    targetAngularSizeAt10Tiles
  );

  // Calculate the final expected damage for this single shot
  // (We'll assume a simplified damage multiplier model for now)
  const effectiveDamageAt10Tiles =
    theoreticalDph * (
      (hitProbabilitiesAt10Tiles.P_Crit * (ammoCritMultiplier ?? 1.5)) +
      (hitProbabilitiesAt10Tiles.P_Hit * 1.0) +
      (hitProbabilitiesAt10Tiles.P_Graze * 0.5)
    );

  // 5. ASSEMBLE AND RETURN THE FINAL OBJECT
  const result: RepresentativeCombatInfo = {
    id: gun.id,
    name: (basicInfo.name?.str ?? gun.id),
    category: category,
    isNonStandard: false,
    standardAmmo: ammoName,
    standardMagazine: standardMagazine,
    defaultReceiver: defaultReceiver,
    theoreticalDph: theoreticalDph,
    effectiveDamageAt10Tiles: effectiveDamageAt10Tiles,
    hitChancesAt10Tiles: formatHitChances(hitProbabilitiesAt10Tiles),
    _internal: {
      dphInfo: dphInfo,
      hitProbabilities: hitProbabilitiesAt10Tiles,
    },
  };

  return result;
}