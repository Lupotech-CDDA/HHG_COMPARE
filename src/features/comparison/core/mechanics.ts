// src/features/comparison/core/mechanics.ts

// NOTE: This file is being provided again to fix a critical bug.
// The code is largely the same, but the `getHitProbabilities` function
// now correctly calculates probabilities instead of returning raw counts.

import type { Item, GunSlot } from "../../../types";
import { CombatProfile, DispersionSources, HitProbabilities } from "./types";
import * as C from "../constants/index";
import { logarithmic_range, calculate_iso_tangent_linear_deviation, get_occupied_tile_fraction } from "./utils";

// --- Private Functions (no change) ---
function calculateRangedDexMod(dexterity: number): number {
  return Math.max((C.STAT_THRESHOLD_FOR_PENALTY - dexterity) * C.RANGED_DEX_MOD_FACTOR, 0.0);
}

function calculate_point_shooting_limit(skillLevel: number, gunSkillId: string): number {
  const cappedSkill = Math.min(skillLevel, C.MAX_SKILL);
  if (gunSkillId === "archery") {
    return C.ARCHERY_PS_LIMIT_BASE + C.ARCHERY_PS_LIMIT_DIVISOR_FACTOR / (1.0 + cappedSkill);
  }
  return C.FIREARM_PS_LIMIT_BASE - C.FIREARM_PS_LIMIT_SKILL_FACTOR * cappedSkill;
}

function calculate_modified_sight_speed(intrinsicSpeedMod: number, effectiveDispersion: number, currentRecoil: number): number {
  if (currentRecoil <= effectiveDispersion || effectiveDispersion < 0) return 0;
  const logRangeMax = 3.0 * effectiveDispersion + 1.0;
  const attenuation = 1.0 - logarithmic_range(effectiveDispersion, logRangeMax, currentRecoil);
  return (C.BASE_AIM_SPEED_CONSTANT + intrinsicSpeedMod) * attenuation;
}

function calculate_aim_per_move(gun: Item & GunSlot, profile: CombatProfile, currentRecoil: number): number {
  const gunSkillId = gun.skill ?? 'N/A';
  const psLimit = calculate_point_shooting_limit(profile.weaponSkillLevel, gunSkillId);
  const psIntrinsicSpeed = gunSkillId === 'pistol' 
    ? C.POINT_SHOOTING_PISTOL_BASE_SPEED_MOD + C.POINT_SHOOTING_PISTOL_SKILL_SPEED_FACTOR * profile.weaponSkillLevel 
    : profile.weaponSkillLevel;
  let sightSpeedMod = calculate_modified_sight_speed(psIntrinsicSpeed, psLimit, currentRecoil);

  if (gun.sight_dispersion && currentRecoil <= C.IRON_SIGHT_FOV) {
    const parallax = Math.max(0, (C.STAT_THRESHOLD_FOR_PENALTY - profile.perception) * C.RANGED_PER_MOD_FACTOR);
    const ironEffDisp = parallax + gun.sight_dispersion;
    const ironSpeed = calculate_modified_sight_speed(0, ironEffDisp, currentRecoil);
    sightSpeedMod = Math.max(sightSpeedMod, ironSpeed);
  }

  let aimSpeed = C.BASE_AIM_SPEED_CONSTANT + sightSpeedMod;

  aimSpeed += (profile.dexterity - C.AIM_SPEED_DEX_MOD_BASE_DEX) * C.AIM_SPEED_DEX_MOD_FACTOR;
  aimSpeed += C.AIM_SPEED_SKILL_MOD_FIREARM_MULT * profile.weaponSkillLevel + C.AIM_SPEED_SKILL_MOD_FIREARM_BASE;

  const skillDivisor = Math.max(1.0, C.AIM_SPEED_SKILL_DIVISOR_BASE - C.AIM_SPEED_SKILL_DIVISOR_SKILL_FACTOR * profile.weaponSkillLevel);
  aimSpeed /= skillDivisor;

  const recoilScaleFactor = Math.max(currentRecoil / C.MAX_RECOIL_MOA, 1.0 - logarithmic_range(0, C.MAX_RECOIL_MOA, currentRecoil));
  aimSpeed *= recoilScaleFactor;
  
  aimSpeed *= C.AIM_PER_MOVE_FINAL_SCALER;
  aimSpeed = Math.max(aimSpeed, C.MIN_RECOIL_IMPROVEMENT_PER_MOVE);
  
  const limit = calculate_point_shooting_limit(profile.weaponSkillLevel, gunSkillId);
  if (currentRecoil <= limit) return 0;
  
  return Math.min(aimSpeed, currentRecoil - limit);
}


