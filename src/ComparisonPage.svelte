<script lang="ts">
import { onMount } from "svelte";
import { CddaData, normalizeDamageInstance } from "./data";
import type {
  Item,
  GunSlot,
  ItemBasicInfo,
  AmmoSlot,
  DamageUnit,
  Translation,
  Skill as SkillType,
  GunClassification,
} from "./types";
import { isItemSubtype } from "./types";

// Imports from new/refactored gun logic files
import {
  type FiringModeDetail, // From gunProperties, used by formatFiringModesForDisplay
} from "./gunProperties";
import {
  type CombatProfile,
  AimingStrategy, // From combatMechanics
} from "./combatMechanics";
import {
  getRepresentativeCombatInfo,
  TEST_GUY_PROFILE,
  type RepresentativeCombatInfo, // From gunDPS
} from "./gunDPS";
import {
  DEFAULT_REFERENCE_RANGE_TILES, // From gameConstants
} from "./gameConstants";

import {
  getItemNameFromIdOrObject,
  formatFireableAmmoItems,
  formatCompatibleMagazines,
  formatCategory,
  formatGunBaseRangedDamageDisplay,
  formatGunBaseAPDisplay,
  formatModSlots,
  formatMaterial,
  formatFaults,
  formatDefaultMods,
  formatVolumeForSort,
  formatWeightForSort,
  formatNumberOrNull,
  formatFiringModesForDisplay,
  formatDpsTooltip,
} from "./formatters";
import {
  log,
  downloadLogs,
  clearLogs as clearDebugLogs,
  getLogsAsString,
} from "./debugLogger";

export let data: CddaData;

type EntityType = "gun" | "armor" | "monster";

type GunWithCombatInfo = Item & {
  _calculatedCombatInfo?: RepresentativeCombatInfo | null;
  _classification: GunClassification;
  id: string;
};

interface ColumnDefinition {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  formatter?: (
    value: any,
    entity: GunWithCombatInfo,
    processor: CddaData
  ) => string | number | null;
  displayUnit?: string;
  hidden?: boolean;
  getSortFilterValue?: (entity: GunWithCombatInfo, processor: CddaData) => any;
  cellClass?: string;
  hasInfoPopup?: boolean;
  infoPopupContent?: string | ((entity: GunWithCombatInfo) => string);
}

let selectedEntityType: EntityType = "gun";
let allEntitiesForType: GunWithCombatInfo[] = [];
let displayedEntities: GunWithCombatInfo[] = [];
let tableColumns: ColumnDefinition[] = [];
let currentFilters: Record<string, string> = {};
let sortState: { columnKey: string | null; direction: "asc" | "desc" } = {
  columnKey: null,
  direction: "asc",
};

let includeVariants = false;
let includeNonTraditional = false;

let showTooltip = false;
let tooltipContent = "";
let tooltipX = 0;
let tooltipY = 0;

let showFullLog = false;
let fullLogContent = "";

function getNestedValue(obj: any, keyPath: string): any {
  if (!keyPath || !obj) return undefined;
  return keyPath
    .split(".")
    .reduce(
      (current, key) =>
        current && typeof current === "object" && current[key] !== undefined
          ? current[key]
          : undefined,
      obj
    );
}

function getGunProperty(item: Item, propertyName: keyof GunSlot): any {
  const gunItem = item as Item & GunSlot;
  return gunItem[propertyName];
}

function getItemBasicProperty(
  item: Item,
  propertyName: keyof ItemBasicInfo
): any {
  const basicItem = item as ItemBasicInfo;
  return basicItem[propertyName];
}

function classifyGun(
  gun: Item,
  processor: CddaData,
  allVariantIds: Set<string>
): GunClassification {
  let isVariant = allVariantIds.has(gun.id);
  let isNonTraditional = false;
  let weaponSubType: GunClassification["weaponSubType"] = "firearm";
  const gunNameForLog = getItemNameFromIdOrObject(gun, processor) || gun.id;
  const gunFlags = (gun as ItemBasicInfo).flags || [];
  const skill = (gun as Item & GunSlot).skill;
  const fireableAmmoDisplayString = formatFireableAmmoItems(gun, processor);

  if (gunFlags.includes("PSEUDO")) {
    isNonTraditional = true;
    weaponSubType = "other_nontrad";
    if (gunFlags.includes("BIONIC_WEAPON")) weaponSubType = "cbm_mutation";
    else if (gun.id.startsWith("mut_")) weaponSubType = "cbm_mutation";
  } else if (
    fireableAmmoDisplayString === "UPS Charge" ||
    fireableAmmoDisplayString === "UPS Compatible" ||
    fireableAmmoDisplayString === "Bionic Power" ||
    (gunFlags.includes("NEVER_JAMS") && gunFlags.includes("NO_AMMO"))
  ) {
    isNonTraditional = true;
    weaponSubType = "energy";
  } else if (skill === "archery") {
    isNonTraditional = true;
    weaponSubType = "archery";
  } else if (
    gun.id.includes("chemical_thrower") ||
    gunFlags.includes("FLAMETHROWER")
  ) {
    isNonTraditional = true;
    weaponSubType = "chemical";
  } else if (
    (gun as Item & GunSlot).ammo &&
    (gun as Item & GunSlot).ammo?.[0] === "NULL" &&
    !(gun as Item & GunSlot).default_mods
  ) {
    const magText = formatCompatibleMagazines(gun, processor);
    if (magText === "N/A" || magText?.startsWith("Internal Magazine")) {
      const baseRangedDamageProp = (gun as Item & GunSlot).ranged_damage;
      let baseDmgAmount = 0;
      if (baseRangedDamageProp) {
        const normalized = normalizeDamageInstance(baseRangedDamageProp);
        if (normalized.length > 0 && normalized[0])
          baseDmgAmount = normalized[0].amount || 0;
      }
      if (baseDmgAmount === 0 && fireableAmmoDisplayString === "N/A") {
        isNonTraditional = true;
        weaponSubType = "other_nontrad";
      }
    }
  }
  const classificationResult = { isVariant, isNonTraditional, weaponSubType };
  log(
    "CLASSIFY",
    `Gun: ${gun.id} (${gunNameForLog}) -> Classified as:`,
    classificationResult
  );
  return classificationResult;
}

