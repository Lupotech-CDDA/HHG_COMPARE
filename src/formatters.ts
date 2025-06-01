import type {
  Item,
  GunSlot,
  ItemBasicInfo,
  PocketData,
  Translation,
  AmmoSlot,
  GunClassification,
  DamageInstance,
} from "./types"; // Added GunClassification, DamageInstance
import {
  parseVolume,
  parseMass,
  singularName,
  CddaData,
  normalizeDamageInstance,
} from "./data";
import { isItemSubtype } from "./types";
import {
  getFireableAmmoObjects,
  getMagazineIdsFromGunMod,
  getMagazineIdsFromItemPockets,
  getAmmoTypesFromMagazinePockets,
  // Import types from gunLogic that are used here
  type FiringModeDetail,
  type RepresentativeCombatInfo,
  DEFAULT_REFERENCE_RANGE_TILES, // Import for tooltip consistency
} from "./gunLogic";

// parseLengthToMm remains here
export function parseLengthToMm(lengthStr: string | undefined): number | null {
  if (!lengthStr) return null;
  const parts = String(lengthStr).trim().toLowerCase().split(/\s+/);
  if (parts.length !== 2) {
    if (parts.length === 1 && !isNaN(parseFloat(parts[0]))) {
      /* Allow unitless */
    } else return null;
  }
  const value = parseFloat(parts[0]);
  const unit = parts.length === 2 ? parts[1] : "mm";
  if (isNaN(value)) return null;
  switch (unit) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "m":
      return value * 1000;
    case "in":
    case "inch":
    case "inches":
      return value * 25.4;
    default:
      return null;
  }
}

export function getItemNameFromIdOrObject(
  itemIdentifier: any,
  processor: CddaData
): string | null {
  if (typeof itemIdentifier === "string") {
    const itemObj =
      processor.byIdMaybe("item", itemIdentifier) ||
      processor.byIdMaybe("ammunition_type", itemIdentifier) ||
      processor.byIdMaybe("weapon_category", itemIdentifier) ||
      processor.byIdMaybe("ITEM_CATEGORY", itemIdentifier) ||
      processor.byIdMaybe("material", itemIdentifier) ||
      processor.byIdMaybe("damage_type", itemIdentifier) ||
      processor.byIdMaybe("fault", itemIdentifier);
    if (itemObj) return singularName(itemObj);
    if (itemIdentifier.startsWith("group:")) return itemIdentifier;
    return itemIdentifier;
  }
  if (
    itemIdentifier &&
    typeof itemIdentifier === "object" &&
    itemIdentifier.name
  ) {
    return singularName(itemIdentifier);
  }
  if (
    itemIdentifier &&
    typeof itemIdentifier === "object" &&
    itemIdentifier.id &&
    !itemIdentifier.name
  ) {
    return itemIdentifier.id;
  }
  return null;
}

export function formatVolumeForSort(
  value: ItemBasicInfo["volume"]
): number | null {
  if (value === undefined) return null;
  return parseVolume(value) / 1000;
}
export function formatWeightForSort(
  value: ItemBasicInfo["weight"]
): number | null {
  if (value === undefined) return null;
  return parseMass(value) / 1000;
}

