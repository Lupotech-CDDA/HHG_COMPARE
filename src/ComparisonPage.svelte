<script lang="ts">
import { onMount } from "svelte";
import { CddaData, normalizeDamageInstance } from "./data"; // Added normalizeDamageInstance
import type {
  Item,
  GunSlot,
  ItemBasicInfo,
  AmmoSlot,
  DamageUnit,
  Translation,
  Skill as SkillType,
  GunClassification,
} from "./types"; // GunClassification from types
import { isItemSubtype } from "./types";
import {
  getRepresentativeCombatInfo,
  TEST_GUY_PROFILE,
  type RepresentativeCombatInfo,
  type CombatProfile, // Keep if you plan to make profile selectable
  AimingStrategy,
} from "./gunLogic";
import {
  getItemNameFromIdOrObject,
  formatFireableAmmoItems,
  formatCompatibleMagazines,
  formatCategory,
  formatGunBaseRangedDamageDisplay,
  formatGunBaseAPDisplay,
  formatModSlots,
  formatMaterial,
  formatModes,
  formatFaults,
  formatDefaultMods,
  formatVolumeForSort,
  formatWeightForSort,
  formatNumberOrNull,
} from "./formatters";

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
  infoPopupContent?: string;
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
  return { isVariant, isNonTraditional, weaponSubType };
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
      key: "_calculatedCombatInfo.rawSustainedDps",
      label: "Effective DPS (Test Guy)",
      sortable: true,
      filterable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const combatInfo = entity._calculatedCombatInfo;
        if (!combatInfo || combatInfo.rawSustainedDps === null) {
          return combatInfo?.ammoName === "Varies (Modular)" ||
            entity._classification.isNonTraditional
            ? "Varies"
            : "N/A";
        }
        return `${combatInfo.rawSustainedDps.toFixed(
          1
        )} (${combatInfo.modeUsed?.substring(0, 8)})`;
      },
      getSortFilterValue: (entity: GunWithCombatInfo) => {
        const combatInfo = entity._calculatedCombatInfo;
        return combatInfo &&
          combatInfo.ammoName !== "Varies (Modular)" &&
          !entity._classification.isNonTraditional
          ? combatInfo.rawSustainedDps
          : null;
      },
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent:
        "Effective Sustained DPS: Calculated for Test Guy (Skills 4, Stats 10). Assumes aiming to 'Regular' threshold (with time cost), factors in simplified accuracy (hit/crit/graze model vs. 0.5m target @ 10 tiles), recoil accumulation, uses representative ammo & firing mode, includes reload.",
    },
    {
      key: "_calculatedCombatInfo.dphBase",
      label: "Rep. Dmg/AP (Ammo*)",
      sortable: true,
      filterable: false,
      formatter: (_val: any, entity: GunWithCombatInfo) => {
        const combatInfo = entity._calculatedCombatInfo;
        if (!combatInfo) return "N/A";
        if (
          combatInfo.ammoName === "Varies (Modular)" ||
          entity._classification.isNonTraditional
        )
          return "Varies";
        return `${combatInfo.dphBase} ${
          combatInfo.damageType.split(" ")[0]
        } / ${combatInfo.ap} AP (${(combatInfo.ammoName || "Ammo").substring(
          0,
          10
        )}${combatInfo.barrelMatchInfo ? "*" : ""})`;
      },
      getSortFilterValue: (entity: GunWithCombatInfo) => {
        const combatInfo = entity._calculatedCombatInfo;
        return combatInfo &&
          combatInfo.ammoName !== "Varies (Modular)" &&
          !entity._classification.isNonTraditional
          ? combatInfo.dphBase
          : null;
      },
      cellClass: "wrap-text",
      hasInfoPopup: true,
      infoPopupContent:
        "Representative Damage Per Hit (DPH) & Armor Penetration (AP) for a 'standard' conventional fireable ammo. Adjusted for effective barrel length. '*' indicates barrel length adjustment was applied based on gun's barrel.",
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

    if (!includeVariants) {
      itemsToDisplay = itemsToDisplay.filter(
        (entity) => !entity._classification?.isVariant
      );
    }
    if (!includeNonTraditional) {
      itemsToDisplay = itemsToDisplay.filter(
        (entity) => !entity._classification?.isNonTraditional
      );
    }

    let filtered = itemsToDisplay;

    for (const colDef of tableColumns) {
      if (colDef.hidden) continue;
      const filterInput = currentFilters[colDef.key];
      if (colDef.filterable && filterInput && filterInput.trim() !== "") {
        const filterValue = filterInput.toLowerCase().trim();
        filtered = filtered.filter((entity: GunWithCombatInfo) => {
          let valueToFilter;
          if (colDef.key === "_calculatedCombatInfo.rawSustainedDps")
            valueToFilter = entity._calculatedCombatInfo?.rawSustainedDps;
          else if (colDef.key === "_calculatedCombatInfo.dphBase")
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
          const displayValueForFilter =
            valueToFilter === null || valueToFilter === undefined
              ? "n/a"
              : String(valueToFilter);
          return displayValueForFilter.toLowerCase().includes(filterValue);
        });
      }
    }
    if (sortState.columnKey) {
      const sortColumnDef = tableColumns.find(
        (c: ColumnDefinition) => c.key === sortState.columnKey
      );
      if (sortColumnDef && !sortColumnDef.hidden) {
        filtered.sort((a: GunWithCombatInfo, b: GunWithCombatInfo) => {
          let valA, valB;
          if (sortColumnDef.key === "_calculatedCombatInfo.rawSustainedDps") {
            valA = a._calculatedCombatInfo?.rawSustainedDps;
            valB = b._calculatedCombatInfo?.rawSustainedDps;
          } else if (sortColumnDef.key === "_calculatedCombatInfo.dphBase") {
            valA = a._calculatedCombatInfo?.dphBase;
            valB = b._calculatedCombatInfo?.dphBase;
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

          const aIsVariesOrNull =
            (typeof valA === "string" && valA.toLowerCase() === "varies") ||
            valA === null ||
            valA === undefined;
          const bIsVariesOrNull =
            (typeof valB === "string" && valB.toLowerCase() === "varies") ||
            valB === null ||
            valB === undefined;

          if (aIsVariesOrNull && bIsVariesOrNull) return 0;
          if (aIsVariesOrNull) return sortState.direction === "asc" ? 1 : -1;
          if (bIsVariesOrNull) return sortState.direction === "asc" ? -1 : 1;
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
  if (
    col.key === "_calculatedCombatInfo.rawSustainedDps" ||
    col.key === "_calculatedCombatInfo.dphBase"
  ) {
    return col.formatter ? col.formatter(null, entity, cddaData) : "Error";
  }
  const rawValue = getNestedValue(entity, col.key);
  const formatted = col.formatter
    ? col.formatter(rawValue, entity, cddaData)
    : rawValue;
  return formatted ?? "N/A";
}

function handleInfoHover(
  event: MouseEvent | FocusEvent,
  content: string | undefined
) {
  if (!content) return;
  tooltipContent = content;
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
</script>

<div class="comparison-page">
  <!-- HTML structure remains the same -->
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
                        handleInfoHover(e, col.infoPopupContent)}
                      on:mouseleave={handleInfoLeave}
                      on:focus={(e) => handleInfoHover(e, col.infoPopupContent)}
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
                    cellDisplayValue.length > 30 &&
                    !col.cellClass?.includes("wrap-text")
                      ? cellDisplayValue
                      : ""}>
                    {cellDisplayValue}<!--
                    -->{#if col.displayUnit && cellDisplayValue !== "N/A" && typeof cellDisplayValue === "number"}
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
      {tooltipContent}
    </div>
  {/if}
</div>

<style>
/* Styles remain the same */
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
  max-height: calc(100vh - 15em);
}
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
  content: "\00a0";
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
  max-width: 400px;
  pointer-events: none;
}

th[title="Name"],
td:nth-child(1) {
  width: 200px;
  white-space: normal;
  word-break: break-word;
}
th[title="ID"],
td:nth-child(2) {
  width: 150px;
}
th[title="Category"],
td:nth-child(3) {
  width: 150px;
  white-space: normal;
  word-break: break-word;
}
th[title="Effective DPS (Test Guy)"],
td:nth-child(4) {
  width: 120px;
  white-space: normal;
  word-break: break-word;
}
th[title="Rep. Dmg/AP (Ammo*)"],
td:nth-child(5) {
  width: 150px;
  white-space: normal;
  word-break: break-word;
}
th[title="Fireable Ammo Items"],
td:nth-child(7) {
  width: 250px;
  white-space: normal;
  word-break: break-word;
}
th[title="Magazines"],
td:nth-child(8) {
  width: 250px;
  white-space: normal;
  word-break: break-word;
}
th[title="Material"],
td:nth-child(18) {
  width: 180px;
  white-space: normal;
  word-break: break-word;
}
th[title="Mod Slots"],
td:nth-child(21) {
  width: 200px;
  white-space: normal;
  word-break: break-word;
}
th[title="Default Mods"],
td:nth-child(22) {
  width: 200px;
  white-space: normal;
  word-break: break-word;
}
th[title="Possible Faults"],
td:nth-child(23) {
  width: 200px;
  white-space: normal;
  word-break: break-word;
}
</style>
