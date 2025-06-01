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
  ModValProperty,
  AmmoEffectEntry,
  DamageInstance,
} from "./types";
import { isItemSubtype } from "./types";
import { normalizeDamageInstance, CddaData, singularName } from "./data";
import { parseLengthToMm } from "./formatters";

// --- Interfaces & Constants ---
// Constants
const MAX_SKILL = 10;
const MAX_RECOIL_MOA = 5000;
const METERS_PER_TILE = 1.0;
const ACCURACY_CRITICAL_FACTOR = 0.1;
const ACCURACY_STANDARD_FACTOR = 0.4;
const ACCURACY_GRAZING_FACTOR = 0.7;
const GRAZE_DAMAGE_MULTIPLIER_DEFAULT = 0.33;
const PLAYER_SPEED_MOVES_PER_SECOND = 100;
const WEAPON_DISPERSION_CONSTANT_FIREARM = 300;
const MOVES_PER_GAME_SECOND = 100;
const AMMO_EFFECT_RECHARGE_RATE_KJ_PER_TURN = 0.2;

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

const STANDARD_RANGES_TILES = [1, 5, 10, 15, 20, 30];
export const DEFAULT_REFERENCE_RANGE_TILES = 10; // Export if needed by formatters
const STANDARD_UPS_CAPACITY_KJ = 500;
const STANDARD_UPS_SWAP_MOVES = 150;

// Interfaces
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

interface ClassifiedAmmoItem {
  item: Item & AmmoSlot;
  isDefaultForAmmoType: boolean;
  isStandardHeuristic: boolean;
  baseDamageAmount: number;
  pelletCount: number;
}

export interface FiringModeDetail {
  id: string;
  name: string;
  shotsPerActivation: number;
  recoilMultiplierFromMode: number;
  hasAccurateShot: boolean;
}

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

export interface RepresentativeCombatInfo {
  ammoName: string | null;
  dphBase: number;
  damageType: string;
  ap: number;
  barrelMatchInfo?: string;
  ammoCritMultiplier: number;
  pelletCount?: number;

  availableFiringModes: FiringModeDetail[]; // ADDED
  modePerformances: ModePerformance[];

  referenceSustainedDps: number | null;
  referenceModeName: string | null;
  referenceRangeTiles: number | null;

  isRechargeableGun: boolean;
  rechargeableStats?: RechargeableStats;
  isModularVaries?: boolean;
  isNonConventional?: boolean;
  nonConventionalType?: GunClassification["weaponSubType"];
}

// --- Low-Level Helpers ---
// ... (getLocalItemNameForLogic, getSummedModProperty, getMultiplicativeModRecoilFactor remain the same) ...
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

function getSummedModProperty(
  gunItem: Item & GunSlot,
  processor: CddaData,
  propertyName: "dispersion_modifier" | "handling_modifier",
  modValueKey?: keyof ModValProperty
): number {
  let sum = 0;
  if (gunItem.default_mods) {
    for (const modId of gunItem.default_mods) {
      const modItem = processor.byIdMaybe("item", modId) as Item | undefined;
      if (modItem && isItemSubtype("GUNMOD", modItem)) {
        const gunModProps = modItem as Item & {
          mod_values?: ModValProperty;
          dispersion_modifier?: number;
          handling_modifier?: number;
        };
        if (
          modValueKey &&
          gunModProps.mod_values &&
          typeof gunModProps.mod_values[modValueKey] === "number"
        ) {
          sum += gunModProps.mod_values[modValueKey] as number;
        } else if (
          !modValueKey &&
          propertyName in gunModProps &&
          typeof (gunModProps as any)[propertyName] === "number"
        ) {
          sum += (gunModProps as any)[propertyName] as number;
        }
      }
    }
  }
  return sum;
}