function getGunColumns(): ColumnDefinition[] {
  return [
    {
      key: "name",
      label: "Name",
      sortable: true,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        getItemNameFromIdOrObject(entity, P),
      getSortFilterValue: (entity: GunWithCombatInfo, P: CddaData) =>
        getItemNameFromIdOrObject(entity, P),
    },
    { key: "id", label: "ID", sortable: true, filterable: true },
    {
      key: "category",
      label: "Category",
      sortable: true,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatCategory(entity as Item, P),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatCategory(e as Item, P),
      cellClass: "wrap-text",
    },
    {
      key: "_calculatedCombatInfo.referenceSustainedDps",
      label: `Sust. DPS (${DEFAULT_REFERENCE_RANGE_TILES}t)`,
      sortable: true,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const ci = entity._calculatedCombatInfo;
        if (!ci) return "N/A";
        if (ci.isModularVaries) return "Varies";
        if (ci.isRechargeableGun) return `Recharge`;
        if (ci.isNonConventional)
          return `N/C (${ci.nonConventionalType?.substring(0, 4) || ""})`;
        if (
          ci.referenceSustainedDps === null ||
          ci.referenceSustainedDps === undefined
        )
          return "N/A";
        return `${ci.referenceSustainedDps.toFixed(1)}`;
      },
      getSortFilterValue: (entity: GunWithCombatInfo) =>
        entity._calculatedCombatInfo?.referenceSustainedDps,
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent: (entity: GunWithCombatInfo) =>
        formatDpsTooltip(entity._calculatedCombatInfo),
    },
    {
      key: "_calculatedCombatInfo.dpsMagDumpNoReload",
      label: "DPS (Mag Dump)",
      sortable: true,
      filterable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const ci = entity._calculatedCombatInfo;
        if (
          !ci ||
          ci.isModularVaries ||
          ci.isRechargeableGun ||
          ci.isNonConventional
        )
          return "";
        return ci.dpsMagDumpNoReload !== null
          ? ci.dpsMagDumpNoReload.toFixed(1)
          : "N/A";
      },
      getSortFilterValue: (entity: GunWithCombatInfo) =>
        entity._calculatedCombatInfo?.dpsMagDumpNoReload,
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent:
        "DPS emptying one magazine (after initial aim), NO reload time included. Uses reference mode/ammo and default range.",
    },
    {
      key: "_calculatedCombatInfo.dpsPreciseAimPerShotNoReload",
      label: "DPS (Precise/Shot)",
      sortable: true,
      filterable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const ci = entity._calculatedCombatInfo;
        if (
          !ci ||
          ci.isModularVaries ||
          ci.isRechargeableGun ||
          ci.isNonConventional
        )
          return "";
        return ci.dpsPreciseAimPerShotNoReload !== null
          ? ci.dpsPreciseAimPerShotNoReload.toFixed(1)
          : "N/A";
      },
      getSortFilterValue: (entity: GunWithCombatInfo) =>
        entity._calculatedCombatInfo?.dpsPreciseAimPerShotNoReload,
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent:
        "DPS emptying one magazine, performing a full 'Precise Aim' (to gun's effective sight dispersion) before EACH shot. NO reload time included. Uses reference mode/ammo and default range.",
    },
    {
      key: "_calculatedCombatInfo.dphBase",
      label: "Effective Dmg / Shot",
      sortable: true,
      filterable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const ci = entity._calculatedCombatInfo;
        if (!ci) return "N/A";
        if (ci.isModularVaries) return "Varies";
        if (ci.isRechargeableGun && (!ci.dphBase || ci.dphBase === 0))
          return `Recharge`;
        if (ci.isNonConventional && (!ci.dphBase || ci.dphBase === 0))
          return `N/C`;
        if (ci.dphBase === null || ci.dphBase === undefined) return "N/A";
        let specialSuffix = "";
        if (ci.debugPrimaryAmmoEffects?.hasIncendiaryEffect)
          specialSuffix += " (Inc)";
        if (ci.debugPrimaryAmmoEffects?.isExplosive)
          specialSuffix += ` (Exp P:${
            ci.debugPrimaryAmmoEffects.explosionPower || 0
          })`;
        return `${ci.dphBase.toFixed(0)} ${ci.damageType.substring(0, 4)}/${
          ci.ap
        }AP (${(ci.ammoName || "").substring(0, 7)}${
          ci.barrelMatchInfo && ci.barrelMatchInfo !== "Default/Top-level"
            ? "*"
            : ""
        })${specialSuffix}`;
      },
      getSortFilterValue: (entity: GunWithCombatInfo) =>
        entity._calculatedCombatInfo?.dphBase,
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent:
        "Effective Damage Per Hit (DPH) & Armor Penetration (AP) for rep. ammo. '*' = barrel adjust. Special effects factored if applicable. Fire DoT not included in DPH/DPS.",
    },
    {
      key: "skill",
      label: "Skill",
      sortable: true,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        getGunProperty(entity as Item, "skill") || null,
    },
    {
      key: "_calculatedCombatInfo.availableFiringModes",
      label: "Firing Modes (RoF)",
      sortable: false,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatFiringModesForDisplay(
          entity._calculatedCombatInfo?.availableFiringModes
        ),
      getSortFilterValue: (entity: GunWithCombatInfo) =>
        formatFiringModesForDisplay(
          entity._calculatedCombatInfo?.availableFiringModes
        ),
      cellClass: "wrap-text",
    },
    {
      key: "fireableAmmoItems",
      label: "Fireable Ammo Items",
      sortable: false,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatFireableAmmoItems(entity as Item, P),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatFireableAmmoItems(e as Item, P),
      cellClass: "wrap-text",
    },
    {
      key: "compatibleMagazines",
      label: "Magazines",
      sortable: false,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatCompatibleMagazines(entity as Item, P),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatCompatibleMagazines(e as Item, P),
      cellClass: "wrap-text",
    },
    {
      key: "baseRangedDamageDisplay",
      label: "Gun Base Dmg",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatGunBaseRangedDamageDisplay(
          getGunProperty(entity as Item, "ranged_damage"),
          P
        ),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatGunBaseRangedDamageDisplay(
          getGunProperty(e as Item, "ranged_damage"),
          P
        ),
    },
    {
      key: "baseAPDisplay",
      label: "Gun Base AP",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatGunBaseAPDisplay(getGunProperty(entity as Item, "ranged_damage")),
      getSortFilterValue: (e: GunWithCombatInfo) =>
        formatGunBaseAPDisplay(getGunProperty(e as Item, "ranged_damage")),
    },
    {
      key: "range",
      label: "Range Bonus",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "range")),
    },
    {
      key: "dispersion",
      label: "Dispersion",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "dispersion")),
    },
    {
      key: "recoil",
      label: "Recoil",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "recoil")),
    },
    {
      key: "loudness",
      label: "Loudness Mod",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "loudness")),
    },
    {
      key: "reload",
      label: "Reload Time",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "reload")),
      displayUnit: "moves",
    },
    {
      key: "clipSize",
      label: "Internal Clip",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "clip_size")),
    },
    {
      key: "durability",
      label: "Durability",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatNumberOrNull(getGunProperty(entity as Item, "durability")),
    },
    {
      key: "material",
      label: "Material",
      filterable: true,
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatMaterial(getItemBasicProperty(entity as Item, "material"), P),
      cellClass: "wrap-text",
    },
    {
      key: "volume",
      label: "Volume",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatVolumeForSort(getItemBasicProperty(entity as Item, "volume")),
      displayUnit: "L",
    },
    {
      key: "weight",
      label: "Weight",
      sortable: true,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatWeightForSort(getItemBasicProperty(entity as Item, "weight")),
      displayUnit: "kg",
    },
    {
      key: "valid_mod_locations",
      label: "Mod Slots",
      sortable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) =>
        formatModSlots(getGunProperty(entity as Item, "valid_mod_locations")),
      cellClass: "wrap-text",
    },
    {
      key: "default_mods_display",
      label: "Default Mods",
      sortable: false,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatDefaultMods(getGunProperty(entity as Item, "default_mods"), P),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatDefaultMods(getGunProperty(e as Item, "default_mods"), P),
      cellClass: "wrap-text",
    },
    {
      key: "faults_display",
      label: "Possible Faults",
      sortable: false,
      filterable: true,
      formatter: (_val: any, entity: GunWithCombatInfo, P: CddaData) =>
        formatFaults(getItemBasicProperty(entity as Item, "faults"), P),
      getSortFilterValue: (e: GunWithCombatInfo, P: CddaData) =>
        formatFaults(getItemBasicProperty(e as Item, "faults"), P),
      cellClass: "wrap-text",
    },
  ];
}

