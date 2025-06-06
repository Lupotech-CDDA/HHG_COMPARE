<!-- src/features/gun-comparison/ui/components/CharacterInputForm.svelte -->
<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { CharacterProfile } from '../../utils/cddaTypes';

  /**
   * Writable store for the CharacterProfile.
   * Bound from the parent ComparisonPage.svelte.
   * @type {Writable<CharacterProfile>}
   */
  export let characterProfile: Writable<CharacterProfile>;

  // Function to reset to default character profile
  function resetToDefault() {
    characterProfile.set({
      dex_level: 10,
      per_level: 10,
      current_perception: 10,
      gun_skill_level: 3,
      skill_marksmanship_level: 2,
      vision_score_val: 1.0,
      grip_score_val: 1.0,
      manip_score_val: 1.0,
      lift_score_val: 1.0,
      hand_manip_score_val: 1.0,
      is_confined_space: false,
      stamina_current: 500,
      stamina_max: 500,
    });
  }
</script>

<div class="input-card">
  <h3>Character Profile</h3>
  <div class="input-grid">
    <label>
      Dexterity:
      <input type="number" bind:value={$characterProfile.dex_level} min="0" max="20" />
    </label>
    <label>
      Perception (Base):
      <input type="number" bind:value={$characterProfile.per_level} min="0" max="20" />
    </label>
    <label>
      Perception (Current Effective):
      <input type="number" bind:value={$characterProfile.current_perception} min="0" />
    </label>
    <label>
      Gun Skill Level:
      <input type="number" bind:value={$characterProfile.gun_skill_level} min="0" max="10" />
    </label>
    <label>
      Marksmanship Skill Level:
      <input type="number" bind:value={$characterProfile.skill_marksmanship_level} min="0" max="10" />
    </label>
    <label>
      Vision Score (1.0 for normal):
      <input type="number" step="0.1" bind:value={$characterProfile.vision_score_val} min="0.01" />
    </label>
    <label>
      Grip Score (1.0 for normal):
      <input type="number" step="0.1" bind:value={$characterProfile.grip_score_val} min="0.01" />
    </label>
    <label>
      Manipulation Score (1.0 for normal):
      <input type="number" step="0.1" bind:value={$characterProfile.manip_score_val} min="0.01" />
    </label>
    <label>
      Lift Score (1.0 for normal):
      <input type="number" step="0.1" bind:value={$characterProfile.lift_score_val} min="0.01" />
    </label>
    <label>
      Hand Manipulation Score (1.0 for normal):
      <input type="number" step="0.1" bind:value={$characterProfile.hand_manip_score_val} min="0.01" />
    </label>
    <label>
      Current Stamina:
      <input type="number" bind:value={$characterProfile.stamina_current} min="0" />
    </label>
    <label>
      Max Stamina:
      <input type="number" bind:value={$characterProfile.stamina_max} min="1" />
    </label>
    <label class="checkbox-label">
      In Confined Space:
      <input type="checkbox" bind:checked={$characterProfile.is_confined_space} />
    </label>
  </div>
  <button on:click={resetToDefault}>Reset to Default</button>
</div>

<style>
  .input-card {
    background-color: var(--card-bg-color, #333); /* Example: using CSS variables from HHG */
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  h3 {
    color: var(--header-text-color, #eee);
    margin-top: 0;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--border-color, #555);
    padding-bottom: 5px;
  }
  .input-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    color: var(--text-color, #ccc);
    font-size: 0.9em;
  }
  input[type="number"],
  input[type="text"],
  select {
    padding: 8px;
    border: 1px solid var(--input-border-color, #666);
    background-color: var(--input-bg-color, #444);
    color: var(--input-text-color, #eee);
    border-radius: 4px;
    margin-top: 4px;
    width: auto; /* Adjust width as needed */
  }
  input[type="checkbox"] {
    margin-top: 8px;
    align-self: flex-start; /* Align checkbox at the start */
  }
  .checkbox-label {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
  button {
    align-self: flex-start;
    padding: 8px 12px;
    background-color: var(--button-bg-color, #007bff);
    color: var(--button-text-color, white);
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.9em;
    margin-top: 10px;
  }
  button:hover {
    filter: brightness(1.1);
  }
</style>