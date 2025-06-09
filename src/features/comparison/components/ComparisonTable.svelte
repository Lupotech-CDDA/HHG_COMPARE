<script lang="ts">
  import type { RepresentativeCombatInfo } from "../core/calculations";

  // This line is crucial. It tells Svelte that this component accepts a 'guns' prop.
  export let guns: RepresentativeCombatInfo[] = [];

  // Internal State for Sorting
  let sortKey: keyof RepresentativeCombatInfo | "name" = "name"; // Default sort by name
  let sortDirection: "asc" | "desc" = "asc";

  // Reactive Sorting Logic
  $: sortedGuns = [...guns].sort((a, b) => {
    if (!sortKey) return 0;

    const valA = a[sortKey];
    const valB = b[sortKey];

    // Handle non-numeric or special values by pushing them to the bottom
    const isASpecial = valA === null || valA === undefined || valA === "N/A" || (typeof valA !== 'number' && typeof valA !== 'string');
    const isBSpecial = valB === null || valB === undefined || valB === "N/A" || (typeof valB !== 'number' && typeof valB !== 'string');

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

  // Function to handle header clicks for sorting
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
        <!-- These headers match your requested design -->
        <th on:click={() => toggleSort("name")}>Name</th>
        <th on:click={() => toggleSort("id")}>ID</th>
        <th on:click={() => toggleSort("category")}>Category</th>
        <th on:click={() => toggleSort("standardAmmo")}>Standard Ammo</th>
        <th on:click={() => toggleSort("standardMagazine")}>Standard Magazine</th>
        <th on:click={() => toggleSort("defaultReceiver")}>Default Receiver</th>
        <th on:click={() => toggleSort("theoreticalDph")}>Theoretical Dmg/Bullet</th>
        <th on:click={() => toggleSort("effectiveDamageAt10Tiles")}>Effective Dmg @ 10t</th>
        <th on:click={() => toggleSort("hitChancesAt10Tiles")}>Hit Chances @ 10t</th>
      </tr>
    </thead>
    <tbody>
      {#if sortedGuns.length > 0}
        {#each sortedGuns as gun (gun.id)}
          <tr>
            <td>{gun.name}</td>
            <td>{gun.id}</td>
            <td>{gun.category}</td>
            <td>{gun.standardAmmo}</td>
            <td>{gun.standardMagazine}</td>
            <td>{gun.defaultReceiver}</td>
            <td>{gun.theoreticalDph > 0 ? gun.theoreticalDph.toFixed(0) : 'N/A'}</td>
            <td>{gun.effectiveDamageAt10Tiles > 0 ? gun.effectiveDamageAt10Tiles.toFixed(1) : 'N/A'}</td>
            <td>{gun.hitChancesAt10Tiles}</td>
          </tr>
        {/each}
      {:else}
        <tr>
          <td colspan="9" class="no-results">No weapons match the current filters.</td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper {
    overflow-x: auto;
    border: 1px solid #ccc;
    border-radius: 4px;
    max-height: 70vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  th, td {
    padding: 8px 12px;
    border: 1px solid #ddd;
    text-align: left;
    white-space: nowrap;
  }
  th {
    background-color: #f2f2f2;
    position: sticky;
    top: 0;
    cursor: pointer;
    user-select: none;
  }
  th:hover {
    background-color: #e0e0e0;
  }
  .no-results {
    text-align: center;
    color: #777;
    padding: 2em;
  }
</style>