function loadEntitiesForSelectedType() {
  log("INFO", `Loading entities for type: ${selectedEntityType}`);
  clearDebugLogs();
  if (!data) {
    allEntitiesForType = [];
    tableColumns = [];
    return;
  }
  if (selectedEntityType === "gun") {
    const rawGunItems = data
      .byType("item")
      .filter(
        (it): it is Item =>
          it.id !== undefined &&
          it.id !== null &&
          isItemSubtype("GUN", it as Item)
      );
    log("INFO", `Found ${rawGunItems.length} raw gun items.`);
    const allVariantIds = new Set<string>();
    rawGunItems.forEach((gun) => {
      const gunSlot = gun as Item & GunSlot;
      if (gunSlot.variant_type === "gun" && gunSlot.variants) {
        gunSlot.variants.forEach((variant) => allVariantIds.add(variant.id));
      }
    });
    allEntitiesForType = rawGunItems.map((gun) => {
      const classification = classifyGun(gun, data, allVariantIds);
      const combatInfo = getRepresentativeCombatInfo(
        gun,
        data,
        TEST_GUY_PROFILE,
        classification
      );
      return {
        ...gun,
        _calculatedCombatInfo: combatInfo,
        _classification: classification,
        id: gun.id,
      };
    });
    log(
      "INFO",
      `Processed ${allEntitiesForType.length} guns with combat info.`
    );
    tableColumns = getGunColumns();
  } else {
    allEntitiesForType = [];
    tableColumns = [];
  }
  currentFilters = {};
  sortState = { columnKey: null, direction: "asc" };
}

