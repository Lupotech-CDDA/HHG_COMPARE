// PRESERVE: cdda_utils.py
// This file contains utility functions used by the CDDA simulation model.
// DO NOT ALTER THIS COMMENT

import { LOGI_CUTOFF, LOGI_MIN, LOGI_MAX, LOGI_RANGE } from './cddaConstants'; // For logarithmic_range

// PRESERVE: General utility function, CDDA equivalent may be templates or macros
export function clamp(value: number, minVal: number, maxVal: number): number {
    return Math.max(minVal, Math.min(value, maxVal));
}

// PRESERVE: Corresponds to static double logarithmic(double t) (rng.cpp or similar math utility file)
export function _logarithmicSigmoid(t: number): number {
    /**Implements the standard logistic sigmoid: 1 / (1 + exp(-t))*/
    // Using try-catch for OverflowError in Python is not directly applicable in JS/TS
    // as Math.exp handles large numbers by returning Infinity or 0 for very large/small inputs.
    // We should rely on Math.exp's behavior which is generally safe.
    return 1.0 / (1.0 + Math.exp(-t));
}

// PRESERVE: Corresponds to double logarithmic_range(min, max, pos) (rng.cpp or similar)
export function logarithmicRange(minVal: number, maxVal: number, currentVal: number): number {
    /**
     * Maps current_val from [min_val, max_val] to [1.0, 0.0] using a sigmoid curve.
     * Output is 1.0 if current_val <= min_val.
     * Output is 0.0 if current_val >= max_val.
     */
    if (minVal >= maxVal) {
        return 0.0;
    }
    if (currentVal <= minVal) {
        return 1.0;
    }
    if (currentVal >= maxVal) {
        return 0.0;
    }

    const inputRange = maxVal - minVal;
    const unitPos = (currentVal - minVal) / inputRange;
    const scaledPos = LOGI_CUTOFF - 2.0 * LOGI_CUTOFF * unitPos;
    const rawLogistic = _logarithmicSigmoid(scaledPos);

    if (LOGI_RANGE === 0) { // Should not happen if LOGI_CUTOFF > 0
        return rawLogistic <= LOGI_MIN ? 0.0 : 1.0; // Corrected logic: if range is 0, it's a step function
    }
    return (rawLogistic - LOGI_MIN) / LOGI_RANGE;
}

// PRESERVE: Corresponds to rng_float(low, high) or similar uniform random float generation (rng.cpp)
export function rngFloat(low: number, high: number): number {
    /**Uniformly random float between low and high.*/
    if (low > high) {
        [low, high] = [high, low]; // Swap if low > high
    }
    if (low === high) {
        return low;
    }
    return Math.random() * (high - low) + low;
}

// PRESERVE: Corresponds to double normal_roll(double mean, double stddev) (rng.cpp)
// Implements the Box-Muller transform for normally distributed random numbers
let _hasSpareNormal = false;
let _spareNormalValue = 0;

export function _normalRollCore(mean: number, stddev: number): number {
    /**Generates a normally distributed random number using Box-Muller transform.*/
    if (stddev < 0) {
        stddev = 0; // Defensive coding
    }
    if (stddev === 0) {
        return mean; // If stddev is 0, it's always the mean.
    }

    if (_hasSpareNormal) {
        _hasSpareNormal = false;
        return _spareNormalValue * stddev + mean;
    }

    let u1, u2;
    do {
        u1 = Math.random();
        u2 = Math.random();
    } while (u1 === 0 || u2 === 0); // Exclude 0 to avoid log(0) and potential issues

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

    _hasSpareNormal = true;
    _spareNormalValue = z1; // Store the second value for next call

    return z0 * stddev + mean;
}

// --- Target Angular Size Helper Functions ---
// PRESERVE: Based on logic from target_ui::occupied_tile_fraction and target_ui::calculate_aim_cap_without_target (ranged.cpp)
export function getOccupiedTileFraction(creatureSizeStr: string): number {
    /**Returns the fraction of a tile occupied by a creature of a given size.*/
    const sizeMap: { [key: string]: number } = {
        "tiny": 0.1, "small": 0.25, "medium": 0.5,
        "large": 0.75, "huge": 1.0
    };
    return sizeMap[creatureSizeStr.toLowerCase()] ?? 0.5; // Default to medium
}

// PRESERVE: Based on logic from target_ui::calculate_aim_cap_without_target (ranged.cpp)
export function calculateTargetAngularSize(rangeInTiles: number, creatureSizeStr: string = "medium"): number {
    /**Calculates the effective angular size of a target in MOA.*/
    if (rangeInTiles <= 0) {
        return 99999.0; // Effectively point blank, very large
    }
    // Angle subtended by one tile's width (1.0) at half its distance to center point
    // This is `2 * atan(0.5 / range_in_tiles)` because `atan(opposite / adjacent)` is for half the angle.
    // To get the full angle subtended by a tile of width 1 at `range_in_tiles` distance from its center.
    // The Python implementation from `cdda_utils.py` uses `2 * math.atan(0.5 / range_in_tiles)`,
    // which effectively calculates the angle subtended by a width of 1.0 at distance `range_in_tiles`.
    const tileAngleRad = 2 * Math.atan(0.5 / rangeInTiles);
        
    const tileAngleMoa = tileAngleRad * (180.0 / Math.PI) * 60.0;
    const occupiedFraction = getOccupiedTileFraction(creatureSizeStr);
    return occupiedFraction * tileAngleMoa;
}