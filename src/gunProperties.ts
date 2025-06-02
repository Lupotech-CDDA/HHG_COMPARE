// src/gunProperties.ts
import type {
  Item,
  GunSlot,
  PocketData,
  AmmoSlot,
  DamageUnit,
  ItemBasicInfo,
  AmmunitionType,
  ModValProperty,
  Translation,
  ExplosionProperties,
  ShrapnelProperties,
  DamageInstance,
  AmmoEffectEntry,
} from "./types";
import { isItemSubtype } from "./types";
import { normalizeDamageInstance, CddaData, singularName } from "./data";
import { parseLengthToMm } from "./formatters"; // Assuming formatters.ts is stable
import { log } from "./debugLogger";
import {
  STANDARD_AMMO_KEYWORDS,
  NON_STANDARD_AMMO_KEYWORDS,
  EXPECTED_SHRAPNEL_HIT_PERCENTAGE_ON_EPICENTER_TARGET,
} from "./gameConstants";

// --- Interfaces primarily defined and used by this module ---
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

// --- Helper & Property Extraction Functions ---

export function getLocalItemNameForLogic(
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
      return itemIdentifier; // Return ID if not found in common types
    }
  } else if (typeof itemIdentifier === "object" && itemIdentifier !== null) {
    nameProperty = (itemIdentifier as ItemBasicInfo).name;
    idProperty = (itemIdentifier as ItemBasicInfo).id;
  } else {
    return null; // Not a string ID or a valid object
  }

  if (nameProperty) {
    if (typeof nameProperty === "string") return nameProperty;
    // Handle Translation object
    if (typeof nameProperty === "object") {
      const nameTrans = nameProperty as { str_sp?: string; str?: string }; // Type assertion
      if (nameTrans.str_sp) return nameTrans.str_sp;
      if (nameTrans.str) return nameTrans.str;
    }
  }
  return idProperty || null; // Fallback to ID if name processing fails or no name
}

export function getSummedModProperty(
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

export function getMultiplicativeModRecoilFactor(
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
      (Array.isArray(gunProps.ammo) ? gunProps.ammo : [gunProps.ammo]).forEach(
        (ammoIdOrType) => {
          if (ammoIdOrType === "NULL") return;
          const ammoItem = processor.byIdMaybe("item", ammoIdOrType);
          if (ammoItem && isItemSubtype("AMMO", ammoItem as Item)) {
            fireableAmmoItems.push(ammoItem as Item & AmmoSlot);
          } else {
            const allAmmoItemsInGame = processor
              .byType("item")
              .filter((item) => isItemSubtype("AMMO", item as Item)) as (Item &
              AmmoSlot)[];
            for (const anAmmoItem of allAmmoItemsInGame) {
              if (anAmmoItem.ammo_type === ammoIdOrType) {
                fireableAmmoItems.push(anAmmoItem);
              }
            }
          }
        }
      );
    }
  }
  const uniqueFireableAmmoItems = Array.from(
    new Map(fireableAmmoItems.map((item) => [item.id, item])).values()
  );
  uniqueFireableAmmoItems.sort((a, b) =>
    (getLocalItemNameForLogic(a, processor) || "").localeCompare(
      getLocalItemNameForLogic(b, processor) || ""
    )
  );
  return uniqueFireableAmmoItems;
}

export function classifyAndSelectStandardAmmo(
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
      return false;
    if (
      ammoName === "ups charge" ||
      ammoName === "ups compatible" ||
      ammoName === "bionic power"
    )
      return false;
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
    log(
      "AMMO_SELECT",
      `[${gunId}] No ammo in target list after conventional filter. Returning null.`
    );
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
      );
    let baseDmg = 0;
    if (ammoItem.damage) {
      const damageInstance = normalizeDamageInstance(ammoItem.damage);
      if (
        damageInstance &&
        damageInstance.length > 0 &&
        damageInstance[0].amount
      ) {
        baseDmg = damageInstance[0].amount;
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
    const standardsByName = classified.filter(
      (c) =>
        c.isStandardHeuristic &&
        !c.item.explosion &&
        !(c.item.effects || []).some((eff) =>
          typeof eff === "string"
            ? eff === "INCENDIARY" || eff === "NAPALM"
            : (eff as AmmoEffectEntry).id === "INCENDIARY" ||
              (eff as AmmoEffectEntry).id === "NAPALM"
        )
    );
    if (standardsByName.length > 0) {
      standardsByName.sort((a, b) => b.baseDamageAmount - a.baseDamageAmount);
      selectedAmmo = standardsByName[0].item;
      log(
        "AMMO_SELECT",
        `[${gunId}] Selected standard-by-name (non-special) ammo: ${selectedAmmo.id}`
      );
    } else if (classified.length > 0) {
      classified.sort((a, b) => {
        const aIsSpecial =
          !!a.item.explosion ||
          !!(a.item.effects || []).some((eff) =>
            typeof eff === "string"
              ? eff === "INCENDIARY" || eff === "NAPALM"
              : (eff as AmmoEffectEntry).id === "INCENDIARY" ||
                (eff as AmmoEffectEntry).id === "NAPALM"
          );
        const bIsSpecial =
          !!b.item.explosion ||
          !!(b.item.effects || []).some((eff) =>
            typeof eff === "string"
              ? eff === "INCENDIARY" || eff === "NAPALM"
              : (eff as AmmoEffectEntry).id === "INCENDIARY" ||
                (eff as AmmoEffectEntry).id === "NAPALM"
          );
        if (aIsSpecial && !bIsSpecial) return 1;
        if (!aIsSpecial && bIsSpecial) return -1;
        return b.baseDamageAmount - a.baseDamageAmount;
      });
      selectedAmmo = classified[0].item;
      log(
        "AMMO_SELECT",
        `[${gunId}] Selected ammo by fallback (best non-special or highest damage special): ${selectedAmmo.id}`
      );
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
