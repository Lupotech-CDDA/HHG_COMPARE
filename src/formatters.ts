// src/formatters.ts
import type {
  Item,
  GunSlot,
  ItemBasicInfo,
  PocketData,
  Translation,
  AmmoSlot,
  GunClassification,
  DamageInstance,
} from "./types";
import {
  parseVolume,
  parseMass,
  singularName,
  CddaData,
  normalizeDamageInstance,
} from "./data";
import { isItemSubtype } from "./types";

// Import types from gun logic files
import type {
  FiringModeDetail, // from gunProperties
} from "./gunProperties";
import type {
  RepresentativeCombatInfo,
  DpsCalculationDetails, // from gunDPS
  ModePerformance,
  DpsAtRange, // from gunDPS
} from "./gunDPS";
import {
  DEFAULT_REFERENCE_RANGE_TILES, // from gameConstants (or gunDPS if re-exported)
} from "./gameConstants";

// Import helper functions from gunProperties that are used by formatters here
import {
  getFireableAmmoObjects,
  getMagazineIdsFromGunMod,
  getMagazineIdsFromItemPockets,
  getAmmoTypesFromMagazinePockets,
} from "./gunProperties";

export function parseLengthToMm(lengthStr: string | undefined): number | null {
  if (!lengthStr) return null;
  const parts = String(lengthStr).trim().toLowerCase().split(/\s+/);
  if (parts.length === 1 && !isNaN(parseFloat(parts[0]))) {
  } else if (parts.length !== 2) {
    return null;
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
  if (!itemIdentifier) return null;
  let nameProp: string | Translation | undefined;
  let idProp: string | undefined;

  if (typeof itemIdentifier === "string") {
    const itemObj =
      processor.byIdMaybe("item", itemIdentifier) ||
      processor.byIdMaybe("ammunition_type", itemIdentifier) ||
      processor.byIdMaybe("weapon_category", itemIdentifier) ||
      processor.byIdMaybe("ITEM_CATEGORY", itemIdentifier) ||
      processor.byIdMaybe("material", itemIdentifier) ||
      processor.byIdMaybe("damage_type", itemIdentifier) ||
      processor.byIdMaybe("fault", itemIdentifier);
    if (itemObj) {
      nameProp = (itemObj as ItemBasicInfo).name;
      idProp = (itemObj as ItemBasicInfo).id;
    } else {
      if (itemIdentifier.startsWith("group:")) return itemIdentifier;
      return itemIdentifier;
    }
  } else if (typeof itemIdentifier === "object" && itemIdentifier !== null) {
    nameProp = (itemIdentifier as ItemBasicInfo).name;
    idProp = (itemIdentifier as ItemBasicInfo).id;
  } else {
    return null;
  }

  if (nameProp) {
    if (typeof nameProp === "string") return nameProp;
    if (typeof nameProp === "object") {
      const nameTrans = nameProp as { str_sp?: string; str?: string };
      return nameTrans.str_sp || nameTrans.str || idProp || "Unnamed";
    }
  }
  return idProp || "Unknown ID";
}

export function formatVolumeForSort(
  value: ItemBasicInfo["volume"]
): number | null {
  if (value === undefined || value === null) return null;
  return parseVolume(value) / 1000;
}
export function formatWeightForSort(
  value: ItemBasicInfo["weight"]
): number | null {
  if (value === undefined || value === null) return null;
  return parseMass(value) / 1000;
}

export function formatGunBaseRangedDamageDisplay(
  rangedDamage: GunSlot["ranged_damage"] | undefined,
  processor: CddaData
): string {
  if (!rangedDamage) return "0";
  const d = normalizeDamageInstance(rangedDamage);
  if (!d || d.length === 0 || (d[0] && d[0].amount === 0 && d.length === 1))
    return "N/A (Ammo/Mod)";
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
  if (!d || d.length === 0 || (d[0] && d[0].amount === 0 && d.length === 1))
    return null;
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
export function formatNumberOrNull(
  value: number | undefined | null
): number | null {
  return value ?? null;
}

export function formatGunModes(modes: GunSlot["modes"] | undefined): string {
  if (!modes || modes.length === 0) return "Semi-auto (1)";
  return modes.map((mode) => `${mode[1]} (${mode[2]})`).join(" / ");
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
      (obj: Item & AmmoSlot) =>
        getItemNameFromIdOrObject(obj, processor) || obj.id
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

export function formatFiringModesForDisplay(
  modes: FiringModeDetail[] | undefined
): string | null {
  if (!modes || modes.length === 0) {
    return "Semi-auto (1 RoF)";
  }
  return modes
    .map((mode) => `${mode.name} (${mode.shotsPerActivation} RoF)`)
    .join(" / ");
}

function formatDpsDetails(
  details: DpsCalculationDetails | undefined,
  type: string
): string {
  if (!details) return "";
  let detailStr = `    <em>${type} Cycle:</em><br>`;
  detailStr += `      Dmg: ${details.totalExpectedDamage.toFixed(
    1
  )}, Time: ${details.timeCycleSec.toFixed(2)}s<br>`;
  if (
    details.aimingMoves !== undefined ||
    details.firingMoves !== undefined ||
    details.reloadMoves !== undefined
  ) {
    detailStr += `        Moves: `;
    const moveParts = [];
    if (details.aimingMoves !== undefined)
      moveParts.push(`Aim ${details.aimingMoves}`);
    if (details.firingMoves !== undefined)
      moveParts.push(`Fire ${details.firingMoves}`);
    if (details.reloadMoves !== undefined)
      moveParts.push(`Reload ${details.reloadMoves}`);
    detailStr += moveParts.join(", ") + "mv<br>";
  }
  // Check if avgAimingMovesPerPreciseShot exists and is a number before formatting
  const avgAimMoves = (details as any).avgAimingMovesPerPreciseShot;
  if (typeof avgAimMoves === "number") {
    detailStr += `        Avg Aim/Shot: ${avgAimMoves.toFixed(0)}mv<br>`;
  }
  return detailStr;
}

export function formatDpsTooltip(
  combatInfo: RepresentativeCombatInfo | undefined | null
): string {
  if (!combatInfo) return "No combat information available.";

  let content = `<strong>Test Guy Profile:</strong> Skills @4, Stats @10.<br>`;
  if (combatInfo.ammoName) {
    content += `<strong>Rep. Ammo:</strong> ${combatInfo.ammoName}`;
    if (combatInfo.pelletCount && combatInfo.pelletCount > 1) {
      content += ` (${combatInfo.pelletCount} pellets)`;
    }
    content += `<br>`;
  }
  if (combatInfo.debugPrimaryAmmoEffects) {
    const effects = combatInfo.debugPrimaryAmmoEffects;
    if (effects.hasIncendiaryEffect)
      content += `<span style="color: orange;">Effect: Incendiary</span><br>`;
    if (effects.isExplosive) {
      content += `<span style="color: red;">Effect: Explosive (Power: ${
        effects.explosionPower || 0
      }`;
      if (effects.shrapnelCount)
        content += `, Frags: ${effects.shrapnelCount} (Exp.Dmg: ${
          effects.shrapnelDamage?.toFixed(0) || 0
        })`;
      content += `)</span><br>`;
    }
  }
  content += `<hr style='margin: 5px 0;'>`;

  if (combatInfo.isModularVaries) {
    content +=
      "<strong>Performance varies based on installed modular parts.</strong>";
    return content;
  }
  if (combatInfo.isRechargeableGun && combatInfo.rechargeableStats) {
    const stats = combatInfo.rechargeableStats;
    content += `<strong>Rechargeable Weapon (${stats.energySource}):</strong><br>`;
    content += `  Dmg/Full Charge: ${stats.damagePerFullCharge.toFixed(0)}<br>`;
    content += `  Shots/Full Charge: ${stats.shotsPerFullCharge}<br>`;
    content += `  Recharge Time: ${
      stats.timeToFullRechargeSeconds === Infinity
        ? "Infinite"
        : stats.timeToFullRechargeSeconds.toFixed(1) + "s"
    }<br>`;
    if (
      combatInfo.dphBase > 0 &&
      combatInfo.ammoName &&
      combatInfo.ammoName !== stats.energySource
    ) {
      content += `<br>Base Projectile:<br>  ${combatInfo.dphBase.toFixed(0)} ${
        combatInfo.damageType
      } / ${combatInfo.ap} AP<br>`;
    }
    return content;
  }
  if (combatInfo.isNonConventional && !combatInfo.isRechargeableGun) {
    content += `<strong>Non-Conventional Weapon (${
      combatInfo.nonConventionalType || ""
    }):</strong><br>`;
    content += `Standard DPS metrics may not fully represent performance.<br>`;
    if (combatInfo.dphBase > 0 && combatInfo.ammoName) {
      content += `<br>Base Projectile:<br>  ${combatInfo.dphBase.toFixed(0)} ${
        combatInfo.damageType
      } / ${combatInfo.ap} AP<br>`;
    }
    return content;
  }

  const refModeDisplay = combatInfo.referenceModeName || "Default";
  const refRangeDisplay =
    combatInfo.referenceRangeTiles || DEFAULT_REFERENCE_RANGE_TILES;

  if (combatInfo.referenceSustainedDps !== null) {
    content += `<strong><u>Sustained DPS (Full Cycle)</u></strong><br>`;
    content += `  Mode: ${refModeDisplay}, Range: ${refRangeDisplay}t<br>`;
    content += `  <strong>DPS: ${combatInfo.referenceSustainedDps.toFixed(
      1
    )}</strong><br>`;
    content += formatDpsDetails(
      combatInfo.referenceSustainedDpsDetails,
      "Sustained"
    );
  }

  if (combatInfo.dpsMagDumpNoReload !== null) {
    content += `<strong><u>DPS (Mag Dump, No Reload)</u></strong><br>`;
    content += `  Mode: ${refModeDisplay}, Range: ${refRangeDisplay}t (Assumed)<br>`;
    content += `  <strong>DPS: ${combatInfo.dpsMagDumpNoReload.toFixed(
      1
    )}</strong><br>`;
    content += formatDpsDetails(combatInfo.dpsMagDumpDetails, "Mag Dump");
  }

  if (combatInfo.dpsPreciseAimPerShotNoReload !== null) {
    content += `<strong><u>DPS (Precise Aim/Shot, No Reload)</u></strong><br>`;
    content += `  Mode: ${refModeDisplay}, Range: ${refRangeDisplay}t (Assumed)<br>`;
    content += `  <strong>DPS: ${combatInfo.dpsPreciseAimPerShotNoReload.toFixed(
      1
    )}</strong><br>`;
    content += formatDpsDetails(
      combatInfo.dpsPreciseAimPerShotDetails,
      "Precise Aim"
    );
  }

  if (combatInfo.modePerformances && combatInfo.modePerformances.length > 0) {
    const refModePerf = combatInfo.modePerformances.find(
      (mp) => mp.modeDetails.name === combatInfo.referenceModeName
    );
    if (refModePerf && refModePerf.dpsAtRanges.length > 1) {
      content += `<br><strong><u>Sustained DPS by Range (Mode: ${refModePerf.modeDetails.name})</u></strong><br>`;
      refModePerf.dpsAtRanges.forEach((rangeDps) => {
        content += `  @ ${rangeDps.rangeTiles} tiles: ${
          rangeDps.sustainedDps?.toFixed(1) ?? "N/A"
        } DPS<br>`;
      });
    }
  }
  return content;
}
