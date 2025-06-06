// PRESERVE: cdda_constants.py
// This file contains constants mirrored or derived from CDDA source code.
// DO NOT ALTER THIS COMMENT

// We need math for MOA_TO_RADIANS calculation and for derived LOGI constants.
import { _logarithmicSigmoid } from './cddaUtils'; // Temporarily import for LOGI_MIN/MAX/RANGE derivation. Will be removed once derived.

// --- Core Game Mechanics Constants ---
// PRESERVE: From CDDA source mostly from game_constants.h /.ccp
export const MAX_RECOIL = 3000.0; // // The maximum level recoil will ever reach. (character.h or similar)
export const MIN_RECOIL_IMPROVEMENT = 0.01; // // Recoil change less or equal to this value (in MoA) stops further aiming (character.h)
export const MAX_SKILL = 10; // // Maximum (effective) level for a skill. (defines.h or options.cpp)

// --- Options Loaded (Typically from options.json or game_options.cpp) ---
// PRESERVE: Values confirmed from options JSON data provided by user
export const GUN_DISPERSION_DIVIDER = 18.0; // // Value that divides total weapon dispersion. (options.json)
export const DISPERSION_PER_GUN_DAMAGE = 30; // // Value that adds to weapon dispersion per weapon damage value. (options.json)

// --- Mathematical/Curve Constants ---
// PRESERVE: Used in logarithmic_range function (rng.cpp or similar utility)
export const LOGI_CUTOFF = 4.0;

// PRESERVE: Derived constants for logarithmic_range, defined here after _logarithmic_sigmoid and LOGI_CUTOFF import
// These need to be defined *after* _logarithmicSigmoid is available.
// This is a temporary import, once these values are set, _logarithmicSigmoid will not be directly used here.
export const LOGI_MIN = _logarithmicSigmoid(-LOGI_CUTOFF);
export const LOGI_MAX = _logarithmicSigmoid(LOGI_CUTOFF);
export const LOGI_RANGE = LOGI_MAX - LOGI_MIN;


// --- Aiming Speed and Factor Constants ---
// PRESERVE: From Character::aim_factor_from_volume (character.cpp)
export const PISTOL_AIM_FACTOR_VOLUME_BASE = 4.0;
export const OTHER_GUN_AIM_FACTOR_VOLUME_BASE = 1.0;
export const MIN_VOLUME_WITHOUT_DEBUFF_ML = 800.0;
export const MIN_AIM_FACTOR_VOLUME_OR_LENGTH = 0.2; // // Common minimum for both volume and length factors

// PRESERVE: From Character::aim_factor_from_length (character.cpp)
export const LENGTH_THRESHOLD_MM_CONFINED = 300.0;
export const LENGTH_PENALTY_DIVISOR_CONFINED = 1000.0;

// PRESERVE: From Character::aim_per_move (character.cpp)
export const BASE_AIM_SPEED_CONSTANT = 10.0;
export const AIM_PER_MOVE_FINAL_SCALER = 2.4;
export const AIM_SPEED_SKILL_DIVISOR_BASE = 2.5;
export const AIM_SPEED_SKILL_DIVISOR_SKILL_FACTOR = 0.2; // Multiplies skill level

// PRESERVE: From Character::fastest_aiming_method_speed (character.cpp)
export const IRON_SIGHT_FOV = 480.0; // MOA for iron sights to be usable
export const POINT_SHOOTING_PISTOL_BASE_SPEED_MOD = 10.0;
export const POINT_SHOOTING_PISTOL_SKILL_SPEED_FACTOR = 4.0;
export const LASER_SIGHT_BASE_DISTANCE = 10; // tiles for laser range calculation
export const LASER_SIGHT_LIGHT_LIMIT = 120.0; // light level for laser effectiveness falloff

// PRESERVE: From Character::point_shooting_limit (character.cpp)
export const ARCHERY_PS_LIMIT_BASE = 30.0;
export const ARCHERY_PS_LIMIT_DIVISOR_FACTOR = 220.0;
export const FIREARM_PS_LIMIT_BASE = 200.0;
export const FIREARM_PS_LIMIT_SKILL_FACTOR = 10.0;

// PRESERVE: From static double dispersion_from_skill (ranged.cpp)
export const DISP_FROM_SKILL_BASE_PENALTY_PER_SHORTFALL = 10.0;
export const DISP_FROM_SKILL_THRESHOLD = 5.0;
export const DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR = 1.25; // Multiplies (p_val / (MAX_SKILL - THRESHOLD)) effectively
export const DISP_FROM_SKILL_PRE_THRESH_WEAP_DISP_BASE_FACTOR = 1.25;
export const DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR = 2.0; // Derived from (10.0 / skill_threshold which is 5.0)

