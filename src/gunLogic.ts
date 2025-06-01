// src/gunLogic.ts
import type {
  Item,
  GunSlot,
  PocketData,
  AmmoSlot,
  DamageUnit,
  ItemBasicInfo,
  Skill as SkillType,
  AmmunitionType,
  GunClassification,
} from "./types";
import { isItemSubtype } from "./types";
import { normalizeDamageInstance, CddaData, singularName } from "./data";
import { parseLengthToMm, getItemNameFromIdOrObject } from "./formatters";

// --- Interfaces & Constants ---
interface DamageUnitWithBarrels extends DamageUnit {
  barrels?: { barrel_length: string; amount: number }[];
}

export interface PotentialDamageInfo {
  ammoName: string | null;
  damage: number;
  damageType: string;
  ap: number;
  barrelMatchInfo?: string;
  ammoCritMultiplier: number;
  pelletCount?: number;
}

export interface BaseCharacterProfile {
  // Renamed from CharacterProfile
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

export interface RepresentativeCombatInfo {
  ammoName: string | null;
  dphBase: number;
  damageType: string;
  ap: number;
  barrelMatchInfo?: string;
  ammoCritMultiplier: number;
  pelletCount?: number;

  shotsPerActivationInMode: number;
  movesPerActivationInMode: number;
  magCapacityUsed: number | null;
  modeUsed: string;
  rawSustainedDps: number | null;
}

const MAX_SKILL = 10;
const MAX_RECOIL_MOA = 5000;
const METERS_PER_TILE = 1.0;
const ACCURACY_CRITICAL_FACTOR = 0.1;
const ACCURACY_STANDARD_FACTOR = 0.4;
const ACCURACY_GRAZING_FACTOR = 0.7;
const GRAZE_DAMAGE_MULTIPLIER_DEFAULT = 0.33;
const PLAYER_SPEED_MOVES_PER_SECOND = 100;
const WEAPON_DISPERSION_CONSTANT_FIREARM = 300;

const STANDARD_AMMO_KEYWORDS = ["fmj", "ball", "standard"];
const NON_STANDARD_AMMO_KEYWORDS = [
  "+p",
  "jhp",
  "ap",
  "incendiary",
  "tracer",
  "reloaded",
  "black powder",
  "match",
  "subsonic",
  "cb",
  "short",
  "ratshot",
  "birdshot",
  "blank",
  "flechette",
  "beanbag",
  "slug",
];

interface ClassifiedAmmoItem {
  item: Item & AmmoSlot;
  isDefaultForAmmoType: boolean;
  isStandardHeuristic: boolean;
  baseDamageAmount: number;
  pelletCount: number;
}

function getLocalItemNameForLogic(
  itemIdentifier: any,
  processor: CddaData
): string | null {
  if (typeof itemIdentifier === "string") {
    const itemObj =
      processor.byIdMaybe("item", itemIdentifier) ||
      processor.byIdMaybe("ammunition_type", itemIdentifier) ||
      processor.byIdMaybe("damage_type", itemIdentifier);
    if (itemObj) return singularName(itemObj);
    return itemIdentifier;
  }
  if (
    itemIdentifier &&
    typeof itemIdentifier === "object" &&
    itemIdentifier.name
  )
    return singularName(itemIdentifier);
  if (
    itemIdentifier &&
    typeof itemIdentifier === "object" &&
    itemIdentifier.id &&
    !itemIdentifier.name
  )
    return itemIdentifier.id;
  return null;
}

export function getAmmoTypesFromMagazinePockets(
  pockets: PocketData[] | undefined
): Set<string> {
  const ammoTypeIds = new Set<string>();
  if (!pockets) return ammoTypeIds;
  for (const pocket of pockets) {
    if (pocket.pocket_type === "MAGAZINE" && pocket.ammo_restriction) {
      Object.keys(pocket.ammo_restriction).forEach((id) => ammoTypeIds.add(id));
    }
  }
  return ammoTypeIds;
}
export function getMagazineIdsFromItemPockets(
  itemWithPockets: Item | undefined
): Set<string> {
  const magazineIds = new Set<string>();
  if (!itemWithPockets || !itemWithPockets.pocket_data) return magazineIds;
  for (const pocket of itemWithPockets.pocket_data) {
    if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
      pocket.item_restriction.forEach((id) => magazineIds.add(id));
    }
  }
  return magazineIds;
}
export function getAmmoTypesFromGunMod(modItem: Item): Set<string> {
  const ammoTypeIds = new Set<string>();
  if (!isItemSubtype("GUNMOD", modItem)) return ammoTypeIds;
  const gunModProps = modItem as Item & { ammo_modifier?: string[] };
  if (gunModProps.ammo_modifier) {
    gunModProps.ammo_modifier.forEach((id) => {
      if (id && id !== "NULL") ammoTypeIds.add(id);
    });
  }
  return ammoTypeIds;
}
export function getMagazineIdsFromGunMod(modItem: Item): Set<string> {
  const magazineItemIds = new Set<string>();
  if (!isItemSubtype("GUNMOD", modItem)) return magazineItemIds;
  const gunModProps = modItem as Item & {
    magazine_adaptor?: [string, string[]][];
    pocket_mods?: PocketData[];
  };
  if (gunModProps.magazine_adaptor) {
    for (const adaptor of gunModProps.magazine_adaptor) {
      const mags = adaptor[1];
      if (mags) mags.forEach((magId) => magazineItemIds.add(magId));
    }
  }
  if (gunModProps.pocket_mods) {
    for (const pocket of gunModProps.pocket_mods) {
      if (pocket.pocket_type === "MAGAZINE_WELL" && pocket.item_restriction) {
        pocket.item_restriction.forEach((id) => magazineItemIds.add(id));
      }
    }
  }
  return magazineItemIds;
}
export function getGunChamberings(
  entityGun: Item,
  processor: CddaData
): Set<string> {
  const chamberings = new Set<string>();
  const gunProps = entityGun as Item & GunSlot;
  let modDictatesChambering = false;
  if (gunProps.default_mods) {
    for (const modId of gunProps.default_mods) {
      const modItem = processor.byIdMaybe("item", modId) as Item | undefined;
      if (modItem && isItemSubtype("GUNMOD", modItem)) {
        const modAsGunMod = modItem as Item & { ammo_modifier?: string[] };
        if (modAsGunMod.ammo_modifier && modAsGunMod.ammo_modifier.length > 0) {
          modDictatesChambering = true;
          modAsGunMod.ammo_modifier.forEach((id) => {
            if (id && id !== "NULL") chamberings.add(id);
          });
        }
      }
    }
  }
  if (!modDictatesChambering && gunProps.ammo) {
    (Array.isArray(gunProps.ammo) ? gunProps.ammo : [gunProps.ammo]).forEach(
      (id) => {
        if (id && id !== "NULL") chamberings.add(id);
      }
    );
  }
  chamberings.delete("NULL");
  return chamberings;
}
export function getEffectiveBarrelLengthMm(
  gunItem: Item,
  processor: CddaData
): number | null {
  const gunAsBasic = gunItem as ItemBasicInfo & { barrel_length?: string };
  const gunAsGunType = gunItem as Item & GunSlot;
  let finalBarrelLengthStr: string | undefined = undefined;
  if (gunAsGunType.default_mods) {
    for (const modId of gunAsGunType.default_mods) {
      const modItem = processor.byIdMaybe("item", modId) as Item | undefined;
      if (modItem && isItemSubtype("GUNMOD", modItem)) {
        const gunModProps = modItem as Item & { barrel_length?: string };
        if (gunModProps.barrel_length) {
          finalBarrelLengthStr = gunModProps.barrel_length;
          break;
        }
      }
    }
  }
  if (!finalBarrelLengthStr && gunAsBasic.barrel_length) {
    finalBarrelLengthStr = gunAsBasic.barrel_length;
  }
  return finalBarrelLengthStr ? parseLengthToMm(finalBarrelLengthStr) : null;
}