onMount(() => {
  if (data) {
    loadEntitiesForSelectedType();
  }
});
$: if (data && selectedEntityType) {
  loadEntitiesForSelectedType();
}

$: {
  if (allEntitiesForType.length > 0 && tableColumns.length > 0) {
    let itemsToDisplay = [...allEntitiesForType];
    log(
      "FILTER",
      `Starting filter block. Initial items: ${itemsToDisplay.length}`
    );
    if (!includeVariants) {
      const beforeFilter = itemsToDisplay.length;
      itemsToDisplay = itemsToDisplay.filter(
        (entity) => !entity._classification?.isVariant
      );
      log(
        "FILTER",
        `Applied 'Include Variants' (${includeVariants}). Items reduced from ${beforeFilter} to ${itemsToDisplay.length}.`
      );
    }
    if (!includeNonTraditional) {
      const beforeFilter = itemsToDisplay.length;
      itemsToDisplay = itemsToDisplay.filter(
        (entity) =>
          !entity._classification?.isNonTraditional &&
          !(
            entity._calculatedCombatInfo?.isNonConventional &&
            !entity._calculatedCombatInfo?.isRechargeableGun
          )
      );
      log(
        "FILTER",
        `Applied 'Include Non-Traditional' (${includeNonTraditional}). Items reduced from ${beforeFilter} to ${itemsToDisplay.length}.`
      );
    }
    let filtered = itemsToDisplay;
    for (const colDef of tableColumns) {
      if (colDef.hidden) continue;
      const filterVal = currentFilters[colDef.key];
      if (colDef.filterable && filterVal && filterVal.trim() !== "") {
        const filterValue = filterVal.toLowerCase().trim();
        const beforeFilterLength = filtered.length;
        filtered = filtered.filter((entity: GunWithCombatInfo) => {
          let valueToFilter: string | number | null | undefined;
          if (
            colDef.key === "_calculatedCombatInfo.referenceSustainedDps" ||
            colDef.key === "_calculatedCombatInfo.dpsMagDumpNoReload" ||
            colDef.key === "_calculatedCombatInfo.dpsPreciseAimPerShotNoReload"
          ) {
            valueToFilter = getNestedValue(entity, colDef.key);
          } else if (colDef.key === "_calculatedCombatInfo.dphBase")
            valueToFilter = entity._calculatedCombatInfo?.dphBase;
          else {
            valueToFilter = colDef.getSortFilterValue
              ? colDef.getSortFilterValue(entity, data)
              : colDef.formatter
              ? colDef.formatter(
                  getNestedValue(entity, colDef.key),
                  entity,
                  data
                )
              : getNestedValue(entity, colDef.key);
          }
          let displayValueForFilter =
            valueToFilter === null || valueToFilter === undefined
              ? "n/a"
              : String(valueToFilter);
          if (
            typeof displayValueForFilter === "string" &&
            displayValueForFilter.toLowerCase().startsWith("varies")
          )
            displayValueForFilter = "varies";
          if (
            typeof displayValueForFilter === "string" &&
            displayValueForFilter.toLowerCase().startsWith("rechargeable")
          )
            displayValueForFilter = "rechargeable";
          if (
            typeof displayValueForFilter === "string" &&
            displayValueForFilter.toLowerCase().startsWith("n/c")
          )
            displayValueForFilter = "n/c";
          return displayValueForFilter.toLowerCase().includes(filterValue);
        });
        log(
          "FILTER",
          `Text filter on '${colDef.label}' with '${filterVal}'. Items reduced from ${beforeFilterLength} to ${filtered.length}.`
        );
      }
    }
    if (sortState.columnKey) {
      const sortColumnDef = tableColumns.find(
        (c: ColumnDefinition) => c.key === sortState.columnKey
      );
      if (sortColumnDef && !sortColumnDef.hidden) {
        filtered.sort((a: GunWithCombatInfo, b: GunWithCombatInfo) => {
          let valA: any, valB: any;
          if (
            sortColumnDef.key ===
              "_calculatedCombatInfo.referenceSustainedDps" ||
            sortColumnDef.key === "_calculatedCombatInfo.dpsMagDumpNoReload" ||
            sortColumnDef.key ===
              "_calculatedCombatInfo.dpsPreciseAimPerShotNoReload"
          ) {
            valA =
              a._calculatedCombatInfo?.isModularVaries ||
              a._calculatedCombatInfo?.isRechargeableGun ||
              a._calculatedCombatInfo?.isNonConventional
                ? -Infinity
                : getNestedValue(a, sortColumnDef.key);
            valB =
              b._calculatedCombatInfo?.isModularVaries ||
              b._calculatedCombatInfo?.isRechargeableGun ||
              b._calculatedCombatInfo?.isNonConventional
                ? -Infinity
                : getNestedValue(b, sortColumnDef.key);
          } else if (sortColumnDef.key === "_calculatedCombatInfo.dphBase") {
            valA =
              a._calculatedCombatInfo?.isModularVaries ||
              a._calculatedCombatInfo?.isRechargeableGun ||
              a._calculatedCombatInfo?.isNonConventional
                ? -Infinity
                : a._calculatedCombatInfo?.dphBase;
            valB =
              b._calculatedCombatInfo?.isModularVaries ||
              b._calculatedCombatInfo?.isRechargeableGun ||
              b._calculatedCombatInfo?.isNonConventional
                ? -Infinity
                : b._calculatedCombatInfo?.dphBase;
          } else {
            valA = sortColumnDef.getSortFilterValue
              ? sortColumnDef.getSortFilterValue(a, data)
              : sortColumnDef.formatter
              ? sortColumnDef.formatter(
                  getNestedValue(a, sortColumnDef.key),
                  a,
                  data
                )
              : getNestedValue(a, sortColumnDef.key);
            valB = sortColumnDef.getSortFilterValue
              ? sortColumnDef.getSortFilterValue(b, data)
              : sortColumnDef.formatter
              ? sortColumnDef.formatter(
                  getNestedValue(b, sortColumnDef.key),
                  b,
                  data
                )
              : getNestedValue(b, sortColumnDef.key);
          }

          const aIsSpecial =
            valA === null ||
            valA === undefined ||
            (typeof valA === "string" &&
              valA.toLowerCase().startsWith("varies")) ||
            valA === -Infinity;
          const bIsSpecial =
            valB === null ||
            valB === undefined ||
            (typeof valB === "string" &&
              valB.toLowerCase().startsWith("varies")) ||
            valB === -Infinity;

          if (aIsSpecial && bIsSpecial) return 0;
          if (aIsSpecial) return sortState.direction === "asc" ? 1 : -1;
          if (bIsSpecial) return sortState.direction === "asc" ? -1 : 1;

          if (typeof valA === "number" && typeof valB === "number") {
            return sortState.direction === "asc" ? valA - valB : valB - valA;
          } else {
            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            return sortState.direction === "asc"
              ? strA.localeCompare(strB)
              : strB.localeCompare(strA);
          }
        });
      }
    }
    displayedEntities = filtered;
  } else {
    displayedEntities = [];
  }
}

