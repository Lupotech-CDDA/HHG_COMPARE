// src/combatMechanics.ts
import type {
  Item,
  GunSlot,
  AmmoSlot,
  ItemBasicInfo,
  Skill as SkillType,
} from "./types";
import type { CddaData } from "./data";
import { isItemSubtype } from "./types";
import { log } from "./debugLogger";
import {
  MAX_SKILL,
  MAX_RECOIL_MOA,
  ACCURACY_CRITICAL_FACTOR,
  ACCURACY_STANDARD_FACTOR,
  ACCURACY_GRAZING_FACTOR,
  GRAZE_DAMAGE_MULTIPLIER_DEFAULT,
  WEAPON_DISPERSION_CONSTANT_FIREARM,
  DEFAULT_SIGHT_DISPERSION,
} from "./gameConstants"; // Ensure all needed constants are here

// --- Interfaces specific to or heavily used by combat mechanics ---
export interface BaseCharacterProfile {
  strength: number;
  dexterity: number;
  perception: number;
  intelligence: number;
  weaponSkillLevel: number;
  marksmanshipLevel: number;
}
export enum AimingStrategy {
  SightDispersionInstantly,
  FixedMovesToRegularAim,
  EstimatedMovesToRegularAim,
}
export interface CombatProfile extends BaseCharacterProfile {
  aimingStrategy: AimingStrategy;
  fixedAimMoves?: number;
}

// --- Combat Mechanic Functions ---

// getMovesPerAttackActivation, dispersion_from_skill, getInherentWeaponDispersionMoa,
// getRecoilAbsorbFactor, getEffectiveGunRecoilQtyPerShot, getIncreaseInRecoilMoaPerShot, getHitProbabilities
// (These functions remain as previously defined and corrected)
// ... (paste their full, correct implementations here) ...

export function getMovesPerAttackActivation(
  gunSkillId: string | null,
  profile: BaseCharacterProfile,
  processor: CddaData
): number {
  if (!gunSkillId) return 100;
  const skillData = processor.byIdMaybe("skill", gunSkillId) as SkillType & {
    time_to_attack?: {
      base_time: number;
      time_reduction_per_level: number;
      min_time: number;
    };
  };
  let moves = 100;
  if (skillData && skillData.time_to_attack) {
    const { base_time, time_reduction_per_level, min_time } =
      skillData.time_to_attack;
    const calculated = Math.round(
      base_time - time_reduction_per_level * profile.weaponSkillLevel
    );
    moves = Math.max(min_time, calculated);
  }
  return moves;
}

export function dispersion_from_skill(
  skill_val: number,
  wep_disp_const: number = WEAPON_DISPERSION_CONSTANT_FIREARM
): number {
  const skill_shortfall = MAX_SKILL - skill_val;
  const dispersion_penalty_flat = 10 * skill_shortfall;
  const skill_threshold = 5.0;
  if (skill_val >= MAX_SKILL) return 0;
  let dispersion_penalty_scaled: number;
  if (skill_val >= skill_threshold) {
    const post_thresh_shortfall = MAX_SKILL - skill_val;
    const divisor = MAX_SKILL - skill_threshold;
    dispersion_penalty_scaled =
      divisor > 0
        ? (wep_disp_const * post_thresh_shortfall * 1.25) / divisor
        : 0;
  } else {
    const pre_thresh_shortfall = skill_threshold - skill_val;
    const pre_thresh_factor =
      skill_threshold > 0 ? (pre_thresh_shortfall * 10.0) / skill_threshold : 0;
    dispersion_penalty_scaled = wep_disp_const * (1.25 + pre_thresh_factor);
  }
  return dispersion_penalty_flat + dispersion_penalty_scaled;
}