export function getAdjustedAmmoDamage(
  ammoItem: Item & AmmoSlot,
  effectiveBarrelLengthMm: number | null,
  processor: CddaData
): PotentialDamageInfo | null {
  // <<<< FIXED: Check if ammoItem.damage exists before calling normalizeDamageInstance
  if (!ammoItem.damage) return null;
  const damageInstance = normalizeDamageInstance(ammoItem.damage);

  if (!damageInstance || damageInstance.length === 0) return null;

  const primaryDamageUnit = damageInstance[0] as DamageUnitWithBarrels;
  let chosenDamageAmount = primaryDamageUnit.amount ?? 0;
  let sourceMatchInfo: string | undefined = "Default/Top-level";

  if (
    effectiveBarrelLengthMm !== null &&
    primaryDamageUnit.barrels &&
    primaryDamageUnit.barrels.length > 0
  ) {
    let bestMatchEntry: { barrel_length: string; amount: number } | undefined =
      undefined;
    let smallestDiff = Infinity;
    for (const barrelEntry of primaryDamageUnit.barrels) {
      const entryLengthMm = parseLengthToMm(barrelEntry.barrel_length);
      if (entryLengthMm === null) continue;
      const diff = Math.abs(entryLengthMm - effectiveBarrelLengthMm);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        bestMatchEntry = barrelEntry;
      } else if (diff === smallestDiff) {
        if (
          bestMatchEntry &&
          parseLengthToMm(bestMatchEntry.barrel_length)! > entryLengthMm
        ) {
        } else if (
          !bestMatchEntry ||
          entryLengthMm <= effectiveBarrelLengthMm
        ) {
          bestMatchEntry = barrelEntry;
        }
      }
    }
    if (bestMatchEntry) {
      chosenDamageAmount = bestMatchEntry.amount;
      sourceMatchInfo = `Barrel array (${bestMatchEntry.barrel_length})`;
    } else {
      sourceMatchInfo = "Default/Top-level (no precise barrel match)";
    }
  }
  return {
    ammoName: getLocalItemNameForLogic(ammoItem, processor),
    damage: chosenDamageAmount,
    damageType:
      getLocalItemNameForLogic(primaryDamageUnit.damage_type, processor) ||
      primaryDamageUnit.damage_type,
    ap: primaryDamageUnit.armor_penetration ?? 0,
    barrelMatchInfo: sourceMatchInfo,
    ammoCritMultiplier: ammoItem.critical_multiplier || 1.0,
    pelletCount: ammoItem.count || 1,
  };
}

