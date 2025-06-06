// This file orchestrates the entire gun combat simulation.
// It takes character, gun, and scenario profiles, runs the aiming progression,
// and calculates hit probabilities.
// It effectively replaces the main simulation loop from simulate_aiming_process.py.

import {
    CharacterProfile,
    GunProfile,
    ScenarioInputs,
    AimingProgressRecord,
    CombatResults,
    DispersionSources,
    HitPercentages,
    UIConfidencePercentages,
    AimingThresholds,
} from '../utils/cddaTypes';
import {
    calculateModifierRangedDispersionVision,
    calculateGetCharacterParallax,
    calculatePointShootingLimit,
    calculateModifierAimSpeedDex,
    calculateModifierAimSpeedSkill,
    calculateModifierAimSpeedGeneral
} from './cddaCharacterModifiers';
import {
    calculateAimFactorFromVolume,
    calculateAimFactorFromLength,
    calculateBaseAttackMoves
} from './cddaWeaponStats';
import {
    calculateMostAccurateAimingMethodLimit,
    calculateDynamicAimThresholds,
    calculateAimPerMove,
    calculateTotalGunDispersionSources,
    getWeaponDispersionSources
} from './cddaAimingCore';
import {
    calculateActualHitOutcome,
    calculateConfidenceEstimate,
    simulateHitProbabilityAndUiChances
} from './cddaHitChance';
import { debugLogger } from '../utils/debugLogger';
import { MAX_RECOIL, MIN_RECOIL_IMPROVEMENT } from '../utils/cddaConstants';

/**
 * Calculates comprehensive combat metrics for a given character, gun, and scenario.
 * This function encapsulates the main simulation loop from the Python script.
 */
