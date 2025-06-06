// PRESERVE: cdda_hit_chance.py
// This file contains logic for calculating hit probability and outcome.
// DO NOT ALTER THIS COMMENT

import { MOA_TO_RADIANS, ACCURACY_CRITICAL, ACCURACY_GOODHIT, ACCURACY_STANDARD } from '../utils/cddaConstants';
import { getOccupiedTileFraction } from '../utils/cddaUtils'; // For target size
import { DispersionSources, HitPercentages, UIConfidencePercentages } from '../utils/cddaTypes';

// PRESERVE: Corresponds to double iso_tangent(double distance, const units::angle &vertex) (line.cpp)
// In CDDA, units::angle is a type wrapper for radians.
// `vertex / 2` in C++ implies that `vertex` is the *full* angle subtended by the target, or the *total* deviation angle.
// If `rolled_angular_deviation_moa` from `dispersion_sources::roll()` is the *actual deviation from center*,
// then `vertex` is this deviation. The formula `tan(vertex / 2) * distance * 2` calculates the *diameter* of a cone at `distance` for `vertex` angle.
// However, if `dispersion_sources::roll()` is a "radius-like" angular deviation, `vertex` would be that.
// Based on usage in `projectile_attack_roll`: `missed_by_tiles = iso_tangent(range, angular_deviation_radians)`,
// and `aim.missed_by = missed_by_tiles / target_size`, it implies missed_by_tiles is a linear distance from center.
// The `* 2` and `/ 2` cancel out if `vertex` is understood as "half-angle".
// So, the most direct translation is `tan(deviation_radians) * range_tiles`
// Let's verify: tan(angle from center) * distance = linear deviation.
// The CDDA formula: `tan(vertex / 2) * distance * 2` is `tan(half_angle) * distance * 2`.
// If `vertex` in the CDDA code is `rolled_angular_deviation_radians` (which is a deviation from center),
// then `vertex/2` is half of that deviation, and the `*2` at the end makes it back.
// This structure seems to be: tangent of HALF THE DEVIATION ANGLE, then scaled by distance, then times 2 to get a DIAMETER.
// If `missed_by_tiles` then represents a radius, we need to divide this result by 2.
// So, `missed_by_tiles = tan(deviation_radians / 2) * distance`.
// Let's use that simplified, more direct interpretation for linear deviation.
export function calculateIsoTangentLinearDeviation(rangeTiles: number, angularDeviationRadians: number): number {
    /**Calculates the linear deviation from center at 'rangeTiles' for a given 'angularDeviationRadians'.
       Interpreted as: tan(deviation_radians / 2) * range_tiles.
    */
    if (rangeTiles <= 0) {
        return 0.0; // No deviation at 0 range (or infinite if target is at 0 distance)
    }
    // The C++ is tan(vertex / 2) * distance * 2. If vertex is the full deviation angle, this is diameter.
    // We want radius from center, so we take tan(vertex / 2) * distance.
    // This aligns with geometric definitions.
    return Math.tan(angularDeviationRadians / 2.0) * rangeTiles;
}

// PRESERVE: Higher-level function for hit calculation, based on projectile_attack_roll logic
// PRESERVE: Higher-level function for hit calculation (true probabilistic hit)
export function calculateActualHitOutcome(
    rolledAngularDeviationMoa: number, // Result from DispersionSources.roll()
    targetRangeTiles: number,           // Range to target
    targetCreatureSizeStr: string      // e.g., "medium"
): "Miss" | "Graze" | "Normal" | "Good" | "Critical" {
    /**
     * Determines if a shot hits a target and its quality based on rolled deviation and target size.
     * Returns (hit_type_str: "Miss", "Graze", "Normal", "Good", "Critical").
    */
    // 1. Convert angular deviation from MOA to Radians
    const angularDeviationRadians = rolledAngularDeviationMoa * MOA_TO_RADIANS;

    // 2. Calculate linear deviation from center in tiles
    const linearDeviationFromCenterTiles = calculateIsoTangentLinearDeviation(
        targetRangeTiles, angularDeviationRadians
    );

    // 3. Determine target's effective radius in tiles
    const targetOccupiedFraction = getOccupiedTileFraction(targetCreatureSizeStr);
    const targetRadiusTiles = 0.5 * targetOccupiedFraction; // Half a tile width * fraction occupied

    // 4. Calculate missed_by factor
    // missed_by = missed_by_tiles / target_size (where target_size is occupied_tile_fraction here)
    const missedByFactor = targetRadiusTiles > 0 ? linearDeviationFromCenterTiles / targetRadiusTiles : Number.POSITIVE_INFINITY;

    // 5. Determine hit quality based on missed_by_factor (true probabilistic outcome)
    // These correspond to the values from gameconstants.h but are used for *true* hit probability categorization
    // based on the actual roll outcome, not the UI's simplified confidence.
    if (missedByFactor >= 1.0) {
        return "Miss";
    } else if (missedByFactor >= ACCURACY_STANDARD) { // 0.8
        return "Graze";
    } else if (missedByFactor >= ACCURACY_GOODHIT) { // 0.5
        return "Normal";
    } else if (missedByFactor >= ACCURACY_CRITICAL) { // 0.2
        return "Good";
    } else { // missedByFactor < 0.2
        return "Critical"; // Or "Great Hit" depending on preferred label
    }
}

