<script lang="ts">
import { onMount } from "svelte";

//test
// CORRECTED IMPORT PATHS to be absolute from 'src/'
import {
  CddaData,
  normalizeDamageInstance,
  singularName,
  asLiters,
  asKilograms,
  mapType,
} from "./data"; // Assumes data.ts is directly in src/

import type {
  Item,
  GunSlot,
  Translation,
  DamageUnit,
  ItemBasicInfo,
} from "./types"; // Assumes types.ts is directly in src/
import { isItemSubtype } from "./types"; // Assumes isItemSubtype is exported from src/types.ts

// This prop will be passed from App.svelte: <ComparisonPage data={$data} />
export let data: CddaData;
console.log("ComparisonPage: Received data prop:", data);
if (data) {
  console.log("ComparisonPage: data prop build number:", data.build_number);
}

// --- State for this page ---
type EntityType = "gun" | "armor" | "monster";
let selectedEntityType: EntityType = "gun";

let allEntitiesForType: any[] = [];
let displayedEntities: any[] = [];
let tableColumns: ColumnDefinition[] = [];

// --- Column Definition Type ---
interface ColumnDefinition {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  formatter?: (value: any, entity: any, processor: CddaData) => string | number; // Changed processor to CddaData
  hidden?: boolean;
}

// --- Helper to get value from potentially nested key ---
function getNestedValue(obj: any, keyPath: string): any {
  if (!keyPath) return undefined;
  return keyPath
    .split(".")
    .reduce(
      (current, key) =>
        current && current[key] !== undefined ? current[key] : undefined,
      obj
    );
}

// --- Formatters ---
function formatName(value: Translation | undefined): string {
  if (!value) return "N/A";
  // singularName might be directly available if imported, or a method on `data` instance
  // Assuming singularName is a top-level export from 'src/data.ts'
  return singularName({ name: value });
}

function formatVolume(value: ItemBasicInfo["volume"]): string {
  return value !== undefined ? asLiters(value) : "N/A";
}

function formatWeight(value: ItemBasicInfo["weight"]): string {
  return value !== undefined ? asKilograms(value) : "N/A";
}

function formatRangedDamage(value: GunSlot["ranged_damage"]): string {
  if (!value) return "0";
  const damages = normalizeDamageInstance(value);
  if (!damages || damages.length === 0) return "0";
  return damages
    .map((d) => `${d.amount || 0} ${d.damage_type || "N/A"}`)
    .join(" + ");
}

function formatArmorPenetration(value: GunSlot["ranged_damage"]): number {
  if (!value) return 0;
  const damages = normalizeDamageInstance(value);
  return damages[0]?.armor_penetration || 0;
}

function formatModSlots(value: GunSlot["valid_mod_locations"]): string {
  if (!value || value.length === 0) return "None";
  return value.map(([loc, num]) => `${loc} (${num})`).join(", ");
}

function formatMaterial(value: ItemBasicInfo["material"]): string {
  if (!value) return "N/A";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((m) =>
        typeof m === "string"
          ? m
          : m.type + (m.portion ? ` (${Math.round(m.portion * 100)}%)` : "")
      )
      .join(", ");
  }
  return String(value);
}