// --- Exported Public Functions ---

export function calculateTimeToAttack(weaponSkillLevel: number, skillUsed: string): number {
  const timeInfo = C.SKILL_TIME_TO_ATTACK_DATA[skillUsed] ?? C.DEFAULT_TIME_TO_ATTACK;
  const effectiveSkillLevel = Math.min(weaponSkillLevel, C.MAX_SKILL);
  const calculatedTime = timeInfo.base_time - timeInfo.time_reduction_per_level * effectiveSkillLevel;
  return Math.max(timeInfo.min_time, Math.round(calculatedTime));
}

export function calculateGunRecoil(gunItem: Item & GunSlot, ammoRecoil: number, profile: CombatProfile): number {
    const armStrength = profile.strength;
    const gunBaseWeightGrams = ((gunItem.weight as number) ?? 0) * 453.592;
    const effectiveWeight = Math.min(gunBaseWeightGrams, armStrength * 333) / 333;
    let handling = gunItem.handling ?? 0;
    handling /= 10;
    handling = Math.pow(effectiveWeight, 0.8) * Math.pow(handling, 1.2);
    let qty = (gunItem.recoil ?? 0) + ammoRecoil;
    qty = handling > 1.0 ? qty / handling : qty * (1.0 + Math.abs(handling));
    return Math.max(0, qty);
}

export function calculateDispersionFromSkill(avgSkill: number, gunSkillId: string): number {
  if (avgSkill >= C.MAX_SKILL) return 0.0;
  const pValToUse = gunSkillId === "archery" ? C.P_VAL_ARCHERY : C.P_VAL_FIREARMS;
  const skillShortfall = C.MAX_SKILL - avgSkill;
  let dispersionPenalty = C.DISP_FROM_SKILL_BASE_PENALTY_PER_SHORTFALL * skillShortfall;
  if (avgSkill >= C.DISP_FROM_SKILL_THRESHOLD) {
    const denominator = C.MAX_SKILL - C.DISP_FROM_SKILL_THRESHOLD;
    if (denominator > 0) {
      dispersionPenalty += (pValToUse * skillShortfall * C.DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR) / denominator;
    }
  } else {
    const preThresholdShortfall = C.DISP_FROM_SKILL_THRESHOLD - avgSkill;
    dispersionPenalty += pValToUse * (C.DISP_FROM_SKILL_PRE_THRESH_WEAP_DISP_BASE_FACTOR + preThresholdShortfall * C.DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR);
  }
  return dispersionPenalty;
}

export function getWeaponDispersionSources(gunItem: Item & GunSlot, ammoItem: Item & { dispersion?: number } | null, profile: CombatProfile, gunSkillId: string): DispersionSources {
    const gunDamage = (gunItem as any).damage_level ?? 0;
    const baseDisp = (gunItem.dispersion ?? 0) + (ammoItem?.dispersion ?? 0) + (gunDamage * C.DISPERSION_PER_GUN_DAMAGE);
    const scaledBaseDispersion = Math.max(1, Math.round(baseDisp / C.GUN_DISPERSION_DIVIDER));
    const dispSources = new DispersionSources(scaledBaseDispersion);
    dispSources.add_range(calculateRangedDexMod(profile.dexterity));
    const manipPenalty = Math.max(0, (1.0 - profile.handManipScore) * 22.8);
    dispSources.add_range(manipPenalty);
    const avgSkill = (profile.marksmanshipLevel + profile.weaponSkillLevel) / 2.0;
    dispSources.add_range(calculateDispersionFromSkill(avgSkill, gunSkillId));
    return dispSources;
}