export function getFireableAmmoObjects(
  entityGun: Item,
  processor: CddaData
): Array<Item & AmmoSlot> {
  const fireableAmmoItems: Array<Item & AmmoSlot> = [];
  if (!isItemSubtype("GUN", entityGun)) return fireableAmmoItems;
  const gunChamberings = getGunChamberings(entityGun, processor);
  const gunProps = entityGun as Item & GunSlot;
  if (gunChamberings.size > 0) {
    const allAmmoItemsInGame = processor
      .byType("item")
      .filter((item) => isItemSubtype("AMMO", item as Item)) as (Item &
      AmmoSlot)[];
    for (const ammoItem of allAmmoItemsInGame) {
      if (ammoItem.ammo_type && gunChamberings.has(ammoItem.ammo_type)) {
        fireableAmmoItems.push(ammoItem);
      }
    }
  } else {
    if (gunProps.ammo && gunProps.ammo[0] !== "NULL") {
      (Array.isArray(gunProps.ammo) ? gunProps.ammo : [gunProps.ammo]).forEach(
        (ammoIdOrType) => {
          const ammoItem = processor.byIdMaybe("item", ammoIdOrType);
          if (ammoItem && isItemSubtype("AMMO", ammoItem as Item)) {
            fireableAmmoItems.push(ammoItem as Item & AmmoSlot);
          }
        }
      );
    }
  }
  fireableAmmoItems.sort((a, b) =>
    (getLocalItemNameForLogic(a, processor) || "").localeCompare(
      getLocalItemNameForLogic(b, processor) || ""
    )
  );
  return fireableAmmoItems;
}

function classifyAndSelectStandardAmmo(
  gunItem: Item,
  processor: CddaData
): (Item & AmmoSlot) | null {
  const fireableAmmoObjects = getFireableAmmoObjects(gunItem, processor);
  if (fireableAmmoObjects.length === 0) return null;
  const conventionalAmmoObjects = fireableAmmoObjects.filter((ammo) => {
    const name = getLocalItemNameForLogic(ammo, processor);
    return (
      name !== "UPS Charge" &&
      name !== "UPS Compatible" &&
      name !== "Bionic Power"
    );
  });
  if (conventionalAmmoObjects.length === 0) return null;

  const classified: ClassifiedAmmoItem[] = conventionalAmmoObjects.map(
    (ammoItem) => {
      const ammoTypeObj = processor.byIdMaybe(
        "ammunition_type",
        ammoItem.ammo_type || ""
      ) as AmmunitionType | undefined;
      const isDefaultForType = !!(
        ammoTypeObj && ammoTypeObj.default === ammoItem.id
      );
      const name = (
        getLocalItemNameForLogic(ammoItem, processor) || ""
      ).toLowerCase();
      const isStandardByName =
        STANDARD_AMMO_KEYWORDS.some((kw) => name.includes(kw)) &&
        !NON_STANDARD_AMMO_KEYWORDS.some((kw) => name.includes(kw));
      let baseDmg = 0;
      if (ammoItem.damage) {
        const damageInstance = normalizeDamageInstance(ammoItem.damage);
        if (damageInstance && damageInstance.length > 0) {
          baseDmg = damageInstance[0].amount ?? 0;
        }
      }
      return {
        item: ammoItem,
        isDefaultForAmmoType: isDefaultForType,
        isStandardHeuristic: isStandardByName,
        baseDamageAmount: baseDmg,
        pelletCount: ammoItem.count || 1,
      };
    }
  );

  const defaults = classified.filter((c) => c.isDefaultForAmmoType);
  if (defaults.length > 0) {
    defaults.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
    return defaults[0].item;
  }
  const standardsByName = classified.filter((c) => c.isStandardHeuristic);
  if (standardsByName.length > 0) {
    standardsByName.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
    return standardsByName[0].item;
  }
  if (classified.length > 0) {
    classified.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
    const bestDamage = classified.find((c) => c.baseDamageAmount > 0);
    return bestDamage ? bestDamage.item : classified[0].item;
  }
  return null;
}

