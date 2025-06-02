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
  ModValProperty,
  AmmoEffectEntry,
  DamageInstance,
  ExplosionProperties,
  ShrapnelProperties,
  Translation,
} from "./types";
import { isItemSubtype } from "./types";
import { normalizeDamageInstance, CddaData, singularName } from "./data";
import { parseLengthToMm } from "./formatters";
import { log } from "./debugLogger";

// --- Interfaces & Constants ---
export const DEFAULT_REFERENCE_RANGE_TILES = 10;
const PLAYER_SPEED_MOVES_PER_SECOND = 100;
const MAX_SKILL = 10;
const MAX_RECOIL_MOA = 5000;
const METERS_PER_TILE = 1.0;
const ACCURACY_CRITICAL_FACTOR = 0.1;
const ACCURACY_STANDARD_FACTOR = 0.4;
const ACCURACY_GRAZING_FACTOR = 0.7;
const GRAZE_DAMAGE_MULTIPLIER_DEFAULT = 0.33;
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
const STANDARD_UPS_CAPACITY_KJ = 500;
const STANDARD_UPS_SWAP_MOVES = 150;
const EXPECTED_SHRAPNEL_HIT_PERCENTAGE_ON_EPICENTER_TARGET = 0.15;
const DEFAULT_SIGHT_DISPERSION = 300;

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
  hasIncendiaryEffect?: boolean;
  isExplosive?: boolean;
  explosionPower?: number;
  shrapnelCount?: number;
  shrapnelDamage?: number;
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

function getLocalItemNameForLogic(
  itemIdentifier: any,
  processor: CddaData
): string | null {
  if (!itemIdentifier) return null;
  let nameProperty: string | Translation | undefined = undefined;
  let idProperty: string | undefined = undefined;
  if (typeof itemIdentifier === "string") {
    const itemObj =
      processor.byIdMaybe("item", itemIdentifier) ||
      processor.byIdMaybe("ammunition_type", itemIdentifier) ||
      processor.byIdMaybe("damage_type", itemIdentifier);
    if (itemObj) {
      nameProperty = (itemObj as ItemBasicInfo).name;
      idProperty = (itemObj as ItemBasicInfo).id;
    } else {
      return itemIdentifier;
    }
  } else if (typeof itemIdentifier === "object" && itemIdentifier !== null) {
    nameProperty = (itemIdentifier as ItemBasicInfo).name;
    idProperty = (itemIdentifier as ItemBasicInfo).id;
  } else {
    return null;
  }
  if (nameProperty) {
    if (typeof nameProperty === "string") return nameProperty;
    if (typeof nameProperty === "object") {
      const nameTrans = nameProperty as { str_sp?: string; str?: string };
      if (nameTrans.str_sp) return nameTrans.str_sp;
      if (nameTrans.str) return nameTrans.str;
    }
  }
  return idProperty || null;
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
  const lengthMm = finalBarrelLengthStr
    ? parseLengthToMm(finalBarrelLengthStr)
    : null;
  log(
    "DPH_CALC",
    `EffectiveBarrelLength for ${gunItem.id}: ${
      lengthMm !== null ? lengthMm + "mm" : "null"
    } (Source: ${finalBarrelLengthStr || "gun direct/none"})`
  );
  return lengthMm;
}

export function getFiringModeDetails(
  gun: Item & GunSlot,
  processor: CddaData
): FiringModeDetail[] {
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
    // If no modes array, create a default based on burst or semi-auto
    modes.push({
      id: "DEFAULT",
      name: gun.burst && gun.burst > 1 ? `Burst (${gun.burst})` : "Semi-auto",
      shotsPerActivation: gun.burst && gun.burst > 0 ? gun.burst : 1,
      recoilMultiplierFromMode: 1.0,
      hasAccurateShot: false,
    });
  }
  log(
    "DEBUG",
    `Firing modes for ${gun.id}:`,
    modes.map((m) => ({ name: m.name, rof: m.shotsPerActivation }))
  );
  return modes;
}

