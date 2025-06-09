<script lang="ts">
  import type { RepresentativeCombatInfo } from "../core/calculations";

  export let guns: RepresentativeCombatInfo[] = [];

  let sortKey: keyof RepresentativeCombatInfo | "name" = "name";
  let sortDirection: "asc" | "desc" = "asc";

  $: sortedGuns = [...guns].sort((a, b) => {
    if (!sortKey) return 0;
    
    // --- UPDATED SORTING LOGIC ---
    // Use the dedicated sort value for the 'Hit Chances' column
    const keyForSort = sortKey === 'hitChancesAt10Tiles' ? 'hitChanceSortValue' : sortKey;

    const valA = a[keyForSort];
    const valB = b[keyForSort];
    // --- END OF UPDATED LOGIC ---

    const isASpecial = valA === null || valA === undefined || valA === 0 || valA === "N/A" || (typeof valA !== 'number' && typeof valA !== 'string');
    const isBSpecial = valB === null || valB === undefined || valB === 0 || valB === "N/A" || (typeof valB !== 'number' && typeof valB !== 'string');
    if (isASpecial && isBSpecial) return 0;
    if (isASpecial) return 1;
    if (isBSpecial) return -1;
    let comparison = 0;
    if (typeof valA === 'number' && typeof valB === 'number') {
      comparison = valA - valB;
    } else {
      comparison = String(valA).localeCompare(String(valB));
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  function toggleSort(key: keyof RepresentativeCombatInfo) {
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDirection = "asc";
    }
  }
</script>

<div class="table-wrapper">
  <table>
    <thead>
      <tr>
        <th on:click={() => toggleSort("name")}>Name</th>
        <th on:click={() => toggleSort("id")}>ID</th>
        <th on:click={() => toggleSort("category")}>Category</th>
        <th on:click={() => toggleSort("skillUsed")}>Skill Used</th>
        <th on:click={() => toggleSort("standardAmmo")}>Standard Ammo</th>
        <th on:click={() => toggleSort("reloadMethod")}>Reload Method</th>
        <th on:click={() => toggleSort("compatibleMagazines")}>Compatible Mags</th>
        <th on:click={() => toggleSort("defaultReceiver")}>Default Receiver</th>
        <th on:click={() => toggleSort("theoreticalDph")}>Theor. Dmg/Bullet
          <span class="info-icon" title="Base damage of the representative ammunition before any hit chance calculations.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("effectiveDamageAt10Tiles")}>
          Eff. Dmg @ 10t
          <span class="info-icon" title="Expected damage for a single, aimed shot at 10 tiles.
Considers hit and critical hit probabilities.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("hitChancesAt10Tiles")}>
          Hit % @ 10t
          <span class="info-icon" title="Estimated hit chances for a single, aimed shot at 10 tiles.
C=Critical, H=Hit, G=Graze.">ⓘ</span>
        </th>
      </tr>
    </thead>
    <tbody>
      {#if sortedGuns.length > 0}
        {#each sortedGuns as gun (gun.id)}
          <tr>
            <td>{gun.name}</td>
            <td>{gun.id}</td>
            <td>{gun.category}</td>
            <td>{gun.skillUsed}</td>
            <td>{gun.standardAmmo}</td>
            <td>{gun.reloadMethod}</td>
            <td>{gun.compatibleMagazines}</td>
            <td>{gun.defaultReceiver}</td>
            <td>{gun.theoreticalDph > 0 ? gun.theoreticalDph.toFixed(0) : 'N/A'}</td>
            <td>{gun.effectiveDamageAt10Tiles > 0 ? gun.effectiveDamageAt10Tiles.toFixed(1) : 'N/A'}</td>
            <td>{gun.hitChancesAt10Tiles}</td>
          </tr>
        {/each}
      {:else}
        <tr>
          <td colspan="11" class="no-results">No weapons match the current filters.</td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper { overflow-x: auto; border: 1px solid #ccc; border-radius: 4px; max-height: 70vh; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap; }
  th { background-color: #f2f2f2; position: sticky; top: 0; cursor: pointer; user-select: none; }
  th:hover { background-color: #e0e0e0; }
  .no-results { text-align: center; color: #777; padding: 2em; }
  
  /* --- NEW: Tooltip Styles --- */
  .info-icon {
    cursor: help;
    margin-left: 4px;
    color: #666;
    font-weight: bold;
    border: 1px solid #aaa;
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: inline-block;
    text-align: center;
    line-height: 14px;
    font-size: 10px;
  }
  .info-icon:hover {
    background-color: #ddd;
  }
</style>