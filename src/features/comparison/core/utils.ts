// src/features/comparison/core/utils.ts

import { MOA_TO_RADIANS } from "../constants/index";

// =============================================================================
// SECTION: Utility Functions Ported from cdda_utils.py
// =============================================================================

const LOGI_CUTOFF = 4.0;
const _logarithmic_sigmoid = (t: number) => 1.0 / (1.0 + Math.exp(-t));
const LOGI_MIN = _logarithmic_sigmoid(-LOGI_CUTOFF);
const LOGI_MAX = _logarithmic_sigmoid(LOGI_CUTOFF);
const LOGI_RANGE = LOGI_MAX - LOGI_MIN;

/**
 * Maps a value from a linear range to a sigmoid curve.
 * Port of: `logarithmic_range` from cdda_utils.py
 * The `invert` flag is a new addition to handle the two different ways this function is used.
 */
export function logarithmic_range(min_val: number, max_val: number, current_val: number, invert: boolean = false): number {
    if (min_val >= max_val) return 0.0;
    if (current_val <= min_val) return invert ? 0.0 : 1.0;
    if (current_val >= max_val) return invert ? 1.0 : 0.0;

    const unit_pos = (current_val - min_val) / (max_val - min_val);
    
    // The C++ version in `aim_per_move` uses the direct value, not scaled.
    // The other version scales it. We use a flag to differentiate.
    const scaled_pos = invert ? (unit_pos * 2 * LOGI_CUTOFF) - LOGI_CUTOFF : LOGI_CUTOFF - 2.0 * LOGI_CUTOFF * unit_pos;
    
    const raw_logistic = _logarithmic_sigmoid(scaled_pos);

    if (LOGI_RANGE === 0) return 0;
    return (raw_logistic - LOGI_MIN) / LOGI_RANGE;
}

export function get_occupied_tile_fraction(creature_size_str: "tiny" | "small" | "medium" | "large" | "huge"): number {
  switch (creature_size_str) {
    case "tiny": return 0.1;
    case "small": return 0.25;
    case "medium": return 0.5;
    case "large": return 0.75;
    case "huge": return 1.0;
    default: return 0.5;
  }
}

export function calculate_iso_tangent_linear_deviation(range_tiles: number, angular_deviation_moa: number): number {
  if (range_tiles <= 0) return 0.0;
  const angular_deviation_radians = angular_deviation_moa * MOA_TO_RADIANS;
  return Math.tan(angular_deviation_radians / 2.0) * range_tiles;
}