export function getInherentWeaponDispersionMoa(
  gunItem: Item & GunSlot,
  ammoItem: (Item & AmmoSlot) | null | undefined,
  profile: BaseCharacterProfile,
  activeDefaultModDispersionBonus: number
): number {
  const gunBaseDispersion =
    (gunItem.dispersion || 0) + activeDefaultModDispersionBonus;
  const ammoBaseDispersion = ammoItem?.dispersion || 0;
  const dexModDispersion = (8 - profile.dexterity) * 10;
  const avgCombatSkill =
    (profile.marksmanshipLevel + profile.weaponSkillLevel) / 2.0;
  const skillPenaltyDispersion = dispersion_from_skill(avgCombatSkill);
  let shotSpread = 0;
  if (ammoItem && isItemSubtype("AMMO", ammoItem as Item)) {
    const ammoAsSlot = ammoItem as Item & AmmoSlot;
    const multiProjectileTypes = ["shot", "ショット", "flechette"];
    if (
      ammoAsSlot.ammo_type &&
      multiProjectileTypes.includes(ammoAsSlot.ammo_type.toLowerCase())
    ) {
      if (ammoAsSlot.count && ammoAsSlot.count > 1) {
        shotSpread =
          (ammoItem as Item & AmmoSlot & { shot_spread?: number })
            .shot_spread || 0;
      }
    }
  }
  const sumAdditiveDispersion =
    gunBaseDispersion +
    ammoBaseDispersion +
    dexModDispersion +
    skillPenaltyDispersion +
    shotSpread;
  const finalDispersion = Math.max(0, sumAdditiveDispersion);
  log(
    "AIM_CALC",
    `Inherent dispersion for ${gunItem.id} w/ ammo ${
      ammoItem?.id || "N/A"
    }: ${finalDispersion.toFixed(1)} MOA`,
    {
      gunBase: gunItem.dispersion,
      modBonus: activeDefaultModDispersionBonus,
      ammoBase: ammoBaseDispersion,
      dexMod: dexModDispersion,
      skillPenalty: skillPenaltyDispersion.toFixed(1),
      shotSpread,
    }
  );
  return finalDispersion;
}

export function getRecoilAbsorbFactor(profile: BaseCharacterProfile): number {
  return Math.min(profile.weaponSkillLevel, MAX_SKILL) / (MAX_SKILL * 2.0);
}

export function getEffectiveGunRecoilQtyPerShot(
  gunItem: Item & GunSlot,
  ammoRecoilValue: number,
  profile: BaseCharacterProfile,
  processor: CddaData,
  activeDefaultModHandlingBonus: number,
  activeDefaultModRecoilFactor: number
): number {
  let currentRecoil = ammoRecoilValue;
  const initialAmmoRecoil = currentRecoil;
  const effectiveHandling =
    (gunItem.handling || 0) + activeDefaultModHandlingBonus;
  currentRecoil = Math.max(0, currentRecoil - effectiveHandling * 20);
  const afterHandlingRecoil = currentRecoil;
  currentRecoil *= activeDefaultModRecoilFactor;
  const afterModFactorRecoil = currentRecoil;
  const strReduction = profile.strength * 10;
  currentRecoil = Math.max(0, currentRecoil - strReduction);
  const afterStrRecoil = currentRecoil;
  const gunFlags = (gunItem as ItemBasicInfo).flags || [];
  const hasBipodOnGun = gunFlags.includes("BIPOD");
  let hasBipodOnMod = false;
  if (gunItem.default_mods) {
    hasBipodOnMod = gunItem.default_mods.some((modId) => {
      const mod = processor.byIdMaybe("item", modId);
      return mod && (mod as ItemBasicInfo).flags?.includes("BIPOD");
    });
  }
  const hasBipod = hasBipodOnGun || hasBipodOnMod;
  if (hasBipod) {
    currentRecoil *= 0.25;
  }
  const finalRecoil = Math.max(0, currentRecoil);
  log(
    "RECOIL_CALC",
    `Effective recoil for ${gunItem.id}: ${finalRecoil.toFixed(1)}`,
    {
      ammoBase: initialAmmoRecoil,
      gunHandling: gunItem.handling,
      modHandlingBonus: activeDefaultModHandlingBonus,
      effectiveHandling,
      afterHandling: afterHandlingRecoil.toFixed(1),
      modRecoilFactor: activeDefaultModRecoilFactor.toFixed(2),
      afterModFactor: afterModFactorRecoil.toFixed(1),
      str: profile.strength,
      strReduction,
      afterStr: afterStrRecoil.toFixed(1),
      hasBipod,
      final: finalRecoil.toFixed(1),
    }
  );
  return finalRecoil;
}

export function getIncreaseInRecoilMoaPerShot(
  effectiveGunRecoilQty: number,
  recoilAbsorbFactor: number
): number {
  return effectiveGunRecoilQty * (1.0 - recoilAbsorbFactor) * 5.0;
}

