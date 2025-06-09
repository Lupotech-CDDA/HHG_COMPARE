// src/features/comparison/core/mechanics.ts

import type { Item, GunSlot } from "../../../types";
import {
  MAX_SKILL,
  MAX_RECOIL_MOA,
  WEAPON_DISPERSION_CONSTANT_FIREARM,
  DEFAULT_SIGHT_DISPERSION,
  ACCURACY_CRITICAL_FACTOR,
  ACCURACY_STANDARD_FACTOR,
  ACCURACY_GRAZING_FACTOR,
} from "../constants/defaults"; // We'll assume constants are in a separate file

// --- Interfaces and Profiles ---
export interface CombatProfile {
  strength: number;
  dexterity: number;
  perception: number;
  weaponSkillLevel: number;
  marksmanshipLevel: number;
}

// --- Ported Combat Mechanic Functions ---

// Note: In a real project, CddaData and SkillType would be imported from the main app's types.
// For this module, we assume they are available.
export function getMovesPerAttackActivation(
  gunSkillId: string | null,
  profile: CombatProfile,
  processor: any // CddaData
): number {
  if (!gunSkillId) return 100;
  const skillData = processor.byIdMaybe("skill", gunSkillId);
  if (skillData && skillData.time_to_attack) {
    const { base_time, time_reduction_per_level, min_time } =
      skillData.time_to_attack;
    const calculated = Math.round(
      base_time - time_reduction_per_level * profile.weaponSkillLevel
    );
    return Math.max(min_time, calculated);
  }
  return 100;
}

export function dispersion_from_skill(
  skill_val: number,
  wep_disp_const: number = WEAPON_DISPERSION_CONSTANT_FIREARM
): number {
  if (skill_val >= MAX_SKILL) return 0;

  const skill_shortfall = MAX_SKILL - skill_val;
  const dispersion_penalty_flat = 10 * skill_shortfall;
  const skill_threshold = 5.0;
  
  let dispersion_penalty_scaled: number;
  if (skill_val >= skill_threshold) {
    const divisor = MAX_SKILL - skill_threshold;
    dispersion_penalty_scaled = divisor > 0
      ? (wep_disp_const * skill_shortfall * 1.25) / divisor
      : 0;
  } else {
    const pre_thresh_shortfall = skill_threshold - skill_val;
    const pre_thresh_factor = skill_threshold > 0 ? (pre_thresh_shortfall * 10.0) / skill_threshold : 0;
    dispersion_penalty_scaled = wep_disp_const * (1.25 + pre_thresh_factor);
  }
  return dispersion_penalty_flat + dispersion_penalty_scaled;
}

export function getInherentWeaponDispersionMoa(
  gunItem: Item & GunSlot,
  ammoItem: Item & { dispersion?: number } | null,
  profile: CombatProfile,
  activeDefaultModDispersionBonus: number = 0
): number {
  const gunBaseDispersion = (gunItem.dispersion ?? 0) + activeDefaultModDispersionBonus;
  const ammoBaseDispersion = ammoItem?.dispersion ?? 0;
  const dexModDispersion = Math.max(0, (8 - profile.dexterity) * 10);
  const avgCombatSkill = (profile.marksmanshipLevel + profile.weaponSkillLevel) / 2.0;
  const skillPenaltyDispersion = dispersion_from_skill(avgCombatSkill);

  const sumAdditiveDispersion =
    gunBaseDispersion +
    ammoBaseDispersion +
    dexModDispersion +
    skillPenaltyDispersion;

  return Math.max(0, sumAdditiveDispersion);
}

export function getRecoilAbsorbFactor(profile: CombatProfile): number {
  return Math.min(profile.weaponSkillLevel, MAX_SKILL) / (MAX_SKILL * 2.0);
}

export function getEffectiveGunRecoilQtyPerShot(
  gunItem: Item & GunSlot,
  ammoRecoilValue: number,
  profile: CombatProfile,
  activeDefaultModHandlingBonus: number = 0,
  activeDefaultModRecoilFactor: number = 1.0
): number {
  let currentRecoil = ammoRecoilValue;
  const effectiveHandling = (gunItem.handling ?? 0) + activeDefaultModHandlingBonus;
  currentRecoil = Math.max(0, currentRecoil - effectiveHandling * 20);
  currentRecoil *= activeDefaultModRecoilFactor;
  currentRecoil = Math.max(0, currentRecoil - (profile.strength * 10));

  // Simplified bipod check for this port
  if ((gunItem as ItemBasicInfo).flags?.includes("BIPOD")) {
    currentRecoil *= 0.25;
  }

  return Math.max(0, currentRecoil);
}

