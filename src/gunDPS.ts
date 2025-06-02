import type {
  Item,
  GunSlot,
  ItemBasicInfo,
  GunClassification,
  AmmoEffectEntry,
  DamageUnit,
  Translation, // Base types needed
} from "./types";
import { isItemSubtype } from "./types";
import { CddaData, normalizeDamageInstance } from "./data"; // CddaData is from here
import { log } from "./debugLogger";

import {
  getLocalItemNameForLogic,
  getSummedModProperty,
  getMultiplicativeModRecoilFactor,
  getGunChamberings,
  getEffectiveBarrelLengthMm,
  getFiringModeDetails,
  getFireableAmmoObjects,
  classifyAndSelectStandardAmmo,
  getRepresentativeDPHInfo,
  getMagazineIdsFromItemPockets,
  getMagazineIdsFromGunMod, // For mag capacity lookup
  type PotentialDamageInfo,
  type FiringModeDetail,
} from "./gunProperties";

import {
  DEFAULT_REFERENCE_RANGE_TILES,
  PLAYER_SPEED_MOVES_PER_SECOND,
  MOVES_PER_GAME_SECOND,
  AMMO_EFFECT_RECHARGE_RATE_KJ_PER_TURN,
  STANDARD_RANGES_TILES,
  STANDARD_UPS_CAPACITY_KJ,
  STANDARD_UPS_SWAP_MOVES,
  METERS_PER_TILE,
  DEFAULT_SIGHT_DISPERSION,
  GOOD_HIT_DAMAGE_MULTIPLIER,
  CRITICAL_HIT_DAMAGE_MULTIPLIER_BASE,
  GRAZE_DAMAGE_MULTIPLIER_DEFAULT,
  MAX_RECOIL_MOA,
  ACCURACY_CRITICAL_FACTOR,
  ACCURACY_STANDARD_FACTOR,
  ACCURACY_GRAZING_FACTOR,
} from "./gameConstants";

import {
  getMovesPerAttackActivation,
  getInherentWeaponDispersionMoa,
  getRecoilAbsorbFactor,
  getEffectiveGunRecoilQtyPerShot,
  getIncreaseInRecoilMoaPerShot,
  getHitProbabilities,
  estimateMovesToReachRecoil,
  type CombatProfile,
  AimingStrategy,
} from "./combatMechanics";

// --- Interfaces for the output structure of this module ---
export interface DpsAtRange {
  rangeTiles: number;
  sustainedDps: number | null;
}
export interface ModePerformance {
  modeDetails: FiringModeDetail;
  dpsAtRanges: DpsAtRange[];
}
export interface RechargeableStats {
  damagePerFullCharge: number;
  shotsPerFullCharge: number;
  timeToFullRechargeSeconds: number;
  energySource: string;
}
export interface DpsCalculationDetails {
  totalExpectedDamage: number;
  timeCycleSec: number;
  aimingMoves?: number;
  firingMoves?: number;
  reloadMoves?: number;
}
export interface RepresentativeCombatInfo {
  ammoName: string | null;
  dphBase: number;
  damageType: string;
  ap: number;
  barrelMatchInfo?: string;
  ammoCritMultiplier: number;
  pelletCount?: number;
  availableFiringModes: FiringModeDetail[];
  modePerformances: ModePerformance[];
  referenceSustainedDps: number | null;
  referenceModeName: string | null;
  referenceRangeTiles: number | null;
  referenceSustainedDpsDetails?: DpsCalculationDetails;
  dpsMagDumpNoReload: number | null;
  dpsMagDumpDetails?: DpsCalculationDetails;
  dpsPreciseAimPerShotNoReload: number | null;
  dpsPreciseAimPerShotDetails?: DpsCalculationDetails & {
    avgAimingMovesPerPreciseShot?: number;
  };
  isRechargeableGun: boolean;
  rechargeableStats?: RechargeableStats;
  isModularVaries?: boolean;
  isNonConventional?: boolean;
  nonConventionalType?: GunClassification["weaponSubType"];
  debugPrimaryAmmoEffects?: {
    hasIncendiaryEffect?: boolean;
    isExplosive?: boolean;
    explosionPower?: number;
    shrapnelCount?: number;
    shrapnelDamage?: number;
  };
}