export function getHitProbabilities(
  effectiveTotalDispersionMoa: number,
  targetAngularSizeMoa: number,
  accuracyConstants: { crit: number; standard: number; graze: number } = {
    crit: ACCURACY_CRITICAL_FACTOR,
    standard: ACCURACY_STANDARD_FACTOR,
    graze: ACCURACY_GRAZING_FACTOR,
  }
): { P_Crit: number; P_Hit: number; P_Graze: number; P_Miss: number } {
  if (targetAngularSizeMoa <= 0)
    return { P_Crit: 0, P_Hit: 0, P_Graze: 0, P_Miss: 1.0 };
  if (effectiveTotalDispersionMoa <= 0)
    return { P_Crit: 1.0, P_Hit: 0, P_Graze: 0, P_Miss: 0 };
  const critThresholdAngle = targetAngularSizeMoa * accuracyConstants.crit;
  const hitThresholdAngle = targetAngularSizeMoa * accuracyConstants.standard;
  const grazeThresholdAngle = targetAngularSizeMoa * accuracyConstants.graze;
  let pCrit = Math.max(
    0,
    Math.min(1.0, critThresholdAngle / effectiveTotalDispersionMoa)
  );
  let pHitTotal = Math.max(
    0,
    Math.min(1.0, hitThresholdAngle / effectiveTotalDispersionMoa)
  );
  let pGrazeTotal = Math.max(
    0,
    Math.min(1.0, grazeThresholdAngle / effectiveTotalDispersionMoa)
  );
  let pHit = pHitTotal - pCrit;
  let pGraze = pGrazeTotal - pHitTotal;
  pCrit = Math.max(0, pCrit);
  pHit = Math.max(0, pHit);
  pGraze = Math.max(0, pGraze);
  const sumP = pCrit + pHit + pGraze;
  if (sumP > 1.0 && sumP > 0.0001) {
    pCrit /= sumP;
    pHit /= sumP;
    pGraze /= sumP;
  }
  return {
    P_Crit: pCrit,
    P_Hit: pHit,
    P_Graze: pGraze,
    P_Miss: Math.max(0, 1.0 - (pCrit + pHit + pGraze)),
  };
}