export function getIncreaseInRecoilMoaPerShot(
  effectiveGunRecoilQty: number,
  recoilAbsorbFactor: number
): number {
  // The V1 formula converted "recoil units" to MOA with a *5 multiplier
  return effectiveGunRecoilQty * (1.0 - recoilAbsorbFactor) * 5.0;
}

export function getHitProbabilities(
  effectiveTotalDispersionMoa: number,
  targetAngularSizeMoa: number
): { P_Crit: number; P_Hit: number; P_Graze: number; P_Miss: number } {
    if (targetAngularSizeMoa <= 0) return { P_Crit: 0, P_Hit: 0, P_Graze: 0, P_Miss: 1.0 };
    if (effectiveTotalDispersionMoa <= 0) return { P_Crit: 1.0, P_Hit: 0, P_Graze: 0, P_Miss: 0 };
    
    // Simplified linear probability model from V1
    const pGrazeTotal = Math.max(0, Math.min(1.0, (targetAngularSizeMoa * ACCURACY_GRAZING_FACTOR) / effectiveTotalDispersionMoa));
    const pHitTotal = Math.max(0, Math.min(1.0, (targetAngularSizeMoa * ACCURACY_STANDARD_FACTOR) / effectiveTotalDispersionMoa));
    const pCrit = Math.max(0, Math.min(1.0, (targetAngularSizeMoa * ACCURACY_CRITICAL_FACTOR) / effectiveTotalDispersionMoa));

    const pHit = Math.max(0, pHitTotal - pCrit);
    const pGraze = Math.max(0, pGrazeTotal - pHitTotal);
    
    const pMiss = Math.max(0, 1.0 - (pCrit + pHit + pGraze));
    
    return { P_Crit: pCrit, P_Hit: pHit, P_Graze: pGraze, P_Miss: pMiss };
}

export function estimateMovesToReachRecoil(
  gunItem: Item & GunSlot,
  targetPlayerRecoilMOA: number,
  startPlayerRecoilMOA: number,
  profile: CombatProfile,
): number {
  const gunBaseSightDispersion = gunItem.sight_dispersion ?? DEFAULT_SIGHT_DISPERSION;
  const perceptionFactor = (gunItem.skill === "pistol" || gunItem.skill === "smg" || gunItem.skill === "shotgun") ? 3 : 5;
  const parallaxOffset = Math.max(0, Math.round((8 - profile.perception) * perceptionFactor));
  const perceptionAdjustedSightLimit = Math.max(10, gunBaseSightDispersion + parallaxOffset);
  const effectiveAimTargetMOA = Math.max(targetPlayerRecoilMOA, perceptionAdjustedSightLimit);

  if (startPlayerRecoilMOA <= effectiveAimTargetMOA) return 0;

  let currentTotalPlayerRecoil = startPlayerRecoilMOA;
  let movesSpent = 0;
  const MAX_AIM_MOVES_SIMULATION = 750;
  const MIN_RECOIL_IMPROVEMENT_PER_MOVE = 0.05;

  while (currentTotalPlayerRecoil > effectiveAimTargetMOA && movesSpent < MAX_AIM_MOVES_SIMULATION) {
    let aimSpeed = 10.0; // base_aim_speed
    const pointShootingLimit = 200 - 10 * profile.weaponSkillLevel;
    
    let sightSpeedModContribution = (currentTotalPlayerRecoil > pointShootingLimit)
      ? (10 + 4 * profile.weaponSkillLevel) // Point shooting speed
      : Math.max(1, gunBaseSightDispersion / 20); // Iron sight speed
      
    aimSpeed += sightSpeedModContribution;
    aimSpeed += (profile.dexterity - 8) * 0.5; // Dex mod
    aimSpeed /= Math.max(1.0, 2.5 - 0.2 * profile.weaponSkillLevel); // Skill divisor

    // Simplified recoil attenuation and other factors from V1
    const recoilAttenuation = Math.max(0.25, 1.0 - (currentTotalPlayerRecoil / MAX_RECOIL_MOA) * 0.75);
    aimSpeed *= recoilAttenuation;

    let actualImprovement = Math.min(aimSpeed, currentTotalPlayerRecoil - effectiveAimTargetMOA);
    actualImprovement = Math.max(MIN_RECOIL_IMPROVEMENT_PER_MOVE, actualImprovement);

    if (actualImprovement <= MIN_RECOIL_IMPROVEMENT_PER_MOVE && currentTotalPlayerRecoil > effectiveAimTargetMOA) {
        return MAX_AIM_MOVES_SIMULATION; // Stalled
    }

    currentTotalPlayerRecoil -= actualImprovement;
    movesSpent++;
  }

  return movesSpent;
}