export function formatGunBaseRangedDamageDisplay(
  rangedDamage: GunSlot["ranged_damage"] | undefined,
  processor: CddaData
): string {
  if (!rangedDamage) return "0";
  const d = normalizeDamageInstance(rangedDamage); // rangedDamage could be undefined, ensure normalize can handle it or check before
  if (!d || d.length === 0 || (d[0] && d[0].amount === 0))
    return "N/A (Relies on Ammo/Mod)";
  return d
    .map(
      (i) =>
        `${i.amount || 0} ${
          getItemNameFromIdOrObject(i.damage_type, processor) || i.damage_type
        }`
    )
    .join(" + ");
}
export function formatGunBaseAPDisplay(
  rangedDamage: GunSlot["ranged_damage"] | undefined
): number | null {
  if (!rangedDamage) return 0;
  const d = normalizeDamageInstance(rangedDamage);
  if (!d || d.length === 0 || (d[0] && d[0].amount === 0)) return null;
  return d[0]?.armor_penetration ?? 0;
}
export function formatModSlots(
  modLocations: GunSlot["valid_mod_locations"] | undefined
): string | null {
  if (!modLocations || modLocations.length === 0) return "None";
  return modLocations.map(([l, n]) => `${l} (${n})`).join(", ");
}
export function formatMaterial(
  material: ItemBasicInfo["material"] | undefined,
  processor: CddaData
): string | null {
  if (!material) return null;
  if (typeof material === "string")
    return getItemNameFromIdOrObject(material, processor) || material;
  if (Array.isArray(material)) {
    return material
      .map((m) => {
        const mid = typeof m === "string" ? m : m.type;
        const mn = getItemNameFromIdOrObject(mid, processor) || mid;
        const portion =
          typeof m !== "string" && m.portion
            ? ` (${Math.round(m.portion * 100)}%)`
            : "";
        return typeof m === "string" ? mn : `${mn}${portion}`;
      })
      .join(", ");
  }
  return String(material);
}
export function formatNumberOrNull(value: number | undefined): number | null {
  return value ?? null;
}

export function formatModes(modes: GunSlot["modes"] | undefined): string {
  // This is for base gun modes, not FiringModeDetail
  if (!modes || modes.length === 0) return "N/A";
  return modes.map((mode) => `${mode[1]} (RoF: ${mode[2]})`).join(" / ");
}
export function formatFaults(
  faults: ItemBasicInfo["faults"] | undefined,
  processor: CddaData
): string | null {
  if (!faults || faults.length === 0) return "None";
  return faults
    .map((f_entry) => {
      let faultIdToLookup: string;
      if (typeof f_entry === "string") faultIdToLookup = f_entry;
      else if (
        "fault" in f_entry &&
        typeof (f_entry as { fault?: string }).fault === "string"
      )
        faultIdToLookup = (f_entry as { fault: string }).fault;
      else if (
        "fault_group" in f_entry &&
        typeof (f_entry as { fault_group?: string }).fault_group === "string"
      )
        faultIdToLookup = `group:${
          (f_entry as { fault_group: string }).fault_group
        }`;
      else return "Unknown Fault Entry";
      return (
        getItemNameFromIdOrObject(faultIdToLookup, processor) || faultIdToLookup
      );
    })
    .join(", ");
}
export function formatDefaultMods(
  modIds: string[] | undefined,
  processor: CddaData
): string | null {
  if (!modIds || modIds.length === 0) return "None";
  return modIds
    .map((modId) => getItemNameFromIdOrObject(modId, processor) || modId)
    .join(", ");
}

export function formatFireableAmmoItems(
  entityGun: Item,
  processor: CddaData
): string | null {
  if (!isItemSubtype("GUN", entityGun)) return null;
  const fireableAmmoObjects = getFireableAmmoObjects(entityGun, processor);
  const fireableAmmoItemNames = new Set(
    fireableAmmoObjects.map(
      (obj) => getItemNameFromIdOrObject(obj, processor) || obj.id
    )
  );

  const gunProps = entityGun as Item & GunSlot;
  const basicGunProps = entityGun as ItemBasicInfo;

  if (fireableAmmoItemNames.size === 0) {
    if (gunProps.ups_charges && gunProps.ups_charges > 0) return "UPS Charge";
    if (basicGunProps.flags?.includes("USE_UPS")) return "UPS Compatible";
    if (basicGunProps.flags?.includes("USE_PLAYER_CHARGE"))
      return "Bionic Power";

    if (isItemSubtype("MAGAZINE", entityGun) && entityGun.pocket_data) {
      // Added check for pocket_data
      const ammoTypesFromSelf = getAmmoTypesFromMagazinePockets(
        entityGun.pocket_data
      );
      if (ammoTypesFromSelf.size > 0) {
        return Array.from(ammoTypesFromSelf)
          .map(
            (id) =>
              getItemNameFromIdOrObject(
                processor.byIdMaybe("ammunition_type", id),
                processor
              ) || id
          )
          .sort()
          .join(", ");
      }
    }
    return "N/A";
  }
  return Array.from(fireableAmmoItemNames).sort().join(", ");
}