export function estimateMovesToReachRecoil(
  gunItem: Item & GunSlot,
  targetPlayerRecoilMOA: number, // The player::recoil MOA we want to achieve (e.g., perceptionAdjustedSightLimit)
  startPlayerRecoilMOA: number, // Current player::recoil (e.g., MAX_RECOIL_MOA or recoil after last shot)
  profile: BaseCharacterProfile,
  currentModeHasAccurateShot: boolean
): number {
  const gunSkillId = gunItem.skill; // Can be null, handle if skill is directly used for factors
  const weaponSkillLevel = profile.weaponSkillLevel;

  // 1. Determine the gun's base sight dispersion and the perception-adjusted sight limit.
  const gunBaseSightDispersion =
    gunItem.sight_dispersion || DEFAULT_SIGHT_DISPERSION;
  let perceptionAdjustedSightLimit = gunBaseSightDispersion;

  const perceptionFactor =
    gunSkillId === "pistol" || gunSkillId === "smg" || gunSkillId === "shotgun"
      ? 3
      : 5;
  const rangedPerMod = (8 - profile.perception) * perceptionFactor;
  const parallaxOffset = Math.max(0, Math.round(rangedPerMod));
  perceptionAdjustedSightLimit += parallaxOffset;
  perceptionAdjustedSightLimit = Math.max(10, perceptionAdjustedSightLimit); // Practical minimum sight limit

  // The actual target for player::recoil cannot be better (lower) than this perceptionAdjustedSightLimit.
  // It also cannot be better than the explicitly passed targetPlayerRecoilMOA (though usually targetPlayerRecoilMOA will be this limit).
  const effectiveAimTargetMOA = Math.max(
    targetPlayerRecoilMOA,
    perceptionAdjustedSightLimit
  );

  if (startPlayerRecoilMOA <= effectiveAimTargetMOA) {
    log(
      "AIM_CALC",
      `[estimateMoves] Already at/below effective target. Start: ${startPlayerRecoilMOA.toFixed(
        0
      )}, Target: ${targetPlayerRecoilMOA.toFixed(
        0
      )}, Effective Target: ${effectiveAimTargetMOA.toFixed(0)}. Moves: 0`
    );
    return 0;
  }

  let currentTotalPlayerRecoil = startPlayerRecoilMOA;
  let movesSpent = 0;
  const MAX_AIM_MOVES_SIMULATION = 750;
  const MIN_RECOIL_IMPROVEMENT_PER_MOVE = 0.05;

  const aimSpeedDexMod = (profile.dexterity - 8) * 0.5;
  const aimSpeedSkillMod = 0; // Assuming no specific character_modifier_aim_speed_skill_mod traits
  const generalAimSpeedMultiplier = 1.0;
  const volFactor = 1.0; // Simplified for now
  const lenFactor = 1.0; // Simplified for now

  while (
    currentTotalPlayerRecoil > effectiveAimTargetMOA &&
    movesSpent < MAX_AIM_MOVES_SIMULATION
  ) {
    // --- Simulate Character::aim_per_move ---
    let aimSpeed = 10.0; // base_aim_speed in C++

    // sight_speed_modifier calculation
    const pointShootingLimit = 200 - 10 * weaponSkillLevel;
    const pointShootingSpeed = 10 + 4 * weaponSkillLevel;

    let sightSpeedModContribution = 0;
    if (currentTotalPlayerRecoil > pointShootingLimit) {
      sightSpeedModContribution = pointShootingSpeed;
    } else {
      // If below point shooting limit, iron sight aiming speed is much lower, related to gun's base sight quality.
      // CORRECTED USAGE HERE:
      sightSpeedModContribution = Math.max(1, gunBaseSightDispersion / 20);
    }
    aimSpeed += sightSpeedModContribution;
    aimSpeed += aimSpeedDexMod;
    aimSpeed += aimSpeedSkillMod;

    aimSpeed /= Math.max(1.0, 2.5 - 0.2 * weaponSkillLevel);

    const recoilAttenuation = Math.max(
      0.25,
      1.0 - (currentTotalPlayerRecoil / MAX_RECOIL_MOA) * 0.75
    );
    aimSpeed *= recoilAttenuation;
    aimSpeed *= volFactor * lenFactor;
    aimSpeed *= generalAimSpeedMultiplier;

    if (currentModeHasAccurateShot) aimSpeed *= 1.2;

    const weaponAimCap = Math.max(10.0, 3.0 * weaponSkillLevel);
    const aimSpeedCap =
      (5.0 + weaponSkillLevel + weaponAimCap) * volFactor * lenFactor;
    aimSpeed = Math.min(aimSpeed, aimSpeedCap);
    aimSpeed = Math.max(aimSpeed, MIN_RECOIL_IMPROVEMENT_PER_MOVE);

    let actualImprovement = Math.min(
      aimSpeed,
      currentTotalPlayerRecoil - effectiveAimTargetMOA
    );
    actualImprovement = Math.max(
      MIN_RECOIL_IMPROVEMENT_PER_MOVE,
      actualImprovement
    );

    // Ensure improvement doesn't make it better than target if already extremely close.
    if (currentTotalPlayerRecoil - actualImprovement < effectiveAimTargetMOA) {
      actualImprovement = currentTotalPlayerRecoil - effectiveAimTargetMOA;
    }
    // Ensure actualImprovement is not negative if currentTotalPlayerRecoil is already target or less
    actualImprovement = Math.max(0, actualImprovement);

    currentTotalPlayerRecoil -= actualImprovement;
    movesSpent++;

    if (currentTotalPlayerRecoil <= effectiveAimTargetMOA) {
      break;
    }

    if (
      actualImprovement < MIN_RECOIL_IMPROVEMENT_PER_MOVE + 0.01 &&
      currentTotalPlayerRecoil > effectiveAimTargetMOA
    ) {
      log(
        "AIM_CALC",
        `[estimateMoves] Aiming stalled for ${
          gunItem.id
        }. Start: ${startPlayerRecoilMOA.toFixed(
          0
        )}, Target: ${effectiveAimTargetMOA.toFixed(
          0
        )}, Current: ${currentTotalPlayerRecoil.toFixed(
          0
        )}, Improvement: ${actualImprovement.toFixed(3)}, Moves: ${movesSpent}`
      );
      return MAX_AIM_MOVES_SIMULATION; // Return max moves as it's stalled effectively
    }
  }

  if (
    currentTotalPlayerRecoil > effectiveAimTargetMOA &&
    movesSpent >= MAX_AIM_MOVES_SIMULATION
  ) {
    log(
      "AIM_CALC",
      `[estimateMoves] Max aim moves reached for ${
        gunItem.id
      }. Start: ${startPlayerRecoilMOA.toFixed(
        0
      )}, Target: ${effectiveAimTargetMOA.toFixed(
        0
      )}, EndedAt: ${currentTotalPlayerRecoil.toFixed(0)}, Moves: ${movesSpent}`
    );
  } else if (currentTotalPlayerRecoil <= effectiveAimTargetMOA) {
    // log('AIM_CALC', `[estimateMoves] Target reached for ${gunItem.id}. Start: ${startPlayerRecoilMOA.toFixed(0)}, Target: ${effectiveAimTargetMOA.toFixed(0)}, EndedAt: ${currentTotalPlayerRecoil.toFixed(0)}, Moves: ${movesSpent}`);
  }
  return movesSpent;
}