// --- Column Definitions ---
function getGunColumns(): ColumnDefinition[] {
  return [
    {
      key: "name",
      label: "Name",
      sortable: true,
      filterable: true,
      formatter: (val) => formatName(val as Translation | undefined),
    },
    { key: "id", label: "ID", sortable: true, filterable: true },
    {
      key: "skill",
      label: "Skill",
      sortable: true,
      filterable: true,
      formatter: (val) => val || "N/A",
    },
    {
      key: "ranged_damage",
      label: "Base Damage",
      sortable: true,
      formatter: (val) => formatRangedDamage(val as GunSlot["ranged_damage"]),
    },
    {
      key: "ranged_damage_ap",
      label: "AP",
      sortable: true,
      formatter: (val) =>
        String(formatArmorPenetration(val as GunSlot["ranged_damage"])), // Ensure formatter returns string or number
    },
    {
      key: "range",
      label: "Range Bonus",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "dispersion",
      label: "Dispersion",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "recoil",
      label: "Recoil",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "loudness",
      label: "Loudness Mod",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "reload",
      label: "Reload Time",
      sortable: true,
      formatter: (val) => `${val || 0} moves`,
    },
    {
      key: "clip_size",
      label: "Clip Size",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "durability",
      label: "Durability",
      sortable: true,
      formatter: (val) => val || 0,
    },
    {
      key: "material",
      label: "Material",
      filterable: true,
      formatter: (val) => formatMaterial(val as ItemBasicInfo["material"]),
    },
    {
      key: "volume",
      label: "Volume",
      sortable: true,
      formatter: (val) => formatVolume(val as ItemBasicInfo["volume"]),
    },
    {
      key: "weight",
      label: "Weight",
      sortable: true,
      formatter: (val) => formatWeight(val as ItemBasicInfo["weight"]),
    },
    {
      key: "category",
      label: "Category",
      filterable: true,
      formatter: (val) => val || "N/A",
    },
    {
      key: "valid_mod_locations",
      label: "Mod Slots",
      formatter: (val) => formatModSlots(val as GunSlot["valid_mod_locations"]),
    },
  ];
}

// --- Logic to load entities ---
function loadEntitiesForSelectedType() {
  if (!data) {
    console.error(
      "ComparisonPage: CddaData instance (data prop) not available."
    );
    allEntitiesForType = [];
    tableColumns = [];
    return;
  }

  console.log(
    `ComparisonPage: Loading entities for type - ${selectedEntityType}`
  );
  if (selectedEntityType === "gun") {
    allEntitiesForType = data
      .byType("item")
      .filter((it) => isItemSubtype("GUN", it as Item));
    tableColumns = getGunColumns();
  } else if (selectedEntityType === "armor") {
    allEntitiesForType = data
      .byType("item")
      .filter(
        (it) =>
          isItemSubtype("ARMOR", it as Item) ||
          isItemSubtype("TOOL_ARMOR", it as Item)
      );
    tableColumns = [
      {
        key: "name",
        label: "Name",
        formatter: (val) => formatName(val as Translation | undefined),
      },
    ];
    console.warn("Armor comparison columns not fully defined.");
  } else if (selectedEntityType === "monster") {
    allEntitiesForType = data.byType("monster");
    tableColumns = [
      {
        key: "name",
        label: "Name",
        formatter: (val) => formatName(val as Translation | undefined),
      },
    ];
    console.warn("Monster comparison columns not fully defined.");
  } else {
    allEntitiesForType = [];
    tableColumns = [];
  }
  console.log(
    `ComparisonPage: Loaded ${allEntitiesForType.length} entities for ${selectedEntityType}.`
  );
  currentFilters = {}; // Reset filters when entity type changes
  sortState = { columnKey: null, direction: "asc" }; // Reset sort state
}

onMount(() => {
  console.log("ComparisonPage onMount: data is", data);
  if (data) {
    loadEntitiesForSelectedType();
  }
});

$: if (data && selectedEntityType) {
  // Also react to selectedEntityType changes
  loadEntitiesForSelectedType();
}

// --- State for filtering and sorting ---
let currentFilters: Record<string, string> = {};
let sortState: { columnKey: string | null; direction: "asc" | "desc" } = {
  columnKey: null,
  direction: "asc",
};