export function getHitOutcome(rolledAngularDeviationMoa: number, targetRangeTiles: number, creatureSizeStr: "tiny" | "small" | "medium" | "large" | "huge"): "Miss" | "Graze" | "Normal" | "Good" | "Critical" {
  const linearDeviation = calculate_iso_tangent_linear_deviation(targetRangeTiles, rolledAngularDeviationMoa);
  const targetRadiusTiles = 0.5 * get_occupied_tile_fraction(creatureSizeStr);
  if (targetRadiusTiles <= 0) return "Miss";
  const missedByFactor = linearDeviation / targetRadiusTiles;
  if (missedByFactor >= 1.0) return "Miss";
  if (missedByFactor >= C.ACCURACY_STANDARD_FACTOR) return "Graze";
  if (missedByFactor >= C.ACCURACY_GOODHIT_FACTOR) return "Normal";
  if (missedByFactor >= C.ACCURACY_CRITICAL_FACTOR) return "Good";
  return "Critical";
}

/**
 * THIS FUNCTION IS NOW CORRECTED
 */
export function getHitProbabilities(dispersionSources: DispersionSources, targetRangeTiles: number, creatureSizeStr: "tiny" | "small" | "medium" | "large" | "huge", numSimulations: number = 5000): HitProbabilities {
  const counts: Record<string, number> = { Critical: 0, Good: 0, Normal: 0, Graze: 0, Miss: 0 };
  if(numSimulations <= 0) return counts as HitProbabilities;

  for (let i = 0; i < numSimulations; i++) {
    const outcome = getHitOutcome(dispersionSources.roll(), targetRangeTiles, creatureSizeStr);
    counts[outcome]++;
  }

  // THE BUG FIX: Divide counts by numSimulations to get probabilities
  return {
    Critical: counts.Critical / numSimulations,
    Good: counts.Good / numSimulations,
    Normal: counts.Normal / numSimulations,
    Graze: counts.Graze / numSimulations,
    Miss: counts.Miss / numSimulations,
  };
}

export function getExpectedDamagePerShot(baseDamage: number, hitProbabilities: HitProbabilities): number {
    const critDmg = baseDamage * C.CRITICAL_HIT_DAMAGE_MULTIPLIER * hitProbabilities.Critical;
    const goodDmg = baseDamage * C.GOOD_HIT_DAMAGE_MULTIPLIER * hitProbabilities.Good;
    const normalDmg = baseDamage * C.NORMAL_HIT_DAMAGE_MULTIPLIER * hitProbabilities.Normal;
    const grazeDmg = baseDamage * C.GRAZE_HIT_DAMAGE_MULTIPLIER * hitProbabilities.Graze;
    // Removed the erroneous "/ 1"
    return critDmg + goodDmg + normalDmg + grazeDmg;
}

export function simulateAiming(gunItem: Item & GunSlot, targetRecoilMoa: number, startRecoilMoa: number, profile: CombatProfile, scenario: { targetAngularSizeMoa: number }): { moves: number; finalRecoil: number } {
  const aimLimit = calculate_point_shooting_limit(profile.weaponSkillLevel, gunItem.skill ?? 'N/A');
  const effectiveAimTarget = Math.max(targetRecoilMoa, aimLimit);
  if (startRecoilMoa <= effectiveAimTarget) {
    return { moves: 0, finalRecoil: startRecoilMoa };
  }
  let currentRecoil = startRecoilMoa;
  let movesSpent = 0;
  while (currentRecoil > effectiveAimTarget && movesSpent < 750) {
    const reduction = calculate_aim_per_move(gunItem, profile, currentRecoil, scenario);
    if (reduction < C.MIN_RECOIL_IMPROVEMENT_PER_MOVE) {
      break; 
    }
    currentRecoil -= reduction;
    movesSpent++;
  }
  return { moves: movesSpent, finalRecoil: Math.max(currentRecoil, effectiveAimTarget) };
}