function getMultiplicativeModRecoilFactor(
  gunItem: Item & GunSlot,
  processor: CddaData
): number {
  let totalFactor = 1.0;
  if (gunItem.default_mods) {
    for (const modId of gunItem.default_mods) {
      const modItem = processor.byIdMaybe("item", modId) as Item | undefined;
      if (modItem && isItemSubtype("GUNMOD", modItem)) {
        const gunModProps = modItem as Item & { mod_values?: ModValProperty };
        if (
          gunModProps.mod_values &&
          typeof gunModProps.mod_values.recoil === "number"
        ) {
          totalFactor *= 1 + gunModProps.mod_values.recoil / 100;
        }
      }
    }
  }
  return totalFactor;
}

// --- Ammo & Magazine Pocket Logic ---
// ... (getAmmoTypesFromMagazinePockets, getMagazineIdsFromItemPockets, getAmmoTypesFromGunMod, getMagazineIdsFromGunMod remain the same) ...
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
// --- Gun Property Derivation ---
// ... (getGunChamberings, getEffectiveBarrelLengthMm remain the same) ...
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
// --- Firing Mode Details ---
export function getFiringModeDetails(
  gun: Item & GunSlot,
  processor: CddaData
): FiringModeDetail[] {
  // Exported
  const modes: FiringModeDetail[] = [];
  type GunModeTuple = [string, string, number, string[]?];

  if (gun.modes && gun.modes.length > 0) {
    gun.modes.forEach((modeTupleInput) => {
      const modeTuple = modeTupleInput as GunModeTuple;
      let recoilMultiplier = 1.0;
      let hasAccurateShot = false;
      if (modeTuple[3] && Array.isArray(modeTuple[3])) {
        modeTuple[3].forEach((flag) => {
          if (typeof flag === "string") {
            if (flag.startsWith("RECOIL_MOD ")) {
              const percentage = parseInt(
                flag.substring("RECOIL_MOD ".length),
                10
              );
              if (!isNaN(percentage)) {
                recoilMultiplier = percentage / 100;
              }
            } else if (flag === "ACCURATE_SHOT") {
              hasAccurateShot = true;
            }
          }
        });
      }
      modes.push({
        id: modeTuple[0],
        name: modeTuple[1],
        shotsPerActivation: modeTuple[2] > 0 ? modeTuple[2] : 1,
        recoilMultiplierFromMode: recoilMultiplier,
        hasAccurateShot: hasAccurateShot,
      });
    });
  }

  if (modes.length === 0) {
    modes.push({
      id: "DEFAULT",
      name: gun.burst && gun.burst > 1 ? `Burst (${gun.burst})` : "Semi-auto",
      shotsPerActivation: gun.burst && gun.burst > 0 ? gun.burst : 1,
      recoilMultiplierFromMode: 1.0,
      hasAccurateShot: false,
    });
  }
  return modes;
}