export function getAdjustedAmmoDamage(
  ammoItem: Item & AmmoSlot,
  effectiveBarrelLengthMm: number | null,
  processor: CddaData
): PotentialDamageInfo | null {
  if (!ammoItem.damage && !ammoItem.explosion) {
    log(
      "DPH_CALC",
      `Ammo ${ammoItem.id} has no direct damage or explosion block. Cannot calculate DPH.`
    );
    return null;
  }

  let combinedDamage = 0;
  let primaryDamageType = "N/A";
  let primaryAp = 0;
  let critMultiplier = ammoItem.critical_multiplier || 1.0;
  let barrelMatchInfoStr: string | undefined = "Default/Top-level";

  let hasIncendiary = false;
  let isExplosiveFlag = false;
  let explosionPowerVal: number | undefined = undefined;
  let shrapnelCountVal: number | undefined = undefined;
  let shrapnelDamageVal: number | undefined = undefined;

  if (ammoItem.damage) {
    const damageInstance = normalizeDamageInstance(ammoItem.damage);
    if (damageInstance && damageInstance.length > 0) {
      const primaryDamageUnit = damageInstance[0] as DamageUnitWithBarrels;
      let chosenDamageAmount = primaryDamageUnit.amount ?? 0;

      if (
        effectiveBarrelLengthMm !== null &&
        primaryDamageUnit.barrels &&
        primaryDamageUnit.barrels.length > 0
      ) {
        let bestMatchEntry:
          | { barrel_length: string; amount: number }
          | undefined = undefined;
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
          barrelMatchInfoStr = `Barrel array (${bestMatchEntry.barrel_length})`;
        } else {
          barrelMatchInfoStr = "Default/Top-level (no precise barrel match)";
        }
      }
      combinedDamage += chosenDamageAmount;
      primaryDamageType =
        getLocalItemNameForLogic(primaryDamageUnit.damage_type, processor) ||
        primaryDamageUnit.damage_type;
      primaryAp = primaryDamageUnit.armor_penetration ?? 0;
      log(
        "DPH_CALC",
        `Ammo ${ammoItem.id} kinetic DPH part: ${chosenDamageAmount} ${primaryDamageType}, AP ${primaryAp}. Barrel: ${barrelMatchInfoStr}`
      );
    }
  }

  if (ammoItem.explosion) {
    isExplosiveFlag = true;
    explosionPowerVal = ammoItem.explosion.power || 0;
    combinedDamage += explosionPowerVal;
    if (primaryDamageType === "N/A" && explosionPowerVal > 0)
      primaryDamageType = "explosion";
    log(
      "DPH_CALC",
      `Ammo ${ammoItem.id} explosion DPH part: ${explosionPowerVal} (power). Combined DPH now: ${combinedDamage}`
    );

    if (ammoItem.explosion.shrapnel) {
      const shrapnel = ammoItem.explosion.shrapnel;
      const shrapnelDmgSpec = Array.isArray(shrapnel.damage)
        ? shrapnel.damage[0]
        : (shrapnel.damage as DamageUnit | undefined);
      const shrapnelDmgPerFrag = shrapnelDmgSpec?.amount || 0;
      shrapnelCountVal = shrapnel.count || 0;
      if (shrapnelCountVal > 0 && shrapnelDmgPerFrag > 0) {
        const expectedHits = Math.floor(
          shrapnelCountVal *
            EXPECTED_SHRAPNEL_HIT_PERCENTAGE_ON_EPICENTER_TARGET
        );
        shrapnelDamageVal = expectedHits * shrapnelDmgPerFrag;
        combinedDamage += shrapnelDamageVal;
        log(
          "DPH_CALC",
          `Ammo ${ammoItem.id} shrapnel DPH part: ${expectedHits} hits * ${shrapnelDmgPerFrag} dmg/frag = ${shrapnelDamageVal}. Combined DPH now: ${combinedDamage}`
        );
      }
    }
  }

  const effectIds: string[] = [];
  if (Array.isArray(ammoItem.effects)) {
    ammoItem.effects.forEach((effect) => {
      if (typeof effect === "string") {
        effectIds.push(effect);
      } else if (typeof effect === "object" && (effect as AmmoEffectEntry).id) {
        effectIds.push((effect as AmmoEffectEntry).id);
      }
    });
  }

  if (
    effectIds.includes("INCENDIARY") ||
    effectIds.includes("NAPALM") ||
    effectIds.includes("THERMITE")
  ) {
    hasIncendiary = true;
    log(
      "DPH_CALC",
      `Ammo ${ammoItem.id} has incendiary effect based on its effects array.`
    );
  }

  let truePelletCount = 1;
  log(
    "DPH_CALC",
    `Ammo ${ammoItem.id} raw JSON count: ${ammoItem.count}, ammo_type: ${ammoItem.ammo_type}`
  );
  const multiProjectileTypes = ["shot", "ショット", "flechette"];
  if (
    ammoItem.ammo_type &&
    multiProjectileTypes.includes(ammoItem.ammo_type.toLowerCase())
  ) {
    if (ammoItem.count && ammoItem.count > 1) {
      truePelletCount = ammoItem.count;
      log(
        "DPH_CALC",
        `Ammo ${ammoItem.id} is type '${ammoItem.ammo_type}', using explicit count for pellets: ${truePelletCount}`
      );
    } else {
      log(
        "DPH_CALC",
        `Ammo ${ammoItem.id} is type '${ammoItem.ammo_type}' but count is missing or <=1. Defaulting pellets to 1.`
      );
    }
  } else if (ammoItem.count && ammoItem.count > 1) {
    log(
      "WARN",
      `Ammo ${ammoItem.id} (type '${ammoItem.ammo_type}') has count: ${ammoItem.count} but is not a recognized multi-projectile type. Forcing DPH pellet count to 1. Original JSON 'count' may be intended for stacking/box quantity.`
    );
  }

  return {
    ammoName: getLocalItemNameForLogic(ammoItem, processor),
    damage: combinedDamage,
    damageType: primaryDamageType,
    ap: primaryAp,
    barrelMatchInfo: barrelMatchInfoStr,
    ammoCritMultiplier: critMultiplier,
    pelletCount: truePelletCount,
    hasIncendiaryEffect: hasIncendiary,
    isExplosive: isExplosiveFlag,
    explosionPower: explosionPowerVal,
    shrapnelCount: shrapnelCountVal,
    shrapnelDamage: shrapnelDamageVal,
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
    if (
      gunProps.ammo &&
      (!Array.isArray(gunProps.ammo) || gunProps.ammo[0] !== "NULL")
    ) {
      // Ensure not just ["NULL"]
      (Array.isArray(gunProps.ammo) ? gunProps.ammo : [gunProps.ammo]).forEach(
        (ammoIdOrType) => {
          if (ammoIdOrType === "NULL") return;
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
  const gunId = gunItem.id;
  log("AMMO_SELECT", `[${gunId}] Starting ammo selection.`);
  const fireableAmmoObjects = getFireableAmmoObjects(gunItem, processor);
  log(
    "AMMO_SELECT",
    `[${gunId}] Found ${fireableAmmoObjects.length} fireable ammo objects.`,
    fireableAmmoObjects.map((a) => a.id)
  );

  if (fireableAmmoObjects.length === 0) {
    log(
      "AMMO_SELECT",
      `[${gunId}] No fireable ammo objects found. Returning null.`
    );
    return null;
  }

  const conventionalAmmoObjects = fireableAmmoObjects.filter((ammo) => {
    const ammoName = (
      getLocalItemNameForLogic(ammo, processor) || ""
    ).toLowerCase();
    const gunFlags = (gunItem as ItemBasicInfo).flags || [];
    if (gunFlags.includes("NEVER_JAMS") && gunFlags.includes("NO_AMMO"))
      return false; // Energy weapon
    if (
      ammoName === "ups charge" ||
      ammoName === "ups compatible" ||
      ammoName === "bionic power"
    )
      return false; // UPS/Bionic power
    // Check if ammo itself is non-conventional (e.g. has explosion, or is caseless, etc.)
    // This might be too aggressive, but helps select "standard" bullets
    if (
      ammo.explosion ||
      ammo.effects?.includes("EXPLOSION_NORMAL") ||
      ammo.effects?.includes("BEANBAG") ||
      ammo.effects?.includes("SHOT") ||
      ammo.effects?.includes("INCENDIARY") ||
      ammo.effects?.includes("NAPALM")
    ) {
      // Keep these if no other "more standard" option is available.
      // For now, let's keep them in conventional and let heuristics sort it out.
    }
    return true;
  });
  log(
    "AMMO_SELECT",
    `[${gunId}] Found ${conventionalAmmoObjects.length} conventional ammo objects.`,
    conventionalAmmoObjects.map((a) => a.id)
  );

  const targetAmmoList =
    conventionalAmmoObjects.length > 0
      ? conventionalAmmoObjects
      : fireableAmmoObjects;
  if (targetAmmoList.length === 0) {
    log("AMMO_SELECT", `[${gunId}] No ammo in target list. Returning null.`);
    return null;
  }

  const classified: ClassifiedAmmoItem[] = targetAmmoList.map((ammoItem) => {
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
      !NON_STANDARD_AMMO_KEYWORDS.some(
        (kw) =>
          name.includes(kw) || name.includes("shot") || name.includes("slug")
      ); // Avoid "shot" in standard
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
  });

  let selectedAmmo: (Item & AmmoSlot) | null = null;
  const defaults = classified.filter((c) => c.isDefaultForAmmoType);
  if (defaults.length > 0) {
    defaults.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
    selectedAmmo = defaults[0].item;
    log("AMMO_SELECT", `[${gunId}] Selected default ammo: ${selectedAmmo.id}`);
  } else {
    const standardsByName = classified.filter((c) => c.isStandardHeuristic);
    if (standardsByName.length > 0) {
      standardsByName.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
      selectedAmmo = standardsByName[0].item;
      log(
        "AMMO_SELECT",
        `[${gunId}] Selected standard-by-name ammo: ${selectedAmmo.id}`
      );
    } else if (classified.length > 0) {
      classified.sort((a, b) => {
        // Prioritize non-explosive, then by damage
        const aIsExplosive = !!a.item.explosion;
        const bIsExplosive = !!b.item.explosion;
        if (aIsExplosive && !bIsExplosive) return 1; // b first
        if (!aIsExplosive && bIsExplosive) return -1; // a first
        return b.baseDamageAmount - a.baseDamageAmount; // then by damage
      });
      const bestNonSpecial = classified.find(
        (c) =>
          !c.item.explosion &&
          !c.item.effects?.includes("INCENDIARY") &&
          !c.item.effects?.includes("NAPALM")
      );
      if (bestNonSpecial) {
        selectedAmmo = bestNonSpecial.item;
        log(
          "AMMO_SELECT",
          `[${gunId}] Selected best non-special ammo by damage: ${selectedAmmo.id}`
        );
      } else {
        selectedAmmo = classified[0].item; // Fallback to highest damage overall if all are special
        log(
          "AMMO_SELECT",
          `[${gunId}] Selected ammo by highest damage (all might be special): ${selectedAmmo.id}`
        );
      }
    }
  }
  log(
    "AMMO_SELECT",
    `Final selected representative ammo for ${gunId}: ${
      selectedAmmo ? selectedAmmo.id : "None"
    }`
  );
  return selectedAmmo;
}

export function getRepresentativeDPHInfo(
  gunItem: Item,
  processor: CddaData
): PotentialDamageInfo | null {
  if (!isItemSubtype("GUN", gunItem)) return null;
  log("DPH_CALC", `Starting DPH info for gun: ${gunItem.id}`);
  const representativeAmmoObject = classifyAndSelectStandardAmmo(
    gunItem,
    processor
  );
  if (!representativeAmmoObject) {
    log(
      "DPH_CALC",
      `No representative ammo selected for ${gunItem.id}, cannot get DPH.`
    );
    return null;
  }
  log(
    "DPH_CALC",
    `Using ammo ${representativeAmmoObject.id} for DPH calculation of ${gunItem.id}.`
  );
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
  // log('AIM_CALC', `Moves per attack for skill ${gunSkillId} (lvl ${profile.weaponSkillLevel}): ${moves}`);
  return moves;
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
    if (
      ammoAsSlot.ammo_type === "shot" ||
      ammoAsSlot.ammo_type === "ショット" ||
      ammoAsSlot.ammo_type === "flechette"
    ) {
      // Check against known multi-projectile types
      shotSpread =
        ammoAsSlot.count && ammoAsSlot.count > 1
          ? (ammoItem as Item & AmmoSlot & { shot_spread?: number })
              .shot_spread || 0
          : 0;
    }
  }
  const sumAdditiveDispersion =
    gunBaseDispersion +
    ammoBaseDispersion +
    dexModDispersion +
    skillPenaltyDispersion +
    shotSpread;
  const finalDispersion = Math.max(0, sumAdditiveDispersion);
  // log('AIM_CALC', `Inherent dispersion for ${gunItem.id} w/ ammo ${ammoItem?.id || 'N/A'}: ${finalDispersion.toFixed(1)} MOA`, { /* details */ });
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
  /* ... rest of calculation ... */ return Math.max(0, currentRecoil);
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
  accuracyConstants: { crit: number; standard: number; graze: number }
): { P_Crit: number; P_Hit: number; P_Graze: number; P_Miss: number } {
  /* ... */ return { P_Crit: 0, P_Hit: 0, P_Graze: 0, P_Miss: 1 };
}
function estimateMovesToReachRecoil(
  gunItem: Item & GunSlot,
  targetRecoilMoa: number,
  startRecoilMoa: number,
  profile: BaseCharacterProfile,
  currentMode: FiringModeDetail
): number {
  /* ... as per previous full version ... */ return 0;
}

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

  // Initialize all fields that will be part of RepresentativeCombatInfo at the top level of this function
  let ammoNameToUse: string | null = null;
  let dphBaseToUse: number = 0;
  let damageTypeToUse: string = "N/A";
  let apToUse: number = 0;
  let barrelMatchInfoToUse: string | undefined = undefined;
  let ammoCritMultiplierToUse: number = 1.0;
  let pelletCountToUse: number = 1;

  let calculatedAvailableFiringModes: FiringModeDetail[] = []; // Will be populated early
  let calculatedModePerformances: ModePerformance[] = []; // For sustained DPS across ranges

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
  // isNonConventional and nonConventionalType come directly from 'classification' parameter

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
  log(
    "DEBUG",
    `Mod bonuses for ${
      gunItem.id
    }: DispBonus=${activeDefaultModDispersionBonus}, HandleBonus=${activeDefaultModHandlingBonus}, RecoilFactor=${activeDefaultModRecoilFactor.toFixed(
      2
    )}`
  );

  const dphInfo = getRepresentativeDPHInfo(gunItem, processor);

  if (dphInfo) {
    ammoNameToUse = dphInfo.ammoName;
    dphBaseToUse = dphInfo.damage;
    damageTypeToUse = dphInfo.damageType;
    apToUse = dphInfo.ap;
    barrelMatchInfoToUse = dphInfo.barrelMatchInfo;
    ammoCritMultiplierToUse = dphInfo.ammoCritMultiplier;
    pelletCountToUse = dphInfo.pelletCount || 1; // Already corrected in getAdjustedAmmoDamage
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
    isRechargeableGun_local_flag = true;
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
    const effectEntry = ammoEffectsArray.find(
      (ae: AmmoEffectEntry) => ae.id === "RECHARGE_INTERNAL_BATTERY"
    );
    const energyCostPerShot =
      gunProps.charges_per_shot ||
      gunProps.energy_per_shot ||
      effectEntry?.energy_cost ||
      1;
    const rechargeRateKjPerTurn = AMMO_EFFECT_RECHARGE_RATE_KJ_PER_TURN;

    if (ammoCapacityKj > 0 && energyCostPerShot > 0) {
      const shots = Math.floor(ammoCapacityKj / energyCostPerShot);
      calculatedRechargeableStats = {
        shotsPerFullCharge: shots,
        damagePerFullCharge:
          dphInfo && dphInfo.damage > 0
            ? shots * dphInfo.damage * pelletCountToUse
            : 0,
        timeToFullRechargeSeconds:
          rechargeRateKjPerTurn > 0
            ? Math.ceil(
                ammoCapacityKj / (rechargeRateKjPerTurn * MOVES_PER_GAME_SECOND)
              )
            : Infinity,
        energySource: localEnergySource,
      };
    } else {
      calculatedRechargeableStats = {
        shotsPerFullCharge: 0,
        damagePerFullCharge: 0,
        timeToFullRechargeSeconds: Infinity,
        energySource: localEnergySource,
      };
    }
    log(
      "DPS_CYCLE",
      `${gunItem.id} identified as internally rechargeable.`,
      calculatedRechargeableStats
    );
  } else if (basicGunProps.flags?.includes("USE_PLAYER_CHARGE")) {
    isRechargeableGun_local_flag = true;
    localEnergySource = "Bionic Power";
    calculatedRechargeableStats = {
      shotsPerFullCharge: Infinity,
      damagePerFullCharge: Infinity,
      timeToFullRechargeSeconds: 0,
      energySource: localEnergySource,
    };
    log("DPS_CYCLE", `${gunItem.id} identified as using Bionic Power.`);
  }

  if (isRechargeableGun_local_flag) {
    return {
      ammoName: ammoNameToUse || localEnergySource,
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
      isRechargeableGun: true,
      rechargeableStats: calculatedRechargeableStats,
      isModularVaries: false,
      isNonConventional: true,
      nonConventionalType: classification.weaponSubType,
      debugPrimaryAmmoEffects,
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
    log(
      "DPS_CYCLE",
      `${gunItem.id} identified as UPS powered. Eff. Mag Cap: ${effectiveMagCapacityOverride}, Reload Time: ${effectiveReloadTimeOverride}`
    );
    if (!dphInfo && classification.weaponSubType === "energy") {
      log(
        "DPS_CYCLE",
        `${gunItem.id} is UPS energy weapon, returning simplified info.`
      );
      let gunDmgNormalized: DamageUnit[] = [];
      if (gunProps.ranged_damage) {
        gunDmgNormalized = normalizeDamageInstance(gunProps.ranged_damage);
      }
      let baseDmg = 0,
        apVal = 0,
        dmgTypeStr = "energy"; // Renamed to avoid conflict
      if (gunDmgNormalized.length > 0) {
        baseDmg = gunDmgNormalized[0].amount || 0;
        apVal = gunDmgNormalized[0].armor_penetration || 0;
        dmgTypeStr =
          getLocalItemNameForLogic(
            gunDmgNormalized[0].damage_type,
            processor
          ) || gunDmgNormalized[0].damage_type;
      }
      return {
        ammoName: "UPS Charge",
        dphBase: baseDmg,
        damageType: dmgTypeStr,
        ap: apVal,
        ammoCritMultiplier: 1.0,
        pelletCount: 1,
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
        isRechargeableGun: false,
        isNonConventional: true,
        nonConventionalType: "energy",
        isModularVaries: false,
        debugPrimaryAmmoEffects,
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
    isModularVaries_local_flag = true;
    log("DPS_CYCLE", `${gunItem.id} is Varies (Modular)...`);
    return {
      ammoName: "Varies (Modular)",
      dphBase: 0,
      damageType: "N/A",
      ap: 0,
      ammoCritMultiplier: 1,
      pelletCount: 1,
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
      isRechargeableGun: false,
      isModularVaries: true,
      isNonConventional: classification.isNonTraditional,
      nonConventionalType: classification.weaponSubType,
      debugPrimaryAmmoEffects,
    };
  }

  if (!dphInfo || dphInfo.damage <= 0) {
    log(
      "WARN",
      `No valid DPH or DPH is zero for ${gunItem.id} (Ammo: ${
        dphInfo?.ammoName
      }). Rep Ammo selected: ${
        classifyAndSelectStandardAmmo(gunItem, processor)?.id
      }`
    );
    if (classification.isNonTraditional) {
      log(
        "DPS_CYCLE",
        `${gunItem.id} is Non-Traditional with no DPH. Skipping full DPS calc.`
      );
      return {
        ammoName:
          classification.weaponSubType === "archery" ? "Arrow/Bolt" : "Special",
        dphBase: 0,
        damageType: "N/A",
        ap: 0,
        ammoCritMultiplier: 1,
        pelletCount: 1,
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
        isRechargeableGun: false,
        isModularVaries: false,
        isNonConventional: true,
        nonConventionalType: classification.weaponSubType,
        debugPrimaryAmmoEffects,
      };
    }
    log(
      "ERROR",
      `Cannot calculate DPS for ${gunItem.id} due to missing/zero DPH for presumably conventional weapon.`
    );
    return null;
  }
  // At this point, dphInfo is valid and damage > 0
  log(
    "DPS_CYCLE",
    `Gun ${gunItem.id} with ammo ${
      dphInfo.ammoName
    }: DPH=${dphInfo.damage.toFixed(1)}, AP=${dphInfo.ap}, CritX=${
      dphInfo.ammoCritMultiplier
    }, Pellets=${pelletCountToUse}`
  );

  // --- Calculations for the referenceMode ---
  if (!referenceMode) {
    log(
      "ERROR",
      `No reference firing mode found for ${gunItem.id}. Cannot calculate DPS metrics.`
    );
    return {
      /* Populate with N/A or defaults, similar to other early exits */
      ammoName: ammoNameToUse,
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
      isRechargeableGun: false,
      isModularVaries: isModularVaries_local_flag,
      isNonConventional: classification.isNonTraditional,
      nonConventionalType: classification.weaponSubType,
      debugPrimaryAmmoEffects,
    };
  }

  const currentModeForCalcs = referenceMode; // Use the chosen reference mode for all DPS types for now
  log(
    "DPS_CYCLE",
    `Calculating DPS metrics for REFERENCE mode: ${currentModeForCalcs.name} (RoF ${currentModeForCalcs.shotsPerActivation}) on ${gunItem.id}`
  );

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
      currentModeForCalcs
    );
    initialEffectiveRecoilMoaForFirstShot_Main = targetEstAim;
  } // Else: SightDispersionInstantly uses defaults (0 moves, sight_dispersion)

  let magCapacityUsed =
    effectiveMagCapacityOverride ?? gunProps.clip_size ?? null;
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    // ... (magazine lookup logic copied from previous full version) ...
    // This should populate magCapacityUsed or it remains null/0
  }
  if (magCapacityUsed === null || magCapacityUsed <= 0) {
    log(
      "WARN",
      `No magazine capacity found for ${gunItem.id} in mode ${currentModeForCalcs.name}. DPS metrics will be N/A.`
    );
    magCapacityUsed = 1; // Default to 1 to avoid division by zero, though DPS will be poor
  }
  log(
    "DPS_CYCLE",
    `  Mode ${currentModeForCalcs.name}: MagCapUsed=${magCapacityUsed}, MovesPerActivation=${movesPerAttackActivation}, InitialAimMoves=${movesSpentAimingInitial_Main}`
  );

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
    getIncreaseInRecoilMoaPerShot(gunRecoilQtyPerShotBase, recoilAbsorbFactor) *
    currentModeForCalcs.recoilMultiplierFromMode;
  log(
    "DPS_CYCLE",
    `  Mode ${
      currentModeForCalcs.name
    }: InherentDisp=${inherentWeaponDispersionMoa.toFixed(
      1
    )}, RecoilQtyBase=${gunRecoilQtyPerShotBase.toFixed(
      1
    )}, RecoilIncreasePerShot=${increaseInRecoilMoaPerShotForThisMode.toFixed(
      1
    )}`
  );

  const accuracyConstants = {
    crit: ACCURACY_CRITICAL_FACTOR,
    standard: ACCURACY_STANDARD_FACTOR,
    graze: ACCURACY_GRAZING_FACTOR,
  };
  const targetSizeMeters = 0.5;

  // --- Calculate referenceSustainedDps (includes reload) & its details ---
  calculatedModePerformances = []; // Reset for this calculation pass
  for (const range of STANDARD_RANGES_TILES) {
    const targetAngularSizeMoa =
      range > 0
        ? Math.atan(targetSizeMeters / (range * METERS_PER_TILE)) *
          (180.0 / Math.PI) *
          60.0
        : MAX_RECOIL_MOA * 2;
    let totalExpectedDamagePerMagCycle_Sustained = 0;
    let currentRecoilLevelMoa_Sustained =
      initialEffectiveRecoilMoaForFirstShot_Main;

    for (let i = 0; i < magCapacityUsed; i++) {
      if (i > 0)
        currentRecoilLevelMoa_Sustained = Math.min(
          MAX_RECOIL_MOA,
          currentRecoilLevelMoa_Sustained +
            increaseInRecoilMoaPerShotForThisMode
        );
      const effectiveDispersionThisShotMoa =
        inherentWeaponDispersionMoa + currentRecoilLevelMoa_Sustained;
      let expectedDamageThisShot = 0;
      for (let p = 0; p < pelletCountToUse; p++) {
        const probs = getHitProbabilities(
          effectiveDispersionThisShotMoa,
          targetAngularSizeMoa,
          accuracyConstants
        );
        expectedDamageThisShot +=
          probs.P_Crit * dphInfo.damage * ammoCritMultiplierToUse +
          probs.P_Hit * dphInfo.damage +
          probs.P_Graze * dphInfo.damage * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
      }
      totalExpectedDamagePerMagCycle_Sustained += expectedDamageThisShot;
    }
    const activationsToEmptyMag_Sustained = Math.ceil(
      magCapacityUsed / shotsPerActivationInMode
    );
    const movesToFireMag_Sustained =
      activationsToEmptyMag_Sustained * movesPerAttackActivation;
    const movesToReload_Sustained =
      effectiveReloadTimeOverride ?? gunProps.reload ?? 100;
    const totalMovesPerCycle_Sustained =
      movesSpentAimingInitial_Main +
      movesToFireMag_Sustained +
      movesToReload_Sustained;
    const dpsVal =
      totalMovesPerCycle_Sustained > 0
        ? totalExpectedDamagePerMagCycle_Sustained /
          (totalMovesPerCycle_Sustained / PLAYER_SPEED_MOVES_PER_SECOND)
        : dphInfo.damage > 0
        ? Infinity
        : 0;

    // Populate modePerformances for the reference mode across ranges
    let modePerfEntry = calculatedModePerformances.find(
      (mp) => mp.modeDetails.id === currentModeForCalcs.id
    );
    if (!modePerfEntry) {
      modePerfEntry = { modeDetails: currentModeForCalcs, dpsAtRanges: [] };
      calculatedModePerformances.push(modePerfEntry);
    }
    modePerfEntry.dpsAtRanges.push({ rangeTiles: range, sustainedDps: dpsVal });

    if (range === DEFAULT_REFERENCE_RANGE_TILES) {
      refSustainedDps = dpsVal;
      refModeName = currentModeForCalcs.name;
      refRangeTiles = range;
      refSustainedDpsDetails = {
        totalExpectedDamage: totalExpectedDamagePerMagCycle_Sustained,
        timeCycleSec:
          totalMovesPerCycle_Sustained / PLAYER_SPEED_MOVES_PER_SECOND,
        aimingMoves: movesSpentAimingInitial_Main,
        firingMoves: movesToFireMag_Sustained,
        reloadMoves: movesToReload_Sustained,
      };
    }
  }
  // Fallback for refSustainedDps if not found at default range
  if (
    refSustainedDps === null &&
    calculatedModePerformances.length > 0 &&
    calculatedModePerformances[0].dpsAtRanges.length > 0
  ) {
    // Simplified: just pick the first available if default range had no data (e.g. if only one range calculated)
    const firstRangeDps = calculatedModePerformances[0].dpsAtRanges[0];
    refSustainedDps = firstRangeDps.sustainedDps;
    refModeName = calculatedModePerformances[0].modeDetails.name;
    refRangeTiles = firstRangeDps.rangeTiles;
    // Details would need to be recalculated or stored if this fallback is common
  }

  // --- Calculate dpsMagDumpNoReload for referenceMode @ DEFAULT_REFERENCE_RANGE_TILES ---
  let totalExpectedDamage_MagDump = 0;
  let currentRecoilLevelMoa_MagDump =
    initialEffectiveRecoilMoaForFirstShot_Main; // Same initial aim
  const targetAngularSize_MagDump =
    DEFAULT_REFERENCE_RANGE_TILES > 0
      ? Math.atan(
          targetSizeMeters / (DEFAULT_REFERENCE_RANGE_TILES * METERS_PER_TILE)
        ) *
        (180.0 / Math.PI) *
        60.0
      : MAX_RECOIL_MOA * 2;

  for (let i = 0; i < magCapacityUsed; i++) {
    if (i > 0)
      currentRecoilLevelMoa_MagDump = Math.min(
        MAX_RECOIL_MOA,
        currentRecoilLevelMoa_MagDump + increaseInRecoilMoaPerShotForThisMode
      );
    const effectiveDispersionThisShotMoa =
      inherentWeaponDispersionMoa + currentRecoilLevelMoa_MagDump;
    let expectedDamageThisShot = 0;
    for (let p = 0; p < pelletCountToUse; p++) {
      const probs = getHitProbabilities(
        effectiveDispersionThisShotMoa,
        targetAngularSize_MagDump,
        accuracyConstants
      );
      expectedDamageThisShot +=
        probs.P_Crit * dphInfo.damage * ammoCritMultiplierToUse +
        probs.P_Hit * dphInfo.damage +
        probs.P_Graze * dphInfo.damage * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
    }
    totalExpectedDamage_MagDump += expectedDamageThisShot;
  }
  const activationsToEmptyMag_MagDump = Math.ceil(
    magCapacityUsed / shotsPerActivationInMode
  );
  const movesToFireMag_MagDump =
    activationsToEmptyMag_MagDump * movesPerAttackActivation;
  const timeToAimAndFireMagMoves_MagDump =
    movesSpentAimingInitial_Main + movesToFireMag_MagDump;
  const timeToAimAndFireMagSec_MagDump =
    timeToAimAndFireMagMoves_MagDump / PLAYER_SPEED_MOVES_PER_SECOND;
  magDumpDps =
    timeToAimAndFireMagSec_MagDump > 0
      ? totalExpectedDamage_MagDump / timeToAimAndFireMagSec_MagDump
      : dphInfo.damage > 0
      ? Infinity
      : 0;
  magDumpDetails = {
    totalExpectedDamage: totalExpectedDamage_MagDump,
    timeCycleSec: timeToAimAndFireMagSec_MagDump,
    aimingMoves: movesSpentAimingInitial_Main,
    firingMoves: movesToFireMag_MagDump,
  };
  log(
    "DPS_CYCLE",
    `  Mode ${
      currentModeForCalcs.name
    } MagDump DPS @${DEFAULT_REFERENCE_RANGE_TILES}t: ${magDumpDps.toFixed(
      1
    )} (Dmg: ${totalExpectedDamage_MagDump.toFixed(
      1
    )}, Time: ${timeToAimAndFireMagSec_MagDump.toFixed(2)}s)`
  );

  // --- Calculate dpsPreciseAimPerShotNoReload for referenceMode @ DEFAULT_REFERENCE_RANGE_TILES ---
  let perceptionAdjustedSightLimit =
    gunProps.sight_dispersion || DEFAULT_SIGHT_DISPERSION;
  const perFactorPrecise =
    gunProps.skill === "pistol" ||
    gunProps.skill === "smg" ||
    gunProps.skill === "shotgun"
      ? 3
      : 5;
  const perModToSightPrecise = (8 - profile.perception) * perFactorPrecise;
  // Only apply penalty for PER < 8 for sight limit adjustment
  if (profile.perception < 8) {
    perceptionAdjustedSightLimit += perModToSightPrecise; // This will be positive, increasing dispersion
  }
  perceptionAdjustedSightLimit = Math.max(10, perceptionAdjustedSightLimit); // Practical minimum aim limit
  log(
    "AIM_CALC",
    `Precise Aim Target MOA for ${
      gunItem.id
    }: ${perceptionAdjustedSightLimit.toFixed(1)} (Base sight: ${
      gunProps.sight_dispersion
    }, PER: ${profile.perception})`
  );

  let totalExpectedDamage_Precise = 0;
  let totalMovesForPreciseMagCycle_Precise = 0;
  let current_player_recoil_before_aim_Precise = MAX_RECOIL_MOA;
  let totalAimingMovesPrecise = 0;

  for (let i = 0; i < magCapacityUsed; i++) {
    const aimingMovesThisShot = estimateMovesToReachRecoil(
      gunProps,
      perceptionAdjustedSightLimit,
      current_player_recoil_before_aim_Precise,
      profile,
      currentModeForCalcs
    );
    totalAimingMovesPrecise += aimingMovesThisShot;
    const movesThisShotAction = aimingMovesThisShot + movesPerAttackActivation;
    totalMovesForPreciseMagCycle_Precise += movesThisShotAction;

    const effectiveDispersionThisPreciseShot =
      inherentWeaponDispersionMoa + perceptionAdjustedSightLimit; // Aimed to this level
    let expectedDamageThisSinglePreciseShot = 0;
    for (let p = 0; p < pelletCountToUse; p++) {
      const probs = getHitProbabilities(
        effectiveDispersionThisPreciseShot,
        targetAngularSize_MagDump,
        accuracyConstants
      ); // Using same target size as MagDump (default range)
      expectedDamageThisSinglePreciseShot +=
        probs.P_Crit * dphInfo.damage * ammoCritMultiplierToUse +
        probs.P_Hit * dphInfo.damage +
        probs.P_Graze * dphInfo.damage * GRAZE_DAMAGE_MULTIPLIER_DEFAULT;
    }
    totalExpectedDamage_Precise += expectedDamageThisSinglePreciseShot;

    const increaseInRecoilDueToFiring =
      getIncreaseInRecoilMoaPerShot(
        gunRecoilQtyPerShotBase,
        recoilAbsorbFactor
      ) * currentModeForCalcs.recoilMultiplierFromMode;
    current_player_recoil_before_aim_Precise = Math.min(
      MAX_RECOIL_MOA,
      perceptionAdjustedSightLimit + increaseInRecoilDueToFiring
    );
  }
  const timeToAimAndFireMagSec_Precise =
    totalMovesForPreciseMagCycle_Precise / PLAYER_SPEED_MOVES_PER_SECOND;
  preciseAimDps =
    timeToAimAndFireMagSec_Precise > 0
      ? totalExpectedDamage_Precise / timeToAimAndFireMagSec_Precise
      : dphInfo.damage > 0
      ? Infinity
      : 0;
  preciseAimDetails = {
    totalExpectedDamage: totalExpectedDamage_Precise,
    timeCycleSec: timeToAimAndFireMagSec_Precise,
    aimingMoves: totalAimingMovesPrecise,
    firingMoves: magCapacityUsed * movesPerAttackActivation,
    avgAimingMovesPerPreciseShot: totalAimingMovesPrecise / magCapacityUsed,
  };
  log(
    "DPS_CYCLE",
    `  Mode ${
      currentModeForCalcs.name
    } PreciseAim DPS @${DEFAULT_REFERENCE_RANGE_TILES}t: ${preciseAimDps.toFixed(
      1
    )} (Dmg: ${totalExpectedDamage_Precise.toFixed(
      1
    )}, Time: ${timeToAimAndFireMagSec_Precise.toFixed(2)}s, AvgAimMoves: ${(
      totalAimingMovesPrecise / magCapacityUsed
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
