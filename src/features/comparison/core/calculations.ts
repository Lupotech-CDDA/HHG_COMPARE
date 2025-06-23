// src/features/comparison/core/calculations.ts

// --- Corrected Imports ---
import type { Item, GunSlot, AmmoSlot, ItemBasicInfo } from "../../../types";
import type { CddaData } from "../../../data";
import { log } from "../utils/logger";
import { classifyGunDetailed } from "../utils/classify";
import {
  getReloadMethod,
  getCompatibleMagazines,
  getDefaultReceiver,
  formatHitChances,
} from "../utils/helpers";
import {
  // CORRECTED: All feature-specific types are now imported from the central types file
  CombatProfile,
  RepresentativeCombatInfo,
  PotentialDamageInfo,
  DispersionSources,
} from "./types";
import {
  getFireableAmmoObjects,
  getDphInfoForAmmo,
  getFiringModes,
} from "./properties";
import {
  calculateGunRecoil,
  getHitProbabilities,
  getExpectedDamagePerShot,
  simulateAiming,
  calculateTimeToAttack,
} from "./mechanics";
import {
  TARGET_ANGULAR_SIZE_MEDIUM_10_TILES,
  DEFAULT_AIM_PROFILE,
} from "../constants/index";
import { getReloadTime } from "./reloads";

// REMOVED the local interface definitions, they now live in core/types.ts

export const TEST_GUY_PROFILE: CombatProfile = {
  strength: 10,
  dexterity: 10,
  perception: 10,
  weaponSkillLevel: 4,
  marksmanshipLevel: 4,
  gripScore: 1.0,
  handManipScore: 1.0,
};

export function processGun(
  gun: Item,
  processor: CddaData,
  profile: CombatProfile
): RepresentativeCombatInfo[] {
  // Function body remains the same...
  const fireableAmmos = getFireableAmmoObjects(gun, processor);
  if (fireableAmmos.length <= 1) {
    const singleResult = getSingleConfigurationCombatInfo(
      gun,
      profile,
      processor,
      fireableAmmos[0] ?? null
    );
    return singleResult ? [singleResult] : [];
  }
  const results: RepresentativeCombatInfo[] = [];
  for (const ammo of fireableAmmos) {
    if (ammo.id === "null" && fireableAmmos.length > 1) continue;
    const configResult = getSingleConfigurationCombatInfo(
      gun,
      profile,
      processor,
      ammo
    );
    if (configResult) results.push(configResult);
  }
  if (results.length === 0) {
    const baseResult = getSingleConfigurationCombatInfo(
      gun,
      profile,
      processor,
      null
    );
    return baseResult ? [baseResult] : [];
  }
  return results;
}