export function getRepresentativeDPHInfo(
  gunItem: Item,
  processor: CddaData
): PotentialDamageInfo | null {
  if (!isItemSubtype("GUN", gunItem)) return null;
  const representativeAmmoObject = classifyAndSelectStandardAmmo(
    gunItem,
    processor
  );
  if (!representativeAmmoObject) return null;
  const effectiveBarrelLengthMm = getEffectiveBarrelLengthMm(
    gunItem,
    processor
  );
  return getAdjustedAmmoDamage(
    representativeAmmoObject,
    effectiveBarrelLengthMm,
    processor
  );
}

function getFireableAmmoStringForEnergyCheck(
  entityGun: Item,
  processor: CddaData
): string | null {
  const fireableAmmoItemNames = new Set<string>();
  if (!isItemSubtype("GUN", entityGun)) return "N/A";
  const gunProps = entityGun as Item & GunSlot;
  const basicGunProps = entityGun as ItemBasicInfo;
  const ammoObjects = getFireableAmmoObjects(entityGun, processor);
  ammoObjects.forEach((obj) => {
    const name = getLocalItemNameForLogic(obj, processor);
    if (name) fireableAmmoItemNames.add(name);
  });
  if (fireableAmmoItemNames.size === 0) {
    if (gunProps.ups_charges && gunProps.ups_charges > 0) return "UPS Charge";
    if (basicGunProps.flags?.includes("USE_UPS")) return "UPS Compatible";
    if (basicGunProps.flags?.includes("USE_PLAYER_CHARGE"))
      return "Bionic Power";
    return "N/A";
  }
  return Array.from(fireableAmmoItemNames).sort().join(", ");
}

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

function dispersion_from_skill(
  skill_val: number,
  wep_disp_const: number
): number {
  const skill_shortfall = MAX_SKILL - skill_val;
  const dispersion_penalty_flat = 10 * skill_shortfall;
  const skill_threshold = 5.0;
  if (skill_val >= MAX_SKILL) return 0;
  let dispersion_penalty_scaled: number;
  if (skill_val >= skill_threshold) {
    const post_thresh_shortfall = MAX_SKILL - skill_val;
    dispersion_penalty_scaled =
      MAX_SKILL - skill_threshold > 0
        ? (wep_disp_const * post_thresh_shortfall * 1.25) /
          (MAX_SKILL - skill_threshold)
        : 0;
  } else {
    const pre_thresh_shortfall = skill_threshold - skill_val;
    dispersion_penalty_scaled =
      wep_disp_const *
      (1.25 +
        (skill_threshold > 0
          ? (pre_thresh_shortfall * 10.0) / skill_threshold
          : 0));
  }
  return dispersion_penalty_flat + dispersion_penalty_scaled;
}

// <<<< FIXED: ammoItem parameter type to allow null or undefined for broader use if needed.
export function getInherentWeaponDispersionMoa(
  gunItem: Item & GunSlot,
  ammoItem: (Item & AmmoSlot) | null | undefined,
  profile: BaseCharacterProfile,
  processor: CddaData
): number {
  const gunBaseDispersion = gunItem.dispersion || 0;
  const ammoBaseDispersion = ammoItem?.dispersion || 0;
  // TODO: Add ammo barrel dispersion modifier if getEffectiveBarrelLengthMm is available and ammo has dispersion_modifier array
  const dexModDispersion = (8 - profile.dexterity) * 10;
  const avgCombatSkill =
    (profile.marksmanshipLevel + profile.weaponSkillLevel) / 2.0;
  const skillPenaltyDispersion = dispersion_from_skill(
    avgCombatSkill,
    WEAPON_DISPERSION_CONSTANT_FIREARM
  );

  let shotSpread = 0;
  if (ammoItem && isItemSubtype("AMMO", ammoItem as Item)) {
    const ammoAsSlot = ammoItem as Item & AmmoSlot; // Cast to access ammo_type
    if (ammoAsSlot.ammo_type === "shot" || ammoAsSlot.ammo_type === "bolt") {
      // Example check for shotgun/crossbow ammo
      shotSpread =
        (ammoItem as Item & AmmoSlot & { shot_spread?: number }).shot_spread ||
        0;
    }
  }

  const sumAdditiveDispersion =
    gunBaseDispersion +
    ammoBaseDispersion +
    dexModDispersion +
    skillPenaltyDispersion +
    shotSpread;
  return Math.max(0, sumAdditiveDispersion);
}