export function formatCompatibleMagazines(
  entityGun: Item,
  processor: CddaData
): string | null {
  if (!isItemSubtype("GUN", entityGun)) return null;
  const allMagazineItemIds = new Set<string>();
  const gunProps = entityGun as Item & GunSlot;
  let modAlteredMagazines = false;

  if (gunProps.default_mods) {
    for (const modId of gunProps.default_mods) {
      const modItem = processor.byIdMaybe("item", modId) as Item | undefined;
      if (modItem && isItemSubtype("GUNMOD", modItem)) {
        const magsFromMod = getMagazineIdsFromGunMod(modItem);
        if (magsFromMod.size > 0) {
          modAlteredMagazines = true;
          magsFromMod.forEach((id) => allMagazineItemIds.add(id));
        }
      }
    }
  }

  if (
    !modAlteredMagazines ||
    (entityGun.pocket_data &&
      entityGun.pocket_data.some((p) => p.pocket_type === "MAGAZINE_WELL"))
  ) {
    getMagazineIdsFromItemPockets(entityGun).forEach((id) =>
      allMagazineItemIds.add(id)
    );
  }

  if (allMagazineItemIds.size > 0) {
    return Array.from(allMagazineItemIds)
      .map((magId) => getItemNameFromIdOrObject(magId, processor) || magId)
      .sort()
      .join(", ");
  }

  if (gunProps.clip_size && gunProps.clip_size > 0) {
    return `Internal Magazine (${gunProps.clip_size} rounds)`;
  }
  return "N/A";
}

export function formatCategory(
  entity: Item,
  processor: CddaData
): string | null {
  if (!entity) return null;
  if (
    isItemSubtype("GUN", entity) &&
    entity.weapon_category &&
    entity.weapon_category.length > 0
  ) {
    const weaponCategoryNames = entity.weapon_category
      .map(
        (wcId) =>
          getItemNameFromIdOrObject(
            processor.byIdMaybe("weapon_category", wcId),
            processor
          ) || wcId
      )
      .filter((name) => name !== null);
    if (weaponCategoryNames.length > 0) return weaponCategoryNames.join(", ");
  }
  if (entity.category) {
    const itemCategoryObj = processor.byIdMaybe(
      "ITEM_CATEGORY",
      entity.category
    );
    if (itemCategoryObj)
      return getItemNameFromIdOrObject(itemCategoryObj, processor);
  }
  if (isItemSubtype("GUN", entity)) {
    const gunsCategoryObj = processor.byIdMaybe("ITEM_CATEGORY", "guns");
    if (gunsCategoryObj)
      return getItemNameFromIdOrObject(gunsCategoryObj, processor);
    return "Gun";
  }
  return (entity as any).category || null;
}

// NEW FORMATTER for Firing Modes column
export function formatFiringModesForDisplay(
  modes: FiringModeDetail[] | undefined
): string | null {
  if (!modes || modes.length === 0) {
    return "Semi-auto (1 RoF)"; // Default assumption
  }
  return modes
    .map((mode) => `${mode.name} (${mode.shotsPerActivation} RoF)`)
    .join(" / ");
}

