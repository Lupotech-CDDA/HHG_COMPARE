<script lang="ts">
  import { onMount } from "svelte";
  import type { CddaData } from "../../../data";
  import type { Item } from "../../../types";
  import { isItemSubtype } from "../../../types";
  import { log } from "../utils/logger";

  import { processGun, TEST_GUY_PROFILE, type RepresentativeCombatInfo } from "../core/calculations";
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

  // --- NEW: Dedicated Function for One-Time Data Processing ---
  async function processAllGuns() {
    if (!data || isLoading) return;

    isLoading = true;
    log("INFO", "Starting one-time processing of all gun data...");
    await new Promise(resolve => setTimeout(resolve, 10));

    const rawGunItems = data
      .byType("item")
      .filter((it): it is Item => it && isItemSubtype("GUN", it as Item));
    
    totalGunsToProcess = rawGunItems.length;

    const processedWithDuplicates = rawGunItems.flatMap((gun, index) => {
      calculationProgress = index + 1;
      return processGun(gun, data, TEST_GUY_PROFILE);
    });

    // --- THIS IS THE DEFINITIVE FIX ---
    // De-duplicate the entire list to prevent the Svelte 'keyed each' error.
    // This handles all edge cases (modular variants, item variants, etc.)
    // by enforcing unique IDs in the final list.
    const uniqueGunsMap = new Map<string, RepresentativeCombatInfo>();
    for (const gunInfo of processedWithDuplicates) {
      if (!uniqueGunsMap.has(gunInfo.id)) {
        uniqueGunsMap.set(gunInfo.id, gunInfo);
      } else {
        log("WARN", `Duplicate key detected and removed: '${gunInfo.id}' for item '${gunInfo.name}'. This is expected for some item variants.`);
      }
    }
    allProcessedGuns = Array.from(uniqueGunsMap.values());
    // --- END OF DEFINITIVE FIX ---

    isLoading = false;
    log("SUCCESS", `Finished processing. Found ${processedWithDuplicates.length} configurations, resulting in ${allProcessedGuns.length} unique entries.`);
  }

  // Reactive block to trigger the one-time function
  $: if (data && allProcessedGuns.length === 0 && !isLoading) {
    processAllGuns();
  }

  // Reactive block for filtering
  $: {
    let filtered = allProcessedGuns;
    if (!showNonStandard) {
      filtered = filtered.filter((gun) => !gun.isNonStandard);
    }
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

<!-- Styles remain the same -->
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