export function getRecoilAbsorbFactor(profile: BaseCharacterProfile): number {
  return Math.min(profile.weaponSkillLevel, MAX_SKILL) / (MAX_SKILL * 2.0);
}

// <<<< FIXED: Signature now takes processor for bipod check
export function getEffectiveGunRecoilQtyPerShot(
  gunItem: Item & GunSlot,
  ammoRecoilValue: number,
  profile: BaseCharacterProfile,
  processor: CddaData
): number {
  let currentRecoil = ammoRecoilValue;
  const strReduction = profile.strength * 10;
  currentRecoil = Math.max(0, currentRecoil - strReduction);

  const gunFlags = (gunItem as ItemBasicInfo).flags || [];
  const hasBipod =
    gunFlags.includes("BIPOD") ||
    (gunItem.default_mods &&
      gunItem.default_mods.some((modId) => {
        const mod = processor.byIdMaybe("item", modId); // Pass processor here
        return mod && (mod as ItemBasicInfo).flags?.includes("BIPOD");
      }));
  // Assuming 'profile' implies character is prone/braced if using a bipod for this test_guy calc
  if (hasBipod) currentRecoil *= 0.25;

  return currentRecoil;
}

export function getIncreaseInRecoilMoaPerShot(
  effectiveGunRecoilQty: number,
  recoilAbsorbFactor: number
): number {
  const recoilIncreaseImmediate =
    effectiveGunRecoilQty * (1.0 - recoilAbsorbFactor);
  return recoilIncreaseImmediate * 5.0;
}