// --- Character Stat Modifier Related Constants ---
// PRESERVE: From Character::ranged_dex_mod / Character::ranged_per_mod (character.cpp)
export const STAT_THRESHOLD_FOR_PENALTY = 20.0; // // Stats at or above this often incur no penalty from these specific mods
export const RANGED_DEX_MOD_FACTOR = 0.5;
export const RANGED_PER_MOD_FACTOR = 1.2;
// PRESERVE: From Character::get_character_parallax (character.cpp)
export const RANGED_PER_MOD_ZOOM_EFFECT_MULTIPLIER = 0.25;

// --- Specific Character Modifier Builtin/Config Constants ---
// PRESERVE: Based on JSON definitions for character_modifiers

// PRESERVE: For ranged_dispersion_vision_mod (character_modifiers.json)
export const VISION_MOD_NOMINATOR = 30.0;
export const VISION_MOD_SUBTRACTOR = 30.0;
export const VISION_MOD_MAX_VAL = 10000.0;

// PRESERVE: For aim_speed_dex_modifier (builtin, character_modifiers.json)
export const AIM_SPEED_DEX_MOD_BASE_DEX = 8;
export const AIM_SPEED_DEX_MOD_FACTOR = 0.5;

// PRESERVE: For aim_speed_skill_modifier (builtin, character_modifiers.json)
export const AIM_SPEED_SKILL_MOD_FIREARM_MULT = 0.25;
export const AIM_SPEED_SKILL_MOD_FIREARM_BASE = 0.0;
export const AIM_SPEED_SKILL_MOD_ARCHERY_MULT = 0.5;
export const AIM_SPEED_SKILL_MOD_ARCHERY_BASE = -1.5;

// PRESERVE: For aim_speed_mod (character_modifiers.json)
export const AIM_SPEED_GENERAL_MOD_MIN = 0.1;
export const AIM_SPEED_GENERAL_MOD_MAX = 1.0;
export const AIM_SPEED_GENERAL_MOD_GRIP_WEIGHT = 0.2;
export const AIM_SPEED_GENERAL_MOD_MANIP_WEIGHT = 0.2;
export const AIM_SPEED_GENERAL_MOD_LIFT_WEIGHT = 0.6;

// PRESERVE: For ranged_dispersion_manip_mod (character_modifiers.json)
export const MANIP_DISP_MOD_NOMINATOR = 22.8;
export const MANIP_DISP_MOD_SUBTRACTOR = 22.8;
export const MANIP_DISP_MOD_MAX_VAL = 1000.0;

// --- P_VALs for dispersion_from_skill (derived) ---
// PRESERVE: Based on formula 300 or 450 / GUN_DISPERSION_DIVIDER (Character::get_weapon_dispersion, ranged.cpp)
export const P_VAL_FIREARMS = 300.0 / GUN_DISPERSION_DIVIDER;
export const P_VAL_ARCHERY = 450.0 / GUN_DISPERSION_DIVIDER;

// --- Constants for dispersion_sources::roll() cap ---
// PRESERVE: dispersion_sources::roll() (dispersion.cpp)
export const DISPERSION_ROLL_MAX_CAP = 3600.0; // Max MOA value from a roll

// PRESERVE: Time to Attack parameters for various skills
// Data from skill JSON files: { "min_time": X, "base_time": Y, "time_reduction_per_level": Z }
export const SKILL_TIME_TO_ATTACK_DATA = {
    "archery":  {"min_time": 20, "base_time": 50, "time_reduction_per_level": 3},
    "launcher": {"min_time": 30, "base_time": 100, "time_reduction_per_level": 5},
    "pistol":   {"min_time": 20, "base_time": 30, "time_reduction_per_level": 1},
    "rifle":    {"min_time": 20, "base_time": 30, "time_reduction_per_level": 1},
    "shotgun":  {"min_time": 20, "base_time": 30, "time_reduction_per_level": 1},
    "smg":      {"min_time": 20, "base_time": 30, "time_reduction_per_level": 1},
    // Add other skills here if you get their data, e.g., melee, unarmed
    "unarmed":  {"min_time": 25, "base_time": 100, "time_reduction_per_level": 5}, // Common default if skill not found
};

// PRESERVE: Default if a specific skill's time_to_attack data isn't found
export const DEFAULT_TIME_TO_ATTACK = {"min_time": 25, "base_time": 100, "time_reduction_per_level": 0}; // Generic fallback

// PRESERVE: Stamina penalty for RAS_time
export const RAS_STAMINA_THRESHOLD_PERCENT = 25;
export const RAS_STAMINA_PENALTY_FACTOR = 2;

// PRESERVE: For angular conversions (ballistics.cpp / ranged.cpp)
export const MOA_TO_RADIANS = (1.0 / 60.0) * (Math.PI / 180.0);

// PRESERVE: From gameconstants.h - Accuracy levels for UI confidence display
export const ACCURACY_CRITICAL = 0.2;    // For "Great" hits in UI
export const ACCURACY_GOODHIT  = 0.5;    // For "Normal" hits in UI
export const ACCURACY_STANDARD = 0.8;    // For "Graze" hits in UI (UI label often "Graze", despite standard name)
export const ACCURACY_GRAZING  = 1.0;    // Edge of hit/miss threshold