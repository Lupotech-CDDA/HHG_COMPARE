// src/gameConstants.ts

// --- Core Game Mechanics & Time ---
export const PLAYER_SPEED_MOVES_PER_SECOND = 100;
export const MOVES_PER_GAME_SECOND = 100; // Typically 1 turn = 1 second = 100 moves in CDDA

// --- Combat & Accuracy ---
export const MAX_SKILL = 10; // Maximum skill level relevant for calculations
export const MAX_RECOIL_MOA = 5000; // A cap for player's recoil MOA
export const METERS_PER_TILE = 1.0; // Standard conversion for range calculations

export const ACCURACY_CRITICAL_FACTOR = 0.1; // Target angular size multiplier for a critical hit
export const ACCURACY_STANDARD_FACTOR = 0.4; // Target angular size multiplier for a standard hit
export const ACCURACY_GRAZING_FACTOR = 0.7; // Target angular size multiplier for a grazing hit
export const GRAZE_DAMAGE_MULTIPLIER_DEFAULT = 0.33; // Damage multiplier for a graze

export const WEAPON_DISPERSION_CONSTANT_FIREARM = 300; // Constant used in skill-based dispersion penalty formula
export const DEFAULT_SIGHT_DISPERSION = 300; // Fallback sight dispersion if a gun is missing 'sight_dispersion' property

// --- Ammunition & Special Effects ---
export const AMMO_EFFECT_RECHARGE_RATE_KJ_PER_TURN = 0.2; // For RECHARGE_INTERNAL_BATTERY effect, in kJ per turn (100 moves)
export const EXPECTED_SHRAPNEL_HIT_PERCENTAGE_ON_EPICENTER_TARGET = 0.15; // Simplified factor for shrapnel damage calc

// --- Standardized Values for DPS Calculations & Scenarios ---
export const STANDARD_RANGES_TILES = [1, 5, 10, 15, 20, 30]; // Standard ranges for DPS calculation
export const DEFAULT_REFERENCE_RANGE_TILES = 10; // Default range for choosing the primary reference DPS
export const STANDARD_UPS_CAPACITY_KJ = 500; // Assumed capacity for a standard UPS unit in calculations
export const STANDARD_UPS_SWAP_MOVES = 150; // Assumed time to swap a UPS

// --- Damage Multipliers for Hit Tiers ---
export const GOOD_HIT_DAMAGE_MULTIPLIER = 1.414; // Added export
export const CRITICAL_HIT_DAMAGE_MULTIPLIER_BASE = 1.9; // Added export

// --- Ammunition Keywords (used for selecting representative ammo) ---
export const STANDARD_AMMO_KEYWORDS = ["fmj", "ball", "standard"];
export const NON_STANDARD_AMMO_KEYWORDS = [
  "+p",
  "jhp",
  "ap",
  "incendiary",
  "tracer",
  "reloaded",
  "black powder",
  "match",
  "subsonic",
  "cb",
  "short",
  "ratshot",
  "birdshot",
  "blank",
  "flechette",
  "beanbag",
  "slug",
];

// --- Aiming & Recoil ---
// (Could add aiming related constants here if they become more global, e.g., default aim times, but many are derived)
// export const MIN_RECOIL_IMPROVEMENT_PER_MOVE = 0.1; // If needed for estimateMovesToReachRecoil
