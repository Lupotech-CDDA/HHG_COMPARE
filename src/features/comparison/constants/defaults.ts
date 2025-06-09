// src/features/comparison/constants/defaults.ts
// Placeholder constants based on our analysis.

export const MAX_SKILL = 10;
export const MAX_RECOIL_MOA = 500; // V1's value, different from Python's 3000
export const WEAPON_DISPERSION_CONSTANT_FIREARM = 300 / 18.0;
export const DEFAULT_SIGHT_DISPERSION = 300;

// Hit probability factors from V1
export const ACCURACY_CRITICAL_FACTOR = 0.4;
export const ACCURACY_STANDARD_FACTOR = 0.8;
export const ACCURACY_GRAZING_FACTOR = 1.0;

// Damage multipliers
export const GOOD_HIT_DAMAGE_MULTIPLIER = 1.4;
export const GRAZE_DAMAGE_MULTIPLIER_DEFAULT = 0.5;