export function calculateConfidenceEstimate(
    targetRangeTiles: number,
    targetOccupiedFraction: number,
    dispersionSourcesObj: DispersionSources
): number {
    /**
     * Calculates the UI's 'confidence' score for hitting a target.
     * This is a deterministic estimate based on max dispersion, not a probabilistic roll.
    */
    if (targetRangeTiles === 0) {
        return 2.0 * targetOccupiedFraction; // Special case for point-blank
    }

    // PRESERVE: double max_lateral_offset = iso_tangent( attributes.range, units::from_arcmin( dispersion.max() ) );
    // dispersion.max() returns the sum of all sources, representing max possible deviation.
    const maxDeviationMoa = dispersionSourcesObj.max();
    const maxDeviationRadians = maxDeviationMoa * MOA_TO_RADIANS;

    // Re-using iso_tangent logic, where this represents max linear deviation from center.
    const maxLateralOffsetTiles = calculateIsoTangentLinearDeviation(
        targetRangeTiles, maxDeviationRadians
    );

    // PRESERVE: return 1 / ( max_lateral_offset / attributes.size );
    // attributes.size is target_occupied_fraction (e.g., 0.5 for medium)
    // This formula can result in values > 1.0 (indicating very high confidence).
    if (targetOccupiedFraction === 0) {
        return 0.0; // Avoid division by zero if target size is 0
    }
    
    const normalizedMaxOffset = maxLateralOffsetTiles / targetOccupiedFraction;
    
    if (normalizedMaxOffset === 0) {
        return Number.POSITIVE_INFINITY; // Perfect aim, no max offset, implies infinite confidence
    }
    
    return 1.0 / normalizedMaxOffset;
}