// --- Damage & Ammo Logic ---
// ... (getAdjustedAmmoDamage, getFireableAmmoObjects, classifyAndSelectStandardAmmo, getRepresentativeDPHInfo remain the same) ...
export function getAdjustedAmmoDamage(
  ammoItem: Item & AmmoSlot,
  effectiveBarrelLengthMm: number | null,
  processor: CddaData
): PotentialDamageInfo | null {
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
    const ammoName = (
      getLocalItemNameForLogic(ammo, processor) || ""
    ).toLowerCase();
    const gunFlags = (gunItem as ItemBasicInfo).flags || [];
    if (gunFlags.includes("NEVER_JAMS") && gunFlags.includes("NO_AMMO"))
      return false;
    if (
      ammoName === "ups charge" ||
      ammoName === "ups compatible" ||
      ammoName === "bionic power"
    )
      return false;
    return true;
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
// --- Combat Mechanics (Parameterized by CombatProfile) ---
// ... (getMovesPerAttackActivation, dispersion_from_skill, getInherentWeaponDispersionMoa, getRecoilAbsorbFactor, getEffectiveGunRecoilQtyPerShot, getIncreaseInRecoilMoaPerShot, getHitProbabilities, estimateMovesToReachRecoil remain the same) ...
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
  const skillPenaltyDispersion = dispersion_from_skill(
    avgCombatSkill,
    WEAPON_DISPERSION_CONSTANT_FIREARM
  );
  let shotSpread = 0;
  if (ammoItem && isItemSubtype("AMMO", ammoItem as Item)) {
    const ammoAsSlot = ammoItem as Item & AmmoSlot;
    if (ammoAsSlot.ammo_type === "shot" || ammoAsSlot.ammo_type === "bolt") {
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

export function getEffectiveGunRecoilQtyPerShot(
  gunItem: Item & GunSlot,
  ammoRecoilValue: number,
  profile: BaseCharacterProfile,
  processor: CddaData,
  activeDefaultModHandlingBonus: number,
  activeDefaultModRecoilFactor: number
): number {
  let currentRecoil = ammoRecoilValue;
  const effectiveHandling =
    (gunItem.handling || 0) + activeDefaultModHandlingBonus;
  currentRecoil = Math.max(0, currentRecoil - effectiveHandling * 20);
  currentRecoil *= activeDefaultModRecoilFactor;
  const strReduction = profile.strength * 10;
  currentRecoil = Math.max(0, currentRecoil - strReduction);
  const gunFlags = (gunItem as ItemBasicInfo).flags || [];
  const hasBipodOnGun = gunFlags.includes("BIPOD");
  let hasBipodOnMod = false;
  if (gunItem.default_mods) {
    hasBipodOnMod = gunItem.default_mods.some((modId) => {
      const mod = processor.byIdMaybe("item", modId);
      return mod && (mod as ItemBasicInfo).flags?.includes("BIPOD");
    });
  }
  if (hasBipodOnGun || hasBipodOnMod) {
    currentRecoil *= 0.25;
  }
  return Math.max(0, currentRecoil);
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

function estimateMovesToReachRecoil(
  gunItem: Item & GunSlot,
  targetRecoilMoa: number,
  startRecoilMoa: number,
  profile: BaseCharacterProfile,
  hasAccurateShotMode: boolean
): number {
  if (startRecoilMoa <= targetRecoilMoa) return 0;

  const sightDispersion = gunItem.sight_dispersion || 300;
  const baseAimRate = 300 - Math.min(sightDispersion, 280);
  const perBonus = (profile.perception - 8) * 10;
  const skillBonus =
    ((profile.weaponSkillLevel + profile.marksmanshipLevel) / 2) * 5;
  let simplifiedAimPerMovePer10Moves = baseAimRate / 10 + perBonus + skillBonus;
  let simplifiedAimPerMove = Math.max(5, simplifiedAimPerMovePer10Moves / 10);

  if (hasAccurateShotMode) {
    simplifiedAimPerMove *= 1.2;
  }
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
// --- Main Calculation Orchestrator ---
export function getRepresentativeCombatInfo(
  gunItem: Item,
  processor: CddaData,
  profile: CombatProfile,
  classification: GunClassification
): RepresentativeCombatInfo | null {
  if (!isItemSubtype("GUN", gunItem)) return null;
  const gunProps = gunItem as Item & GunSlot;
  const basicGunProps = gunItem as ItemBasicInfo;

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

  const dphInfo = getRepresentativeDPHInfo(gunItem, processor);
  const firingModes = getFiringModeDetails(gunProps, processor); // Get this early

  let isRechargeable = false;
  let rechargeableData: RechargeableStats | undefined = undefined;
  let effectiveMagCapacityOverride: number | null = null;
  let effectiveReloadTimeOverride: number | null = null;
  let energySourceForRechargeable: string = "Internal Battery";

  const hasInternalRechargeEffect = gunProps.ammo_effects?.some(
    (ae: AmmoEffectEntry) => ae.id === "RECHARGE_INTERNAL_BATTERY"
  );

  if (hasInternalRechargeEffect) {
    isRechargeable = true;
    energySourceForRechargeable = "Internal Battery";

    const ammoCapacityKj =
      gunProps.magazine_well_data?.[0]?.capacity ||
      (gunProps.pocket_data?.[0]?.ammo_restriction && gunProps.ammo
        ? (gunProps.pocket_data[0].ammo_restriction as any)[
            Array.isArray(gunProps.ammo)
              ? gunProps.ammo[0]
              : (gunProps.ammo as string)
          ]?.[0]
        : 0) ||
      0;

    const effectEntry = gunProps.ammo_effects?.find(
      (ae: AmmoEffectEntry) => ae.id === "RECHARGE_INTERNAL_BATTERY"
    );
    const energyCostPerShot =
      gunProps.charges_per_shot ||
      gunProps.energy_per_shot ||
      effectEntry?.energy_cost ||
      1;
    const rechargeRateKjPerTurn = AMMO_EFFECT_RECHARGE_RATE_KJ_PER_TURN;

    if (
      ammoCapacityKj > 0 &&
      energyCostPerShot > 0 &&
      dphInfo &&
      dphInfo.damage > 0
    ) {
      const shots = Math.floor(ammoCapacityKj / energyCostPerShot);
      rechargeableData = {
        shotsPerFullCharge: shots,
        damagePerFullCharge:
          shots * dphInfo.damage * (dphInfo.pelletCount || 1),
        timeToFullRechargeSeconds:
          rechargeRateKjPerTurn > 0
            ? Math.ceil(
                ammoCapacityKj / (rechargeRateKjPerTurn * MOVES_PER_GAME_SECOND)
              )
            : Infinity,
        energySource: energySourceForRechargeable,
      };
    }
  } else if (basicGunProps.flags?.includes("USE_PLAYER_CHARGE")) {
    isRechargeable = true;
    energySourceForRechargeable = "Bionic Power";
  }

  if (isRechargeable) {
    return {
      ammoName: dphInfo?.ammoName || energySourceForRechargeable,
      dphBase: dphInfo?.damage || 0,
      damageType: dphInfo?.damageType || "N/A",
      ap: dphInfo?.ap || 0,
      barrelMatchInfo: dphInfo?.barrelMatchInfo,
      ammoCritMultiplier: dphInfo?.ammoCritMultiplier || 1.0,
      pelletCount: dphInfo?.pelletCount || 1,
      availableFiringModes: firingModes, // ADDED
      modePerformances: [],
      referenceSustainedDps: null,
      referenceModeName: null,
      referenceRangeTiles: null,
      isRechargeableGun: true,
      rechargeableStats: rechargeableData,
      isModularVaries: false,
      isNonConventional: true,
      nonConventionalType: classification.weaponSubType,
    };
  }

  if (gunProps.ups_charges || basicGunProps.flags?.includes("USE_UPS")) {
    const energyCost = gunProps.ups_charges || gunProps.energy_per_shot || 1;
    if (energyCost > 0) {
      effectiveMagCapacityOverride = Math.floor(
        STANDARD_UPS_CAPACITY_KJ / energyCost
      );
      effectiveReloadTimeOverride = STANDARD_UPS_SWAP_MOVES;
    }
    if (!dphInfo && classification.weaponSubType === "energy") {
      let gunDmgNormalized: DamageUnit[] = [];
      if (gunProps.ranged_damage) {
        gunDmgNormalized = normalizeDamageInstance(gunProps.ranged_damage);
      }
      let baseDmg = 0,
        ap = 0,
        dmgType = "energy";
      if (gunDmgNormalized.length > 0) {
        baseDmg = gunDmgNormalized[0].amount || 0;
        ap = gunDmgNormalized[0].armor_penetration || 0;
        dmgType =
          getLocalItemNameForLogic(
            gunDmgNormalized[0].damage_type,
            processor
          ) || gunDmgNormalized[0].damage_type;
      }
      return {
        ammoName: "UPS Charge",
        dphBase: baseDmg,
        damageType: dmgType,
        ap: ap,
        ammoCritMultiplier: 1.0,
        pelletCount: 1,
        availableFiringModes: firingModes, // ADDED
        modePerformances: [],
        referenceSustainedDps: null,
        referenceModeName: null,
        referenceRangeTiles: null,
        isRechargeableGun: false,
        isNonConventional: true,
        nonConventionalType: "energy",
        isModularVaries: false,
      };
    }
  }

  const chamberings = getGunChamberings(gunItem, processor);
  if (
    chamberings.size === 0 &&
    (!gunProps.ammo ||
      gunProps.ammo[0] === "NULL" ||
      gunProps.ammo.length === 0) &&
    !effectiveMagCapacityOverride
  ) {
    return {
      ammoName: "Varies (Modular)",
      dphBase: 0,
      damageType: "N/A",
      ap: 0,
      ammoCritMultiplier: 1,
      pelletCount: 1,
      availableFiringModes: firingModes, // ADDED
      modePerformances: [],
      referenceSustainedDps: null,
      referenceModeName: null,
      referenceRangeTiles: null,
      isRechargeableGun: false,
      isModularVaries: true,
    };
  }
  if (!dphInfo || dphInfo.damage <= 0) {
    if (classification.isNonTraditional) {
      return {
        ammoName:
          classification.weaponSubType === "archery" ? "Arrow/Bolt" : "Special",
        dphBase: 0,
        damageType: "N/A",
        ap: 0,
        ammoCritMultiplier: 1,
        pelletCount: 1,
        availableFiringModes: firingModes, // ADDED
        modePerformances: [],
        referenceSustainedDps: null,
        referenceModeName: null,
        referenceRangeTiles: null,
        isRechargeableGun: false,
        isNonConventional: true,
        nonConventionalType: classification.weaponSubType,
        isModularVaries: false,
      };
    }
    return null;
  }

  const allModePerformances: ModePerformance[] = [];

  for (const mode of firingModes) {
    // firingModes already fetched
    const dpsAtEachRangeForThisMode: DpsAtRange[] = [];
    const movesPerAttackActivation = getMovesPerAttackActivation(
      gunProps.skill,
      profile,
      processor
    );
    const shotsPerActivationInMode = mode.shotsPerActivation;

    let movesSpentAimingInitial = 0;
    let initialEffectiveRecoilMoaForFirstShot =
      gunProps.sight_dispersion || MAX_RECOIL_MOA;
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
        mode.hasAccurateShot
      );
      initialEffectiveRecoilMoaForFirstShot = thresholdRegularAimMoa;
    }

    let magCapacityUsed: number | null =
      effectiveMagCapacityOverride ?? gunProps.clip_size ?? null;
    if (magCapacityUsed === null || magCapacityUsed <= 0) {
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
        const magItem = processor.byIdMaybe("item", firstMagId) as
          | Item
          | undefined;
        if (magItem && magItem.pocket_data && dphInfo.ammoName) {
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
                (pocket.ammo_restriction as any)[ammoTypeForDph]
              ) {
                magCapacityUsed = (pocket.ammo_restriction as any)[
                  ammoTypeForDph
                ];
                break;
              }
            }
          }
        }
      }
    }
    if (magCapacityUsed === null || magCapacityUsed <= 0) {
      dpsAtEachRangeForThisMode.push(
        ...STANDARD_RANGES_TILES.map((r) => ({
          rangeTiles: r,
          sustainedDps: null,
        }))
      );
      allModePerformances.push({
        modeDetails: mode,
        dpsAtRanges: dpsAtEachRangeForThisMode,
      });
      continue;
    }

    const selectedAmmoObject = getFireableAmmoObjects(gunItem, processor).find(
      (ammo) => getLocalItemNameForLogic(ammo, processor) === dphInfo.ammoName
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
      getIncreaseInRecoilMoaPerShot(
        gunRecoilQtyPerShotBase,
        recoilAbsorbFactor
      ) * mode.recoilMultiplierFromMode;

    const accuracyConstants = {
      crit: ACCURACY_CRITICAL_FACTOR,
      standard: ACCURACY_STANDARD_FACTOR,
      graze: ACCURACY_GRAZING_FACTOR,
    };
    const targetSizeMeters = 0.5;

    for (const range of STANDARD_RANGES_TILES) {
      const targetAngularSizeMoa =
        range > 0
          ? Math.atan(targetSizeMeters / (range * METERS_PER_TILE)) *
            (180.0 / Math.PI) *
            60.0
          : MAX_RECOIL_MOA * 2;
      let totalExpectedDamagePerMagCycle = 0;
      let currentRecoilLevelMoa = initialEffectiveRecoilMoaForFirstShot;
      const pelletCount = dphInfo.pelletCount || 1;

      for (let i = 0; i < magCapacityUsed; i++) {
        if (i > 0) {
          currentRecoilLevelMoa = Math.min(
            MAX_RECOIL_MOA,
            currentRecoilLevelMoa + increaseInRecoilMoaPerShotForThisMode
          );
        }
        const effectiveDispersionThisShotMoa =
          inherentWeaponDispersionMoa + currentRecoilLevelMoa;
        let expectedDamageThisShot = 0;
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
          expectedDamageThisShot += expectedDamageThisPellet;
        }
        totalExpectedDamagePerMagCycle += expectedDamageThisShot;
      }

      const activationsToEmptyMag = Math.ceil(
        magCapacityUsed / shotsPerActivationInMode
      );
      const movesToFireMag = activationsToEmptyMag * movesPerAttackActivation;
      const movesToReload =
        effectiveReloadTimeOverride ?? gunProps.reload ?? 100;
      const totalMovesPerCycle =
        movesSpentAimingInitial + movesToFireMag + movesToReload;
      const rawSustainedDps =
        totalMovesPerCycle > 0
          ? totalExpectedDamagePerMagCycle /
            (totalMovesPerCycle / PLAYER_SPEED_MOVES_PER_SECOND)
          : dphInfo.damage > 0
          ? Infinity
          : 0;
      dpsAtEachRangeForThisMode.push({
        rangeTiles: range,
        sustainedDps: rawSustainedDps,
      });
    }
    allModePerformances.push({
      modeDetails: mode,
      dpsAtRanges: dpsAtEachRangeForThisMode,
    });
  }

  let refSustainedDps: number | null = null;
  let refModeName: string | null = null;
  let refRangeTiles: number | null = null;

  for (const perf of allModePerformances) {
    const dpsAtRefRange = perf.dpsAtRanges.find(
      (r) => r.rangeTiles === DEFAULT_REFERENCE_RANGE_TILES
    )?.sustainedDps;
    if (dpsAtRefRange !== null && dpsAtRefRange !== undefined) {
      if (refSustainedDps === null || dpsAtRefRange > refSustainedDps) {
        refSustainedDps = dpsAtRefRange;
        refModeName = perf.modeDetails.name;
        refRangeTiles = DEFAULT_REFERENCE_RANGE_TILES;
      }
    }
  }
  if (refSustainedDps === null) {
    for (const perf of allModePerformances) {
      for (const rangeDps of perf.dpsAtRanges) {
        if (
          rangeDps.sustainedDps !== null &&
          rangeDps.sustainedDps !== undefined
        ) {
          if (
            refSustainedDps === null ||
            rangeDps.sustainedDps > refSustainedDps
          ) {
            refSustainedDps = rangeDps.sustainedDps;
            refModeName = perf.modeDetails.name;
            refRangeTiles = rangeDps.rangeTiles;
          }
        }
      }
    }
  }

  return {
    ammoName: dphInfo.ammoName,
    dphBase: dphInfo.damage,
    damageType: dphInfo.damageType,
    ap: dphInfo.ap,
    barrelMatchInfo: dphInfo.barrelMatchInfo,
    ammoCritMultiplier: dphInfo.ammoCritMultiplier,
    pelletCount: dphInfo.pelletCount,
    availableFiringModes: firingModes, // ADDED
    modePerformances: allModePerformances,
    referenceSustainedDps: refSustainedDps,
    referenceModeName: refModeName,
    referenceRangeTiles: refRangeTiles,
    isRechargeableGun: false,
    isModularVaries: false,
    isNonConventional: classification.isNonTraditional,
    nonConventionalType: classification.weaponSubType,
  };
}
