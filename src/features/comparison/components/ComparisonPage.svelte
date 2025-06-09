<script lang="ts">
  import { onMount } from "svelte";
  import type { CddaData } from "../../../data";
  import type { Item } from "../../../types";
  import { isItemSubtype } from "../../../types";

  // Our new calculation engine and its types
  import {
    getRepresentativeCombatInfo,
    TEST_GUY_PROFILE,
    type RepresentativeCombatInfo,
  } from "../core/calculations";

  // The table component we will create next
  import ComparisonTable from "./ComparisonTable.svelte";

  // Component Props
  export let data: CddaData;

  // Component State
  let allProcessedGuns: RepresentativeCombatInfo[] = [];
  let displayedGuns: RepresentativeCombatInfo[] = [];
  let isLoading = true;
  let calculationProgress = 0;
  let totalGunsToProcess = 0;

  // Filter State
  let showNonStandard = false;

  // This reactive block runs once when the 'data' prop becomes available.
  // It performs the heavy, one-time calculation for all guns.
  $: if (data) {
    isLoading = true;
    calculationProgress = 0;

    // Use a timeout to allow the UI to update to the loading state before
    // we block the main thread with heavy calculations.
    setTimeout(() => {
      const rawGunItems = data
        .byType("item")
        .filter((it): it is Item => isItemSubtype("GUN", it as Item));
      
      totalGunsToProcess = rawGunItems.length;

      allProcessedGuns = rawGunItems
        .map((gun, index) => {
          // Update progress for the loading indicator
          calculationProgress = index + 1;
          // Run our main calculation engine for each gun
          return getRepresentativeCombatInfo(gun, data, TEST_GUY_PROFILE);
        })
        .filter(
          (info): info is RepresentativeCombatInfo => info !== null
        ); // Filter out any guns that couldn't be processed

      isLoading = false;
    }, 10);
  }

  // This reactive block runs whenever the source data or a filter changes.
  // It is very fast as it only applies filters to the pre-calculated data.
  $: {
    let filtered = allProcessedGuns;

    if (!showNonStandard) {
      filtered = filtered.filter((gun) => !gun.isNonStandard);
    }
    
    // In the future, other filters (text search, etc.) would be applied here.

    displayedGuns = filtered;
  }
</script>

<div class="comparison-container">
  <h1>Ranged Weapon Comparison</h1>

  <div class="page-controls">
    <div class="filter-group">
      <input type="checkbox" id="show-non-standard" bind:checked={showNonStandard} />
      <label for="show-non-standard">Show Non-Standard Guns (Bows, Energy, etc.)</label>
    </div>
  </div>

  {#if isLoading}
    <div class="loading-indicator">
      <p>Calculating combat stats for all weapons...</p>
      <p>{calculationProgress} / {totalGunsToProcess}</p>
      <progress value={calculationProgress} max={totalGunsToProcess}></progress>
    </div>
  {:else}
    <ComparisonTable guns={displayedGuns} />
  {/if}
</div>

<style>
  .comparison-container {
    padding: 1em;
    font-family: sans-serif;
  }

  .page-controls {
    padding: 1em;
    background-color: #eee;
    margin-bottom: 1em;
    border-radius: 4px;
  }

  .filter-group {
    display: flex;
    align-items: center;
  }

  .filter-group label {
    margin-left: 0.5em;
  }

  .loading-indicator {
    text-align: center;
    padding: 2em;
  }
  
  .loading-indicator p {
      margin: 0.5em 0;
  }

  progress {
      width: 50%;
  }
</style>