$: {
  if (allEntitiesForType.length > 0 && tableColumns.length > 0) {
    let filtered = [...allEntitiesForType];
    for (const colDef of tableColumns) {
      if (
        colDef.filterable &&
        currentFilters[colDef.key] &&
        currentFilters[colDef.key].trim() !== ""
      ) {
        const filterValue = currentFilters[colDef.key].toLowerCase().trim();
        filtered = filtered.filter((entity) => {
          const entityValue = getNestedValue(entity, colDef.key);
          const displayValue = colDef.formatter
            ? String(colDef.formatter(entityValue, entity, data))
            : String(entityValue ?? "");
          return displayValue.toLowerCase().includes(filterValue);
        });
      }
    }

    if (sortState.columnKey) {
      const sortColumnDef = tableColumns.find(
        (c) => c.key === sortState.columnKey
      );
      if (sortColumnDef) {
        filtered.sort((a, b) => {
          let valA = getNestedValue(a, sortState.columnKey!);
          let valB = getNestedValue(b, sortState.columnKey!);

          if (sortColumnDef.formatter) {
            valA = sortColumnDef.formatter(valA, a, data);
            valB = sortColumnDef.formatter(valB, b, data);
          }

          if (typeof valA === "number" && typeof valB === "number") {
            return sortState.direction === "asc" ? valA - valB : valB - valA;
          } else {
            const strA = String(valA ?? "").toLowerCase();
            const strB = String(valB ?? "").toLowerCase();
            if (strA === "n/a" && strB !== "n/a")
              return sortState.direction === "asc" ? 1 : -1;
            if (strB === "n/a" && strA !== "n/a")
              return sortState.direction === "asc" ? -1 : 1;
            if (strA === "n/a" && strB === "n/a") return 0;
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
  if (sortState.columnKey === columnKey) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.columnKey = columnKey;
    sortState.direction = "asc";
  }
  sortState = { ...sortState };
}

function clearFilter(columnKey: string) {
  currentFilters[columnKey] = "";
  currentFilters = { ...currentFilters };
}
</script>

<!-- ... (Template remains the same) ... -->
<div class="comparison-page">
  <div class="entity-selector">
    <button
      class:active={selectedEntityType === "gun"}
      on:click={() => (selectedEntityType = "gun")}>Guns</button>
    <button
      class:active={selectedEntityType === "armor"}
      on:click={() => (selectedEntityType = "armor")}
      disabled>Armor</button>
    <!-- Temporarily disabled -->
    <button
      class:active={selectedEntityType === "monster"}
      on:click={() => (selectedEntityType = "monster")}
      disabled>Monsters</button>
    <!-- Temporarily disabled -->
  </div>

  {#if !data}
    <p>Waiting for data processor to load...</p>
  {:else if tableColumns.length > 0}
    <div class="table-controls">
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
                  on:click={() => col.sortable && toggleSort(col.key)}
                  class:sortable={col.sortable}>
                  {col.label}
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
                  <td>
                    {#if col.formatter}
                      {@html col.formatter(
                        getNestedValue(entity, col.key),
                        entity,
                        data
                      )}
                    {:else}
                      {getNestedValue(entity, col.key) ?? "N/A"}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p>No {selectedEntityType}s match the current filters.</p>
    {/if}
  {:else if selectedEntityType}
    <p>
      No data or columns defined for {selectedEntityType}. Please ensure columns
      are set up.
    </p>
  {/if}
</div>

<!-- Styles remain the same -->
<style>
.comparison-page {
  padding: 1em;
  max-width: 100%;
  box-sizing: border-box;
}
.entity-selector {
  margin-bottom: 1em;
  display: flex;
  gap: 0.5em;
}
.entity-selector button {
  padding: 0.5em 1em;
  border: 1px solid #ccc;
  background-color: #f0f0f0;
  cursor: pointer;
  border-radius: 4px;
}
.entity-selector button.active {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.entity-selector button:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
}
.table-wrapper {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1em;
  font-size: 0.9em;
}
th,
td {
  border: 1px solid #ddd;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}
th {
  background-color: #f2f2f2;
  position: sticky;
  top: 0;
  z-index: 1;
}
th.sortable {
  cursor: pointer;
}
th.sortable:hover {
  background-color: #e8e8e8;
}
.sort-arrow {
  font-size: 0.8em;
  margin-left: 0.3em;
}
.table-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 20px;
  margin-bottom: 1em;
  align-items: flex-end;
}
.filter-input {
  display: flex;
  flex-direction: column;
  min-width: 150px;
}
.filter-input label {
  font-size: 0.8em;
  margin-bottom: 0.2em;
  color: #555;
}
.filter-input input {
  padding: 0.4em;
  border: 1px solid #ccc;
  border-radius: 3px;
}
.filter-input div {
  display: flex;
  align-items: center;
}
.clear-filter {
  margin-left: 4px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  line-height: 1;
  border: 1px solid #ccc;
  background: #eee;
  cursor: pointer;
  border-radius: 3px;
}
.clear-filter:hover {
  background: #ddd;
}
</style>