// --- TEST_GUY_PROFILE ---
export const TEST_GUY_PROFILE: CombatProfile = {
  strength: 10,
  dexterity: 10,
  perception: 10,
  intelligence: 10,
  weaponSkillLevel: 4,
  marksmanshipLevel: 4,
  aimingStrategy: AimingStrategy.FixedMovesToRegularAim,
  fixedAimMoves: 30,
};

// --- Main Orchestrator Function ---
export function getRepresentativeCombatInfo(
  gunItem: Item,
  processor: CddaData,
  profile: CombatProfile,
  classification: GunClassification
): RepresentativeCombatInfo | null {
  log(
    "INFO",
    `Starting getRepresentativeCombatInfo for: ${
      gunItem.id
    } (${getLocalItemNameForLogic(gunItem, processor)})`,
    { classification }
  );

  let ammoNameToUse: string | null = null;
  let dphBaseToUse: number = 0;
  let damageTypeToUse: string = "N/A";
  let apToUse: number = 0;
  let barrelMatchInfoToUse: string | undefined = undefined;
  let ammoCritMultiplierToUse: number = 1.0; // This is from PotentialDamageInfo.ammoCritMultiplier
  let pelletCountToUse: number = 1;

  let calculatedAvailableFiringModes: FiringModeDetail[] = [];
  let calculatedModePerformances: ModePerformance[] = [];

  let refSustainedDps: number | null = null;
  let refModeName: string | null = null;
  let refRangeTiles: number | null = null;
  let refSustainedDpsDetails: DpsCalculationDetails | undefined = undefined;

  let magDumpDps: number | null = null;
  let magDumpDetails: DpsCalculationDetails | undefined = undefined;
  let preciseAimDps: number | null = null;
  let preciseAimDetails:
    | (DpsCalculationDetails & { avgAimingMovesPerPreciseShot?: number })
    | undefined = undefined;

  let isRechargeableGun_local_flag: boolean = false;
  let calculatedRechargeableStats: RechargeableStats | undefined = undefined;
  let isModularVaries_local_flag: boolean = false;

  let debugPrimaryAmmoEffects: RepresentativeCombatInfo["debugPrimaryAmmoEffects"] =
    {};

  if (!isItemSubtype("GUN", gunItem)) {
    log("WARN", `Item ${gunItem.id} is not a GUN. Aborting.`);
    return null;
  }
  const gunProps = gunItem as Item & GunSlot;
  const basicGunProps = gunItem as ItemBasicInfo;

  calculatedAvailableFiringModes = getFiringModeDetails(gunProps, processor);
  const referenceMode =
    calculatedAvailableFiringModes.find((m) => m.id === "DEFAULT") ||
    (calculatedAvailableFiringModes.length > 0
      ? calculatedAvailableFiringModes[0]
      : undefined);

  const activeDefaultModDispersionBonus = getSummedModProperty(
    gunProps,
    processor,
    "dispersion_modifier"
  );
  const activeDefaultModHandlingBonus = getSummedModProperty(
    gunProps,
    processor,
    "handling_modifier"
  );
  const activeDefaultModRecoilFactor = getMultiplicativeModRecoilFactor(
    gunProps,
    processor
  );
  // log('DEBUG', ...); // Mod bonuses

  const dphInfo = getRepresentativeDPHInfo(gunItem, processor);

  if (dphInfo) {
    ammoNameToUse = dphInfo.ammoName;
    dphBaseToUse = dphInfo.damage; // This is the combined DPH (kinetic + explosion + shrapnel if applicable)
    damageTypeToUse = dphInfo.damageType;
    apToUse = dphInfo.ap;
    barrelMatchInfoToUse = dphInfo.barrelMatchInfo;
    ammoCritMultiplierToUse = dphInfo.ammoCritMultiplier; // Base crit mult from ammo
    pelletCountToUse = dphInfo.pelletCount || 1;
    debugPrimaryAmmoEffects = {
      hasIncendiaryEffect: dphInfo.hasIncendiaryEffect,
      isExplosive: dphInfo.isExplosive,
      explosionPower: dphInfo.explosionPower,
      shrapnelCount: dphInfo.shrapnelCount,
      shrapnelDamage: dphInfo.shrapnelDamage,
    };
  }

  let effectiveMagCapacityOverride: number | null = null;
  let effectiveReloadTimeOverride: number | null = null;
  let localEnergySource = "Internal Battery";

  const ammoEffectsArray = Array.isArray(gunProps.ammo_effects)
    ? gunProps.ammo_effects
    : [];
  const hasInternalRechargeEffect = ammoEffectsArray.some(
    (ae: AmmoEffectEntry) => ae.id === "RECHARGE_INTERNAL_BATTERY"
  );

  if (hasInternalRechargeEffect) {
    /* ... (rechargeable logic as before, ensure it uses localEnergySource) ... */
  } else if (basicGunProps.flags?.includes("USE_PLAYER_CHARGE")) {
    /* ... (bionic logic as before, ensure it uses localEnergySource) ... */
  }

  const earlyExitReturn = (
    isNonConv: boolean,
    nonConvType?: GunClassification["weaponSubType"]
  ) => ({
    ammoName:
      ammoNameToUse ||
      (isRechargeableGun_local_flag ? localEnergySource : "N/A"),
    dphBase: dphBaseToUse,
    damageType: damageTypeToUse,
    ap: apToUse,
    barrelMatchInfo: barrelMatchInfoToUse,
    ammoCritMultiplier: ammoCritMultiplierToUse,
    pelletCount: pelletCountToUse,
    availableFiringModes: calculatedAvailableFiringModes,
    modePerformances: [],
    referenceSustainedDps: null,
    referenceModeName: null,
    referenceRangeTiles: null,
    referenceSustainedDpsDetails: undefined,
    dpsMagDumpNoReload: null,
    dpsMagDumpDetails: undefined,
    dpsPreciseAimPerShotNoReload: null,
    dpsPreciseAimPerShotDetails: undefined,
    isRechargeableGun: isRechargeableGun_local_flag,
    rechargeableStats: calculatedRechargeableStats,
    isModularVaries: isModularVaries_local_flag,
    isNonConventional: isNonConv,
    nonConventionalType: nonConvType || classification.weaponSubType,
    debugPrimaryAmmoEffects,
  });

  if (isRechargeableGun_local_flag) {
    return earlyExitReturn(true, classification.weaponSubType);
  }
  if (gunProps.ups_charges || basicGunProps.flags?.includes("USE_UPS")) {
    /* ... (UPS logic with earlyExitReturn) ... */
  }
  const chamberings = getGunChamberings(gunItem, processor);
  if (
    chamberings.size === 0 &&
    (!gunProps.ammo ||
      (Array.isArray(gunProps.ammo) && gunProps.ammo[0] === "NULL") ||
      (!Array.isArray(gunProps.ammo) && gunProps.ammo === "NULL") ||
      (Array.isArray(gunProps.ammo) && gunProps.ammo.length === 0)) &&
    !effectiveMagCapacityOverride
  ) {
    isModularVaries_local_flag = true;
    return earlyExitReturn(classification.isNonTraditional);
  }
  if (!dphInfo || dphBaseToUse <= 0) {
    if (classification.isNonTraditional) {
      return earlyExitReturn(true);
    }
    log(
      "ERROR",
      `Cannot calculate DPS for ${gunItem.id} due to missing/zero DPH for presumably conventional weapon.`
    );
    return null;
  }
  log(
    "DPS_CYCLE",
    `Gun ${gunItem.id} with ammo ${ammoNameToUse}: DPH=${dphBaseToUse.toFixed(
      1
    )}, AP=${apToUse}, CritX=${ammoCritMultiplierToUse}, Pellets=${pelletCountToUse}`
  );
  if (!referenceMode) {
    log("ERROR", `No ref mode for ${gunItem.id}`);
    return earlyExitReturn(classification.isNonTraditional);
  }

  const currentModeForCalcs = referenceMode;
  const movesPerAttackActivation = getMovesPerAttackActivation(
    gunProps.skill,
    profile,
    processor
  );
  const shotsPerActivationInMode = currentModeForCalcs.shotsPerActivation;

  let movesSpentAimingInitial_Main = 0;
  let initialEffectiveRecoilMoaForFirstShot_Main =
    gunProps.sight_dispersion || DEFAULT_SIGHT_DISPERSION;
  const baseSightDispersion_Main =
    gunProps.sight_dispersion || DEFAULT_SIGHT_DISPERSION;

  if (profile.aimingStrategy === AimingStrategy.FixedMovesToRegularAim) {
    movesSpentAimingInitial_Main = profile.fixedAimMoves || 30;
    const thresholdRegAim =
      (MAX_RECOIL_MOA - baseSightDispersion_Main) / 10.0 +
      baseSightDispersion_Main;
    initialEffectiveRecoilMoaForFirstShot_Main = thresholdRegAim;
  } else if (
    profile.aimingStrategy === AimingStrategy.EstimatedMovesToRegularAim
  ) {
    const targetEstAim = Math.max(baseSightDispersion_Main, 150);
    movesSpentAimingInitial_Main = estimateMovesToReachRecoil(
      gunProps,
      targetEstAim,
      MAX_RECOIL_MOA,
      profile,
      currentModeForCalcs.hasAccurateShot
    );
    initialEffectiveRecoilMoaForFirstShot_Main = targetEstAim;
  }

  let magCapacityUsed =
    effectiveMagCapacityOverride ?? gunProps.clip_size ?? null;
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    const compatibleMagIds = new Set<string>();
    if (gunProps.default_mods) {
      /* ... mag lookup ... */
    }
    getMagazineIdsFromItemPockets(gunItem).forEach((id) =>
      compatibleMagIds.add(id)
    );
    if (compatibleMagIds.size > 0) {
      /* ... mag lookup ... */
    }
  }
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    magCapacityUsed = 1;
  }
  log(
    "DPS_CYCLE",
    `  Mode ${currentModeForCalcs.name}: MagCapUsed=${magCapacityUsed}, MovesPerActivation=${movesPerAttackActivation}, InitialAimMoves=${movesSpentAimingInitial_Main}`
  );

  const selectedAmmoObject = getFireableAmmoObjects(gunItem, processor).find(
    (ammo) => getLocalItemNameForLogic(ammo, processor) === ammoNameToUse
  );
  const ammoRecoil = selectedAmmoObject?.recoil || 0;
  const inherentWeaponDispersionMoa = getInherentWeaponDispersionMoa(
    gunProps,
    selectedAmmoObject,
    profile,
    activeDefaultModDispersionBonus
  );
  const recoilAbsorbFactor = getRecoilAbsorbFactor(profile);
  const gunRecoilQtyPerShotBase = getEffectiveGunRecoilQtyPerShot(
    gunProps,
    ammoRecoil,
    profile,
    processor,
    activeDefaultModHandlingBonus,
    activeDefaultModRecoilFactor
  );
  const increaseInRecoilMoaPerShotForThisMode =
    getIncreaseInRecoilMoaPerShot(gunRecoilQtyPerShotBase, recoilAbsorbFactor) *
    currentModeForCalcs.recoilMultiplierFromMode;

  const accuracyConstants = {
    crit: ACCURACY_CRITICAL_FACTOR,
    standard: ACCURACY_STANDARD_FACTOR,
    graze: ACCURACY_GRAZING_FACTOR,
  };
  const targetSizeMeters = 0.5;

  // --- Calculate referenceSustainedDps (includes reload) ---
  calculatedModePerformances = [];
  for (const range of STANDARD_RANGES_TILES) {
    const targetAngularSizeMoa =
      range > 0
        ? Math.atan(targetSizeMeters / (range * METERS_PER_TILE)) *
          (180.0 / Math.PI) *
          60.0
        : MAX_RECOIL_MOA * 2;
    let totalExpectedDamage_Sustained = 0;
    let currentRecoil_Sustained = initialEffectiveRecoilMoaForFirstShot_Main;
    for (let i = 0; i < magCapacityUsed; i++) {
      if (i > 0)
        currentRecoil_Sustained = Math.min(
          MAX_RECOIL_MOA,
          currentRecoil_Sustained + increaseInRecoilMoaPerShotForThisMode
        );
      const effectiveDispersion =
        inherentWeaponDispersionMoa + currentRecoil_Sustained;
      let shotDamage = 0;
      for (let p = 0; p < pelletCountToUse; p++) {
        const probs = getHitProbabilities(
          effectiveDispersion,
          targetAngularSizeMoa,
          accuracyConstants
        );
        const critMult = Math.max(
          ammoCritMultiplierToUse,
          CRITICAL_HIT_DAMAGE_MULTIPLIER_BASE
        );
        shotDamage +=
          probs.P_Crit * dphBaseToUse * critMult +
          probs.P_Hit * dphBaseToUse * GOOD_HIT_DAMAGE_MULTIPLIER +
          probs.P_Graze * dphBaseToUse * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
      }
      totalExpectedDamage_Sustained += shotDamage;
    }
    const firingMoves_Sustained =
      Math.ceil(magCapacityUsed / shotsPerActivationInMode) *
      movesPerAttackActivation;
    const reloadMoves_Sustained =
      effectiveReloadTimeOverride ?? gunProps.reload ?? 100;
    const cycleMoves_Sustained =
      movesSpentAimingInitial_Main +
      firingMoves_Sustained +
      reloadMoves_Sustained;
    const dpsVal =
      cycleMoves_Sustained > 0
        ? totalExpectedDamage_Sustained /
          (cycleMoves_Sustained / PLAYER_SPEED_MOVES_PER_SECOND)
        : 0;

    let modePerf = calculatedModePerformances.find(
      (mp) => mp.modeDetails.id === currentModeForCalcs.id
    );
    if (!modePerf) {
      modePerf = { modeDetails: currentModeForCalcs, dpsAtRanges: [] };
      calculatedModePerformances.push(modePerf);
    }
    modePerf.dpsAtRanges.push({ rangeTiles: range, sustainedDps: dpsVal });

    if (range === DEFAULT_REFERENCE_RANGE_TILES) {
      refSustainedDps = dpsVal;
      refModeName = currentModeForCalcs.name;
      refRangeTiles = range;
      refSustainedDpsDetails = {
        totalExpectedDamage: totalExpectedDamage_Sustained,
        timeCycleSec: cycleMoves_Sustained / PLAYER_SPEED_MOVES_PER_SECOND,
        aimingMoves: movesSpentAimingInitial_Main,
        firingMoves: firingMoves_Sustained,
        reloadMoves: reloadMoves_Sustained,
      };
    }
  }
  if (
    refSustainedDps === null &&
    calculatedModePerformances.length > 0 &&
    calculatedModePerformances[0].dpsAtRanges.length > 0
  ) {
    /* fallback */
  }

  // --- Calculate dpsMagDumpNoReload @ DEFAULT_REFERENCE_RANGE_TILES ---
  const targetAngularSize_Default =
    DEFAULT_REFERENCE_RANGE_TILES > 0
      ? Math.atan(
          targetSizeMeters / (DEFAULT_REFERENCE_RANGE_TILES * METERS_PER_TILE)
        ) *
        (180.0 / Math.PI) *
        60.0
      : MAX_RECOIL_MOA * 2;
  let totalExpectedDamage_MagDump = 0;
  let currentRecoil_MagDump = initialEffectiveRecoilMoaForFirstShot_Main;
  for (let i = 0; i < magCapacityUsed; i++) {
    if (i > 0)
      currentRecoil_MagDump = Math.min(
        MAX_RECOIL_MOA,
        currentRecoil_MagDump + increaseInRecoilMoaPerShotForThisMode
      );
    const effectiveDispersion =
      inherentWeaponDispersionMoa + currentRecoil_MagDump;
    let shotDamage = 0;
    for (let p = 0; p < pelletCountToUse; p++) {
      const probs = getHitProbabilities(
        effectiveDispersion,
        targetAngularSize_Default,
        accuracyConstants
      );
      const critMult = Math.max(
        ammoCritMultiplierToUse,
        CRITICAL_HIT_DAMAGE_MULTIPLIER_BASE
      );
      shotDamage +=
        probs.P_Crit * dphBaseToUse * critMult +
        probs.P_Hit * dphBaseToUse * GOOD_HIT_DAMAGE_MULTIPLIER +
        probs.P_Graze * dphBaseToUse * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
    }
    totalExpectedDamage_MagDump += shotDamage;
  }
  const firingMoves_MagDump =
    Math.ceil(magCapacityUsed / shotsPerActivationInMode) *
    movesPerAttackActivation;
  const cycleMoves_MagDump = movesSpentAimingInitial_Main + firingMoves_MagDump;
  const cycleSec_MagDump = cycleMoves_MagDump / PLAYER_SPEED_MOVES_PER_SECOND;
  magDumpDps =
    cycleSec_MagDump > 0 ? totalExpectedDamage_MagDump / cycleSec_MagDump : 0;
  magDumpDetails = {
    totalExpectedDamage: totalExpectedDamage_MagDump,
    timeCycleSec: cycleSec_MagDump,
    aimingMoves: movesSpentAimingInitial_Main,
    firingMoves: firingMoves_MagDump,
  };
  log(
    "DPS_CYCLE",
    `  Mode ${
      currentModeForCalcs.name
    } MagDump DPS @${DEFAULT_REFERENCE_RANGE_TILES}t: ${magDumpDps?.toFixed(1)}`
  );

  // --- Calculate dpsPreciseAimPerShotNoReload @ DEFAULT_REFERENCE_RANGE_TILES ---
  let perceptionAdjustedSightLimit =
    gunProps.sight_dispersion || DEFAULT_SIGHT_DISPERSION;
  const perFactorPrecise =
    gunProps.skill === "pistol" ||
    gunProps.skill === "smg" ||
    gunProps.skill === "shotgun"
      ? 3
      : 5;
  const perModToSightPrecise = (8 - profile.perception) * perFactorPrecise;
  if (profile.perception < 8 && perModToSightPrecise > 0)
    perceptionAdjustedSightLimit += perModToSightPrecise;
  perceptionAdjustedSightLimit = Math.max(10, perceptionAdjustedSightLimit);
  // log('AIM_CALC', ...); // Precise aim target

  let totalExpectedDamage_Precise = 0;
  let totalMoves_Precise = 0;
  let currentRecoil_Precise = MAX_RECOIL_MOA;
  let totalAimingMoves_Precise = 0;

  for (let i = 0; i < magCapacityUsed; i++) {
    // log('AIM_CALC', `[PreciseShotLoop ${i+1}] Inputs ...`); // Already have this
    const aimingMovesThisShot = estimateMovesToReachRecoil(
      gunProps,
      perceptionAdjustedSightLimit,
      currentRecoil_Precise,
      profile,
      currentModeForCalcs.hasAccurateShot
    );
    totalAimingMoves_Precise += aimingMovesThisShot;
    // log('DEBUG', `[PreciseShotLoop ${i+1}] aimingMovesThisShot=${aimingMovesThisShot}, cumulativeTotalAimingMovesPrecise=${totalAimingMoves_Precise}`);

    totalMoves_Precise += aimingMovesThisShot + movesPerAttackActivation;
    const effectiveDispersionPrecise =
      inherentWeaponDispersionMoa + perceptionAdjustedSightLimit;
    let shotDamage = 0;
    for (let p = 0; p < pelletCountToUse; p++) {
      const probs = getHitProbabilities(
        effectiveDispersionPrecise,
        targetAngularSize_Default,
        accuracyConstants
      );
      const critMult = Math.max(
        ammoCritMultiplierToUse,
        CRITICAL_HIT_DAMAGE_MULTIPLIER_BASE
      );
      shotDamage +=
        probs.P_Crit * dphBaseToUse * critMult +
        probs.P_Hit * dphBaseToUse * GOOD_HIT_DAMAGE_MULTIPLIER +
        probs.P_Graze * dphBaseToUse * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
    }
    totalExpectedDamage_Precise += shotDamage;
    currentRecoil_Precise = Math.min(
      MAX_RECOIL_MOA,
      perceptionAdjustedSightLimit +
        increaseInRecoilMoaPerShotForThisMode /
          currentModeForCalcs.recoilMultiplierFromMode
    ); // Use base increase before mode mult for next aim cycle
  }
  const cycleSec_Precise = totalMoves_Precise / PLAYER_SPEED_MOVES_PER_SECOND;
  preciseAimDps =
    cycleSec_Precise > 0 ? totalExpectedDamage_Precise / cycleSec_Precise : 0;
  preciseAimDetails = {
    totalExpectedDamage: totalExpectedDamage_Precise,
    timeCycleSec: cycleSec_Precise,
    aimingMoves: totalAimingMoves_Precise,
    firingMoves: magCapacityUsed * movesPerAttackActivation,
    avgAimingMovesPerPreciseShot:
      magCapacityUsed > 0 ? totalAimingMoves_Precise / magCapacityUsed : 0,
  };
  log(
    "DPS_CYCLE",
    `  Mode ${
      currentModeForCalcs.name
    } PreciseAim DPS @${DEFAULT_REFERENCE_RANGE_TILES}t: ${preciseAimDps?.toFixed(
      1
    )} (Dmg: ${totalExpectedDamage_Precise.toFixed(
      1
    )}, Time: ${cycleSec_Precise.toFixed(2)}s, AvgAimMoves: ${(
      preciseAimDetails.avgAimingMovesPerPreciseShot || 0
    ).toFixed(0)})`
  );

  log(
    "INFO",
    `Finished getRepresentativeCombatInfo for: ${
      gunItem.id
    }. Ref Sust. DPS: ${refSustainedDps?.toFixed(1)}`
  );

  return {
    ammoName: ammoNameToUse,
    dphBase: dphBaseToUse,
    damageType: damageTypeToUse,
    ap: apToUse,
    barrelMatchInfo: barrelMatchInfoToUse,
    ammoCritMultiplier: ammoCritMultiplierToUse,
    pelletCount: pelletCountToUse,
    availableFiringModes: calculatedAvailableFiringModes,
    modePerformances: calculatedModePerformances,
    referenceSustainedDps: refSustainedDps,
    referenceModeName: refModeName,
    referenceRangeTiles: refRangeTiles,
    referenceSustainedDpsDetails: refSustainedDpsDetails,
    dpsMagDumpNoReload: magDumpDps,
    dpsMagDumpDetails: magDumpDetails,
    dpsPreciseAimPerShotNoReload: preciseAimDps,
    dpsPreciseAimPerShotDetails: preciseAimDetails,
    isRechargeableGun: isRechargeableGun_local_flag,
    rechargeableStats: calculatedRechargeableStats,
    isModularVaries: isModularVaries_local_flag,
    isNonConventional: classification.isNonTraditional,
    nonConventionalType: classification.weaponSubType,
    debugPrimaryAmmoEffects: debugPrimaryAmmoEffects,
  };
}