// PRESERVE: Simulation function to get hit probability
// PRESERVE: Simulation function to get hit probability for true outcomes and UI confidence
export function simulateHitProbabilityAndUiChances(
    dispersionSourcesObj: DispersionSources,     // The pre-populated DispersionSources object for a shot
    targetRangeTiles: number,
    targetCreatureSizeStr: string,
    numSimulations: number = 10000
): { actualHitPercentages: HitPercentages, uiConfidencePercentages: UIConfidencePercentages, avgDeviationOverall: number } {
    /**
     * Simulates multiple shots to determine actual hit probabilities (Miss, Graze, Normal, Good, Critical)
     * and calculates the UI's deterministic confidence percentages.
     * Returns (actual_hit_counts_dict, ui_confidence_percentages_dict, avg_deviation_overall).
    */
    if (numSimulations <= 0) {
        return {
            actualHitPercentages: { Critical: 0, Good: 0, Normal: 0, Graze: 0, Miss: 0 },
            uiConfidencePercentages: { Great: 0, Normal: 0, Graze: 0, Miss: 0 },
            avgDeviationOverall: 0.0
        };
    }

    // --- Actual Hit Probabilities (based on roll()) ---
    const actualHitCounts: { [key: string]: number } = {
        "Critical": 0, "Good": 0, "Normal": 0, "Graze": 0, "Miss": 0
    };
    let totalDeviationOverall = 0.0;

    for (let i = 0; i < numSimulations; i++) {
        const rolledDev = dispersionSourcesObj.roll();
        totalDeviationOverall += rolledDev;
        
        const hitType = calculateActualHitOutcome(
            rolledDev, targetRangeTiles, targetCreatureSizeStr
        );
        actualHitCounts[hitType]++;
    }
            
    const actualHitPercentages: HitPercentages = {
        Critical: (actualHitCounts["Critical"] / numSimulations) * 100.0,
        Good: (actualHitCounts["Good"] / numSimulations) * 100.0,
        Normal: (actualHitCounts["Normal"] / numSimulations) * 100.0,
        Graze: (actualHitCounts["Graze"] / numSimulations) * 100.0,
        Miss: (actualHitCounts["Miss"] / numSimulations) * 100.0,
    };
    const avgDeviationOverall = totalDeviationOverall / numSimulations;


    // --- UI Confidence Percentages (based on max() and confidence_estimate) ---
    const uiConfidenceScore = calculateConfidenceEstimate(
        targetRangeTiles,
        getOccupiedTileFraction(targetCreatureSizeStr), // target_occupied_fraction is attributes.size
        dispersionSourcesObj
    );

    const uiConfidencePercentages: UIConfidencePercentages = {
        Great: 0, Normal: 0, Graze: 0, Miss: 0
    };
    // Order matters here as per CDDA C++ code (subtracting chances for better outcomes)
    let currentChanceAccumulated = 0.0;

    // PRESERVE: From calculate_ranged_chances loop, using confidence_config
    // accuracy_critical, accuracy_goodhit, accuracy_standard map to Great, Normal, Graze respectively
    // Loop order: Critical (Great), then Goodhit (Normal), then Standard (Graze)
    
    // Great Hit / Critical (accuracy_critical = 0.2)
    let chanceGreat = Math.min(100.0, 100.0 * ACCURACY_CRITICAL * uiConfidenceScore) - currentChanceAccumulated;
    uiConfidencePercentages.Great = Math.max(0.0, chanceGreat); // Ensure non-negative
    currentChanceAccumulated += uiConfidencePercentages.Great;

    // Normal Hit / Good Hit (accuracy_goodhit = 0.5)
    let chanceNormal = Math.min(100.0, 100.0 * ACCURACY_GOODHIT * uiConfidenceScore) - currentChanceAccumulated;
    uiConfidencePercentages.Normal = Math.max(0.0, chanceNormal);
    currentChanceAccumulated += uiConfidencePercentages.Normal;

    // Graze / Standard (accuracy_standard = 0.8)
    let chanceGraze = Math.min(100.0, 100.0 * ACCURACY_STANDARD * uiConfidenceScore) - currentChanceAccumulated;
    uiConfidencePercentages.Graze = Math.max(0.0, chanceGraze);
    currentChanceAccumulated += uiConfidencePercentages.Graze;
    
    // Miss (100 - accumulated)
    uiConfidencePercentages.Miss = 100.0 - currentChanceAccumulated;
    uiConfidencePercentages.Miss = Math.max(0.0, uiConfidencePercentages.Miss); // Ensure non-negative due to float arithmetic

    // Round to 0 decimal places for UI comparison, ensuring sum is 100 (CDDA often truncates/rounds)
    let totalSumUi = uiConfidencePercentages.Great + uiConfidencePercentages.Normal + uiConfidencePercentages.Graze + uiConfidencePercentages.Miss;
    if (totalSumUi !== 0) { // Avoid division by zero
        const scalingFactor = 100.0 / totalSumUi;
        uiConfidencePercentages.Great = Math.round(uiConfidencePercentages.Great * scalingFactor);
        uiConfidencePercentages.Normal = Math.round(uiConfidencePercentages.Normal * scalingFactor);
        uiConfidencePercentages.Graze = Math.round(uiConfidencePercentages.Graze * scalingFactor);
        uiConfidencePercentages.Miss = Math.round(uiConfidencePercentages.Miss * scalingFactor);
    }
    // Re-check sum after rounding, sometimes it's 99 or 101. Adjust Miss to make it 100.
    const finalSumUi = uiConfidencePercentages.Great + uiConfidencePercentages.Normal + uiConfidencePercentages.Graze + uiConfidencePercentages.Miss;
    if (finalSumUi !== 100) {
        uiConfidencePercentages.Miss += (100 - finalSumUi);
    }
        
    return { actualHitPercentages, uiConfidencePercentages, avgDeviationOverall };
}