function toggleSort(columnKey: string) {
  const colDef = tableColumns.find((c) => c.key === columnKey);
  if (!colDef?.sortable || colDef.hidden) return;
  if (sortState.columnKey === columnKey) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.columnKey = columnKey;
    sortState.direction = "asc";
  }
}
function clearFilter(columnKey: string) {
  currentFilters[columnKey] = "";
  currentFilters = { ...currentFilters };
}

function getColumnDisplayValue(
  entity: GunWithCombatInfo,
  col: ColumnDefinition,
  cddaData: CddaData
) {
  if (col.key.startsWith("_calculatedCombatInfo.")) {
    return col.formatter
      ? col.formatter(getNestedValue(entity, col.key), entity, cddaData)
      : "Error formatting";
  }
  const rawValue = getNestedValue(entity, col.key);
  const formatted = col.formatter
    ? col.formatter(rawValue, entity, cddaData)
    : rawValue;
  return formatted ?? "N/A";
}

function handleInfoHover(
  event: MouseEvent | FocusEvent,
  contentOrCallback:
    | string
    | ((entity: GunWithCombatInfo) => string)
    | undefined,
  entityForRow?: GunWithCombatInfo
) {
  if (!contentOrCallback) return;
  let finalContent: string;
  if (typeof contentOrCallback === "function") {
    if (
      !entityForRow &&
      event.currentTarget &&
      (event.currentTarget as HTMLElement).closest("td")
    ) {
      // This is a fallback if entityForRow wasn't passed but we are likely in a cell context
      // This part is tricky and might need a more robust way to get the entity if not passed.
      // For now, if entityForRow is needed by a function, it MUST be passed.
      log(
        "WARN",
        "Tooltip content is a function but no entity was provided. Header tooltips should be strings."
      );
      const colDef = tableColumns.find(
        (c) => c.infoPopupContent === contentOrCallback
      ); // Not reliable to find col this way
      finalContent = colDef
        ? `General info for ${colDef.label}`
        : "Detailed information requires row context.";
    } else if (entityForRow) {
      finalContent = contentOrCallback(entityForRow);
    } else {
      // It's a function, but no entity available (likely a header icon that shouldn't have a function tooltip)
      finalContent = "General column information.";
    }
  } else {
    finalContent = contentOrCallback;
  }
  if (!finalContent) return;
  tooltipContent = finalContent;
  if (event instanceof MouseEvent) {
    tooltipX = event.pageX + 10;
    tooltipY = event.pageY + 10;
  } else if (event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect();
    tooltipX = rect.left + window.scrollX + rect.width / 2 - 150;
    tooltipY = rect.bottom + window.scrollY + 5;
    if (tooltipX + 300 > window.innerWidth) tooltipX = window.innerWidth - 310;
    if (tooltipX < 0) tooltipX = 10;
  }
  showTooltip = true;
}
function handleInfoLeave() {
  showTooltip = false;
}

