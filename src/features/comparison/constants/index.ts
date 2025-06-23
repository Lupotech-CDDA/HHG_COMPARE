// src/features/comparison/constants/index.ts

import type { SkillAttackTime } from "../core/types";

// =============================================================================
// SECTION: Type Definitions
// =============================================================================
export interface SkillAttackTime {
  min_time: number;
  base_time: number;
  time_reduction_per_level: number;
}

// =============================================================================
// SECTION: Core Game Mechanics Constants
// =============================================================================
export const MAX_SKILL = 10;
export const MAX_RECOIL_MOA = 3000.0;
export const MIN_RECOIL_IMPROVEMENT_PER_MOVE = 0.01;
export const GUN_DISPERSION_DIVIDER = 18.0;
export const DISPERSION_PER_GUN_DAMAGE = 30;
export const MOA_TO_RADIANS = (1.0 / 60.0) * (Math.PI / 180.0);

// =============================================================================
// SECTION: Aiming and Dispersion Constants
// =============================================================================
export const BASE_AIM_SPEED_CONSTANT = 10.0;
export const AIM_PER_MOVE_FINAL_SCALER = 2.4;
export const AIM_SPEED_SKILL_DIVISOR_BASE = 2.5;
export const AIM_SPEED_SKILL_DIVISOR_SKILL_FACTOR = 0.2;

// --- Sights and Point Shooting ---
export const IRON_SIGHT_FOV = 480.0;
export const POINT_SHOOTING_PISTOL_BASE_SPEED_MOD = 10.0;
export const POINT_SHOOTING_PISTOL_SKILL_SPEED_FACTOR = 4.0;
export const ARCHERY_PS_LIMIT_BASE = 30.0;
export const ARCHERY_PS_LIMIT_DIVISOR_FACTOR = 220.0;
export const FIREARM_PS_LIMIT_BASE = 200.0;
export const FIREARM_PS_LIMIT_SKILL_FACTOR = 10.0;

// --- Skill-based Dispersion ---
export const DISP_FROM_SKILL_BASE_PENALTY_PER_SHORTFALL = 10.0;
export const DISP_FROM_SKILL_THRESHOLD = 5.0;
export const DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR = 1.25;
export const DISP_FROM_SKILL_PRE_THRESH_WEAP_DISP_BASE_FACTOR = 1.25;
export const DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR = 2.0;

export const P_VAL_FIREARMS = 300.0 / GUN_DISPERSION_DIVIDER;
export const P_VAL_ARCHERY = 450.0 / GUN_DISPERSION_DIVIDER;

// =============================================================================
// SECTION: Character Stat and Modifier Constants
// =============================================================================
export const STAT_THRESHOLD_FOR_PENALTY = 20.0;
export const RANGED_DEX_MOD_FACTOR = 0.5;
export const RANGED_PER_MOD_FACTOR = 1.2;
export const RANGED_PER_MOD_ZOOM_EFFECT_MULTIPLIER = 0.25;

export const AIM_SPEED_DEX_MOD_BASE_DEX = 8;
export const AIM_SPEED_DEX_MOD_FACTOR = 0.5;

// --- ADDED MISSING CONSTANTS ---
export const AIM_SPEED_SKILL_MOD_FIREARM_MULT = 0.25;
export const AIM_SPEED_SKILL_MOD_FIREARM_BASE = 0.0;
// --- END OF ADDED CONSTANTS ---

// =============================================================================
// SECTION: Hit Chance & Damage Constants
// =============================================================================
export const ACCURACY_CRITICAL_FACTOR = 0.2;
export const ACCURACY_GOODHIT_FACTOR = 0.5;
export const ACCURACY_STANDARD_FACTOR = 0.8;

export const CRITICAL_HIT_DAMAGE_MULTIPLIER = 2.0;
export const GOOD_HIT_DAMAGE_MULTIPLIER = 1.5;
export const NORMAL_HIT_DAMAGE_MULTIPLIER = 1.0;
export const GRAZE_HIT_DAMAGE_MULTIPLIER = 0.5;
export const CRITICAL_HIT_DAMAGE_MULTIPLIER_DEFAULT = 2.0;

// =============================================================================
// SECTION: Time to Attack Data
// =============================================================================
export const SKILL_TIME_TO_ATTACK_DATA: Record<string, SkillAttackTime> = {
  archery: { min_time: 20, base_time: 50, time_reduction_per_level: 3 },
  launcher: { min_time: 30, base_time: 100, time_reduction_per_level: 5 },
  pistol: { min_time: 20, base_time: 30, time_reduction_per_level: 1 },
  rifle: { min_time: 20, base_time: 30, time_reduction_per_level: 1 },
  shotgun: { min_time: 20, base_time: 30, time_reduction_per_level: 1 },
  smg: { min_time: 20, base_time: 30, time_reduction_per_level: 1 },
  unarmed: { min_time: 25, base_time: 100, time_reduction_per_level: 5 },
};

export const DEFAULT_TIME_TO_ATTACK: SkillAttackTime = {
  min_time: 25, base_time: 100, time_reduction_per_level: 0,
};

// =============================================================================
// SECTION: Standardized Scenario Constants
// =============================================================================
export const TARGET_ANGULAR_SIZE_MEDIUM_10_TILES = 17.18;
export const DEFAULT_AIM_PROFILE = { start: MAX_RECOIL_MOA, target: 150 };