export function calculateCombatMetrics(
    character: CharacterProfile,
    gun: GunProfile,
    scenario: ScenarioInputs,
    numSimulationsForHitProb: number = 10000
): CombatResults {
    // --- Pre-calculations needed before simulation loop (from simulate_aiming_process.py main) ---
    const visionScoreModifierVal = calculateModifierRangedDispersionVision(character.vision_score_val);
    const preciseAimLimitMoa = calculateMostAccurateAimingMethodLimit(
        character.per_level, visionScoreModifierVal,
        character.gun_skill_level, gun.gun_skill_id_str,
        gun.gun_iron_sight_base_disp_moa, gun.has_iron_sights,
        gun.gun_mods_sights_info
    );
    const dynamicThresholds = calculateDynamicAimThresholds(preciseAimLimitMoa);
    
    const baseAttackMvs = calculateBaseAttackMoves(
        character.gun_skill_level, gun.gun_skill_id_str,
        character.stamina_current, character.stamina_max,
        gun.ammo_source_is_external_and_used_for_this_shot,
        gun.external_ammo_reload_option_moves
    );

    // Prepare simulation variables
    let currentRecoil = scenario.initial_character_recoil_moa;
    let movesSpentPureAiming = 0;
    const aimingProgress: AimingProgressRecord = {
        'Current Aim (Start)': { moves: 0, recoil: scenario.initial_character_recoil_moa }
    }; // Store start state

    const thresholdListForSim: { name: string, moa: number }[] = [];
    const tempThresholdMap = new Map<number, string>(); // Map MOA to name for sorting

    // Collect thresholds that are an improvement over initial recoil and better than or equal to precise limit
    if (dynamicThresholds['Regular Aim'] !== undefined &&
        dynamicThresholds['Regular Aim'] < currentRecoil &&
        dynamicThresholds['Regular Aim'] >= preciseAimLimitMoa) {
        tempThresholdMap.set(dynamicThresholds['Regular Aim'], "Regular Aim");
    }
    if (dynamicThresholds['Careful Aim'] !== undefined &&
        dynamicThresholds['Careful Aim'] < currentRecoil &&
        dynamicThresholds['Careful Aim'] >= preciseAimLimitMoa) {
        tempThresholdMap.set(dynamicThresholds['Careful Aim'], "Careful Aim");
    }
    if (preciseAimLimitMoa < currentRecoil) {
        tempThresholdMap.set(preciseAimLimitMoa, "Precise Aim");
    }

    // Sort thresholds from highest MOA (worst aim) to lowest MOA (best aim)
    Array.from(tempThresholdMap.entries())
        .sort((a, b) => b[0] - a[0]) // Sort by MOA, descending
        .forEach(([moa_val, name]) => thresholdListForSim.push({ name, moa: moa_val }));
    
    let thresholdIdxToReach = 0; // Index into sorted threshold_list_for_sim

    debugLogger.log(`[gunDPSCalculator] Starting simulation. Initial Recoil: ${currentRecoil.toFixed(2)} MOA, Precise Limit: ${preciseAimLimitMoa.toFixed(2)} MOA.`);
    debugLogger.log(`[gunDPSCalculator] Dynamic Thresholds:`, dynamicThresholds);
    debugLogger.log(`[gunDPSCalculator] Sorted Thresholds for Sim:`, thresholdListForSim);


    // --- Core Simulation Loop (from simulate_aiming_process.py main) ---
    if (!thresholdListForSim.length) {
        debugLogger.log("[gunDPSCalculator] No aim thresholds are an improvement over initial recoil or all are better than/equal to precise limit. Skipping simulation loop.");
    } else {
        for (let moveNumSimulated = 1; moveNumSimulated <= scenario.max_aiming_moves_to_simulate; moveNumSimulated++) {
            if (currentRecoil <= preciseAimLimitMoa) {
                // If we've reached or surpassed the precise limit, mark all remaining reachable thresholds as achieved.
                for (let i = thresholdIdxToReach; i < thresholdListForSim.length; i++) {
                    const { name, moa } = thresholdListForSim[i];
                    if (!aimingProgress[name as keyof AimingProgressRecord]) { // Only set if not already set
                        aimingProgress[name as keyof AimingProgressRecord] = { moves: movesSpentPureAiming, recoil: currentRecoil };
                        debugLogger.log(`[gunDPSCalculator] Reached/surpassed ${name} at ${movesSpentPureAiming} moves, recoil: ${currentRecoil.toFixed(2)} MOA.`);
                    }
                }
                break; // Exit loop, all reachable thresholds achieved
            }

            const recoilReduction = calculateAimPerMove(
                character.dex_level, character.per_level, visionScoreModifierVal,
                character.gun_skill_level, gun.gun_skill_id_str,
                character.current_perception,
                character.grip_score_val, character.manip_score_val, character.lift_score_val,
                gun.gun_volume_ml, gun.gun_length_mm,
                gun.gun_iron_sight_base_disp_moa, gun.has_iron_sights,
                gun.gun_mods_sights_info,
                gun.has_collapsible_stock, gun.collapsed_volume_delta_ml,
                scenario.target_range_tiles, scenario.target_light_level,
                scenario.target_is_visible, scenario.target_angular_size_moa,
                currentRecoil,
                character.is_confined_space
            );

            if (recoilReduction < MIN_RECOIL_IMPROVEMENT && currentRecoil > preciseAimLimitMoa) {
                debugLogger.log(`[gunDPSCalculator] Recoil reduction (${recoilReduction.toFixed(4)}) too small and above precise limit. Stopping simulation.`);
                break;
            }
            if (recoilReduction === 0.0 && currentRecoil > preciseAimLimitMoa) {
                debugLogger.log(`[gunDPSCalculator] Recoil reduction is zero and above precise limit. Stopping simulation (stall).`);
                break;
            }
            
            currentRecoil -= recoilReduction;
            currentRecoil = Math.max(currentRecoil, preciseAimLimitMoa); // Ensure recoil doesn't go below the limit
            movesSpentPureAiming = moveNumSimulated; // Record moves spent for this iteration
            
            // Check if we've reached any thresholds in the sorted list
            while (thresholdIdxToReach < thresholdListForSim.length) {
                const { name, moa } = thresholdListForSim[thresholdIdxToReach];
                if (currentRecoil <= moa) {
                    if (!aimingProgress[name as keyof AimingProgressRecord]) { // Only set if not already set
                        aimingProgress[name as keyof AimingProgressRecord] = { moves: movesSpentPureAiming, recoil: currentRecoil };
                        debugLogger.log(`[gunDPSCalculator] Reached ${name} at ${movesSpentPureAiming} moves, recoil: ${currentRecoil.toFixed(2)} MOA.`);
                    }
                    thresholdIdxToReach++; // Move to the next threshold
                } else {
                    break; // Current recoil is not yet good enough for this threshold
                }
            }
        }
        // After loop, if any thresholds not marked (e.g. max_aiming_moves_to_simulate reached before them)
        // their values remain undefined in aimingProgress, which is handled by optional properties.
        debugLogger.log(`[gunDPSCalculator] Simulation ended. Final pure aiming moves: ${movesSpentPureAiming}, Final Recoil: ${currentRecoil.toFixed(2)} MOA.`);
    }

    // --- Calculate Hit Probabilities for Reached Aiming States ---
    const hitProbabilities: CombatResults['hitProbabilities'] = {};
    const commonDispersionInputs = {
        dexLevel: character.dex_level,
        perLevel: character.per_level,
        visionScoreModifierVal: visionScoreModifierVal,
        handManipScoreVal: character.hand_manip_score_val,
        avgSkillForDispCalc: (character.skill_marksmanship_level + character.gun_skill_level) / 2.0,
        gunSkillIdStr: gun.gun_skill_id_str,
        gunBaseDispJson: gun.gun_base_disp_json,
        gunModDispSumJson: gun.gun_mod_disp_sum_json,
        gunDamageLevel: gun.gun_damage_level,
        ammoBaseDispJson: gun.ammo_base_disp_json,
        ammoShotSpreadVal: gun.ammo_shot_spread_val,
    };

    // Iterate through all possible aiming states we might have reached
    for (const aimType of Object.keys(aimingProgress) as (keyof AimingProgressRecord)[]) {
        const progress = aimingProgress[aimType];
        if (progress) {
            const dispSourcesForType = calculateTotalGunDispersionSources(
                commonDispersionInputs.dexLevel,
                commonDispersionInputs.perLevel,
                commonDispersionInputs.visionScoreModifierVal,
                commonDispersionInputs.handManipScoreVal,
                commonDispersionInputs.avgSkillForDispCalc,
                commonDispersionInputs.gunSkillIdStr,
                commonDispersionInputs.gunBaseDispJson,
                commonDispersionInputs.gunModDispSumJson,
                commonDispersionInputs.gunDamageLevel,
                commonDispersionInputs.ammoBaseDispJson,
                commonDispersionInputs.ammoShotSpreadVal,
                progress.recoil // Use the specific recoil for this aim type
            );
            const { actualHitPercentages, uiConfidencePercentages } = simulateHitProbabilityAndUiChances(
                dispSourcesForType,
                scenario.target_range_tiles,
                scenario.creature_size_str,
                numSimulationsForHitProb
            );
            hitProbabilities[aimType] = { actual: actualHitPercentages, ui: uiConfidencePercentages };
        }
    }


    // --- Construct and return the comprehensive CombatResults ---
    const results: CombatResults = {
        aimThresholds: dynamicThresholds,
        baseAttackMoves: baseAttackMvs,
        aimingProgress: aimingProgress,
        finalRecoil: currentRecoil,
        finalMovesSpentPureAiming: movesSpentPureAiming,
        hitProbabilities: hitProbabilities,
        // DPS metrics will be calculated and added here in future steps
        // referenceSustainedDps: 0, // Placeholder
        // dpsMagDumpNoReload: 0,    // Placeholder
        // dpsPreciseAimPerShotNoReload: 0, // Placeholder
    };

    return results;
}