function handleDownloadLogs() {
  downloadLogs();
}
function handleShowFullLog() {
  fullLogContent = getLogsAsString();
  showFullLog = true;
}
function handleClearDebugLogs() {
  clearDebugLogs();
  log("INFO", "Debug logs cleared by user.");
  if (showFullLog) fullLogContent = getLogsAsString();
}
</script>

// src/ComparisonPage.svelte
<div class="comparison-page">
  <div
    class="debug-controls"
    style="padding: 10px; background-color: #333; margin-bottom: 1em; display: flex; gap: 10px; flex-wrap: wrap;">
    <button on:click={handleDownloadLogs}>Download Debug Log</button>
    <button on:click={handleShowFullLog}>Show Full Log in Page</button>
    <button on:click={handleClearDebugLogs}>Clear Debug Log</button>
  </div>

  {#if showFullLog}
    <div
      class="full-log-display"
      style="position: fixed; top: 20px; left: 20px; right: 20px; bottom: 20px; background: rgba(0,0,0,0.95); color: #ddd; z-index: 2000; overflow: auto; padding: 20px; border: 1px solid #555; font-family: monospace; font-size: 0.8em;">
      <button
        on:click={() => (showFullLog = false)}
        style="position: absolute; top: 5px; right: 5px; padding: 5px 10px; background: #555; color: white; border: none; cursor: pointer;"
        >Close Log</button>
      <h3>Full Debug Log:</h3>
      <pre>{fullLogContent}</pre>
    </div>
  {/if}

  <div class="entity-selector">
    <button
      class:active={selectedEntityType === "gun"}
      on:click={() => (selectedEntityType = "gun")}>Guns</button>
    <button
      class:active={selectedEntityType === "armor"}
      on:click={() => (selectedEntityType = "armor")}
      disabled>Armor</button>
    <button
      class:active={selectedEntityType === "monster"}
      on:click={() => (selectedEntityType = "monster")}
      disabled>Monsters</button>
  </div>
  {#if !data}
    <p class="loading-message">Waiting for data processor to load...</p>
  {:else if tableColumns.length > 0}
    <div class="table-controls">
      <div class="checkbox-filter">
        <input
          type="checkbox"
          id="includeVariants"
          bind:checked={includeVariants} />
        <label for="includeVariants">Include Variant Weapons</label>
      </div>
      <div class="checkbox-filter">
        <input
          type="checkbox"
          id="includeNonTraditional"
          bind:checked={includeNonTraditional} />
        <label for="includeNonTraditional"
          >Include Non-Traditional (Energy, Bows, etc.)</label>
      </div>
      {#each tableColumns.filter((col) => col.filterable && !col.hidden) as col (col.key)}
        <div class="filter-input">
          <label for="filter-{col.key}">{col.label}:</label>
          <div style="display: flex;">
            <input
              type="text"
              id="filter-{col.key}"
              placeholder="Filter..."
              bind:value={currentFilters[col.key]} />
            {#if currentFilters[col.key]}
              <button
                class="clear-filter"
                on:click={() => clearFilter(col.key)}
                title="Clear filter for {col.label}">×</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if displayedEntities.length > 0}
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              {#each tableColumns.filter((col) => !col.hidden) as col (col.key)}
                <th
                  on:click={() => toggleSort(col.key)}
                  class:sortable={col.sortable}
                  title={col.label}>
                  {col.label}
                  {#if col.hasInfoPopup}
                    <span
                      class="info-icon"
                      on:mouseenter={(e) =>
                        handleInfoHover(
                          e,
                          typeof col.infoPopupContent === "string"
                            ? col.infoPopupContent
                            : `Info for ${col.label}`,
                          undefined
                        )}
                      on:mouseleave={handleInfoLeave}
                      on:focus={(e) =>
                        handleInfoHover(
                          e,
                          typeof col.infoPopupContent === "string"
                            ? col.infoPopupContent
                            : `Info for ${col.label}`,
                          undefined
                        )}
                      on:blur={handleInfoLeave}
                      tabindex="0"
                      role="button"
                      aria-label="More info">ⓘ</span>
                  {/if}
                  {#if col.sortable && sortState.columnKey === col.key}
                    <span class="sort-arrow"
                      >{sortState.direction === "asc" ? "▲" : "▼"}</span>
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each displayedEntities as entity (entity.id)}
              <tr>
                {#each tableColumns.filter((col) => !col.hidden) as col (col.key)}
                  {@const cellDisplayValue = getColumnDisplayValue(
                    entity,
                    col,
                    data
                  )}
                  <td
                    class={col.cellClass ?? ""}
                    title={typeof cellDisplayValue === "string" &&
                    (cellDisplayValue.length > 30 ||
                      (cellDisplayValue.includes &&
                        cellDisplayValue.includes("\n"))) &&
                    !col.cellClass?.includes("wrap-text")
                      ? cellDisplayValue
                      : ""}
                    on:mouseenter={(e) => {
                      if (typeof col.infoPopupContent === "function")
                        handleInfoHover(e, col.infoPopupContent, entity);
                    }}
                    on:focus={(e) => {
                      if (typeof col.infoPopupContent === "function")
                        handleInfoHover(e, col.infoPopupContent, entity);
                    }}
                    on:mouseleave={(e) => {
                      if (typeof col.infoPopupContent === "function")
                        handleInfoLeave();
                    }}>
                    {#if col.cellClass?.includes("wrap-text")}
                      {@html typeof cellDisplayValue === "string"
                        ? cellDisplayValue.replace(/\n/g, "<br/>")
                        : cellDisplayValue}
                    {:else}
                      {cellDisplayValue}
                    {/if}<!--
                    -->{#if col.displayUnit && cellDisplayValue !== "N/A" && typeof cellDisplayValue === "number" && !(String(cellDisplayValue).toLowerCase() === "varies" || String(cellDisplayValue)
                          .toLowerCase()
                          .startsWith("rechargeable") || String(cellDisplayValue)
                          .toLowerCase()
                          .startsWith("n/c"))}
                      {" " + col.displayUnit}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="no-results-message">
        No {selectedEntityType}s match the current filters.
      </p>
    {/if}
  {:else if selectedEntityType}
    <p class="info-message">
      No data or columns defined for {selectedEntityType}. Please ensure columns
      are set up.
    </p>
  {/if}

  {#if showTooltip}
    <div class="tooltip" style="left: {tooltipX}px; top: {tooltipY}px;">
      {@html tooltipContent}
    </div>
  {/if}
</div>

<style>
.comparison-page {
  padding: 1em;
  max-width: 100%;
  box-sizing: border-box;
  background-color: var(--cata-color-black, #121212);
  color: var(--cata-color-white, #ffffff);
  min-height: calc(100vh - 4rem - 2em);
}
.loading-message,
.no-results-message,
.info-message {
  color: var(--cata-color-gray, #969696);
  padding: 1em;
  text-align: center;
}
.entity-selector {
  margin-bottom: 1em;
  display: flex;
  gap: 0.5em;
}
.entity-selector button {
  padding: 0.5em 1em;
  border: 1px solid #303030;
  background-color: #2a2a2a;
  color: var(--cata-color-gray, #969696);
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s, border-color 0.2s;
}
.entity-selector button:hover:not(:disabled) {
  background-color: #383838;
  border-color: #505050;
}
.entity-selector button.active {
  background-color: hsl(122deg, 44%, 35%);
  color: var(--cata-color-white, #ffffff);
  border-color: hsl(122deg, 44%, 45%);
}
.entity-selector button:disabled {
  background-color: #202020;
  color: #505050;
  cursor: not-allowed;
  border-color: #252525;
}
.table-wrapper {
  overflow-x: auto;
  border: 1px solid #303030;
  border-radius: 3px;
  max-height: calc(100vh - 18em);
} /* Adjusted max-height for debug controls */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  table-layout: fixed;
}
th,
td {
  border: 1px solid #303030;
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
td.wrap-text {
  white-space: normal;
  word-break: break-word;
}
th {
  background-color: #2a2a2a;
  color: var(--cata-color-light_gray, #c8c8c8);
  position: sticky;
  top: 0;
  z-index: 2;
  font-weight: bold;
}
.sort-arrow {
  font-size: 0.8em;
  margin-left: 0.3em;
  color: hsl(122deg, 44%, 61%);
}
th.sortable {
  cursor: pointer;
}
th.sortable:hover {
  background-color: #383838;
}
.table-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 20px;
  margin-bottom: 1.5em;
  padding: 1em;
  background-color: #1a1a1a;
  border-radius: 4px;
  align-items: flex-end;
}
.filter-input {
  display: flex;
  flex-direction: column;
  min-width: 160px;
}
.filter-input label {
  font-size: 0.75em;
  margin-bottom: 0.3em;
  color: var(--cata-color-gray, #969696);
  text-transform: uppercase;
}
.filter-input input {
  width: 100%;
  padding: 0.5em;
  border: 1px solid #303030;
  background-color: var(--cata-color-black, #121212);
  color: var(--cata-color-white, #ffffff);
  border-radius: 3px;
  box-sizing: border-box;
}
.filter-input input:focus {
  border-color: hsl(122deg, 44%, 50%);
  outline: none;
  box-shadow: 0 0 0 2px hsla(122, 44%, 50%, 0.3);
}
.filter-input div {
  display: flex;
  align-items: center;
}
.clear-filter {
  margin-left: 5px;
  padding: 0.5em 0.6em;
  font-size: 0.9em;
  line-height: 1;
  border: 1px solid #303030;
  background: #2a2a2a;
  color: var(--cata-color-gray, #969696);
  cursor: pointer;
  border-radius: 3px;
}
.clear-filter:hover {
  background: #383838;
  color: var(--cata-color-white, #ffffff);
}
td:empty::after {
  content: "\\00a0";
}
.checkbox-filter {
  display: flex;
  align-items: center;
  margin-right: 20px;
  margin-bottom: 0.5em;
}
.checkbox-filter input {
  margin-right: 5px;
}
.checkbox-filter label {
  font-size: 0.9em;
  color: var(--cata-color-light_gray, #c8c8c8);
  user-select: none;
}
.info-icon {
  cursor: help;
  margin-left: 4px;
  color: hsl(122deg, 40%, 70%);
  font-weight: bold;
  display: inline-block;
  border: 1px solid transparent;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  text-align: center;
  line-height: 16px;
  user-select: none;
}
.info-icon:hover,
.info-icon:focus {
  color: hsl(122deg, 50%, 80%);
  border-color: hsl(122deg, 40%, 70%);
  outline: none;
}
.tooltip {
  position: fixed;
  background-color: #333;
  color: white;
  padding: 10px 15px;
  border-radius: 4px;
  border: 1px solid #555;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  font-size: 0.85em;
  white-space: pre-wrap;
  z-index: 1000;
  max-width: 450px;
  pointer-events: none;
}
.debug-controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px;
  background-color: #1e1e1e;
  margin-bottom: 1em;
  border-radius: 4px;
}
.debug-controls button {
  padding: 0.4em 0.8em;
  font-size: 0.9em;
}
.full-log-display {
  position: fixed;
  top: 10vh;
  left: 10vw;
  right: 10vw;
  bottom: 10vh;
  width: 80vw;
  height: 80vh;
  background: rgba(20, 20, 20, 0.97);
  color: #e0e0e0;
  z-index: 2000;
  overflow: auto;
  padding: 20px;
  border: 1px solid #444;
  box-shadow: 0 0 15px rgba(0, 0, 0, 0.5);
  font-family: monospace;
  font-size: 0.8em;
  border-radius: 5px;
}
.full-log-display pre {
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Column Widths - Adjust indices based on final column order! */
/* Order: Name, ID, Cat, Sust DPS, MagDump DPS, Precise DPS, DPH, Skill, Modes, Ammo, Mags, ... */
th[title="Name"],
td:nth-child(1) {
  width: 160px;
}
th[title="ID"],
td:nth-child(2) {
  width: 120px;
}
th[title="Category"],
td:nth-child(3) {
  width: 110px;
}
th[title^="Sust. DPS"],
td:nth-child(4) {
  width: 90px;
}
th[title^="DPS (Mag Dump)"],
td:nth-child(5) {
  width: 90px;
}
th[title^="DPS (Precise/Shot)"],
td:nth-child(6) {
  width: 90px;
}
th[title^="Effective Dmg"],
td:nth-child(7) {
  width: 140px;
}
th[title="Skill"],
td:nth-child(8) {
  width: 70px;
}
th[title^="Firing Modes"],
td:nth-child(9) {
  width: 140px;
}
th[title="Fireable Ammo Items"],
td:nth-child(10) {
  width: 180px;
}
th[title="Magazines"],
td:nth-child(11) {
  width: 180px;
}
/* The default width will apply to columns from 12 onwards, adjust as necessary */
/* Example: Base Dmg, Base AP, Range, Dispersion, Recoil, Loudness, Reload, Clip, Durability */
td:nth-child(12),
td:nth-child(13),
td:nth-child(14),
td:nth-child(15),
td:nth-child(16),
td:nth-child(17),
td:nth-child(18),
td:nth-child(19),
td:nth-child(20) {
  width: 80px; /* A smaller default for numeric stats */
}
th[title="Material"],
td:nth-child(21) {
  width: 120px;
} /* Adjusted index */
th[title="Volume"],
td:nth-child(22) {
  width: 70px;
} /* Adjusted index */
th[title="Weight"],
td:nth-child(23) {
  width: 70px;
} /* Adjusted index */
th[title="Mod Slots"],
td:nth-child(24) {
  width: 150px;
} /* Adjusted index */
th[title="Default Mods"],
td:nth-child(25) {
  width: 150px;
} /* Adjusted index */
th[title="Possible Faults"],
td:nth-child(26) {
  width: 150px;
} /* Adjusted index */
</style>