export function getHitProbabilities(
  effectiveTotalDispersionMoa: number,
  targetAngularSizeMoa: number,
  accuracyConstants: { crit: number; standard: number; graze: number }
): { P_Crit: number; P_Hit: number; P_Graze: number; P_Miss: number } {
  if (effectiveTotalDispersionMoa <= 0)
    return { P_Crit: 1.0, P_Hit: 0, P_Graze: 0, P_Miss: 0 };
  const critThresholdAngle = targetAngularSizeMoa * accuracyConstants.crit;
  const hitThresholdAngle = targetAngularSizeMoa * accuracyConstants.standard;
  const grazeThresholdAngle = targetAngularSizeMoa * accuracyConstants.graze;
  let pCrit = Math.max(
    0,
    Math.min(1.0, critThresholdAngle / effectiveTotalDispersionMoa)
  );
  let pHit =
    Math.max(
      0,
      Math.min(1.0, hitThresholdAngle / effectiveTotalDispersionMoa)
    ) - pCrit;
  let pGraze =
    Math.max(
      0,
      Math.min(1.0, grazeThresholdAngle / effectiveTotalDispersionMoa)
    ) -
    pHit -
    pCrit;
  if (pHit < 0) pHit = 0;
  if (pGraze < 0) pGraze = 0;
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

function estimateMovesToReachRecoil(
  gunItem: Item & GunSlot,
  targetRecoilMoa: number,
  startRecoilMoa: number,
  profile: BaseCharacterProfile,
  processor: CddaData
): number {
  if (startRecoilMoa <= targetRecoilMoa) return 0;
  const sightDispersion = gunItem.sight_dispersion || 300;
  const baseAimRate = 300 - Math.min(sightDispersion, 280);
  const perBonus = (profile.perception - 8) * 10;
  const skillBonus =
    ((profile.weaponSkillLevel + profile.marksmanshipLevel) / 2) * 5;
  let simplifiedAimPerMovePer10Moves = baseAimRate / 10 + perBonus + skillBonus;
  let simplifiedAimPerMove = Math.max(5, simplifiedAimPerMovePer10Moves / 10);
  if (simplifiedAimPerMove <= 0) return 500;
  let currentRecoil = startRecoilMoa;
  let movesSpent = 0;
  const MAX_AIM_MOVES = 200;
  while (currentRecoil > targetRecoilMoa && movesSpent < MAX_AIM_MOVES) {
    currentRecoil -= simplifiedAimPerMove;
    if (currentRecoil < sightDispersion * 1.5) simplifiedAimPerMove *= 0.8;
    simplifiedAimPerMove = Math.max(0.1, simplifiedAimPerMove);
    movesSpent++;
    if (simplifiedAimPerMove <= 0.01 && currentRecoil > targetRecoilMoa) {
      return MAX_AIM_MOVES;
    }
  }
  return Math.max(0, movesSpent);
}

export function getRepresentativeCombatInfo(
  gunItem: Item,
  processor: CddaData,
  profile: CombatProfile,
  classification: GunClassification
): RepresentativeCombatInfo | null {
  if (!isItemSubtype("GUN", gunItem)) return null;
  const gunProps = gunItem as Item & GunSlot;
  const basicGunProps = gunItem as ItemBasicInfo;

  const dphInfo = getRepresentativeDPHInfo(gunItem, processor);

  if (classification.isNonTraditional) {
    let ammoNameDisplay = "Special";
    let damageTypeDisplay = "N/A";
    let baseDamageForNonTrad = dphInfo?.damage || 0;
    let apForNonTrad = dphInfo?.ap || 0;
    let critMultForNonTrad = dphInfo?.ammoCritMultiplier || 1.0;
    let pelletCountForNonTrad = dphInfo?.pelletCount || 1; // Use pelletCount from DPH

    if (classification.weaponSubType === "energy") {
      ammoNameDisplay =
        getFireableAmmoStringForEnergyCheck(gunItem, processor) || "Energy";
      damageTypeDisplay = "energy";
      // <<<< FIXED: Check if gunProps.ranged_damage exists
      if (gunProps.ranged_damage) {
        const gunDmg = normalizeDamageInstance(gunProps.ranged_damage);
        if (
          gunDmg.length > 0 &&
          (gunDmg[0].damage_type === "heat" ||
            gunDmg[0].damage_type === "cold" ||
            gunDmg[0].damage_type === "electric")
        ) {
          baseDamageForNonTrad = gunDmg[0].amount || 0;
          apForNonTrad = gunDmg[0].armor_penetration || 0;
        }
      }
    } else if (classification.weaponSubType === "archery") {
      /* ... as before ... */
    }
    // ... other non-traditional types

    return {
      ammoName: ammoNameDisplay,
      dphBase: baseDamageForNonTrad,
      damageType: damageTypeDisplay,
      ap: apForNonTrad,
      ammoCritMultiplier: critMultForNonTrad,
      barrelMatchInfo: dphInfo?.barrelMatchInfo,
      pelletCount: pelletCountForNonTrad,
      shotsPerActivationInMode: 1,
      movesPerActivationInMode: getMovesPerAttackActivation(
        gunProps.skill,
        profile,
        processor
      ),
      magCapacityUsed:
        gunProps.clip_size ||
        (classification.weaponSubType === "archery" ? 1 : null),
      modeUsed: classification.weaponSubType.replace("_", " "),
      rawSustainedDps: null,
    };
  }

  const chamberings = getGunChamberings(gunItem, processor);
  if (
    chamberings.size === 0 &&
    (!gunProps.ammo ||
      gunProps.ammo[0] === "NULL" ||
      gunProps.ammo.length === 0)
  ) {
    const fireableAmmoStrCheck = getFireableAmmoStringForEnergyCheck(
      gunItem,
      processor
    );
    if (
      fireableAmmoStrCheck?.startsWith("UPS") ||
      fireableAmmoStrCheck?.startsWith("Bionic Power")
    ) {
      return {
        ammoName: fireableAmmoStrCheck,
        dphBase: 0,
        damageType: "energy",
        ap: 0,
        ammoCritMultiplier: 1,
        pelletCount: 1,
        shotsPerActivationInMode: 1,
        movesPerActivationInMode: 100,
        magCapacityUsed: null,
        modeUsed: "Energy",
        rawSustainedDps: null,
      };
    }
    return {
      ammoName: "Varies (Modular)",
      dphBase: 0,
      damageType: "N/A",
      ap: 0,
      ammoCritMultiplier: 1,
      pelletCount: 1,
      shotsPerActivationInMode: 1,
      movesPerActivationInMode: 100,
      magCapacityUsed: null,
      modeUsed: "Modular",
      rawSustainedDps: null,
    };
  }

  // <<<< FIXED: dphInfo.damage should be dphInfo.dphBase for consistency if we renamed it
  if (!dphInfo || dphInfo.damage <= 0) {
    const fireableAmmoStrCheck = getFireableAmmoStringForEnergyCheck(
      gunItem,
      processor
    );
    if (
      fireableAmmoStrCheck?.startsWith("UPS") ||
      fireableAmmoStrCheck?.startsWith("Bionic Power")
    ) {
      return {
        ammoName: fireableAmmoStrCheck,
        dphBase: 0,
        damageType: "energy",
        ap: 0,
        ammoCritMultiplier: 1,
        pelletCount: 1,
        shotsPerActivationInMode: 1,
        movesPerActivationInMode: 100,
        magCapacityUsed: null,
        modeUsed: "Energy",
        rawSustainedDps: null,
      };
    }
    return null;
  }

  let initialEffectiveRecoilMoaForFirstShot =
    gunProps.sight_dispersion || MAX_RECOIL_MOA;
  let movesSpentAimingInitial = 0;
  const thresholdRegularAimMoa =
    (MAX_RECOIL_MOA - (gunProps.sight_dispersion || 0)) / 10.0 +
    (gunProps.sight_dispersion || 0);

  if (profile.aimingStrategy === AimingStrategy.FixedMovesToRegularAim) {
    movesSpentAimingInitial = profile.fixedAimMoves || 30;
    initialEffectiveRecoilMoaForFirstShot = thresholdRegularAimMoa;
  } else if (
    profile.aimingStrategy === AimingStrategy.EstimatedMovesToRegularAim
  ) {
    movesSpentAimingInitial = estimateMovesToReachRecoil(
      gunProps,
      thresholdRegularAimMoa,
      MAX_RECOIL_MOA,
      profile,
      processor
    );
    initialEffectiveRecoilMoaForFirstShot = thresholdRegularAimMoa;
  } else if (
    profile.aimingStrategy === AimingStrategy.SightDispersionInstantly
  ) {
    initialEffectiveRecoilMoaForFirstShot =
      gunProps.sight_dispersion || MAX_RECOIL_MOA;
    movesSpentAimingInitial = 0;
  }

  const movesPerAttackActivation = getMovesPerAttackActivation(
    gunProps.skill,
    profile,
    processor
  );
  let shotsPerActivation = 1;
  let modeUsed = "Semi-auto (assumed)";
  type GunModeTuple = [string, string, number, (string | string[])?];
  let chosenModeLogic: GunModeTuple | undefined = undefined;
  if (gunProps.modes && gunProps.modes.length > 0) {
    /* ... mode selection ... */
    const autoMode = gunProps.modes.find((m) => m[0] === "AUTO");
    const burstMode = gunProps.modes.find(
      (m) =>
        m[0] !== "AUTO" &&
        m[0] !== "DEFAULT" &&
        m[2] > 1 &&
        m[2] === gunProps.burst
    );
    const defaultMode = gunProps.modes.find((m) => m[0] === "DEFAULT");
    if (autoMode) chosenModeLogic = autoMode as GunModeTuple;
    else if (burstMode) chosenModeLogic = burstMode as GunModeTuple;
    else if (defaultMode) chosenModeLogic = defaultMode as GunModeTuple;
    else chosenModeLogic = gunProps.modes[0] as GunModeTuple;
  }
  if (chosenModeLogic) {
    const modeShotCount = chosenModeLogic[2];
    shotsPerActivation =
      modeShotCount > 1 && (gunProps.burst ?? 0) > 0
        ? Math.min(modeShotCount, gunProps.burst ?? 1)
        : modeShotCount > 0
        ? modeShotCount
        : 1;
    modeUsed = chosenModeLogic[1];
  } else if (gunProps.burst && gunProps.burst > 0) {
    shotsPerActivation = gunProps.burst;
    modeUsed = `Burst (${gunProps.burst})`;
  }

  const selectedAmmoObject = getFireableAmmoObjects(gunItem, processor).find(
    (ammo) => getLocalItemNameForLogic(ammo, processor) === dphInfo.ammoName
  );
  const ammoBaseDispersion = selectedAmmoObject?.dispersion || 0;
  const ammoRecoil = selectedAmmoObject?.recoil || 0;

  const inherentWeaponDispersionMoa = getInherentWeaponDispersionMoa(
    gunProps,
    selectedAmmoObject,
    profile,
    processor
  ); // <<<< FIXED: Pass selectedAmmoObject
  const recoilAbsorbFactor = getRecoilAbsorbFactor(profile);
  const gunRecoilQtyPerShot = getEffectiveGunRecoilQtyPerShot(
    gunProps,
    ammoRecoil,
    profile,
    processor
  ); // <<<< FIXED: Pass processor
  const increaseInRecoilMoaPerShot = getIncreaseInRecoilMoaPerShot(
    gunRecoilQtyPerShot,
    recoilAbsorbFactor
  );

  const targetSizeMeters = 0.5;
  const targetRangeTiles = 10;
  const targetAngularSizeMoa =
    Math.atan(targetSizeMeters / (targetRangeTiles * METERS_PER_TILE)) *
    (180.0 / Math.PI) *
    60.0;
  const accuracyConstants = {
    crit: ACCURACY_CRITICAL_FACTOR,
    standard: ACCURACY_STANDARD_FACTOR,
    graze: ACCURACY_GRAZING_FACTOR,
  };

  let magCapacityUsed: number | null = gunProps.clip_size || null;
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    /* ... mag capacity lookup ... */
    const compatibleMagIds = new Set<string>();
    if (gunProps.default_mods) {
      for (const modId of gunProps.default_mods) {
        const modItem = processor.byIdMaybe("item", modId);
        if (modItem && isItemSubtype("GUNMOD", modItem))
          getMagazineIdsFromGunMod(modItem).forEach((id) =>
            compatibleMagIds.add(id)
          );
      }
    }
    getMagazineIdsFromItemPockets(gunItem).forEach((id) =>
      compatibleMagIds.add(id)
    );
    if (compatibleMagIds.size > 0) {
      const firstMagId = Array.from(compatibleMagIds).sort()[0];
      if (firstMagId && dphInfo.ammoName) {
        const magItem = processor.byIdMaybe("item", firstMagId) as
          | Item
          | undefined;
        if (magItem && magItem.pocket_data) {
          const ammoItemForDph = getFireableAmmoObjects(
            gunItem,
            processor
          ).find(
            (itm) =>
              getLocalItemNameForLogic(itm, processor) === dphInfo.ammoName
          );
          const ammoTypeForDph = ammoItemForDph?.ammo_type;
          if (ammoTypeForDph) {
            for (const pocket of magItem.pocket_data) {
              if (
                pocket.pocket_type === "MAGAZINE" &&
                pocket.ammo_restriction &&
                pocket.ammo_restriction[ammoTypeForDph]
              ) {
                magCapacityUsed = pocket.ammo_restriction[ammoTypeForDph];
                break;
              }
            }
          }
        }
      }
    }
  }

  // <<<< FIXED: Use dphInfo.damage
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    return {
      ...dphInfo,
      dphBase: dphInfo.damage,
      shotsPerActivationInMode: shotsPerActivation,
      movesPerActivationInMode: movesPerAttackActivation,
      magCapacityUsed: null,
      modeUsed: modeUsed,
      rawSustainedDps: null,
    };
  }

  let totalExpectedDamagePerMagCycle = 0;
  let currentRecoilLevelMoa = initialEffectiveRecoilMoaForFirstShot;
  const pelletCount = dphInfo.pelletCount || 1;

  for (let i = 0; i < magCapacityUsed; i++) {
    if (i > 0) {
      currentRecoilLevelMoa = Math.min(
        MAX_RECOIL_MOA,
        currentRecoilLevelMoa + increaseInRecoilMoaPerShot
      );
    }
    const effectiveDispersionThisShotMoa =
      inherentWeaponDispersionMoa + currentRecoilLevelMoa;

    let expectedDamageThisActivation = 0;
    for (let p = 0; p < pelletCount; p++) {
      const probs = getHitProbabilities(
        effectiveDispersionThisShotMoa,
        targetAngularSizeMoa,
        accuracyConstants
      );
      const expectedDamageThisPellet =
        probs.P_Crit * dphInfo.damage * dphInfo.ammoCritMultiplier +
        probs.P_Hit * dphInfo.damage +
        probs.P_Graze * dphInfo.damage * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
      expectedDamageThisActivation += expectedDamageThisPellet;
    }
    totalExpectedDamagePerMagCycle += expectedDamageThisActivation;
  }

  const activationsToEmptyMag = Math.ceil(magCapacityUsed / shotsPerActivation);
  const movesToFireMag = activationsToEmptyMag * movesPerAttackActivation;
  const movesToReload = gunProps.reload || 100;
  const totalMovesPerCycle =
    movesSpentAimingInitial + movesToFireMag + movesToReload;
  const rawSustainedDps =
    totalMovesPerCycle > 0
      ? totalExpectedDamagePerMagCycle /
        (totalMovesPerCycle / PLAYER_SPEED_MOVES_PER_SECOND)
      : dphInfo.damage > 0
      ? Infinity
      : 0;

  return {
    ...dphInfo,
    dphBase: dphInfo.damage,
    shotsPerActivationInMode: shotsPerActivation,
    movesPerActivationInMode: movesPerAttackActivation,
    magCapacityUsed: magCapacityUsed,
    modeUsed: modeUsed,
    rawSustainedDps: rawSustainedDps,
  };
}
