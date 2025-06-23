<script lang="ts">
  import { onMount } from "svelte";
  import type { CddaData } from "../../../data";
  import type { Item } from "../../../types";
  import { isItemSubtype } from "../../../types";
  import { log, clearLogs, downloadLogs } from "../utils/logger";

  import { processGun, TEST_GUY_PROFILE } from "../core/calculations";
  // CORRECTED: Import types from the canonical source in core/types.ts
  import type { RepresentativeCombatInfo } from "../core/types";
  import ComparisonTable from "./ComparisonTable.svelte";

  // Component Props
  export let data: CddaData;

  // Component State
  let allProcessedGuns: RepresentativeCombatInfo[] = [];
  let displayedGuns: RepresentativeCombatInfo[] = [];
  let isLoading = false;
  let calculationProgress = 0;
  let totalGunsToProcess = 0;

  // Filter State
  let showNonStandard = false;

  async function processAllGuns() {
    if (!data || isLoading) return;

    isLoading = true;
    log("INFO", "Starting one-time processing of all gun data...");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const rawGunItems = data
      .byType("item")
      .filter((it): it is Item => it && isItemSubtype("GUN", it as Item));

    totalGunsToProcess = rawGunItems.length;

    const processedWithDuplicates = rawGunItems.flatMap((gun, index) => {
      calculationProgress = index + 1;
      // Added try-catch block for more robust error handling during processing
      try {
        return processGun(gun, data, TEST_GUY_PROFILE);
      } catch (e: any) {
        log("ERROR", `Failed to process gun '${gun.id}'. Error: ${e.message}`, { gun, error: e });
        return []; // Return empty array for the failed item to prevent crashing flatMap
      }
    });

    const uniqueGunsMap = new Map<string, RepresentativeCombatInfo>();
    for (const gunInfo of processedWithDuplicates) {
      if (!uniqueGunsMap.has(gunInfo.id)) {
        uniqueGunsMap.set(gunInfo.id, gunInfo);
      }
    }
    allProcessedGuns = Array.from(uniqueGunsMap.values());

    isLoading = false;
    log("SUCCESS", `Finished processing. Resulted in ${allProcessedGuns.length} unique entries.`);
  }

  // Reactive blocks remain the same
  $: if (data && allProcessedGuns.length === 0 && !isLoading) {
    processAllGuns();
  }

  $: {
    let filtered = allProcessedGuns;
    if (!showNonStandard) {
      filtered = filtered.filter((gun) => !gun.isNonStandard);
    }
    displayedGuns = filtered;
  }
</script>

<!-- HTML and Style blocks remain unchanged -->
<div class="comparison-container">
  <h1>Ranged Weapon Comparison</h1>

  <div class="page-controls">
    <div class="filter-group">
      <input type="checkbox" id="show-non-standard" bind:checked={showNonStandard} />
      <label for="show-non-standard">Show Non-Standard Guns (Bows, Energy, etc.)</label>
    </div>
    <div class="debug-controls">
      <button on:click={clearLogs}>Clear Logs</button>
      <button on:click={downloadLogs}>Download Logs</button>
    </div>
  </div>

  {#if isLoading}
    <div class="loading-indicator">
      <p>Calculating combat stats for all weapons...</p>
      <p>{calculationProgress} / {totalGunsToProcess}</p>
      <progress value={calculationProgress} max={totalGunsToProcess} />
    </div>
  {:else}
    <ComparisonTable guns={displayedGuns} />
  {/if}
</div>

<style>
  :root {
    --text-color: #004d00;
    --control-bg-color: #f0f8f0;
    --control-border-color: #d0e0d0;
    --button-bg-color: #e0f0e0;
    --button-hover-bg-color: #c0e0c0;
  }
  .comparison-container { padding: 1em; font-family: sans-serif; color: var(--text-color); }
  .page-controls { display: flex; justify-content: space-between; align-items: center; gap: 1em; padding: 1em; background-color: var(--control-bg-color); margin-bottom: 1em; border: 1px solid var(--control-border-color); border-radius: 4px; }
  .filter-group { display: flex; align-items: center; }
  .filter-group label { margin-left: 0.5em; cursor: pointer; }
  .debug-controls { display: flex; gap: 0.5em; }
  .debug-controls button { background-color: var(--button-bg-color); border: 1px solid var(--control-border-color); color: var(--text-color); padding: 0.5em 1em; border-radius: 4px; cursor: pointer; transition: background-color 0.2s; }
  .debug-controls button:hover { background-color: var(--button-hover-bg-color); }
  .loading-indicator { text-align: center; padding: 2em; }
  .loading-indicator p { margin: 0.5em 0; }
  progress { width: 50%; }
</style>