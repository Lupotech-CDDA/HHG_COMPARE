<script lang="ts">
  import type { RepresentativeCombatInfo } from "../core/types";

  export let guns: RepresentativeCombatInfo[] = [];

  let sortKey: keyof RepresentativeCombatInfo | "category" = "name";
  let sortDirection: "asc" | "desc" = "asc";

  $: sortedGuns = [...guns].sort((a, b) => {
    if (!sortKey) return 0;

    let valA: any;
    let valB: any;

    if (sortKey === "category") {
      valA = `${a.category.type} ${a.category.subType}`;
      valB = `${b.category.type} ${b.category.subType}`;
    } else {
      valA = a[sortKey as keyof RepresentativeCombatInfo];
      valB = b[sortKey as keyof RepresentativeCombatInfo];
    }

    const isASpecial = valA === null || valA === undefined || valA === 0 || valA === "N/A" || valA === Infinity;
    const isBSpecial = valB === null || valB === undefined || valB === 0 || valB === "N/A" || valB === Infinity;

    if (isASpecial && isBSpecial) return 0;
    if (isASpecial) return 1;
    if (isBSpecial) return -1;

    let comparison = 0;
    if (typeof valA === "number" && typeof valB === "number") {
      comparison = valA - valB;
    } else {
      comparison = String(valA).localeCompare(String(valB));
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  function toggleSort(key: keyof RepresentativeCombatInfo | "category") {
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      const descDefaults = new Set(['sustainedDps', 'magDumpDps', 'damagePerShot']);
      sortDirection = descDefaults.has(key) ? "desc" : "asc";
    }
  }
</script>

<div class="table-wrapper">
  <table>
    <thead>
      <tr>
        <th on:click={() => toggleSort("name")}>Name</th>
        <th on:click={() => toggleSort("category")}>Category</th>
        <th on:click={() => toggleSort("standardAmmo")}>Ammo</th>
        <th on:click={() => toggleSort("damagePerShot")}>
          Dmg/Shot
          <span class="info-icon" title="Expected damage for a single, precisely aimed shot at 10 tiles.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("sustainedDps")}>
          Sust. DPS
          <span class="info-icon" title="Damage Per Second over a full cycle: initial aim, firing a full magazine with re-aiming between shots, and one reload.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("magDumpDps")}>
          Mag-Dump DPS
          <span class="info-icon" title="Damage Per Second for emptying a full magazine in burst/auto mode without re-aiming or reloading. Measures raw damage output.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("meanTimeToKillStandardZombie")}>
          TTK (Zombie)
          <span class="info-icon" title="Mean Time To Kill a standard 80 HP zombie, in seconds, based on Sustained DPS. Lower is better.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("hitChancesAt10Tiles")}>
          Hit % @ 10t
          <span class="info-icon" title="Hit chances for the first precise shot. C=Crit, G=Good, Z=Graze.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("reloadTime")}>
          Reload (moves)
          <span class="info-icon" title="Total moves to reload one standard magazine from inventory.">ⓘ</span>
        </th>
        <th on:click={() => toggleSort("compatibleMagazines")}>Compatible Mags</th>
      </tr>
    </thead>
    <tbody>
      {#if sortedGuns.length > 0}
        {#each sortedGuns as gun (gun.id)}
          <tr>
            <td>{gun.name}</td>
            <td>{gun.category.type} ({gun.category.subType})</td>
            <td>{gun.standardAmmo}</td>
            <td>{gun.damagePerShot > 0 ? gun.damagePerShot.toFixed(1) : 'N/A'}</td>
            <td>{gun.sustainedDps > 0 ? gun.sustainedDps.toFixed(1) : 'N/A'}</td>
            <td>{gun.magDumpDps > 0 ? gun.magDumpDps.toFixed(1) : 'N/A'}</td>
            <!-- BUG FIX: Convert TTK moves to seconds by dividing by 100 -->
            <td>{gun.meanTimeToKillStandardZombie !== Infinity ? (gun.meanTimeToKillStandardZombie / 100).toFixed(2) + 's' : 'N/A'}</td>
            <td>{gun.hitChancesAt10Tiles}</td>
            <!-- BUG FIX: Round reload time to the nearest integer -->
            <td>{gun.reloadTime > 0 ? Math.round(gun.reloadTime) : 'N/A'}</td>
            <td class="wide-col">{gun.compatibleMagazines}</td>
          </tr>
        {/each}
      {:else}
        <tr>
          <td colspan="10" class="no-results">No weapons match the current filters.</td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--control-border-color, #ccc);
    border-radius: 4px;
    max-height: 75vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  th, td {
    padding: 8px 12px;
    border: 1px solid var(--control-border-color, #ddd);
    text-align: left;
    white-space: nowrap;
  }
  th {
    background-color: var(--control-bg-color, #f2f2f2);
    color: var(--text-color, #000);
    position: sticky;
    top: 0;
    cursor: pointer;
    user-select: none;
  }
  th:hover {
    background-color: var(--button-hover-bg-color, #e0e0e0);
  }
  .no-results {
    text-align: center;
    color: #777;
    padding: 2em;
  }
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
  .wide-col {
      white-space: normal;
      min-width: 250px;
  }
</style>