// NEW FORMATTER for DPS Tooltip
export function formatDpsTooltip(
  combatInfo: RepresentativeCombatInfo | undefined | null
): string {
  if (!combatInfo) return "No combat information available.";

  let content = `Calculated for Test Guy (Skills 4, Stats 10).<br>Aiming to 'Regular' threshold with time cost.<br>Simplified accuracy, recoil, and reload factored in.<br><br>`;

  if (combatInfo.isModularVaries) {
    content +=
      "<strong>Performance varies based on installed modular parts.</strong>";
    return content;
  }
  if (combatInfo.isRechargeableGun && combatInfo.rechargeableStats) {
    const stats = combatInfo.rechargeableStats;
    content += `<strong>Rechargeable Weapon (${stats.energySource}):</strong><br>`;
    content += `  Damage per Full Charge: ${stats.damagePerFullCharge.toFixed(
      0
    )}<br>`;
    content += `  Shots per Full Charge: ${stats.shotsPerFullCharge}<br>`;
    content += `  Time to Full Recharge: ${
      stats.timeToFullRechargeSeconds === Infinity
        ? "Infinite"
        : stats.timeToFullRechargeSeconds.toFixed(1) + " sec"
    }<br>`;
    // Also show DPH if available
    if (combatInfo.dphBase > 0 && combatInfo.ammoName) {
      content += `<br>Base Projectile (if applicable):<br>  ${combatInfo.dphBase.toFixed(
        0
      )} ${combatInfo.damageType} / ${
        combatInfo.ap
      } AP (${combatInfo.ammoName.substring(0, 10)})<br>`;
    }
    return content;
  }
  if (combatInfo.isNonConventional && !combatInfo.isRechargeableGun) {
    // Non-rechargeable, non-conventional (e.g. bows if not given DPS)
    content += `<strong>Non-Conventional Weapon (${
      combatInfo.nonConventionalType || ""
    }):</strong><br>`;
    content += `Performance not directly comparable via standard DPS metrics here.<br>`;
    if (combatInfo.dphBase > 0 && combatInfo.ammoName) {
      // e.g. bows have DPH from ammo
      content += `<br>Base Projectile:<br>  ${combatInfo.dphBase.toFixed(0)} ${
        combatInfo.damageType
      } / ${combatInfo.ap} AP (${combatInfo.ammoName.substring(0, 10)})<br>`;
    }
    return content;
  }

  if (
    !combatInfo.modePerformances ||
    combatInfo.modePerformances.length === 0
  ) {
    content += "No detailed mode performance data calculated.";
    if (combatInfo.referenceSustainedDps !== null) {
      // But we might have a single reference DPS
      content += `<br>Reference DPS: ${combatInfo.referenceSustainedDps.toFixed(
        1
      )} (${combatInfo.referenceModeName || "Default Mode"}) at ${
        combatInfo.referenceRangeTiles || DEFAULT_REFERENCE_RANGE_TILES
      } tiles.`;
    }
    return content;
  }

  content += `<strong>Reference Mode: ${
    combatInfo.referenceModeName || "Default"
  }</strong> (DPS: ${
    combatInfo.referenceSustainedDps?.toFixed(1) ?? "N/A"
  } at ${
    combatInfo.referenceRangeTiles || DEFAULT_REFERENCE_RANGE_TILES
  } tiles)<br><br>`;

  const refModePerf = combatInfo.modePerformances.find(
    (mp) => mp.modeDetails.name === combatInfo.referenceModeName
  );
  if (refModePerf) {
    content += `<u>DPS at various ranges (Reference Mode - ${refModePerf.modeDetails.name}):</u><br>`;
    refModePerf.dpsAtRanges.forEach((rangeDps) => {
      content += `  @ ${rangeDps.rangeTiles} tiles: ${
        rangeDps.sustainedDps?.toFixed(1) ?? "N/A"
      } DPS<br>`;
    });
    content += "<br>";
  }

  const otherModes = combatInfo.modePerformances.filter(
    (mp) => mp.modeDetails.name !== combatInfo.referenceModeName
  );
  if (otherModes.length > 0) {
    content += `<u>Performance of other modes at ${
      combatInfo.referenceRangeTiles || DEFAULT_REFERENCE_RANGE_TILES
    } tiles:</u><br>`;
    otherModes.forEach((modePerf) => {
      const dpsAtRefRange = modePerf.dpsAtRanges.find(
        (r) =>
          r.rangeTiles ===
          (combatInfo.referenceRangeTiles || DEFAULT_REFERENCE_RANGE_TILES)
      )?.sustainedDps;
      content += `  ${modePerf.modeDetails.name} (${
        modePerf.modeDetails.shotsPerActivation
      } RoF): ${dpsAtRefRange?.toFixed(1) ?? "N/A"} DPS<br>`;
    });
  }

  return content;
}