function fullCycleCombatSimulation(
  gunItem: Item & GunSlot,
  dphInfo: PotentialDamageInfo,
  profile: CombatProfile,
  processor: CddaData
) {
    // Function body remains the same...
    const firingModes = getFiringModes(gunItem);
    const autoMode = firingModes.find((m) => m.shots > 1);
    const skillUsed = gunItem.skill ?? "N/A";
    const baseMovesPerShot = calculateTimeToAttack(profile.weaponSkillLevel, skillUsed);
    const magazineCapacity = gunItem.clip_size ?? 1;
    const reloadTime = getReloadTime(gunItem, profile, processor);
    const scenario = { targetRangeTiles: 10, targetAngularSizeMoa: TARGET_ANGULAR_SIZE_MEDIUM_10_TILES, creatureSizeStr: "medium" as const };

    let sustainedTotalTime = 0;
    let sustainedTotalDamage = 0;
    let currentRecoil = DEFAULT_AIM_PROFILE.start;
    const initialAim = simulateAiming(gunItem, DEFAULT_AIM_PROFILE.target, currentRecoil, profile, scenario);
    sustainedTotalTime += initialAim.moves;
    currentRecoil = initialAim.finalRecoil;
    for (let i = 0; i < magazineCapacity; i++) {
        sustainedTotalTime += baseMovesPerShot;
        const dispersionForShot = new DispersionSources(dphInfo.inherentDispersionMoa);
        dispersionForShot.add_range(currentRecoil);
        const hitProbs = getHitProbabilities(dispersionForShot, scenario.targetRangeTiles, scenario.creatureSizeStr);
        sustainedTotalDamage += getExpectedDamagePerShot(dphInfo.damage, hitProbs);
        const recoilKick = calculateGunRecoil(gunItem, dphInfo.ammoRecoil, profile);
        currentRecoil += recoilKick;
        if (i < magazineCapacity - 1) {
            const reAim = simulateAiming(gunItem, DEFAULT_AIM_PROFILE.target, currentRecoil, profile, scenario);
            sustainedTotalTime += reAim.moves;
            currentRecoil = reAim.finalRecoil;
        }
    }
    sustainedTotalTime += reloadTime;
    const sustainedDps = sustainedTotalTime > 0 ? (sustainedTotalDamage / sustainedTotalTime) * 100 : 0;

    let magDumpDps = 0;
    if (autoMode) {
        let magDumpTotalTime = 0;
        let magDumpTotalDamage = 0;
        currentRecoil = DEFAULT_AIM_PROFILE.start;
        const initialAimAuto = simulateAiming(gunItem, DEFAULT_AIM_PROFILE.target, currentRecoil, profile, scenario);
        magDumpTotalTime += initialAimAuto.moves;
        currentRecoil = initialAimAuto.finalRecoil;
        magDumpTotalTime += baseMovesPerShot;
        const absorbRatio = Math.min(profile.weaponSkillLevel, 10) / 20.0;
        let delayedRecoil = 0;
        for (let i = 0; i < magazineCapacity; i++) {
            const dispersionForShot = new DispersionSources(dphInfo.inherentDispersionMoa);
            dispersionForShot.add_range(currentRecoil);
            const hitProbs = getHitProbabilities(dispersionForShot, scenario.targetRangeTiles, scenario.creatureSizeStr);
            magDumpTotalDamage += getExpectedDamagePerShot(dphInfo.damage, hitProbs);
            const recoilKick = calculateGunRecoil(gunItem, dphInfo.ammoRecoil, profile);
            currentRecoil += recoilKick * (1.0 - absorbRatio);
            delayedRecoil += recoilKick * absorbRatio;
        }
        currentRecoil += delayedRecoil;
        magDumpDps = magDumpTotalTime > 0 ? (magDumpTotalDamage / magDumpTotalTime) * 100 : 0;
    } else {
        const semiAutoDumpTime = sustainedTotalTime - reloadTime;
        magDumpDps = semiAutoDumpTime > 0 ? (sustainedTotalDamage / semiAutoDumpTime) * 100 : 0;
    }

    const firstShotAim = simulateAiming(gunItem, DEFAULT_AIM_PROFILE.target, DEFAULT_AIM_PROFILE.start, profile, scenario);
    const firstShotDispersion = new DispersionSources(dphInfo.inherentDispersionMoa);
    firstShotDispersion.add_range(firstShotAim.finalRecoil);
    const firstShotHitProbs = getHitProbabilities(firstShotDispersion, scenario.targetRangeTiles, scenario.creatureSizeStr);
    const damagePerShot = getExpectedDamagePerShot(dphInfo.damage, firstShotHitProbs);

    const ZOMBIE_HP = 80;
    const damagePerMove = sustainedDps / 100;
    const meanTimeToKill = damagePerMove > 0 ? ZOMBIE_HP / damagePerMove : Infinity;

    return {
        sustainedDps, magDumpDps, reloadTime, damagePerShot,
        meanTimeToKillStandardZombie: meanTimeToKill,
        hitChancesAt10Tiles: formatHitChances(firstShotHitProbs),
        _internal: { dphInfo, hitProbabilitiesAt10Tiles: firstShotHitProbs },
    };
}

function getSingleConfigurationCombatInfo(
  gun: Item,
  profile: CombatProfile,
  processor: CddaData,
  preselectedAmmo: (Item & AmmoSlot) | null
): RepresentativeCombatInfo | null {
    // Function body remains the same...
    const gunSlot = gun as Item & GunSlot;
    const category = classifyGunDetailed(gun);
    const skillUsed = gunSlot.skill ?? "N/A";
    let uniqueId = gun.id;
    let displayName = (gun as ItemBasicInfo).name?.str ?? gun.id;

    const dphInfo = preselectedAmmo ? getDphInfoForAmmo(gunSlot, preselectedAmmo, profile, processor) : null;

    if (dphInfo) {
        uniqueId = `${gun.id}_${dphInfo.ammoItem?.id ?? "base"}`;
        displayName = preselectedAmmo ? `${displayName} (${dphInfo.ammoName})` : displayName;
    }

    const isNonStandard = category.type === "Archery" || category.type === "Energy" || category.type === "Other";
    const reloadMethod = getReloadMethod(gun, processor);
    const compatibleMagazines = getCompatibleMagazines(gun, processor);

    if (isNonStandard || !dphInfo || dphInfo.damage <= 0) {
        return {
            id: uniqueId, name: displayName, category, skillUsed,
            isNonStandard: true, standardAmmo: dphInfo?.ammoName ?? "N/A",
            reloadMethod, compatibleMagazines,
            defaultReceiver: getDefaultReceiver(gun, processor),
            damagePerShot: 0, meanTimeToKillStandardZombie: Infinity,
            sustainedDps: 0, magDumpDps: 0, reloadTime: 0,
            hitChancesAt10Tiles: "N/A",
        };
    }

    const combatMetrics = fullCycleCombatSimulation(gunSlot, dphInfo, profile, processor);

    return {
        id: uniqueId, name: displayName, category, skillUsed,
        isNonStandard: isNonStandard, standardAmmo: dphInfo.ammoName,
        reloadMethod, compatibleMagazines,
        defaultReceiver: getDefaultReceiver(gun, processor),
        ...combatMetrics,
    };
}