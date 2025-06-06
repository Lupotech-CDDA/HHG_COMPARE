// PRESERVE: cdda_character_modifiers.py
// This file contains functions that calculate character-specific modifiers
// based on stats, skills, and the character_modifier system.
// DO NOT ALTER THIS COMMENT

import {
    STAT_THRESHOLD_FOR_PENALTY, RANGED_DEX_MOD_FACTOR, RANGED_PER_MOD_FACTOR,
    RANGED_PER_MOD_ZOOM_EFFECT_MULTIPLIER, MAX_SKILL,
    VISION_MOD_NOMINATOR, VISION_MOD_SUBTRACTOR, VISION_MOD_MAX_VAL,
    AIM_SPEED_DEX_MOD_BASE_DEX, AIM_SPEED_DEX_MOD_FACTOR,
    AIM_SPEED_SKILL_MOD_FIREARM_MULT, AIM_SPEED_SKILL_MOD_FIREARM_BASE,
    AIM_SPEED_SKILL_MOD_ARCHERY_MULT, AIM_SPEED_SKILL_MOD_ARCHERY_BASE,
    AIM_SPEED_GENERAL_MOD_MIN, AIM_SPEED_GENERAL_MOD_MAX,
    AIM_SPEED_GENERAL_MOD_GRIP_WEIGHT, AIM_SPEED_GENERAL_MOD_MANIP_WEIGHT,
    AIM_SPEED_GENERAL_MOD_LIFT_WEIGHT,
    MANIP_DISP_MOD_NOMINATOR, MANIP_DISP_MOD_SUBTRACTOR, MANIP_DISP_MOD_MAX_VAL,
    ARCHERY_PS_LIMIT_BASE, ARCHERY_PS_LIMIT_DIVISOR_FACTOR,
    FIREARM_PS_LIMIT_BASE, FIREARM_PS_LIMIT_SKILL_FACTOR
} from '../utils/cddaConstants';
import { clamp } from '../utils/cddaUtils'; // Assuming clamp is in cdda_utils.ts

// --- Direct Stat-Based Calculations (from Character class methods) ---

// PRESERVE: Corresponds to int Character::ranged_dex_mod() const (character.cpp)
export function calculateRangedDexMod(dexLevel: number): number {
    /**Calculates dexterity-based dispersion penalty.*/
    return Math.max((STAT_THRESHOLD_FOR_PENALTY - dexLevel) * RANGED_DEX_MOD_FACTOR, 0.0);
}

// PRESERVE: Corresponds to int Character::ranged_per_mod() const (character.cpp)
export function calculateRangedPerMod(perLevel: number): number {
    /**Calculates perception-based penalty value (raw value used in parallax).*/
    return Math.max((STAT_THRESHOLD_FOR_PENALTY - perLevel) * RANGED_PER_MOD_FACTOR, 0.0);
}

// PRESERVE: Corresponds to int Character::get_character_parallax(bool zoom) const (character.cpp)
export function calculateCharacterParallax(
    perLevel: number,
    visionScoreModifierValue: number,
    isZoomed: boolean
): number {
    /**Calculates character parallax in MOA.
       'visionScoreModifierValue' is the result of calculateModifierRangedDispersionVision.
    */
    let baseParallaxFromPerception = calculateRangedPerMod(perLevel);
    if (isZoomed) {
        baseParallaxFromPerception *= RANGED_PER_MOD_ZOOM_EFFECT_MULTIPLIER;
    }

    // visionScoreModifierValue can be negative (a bonus)
    const totalCharacterParallax = baseParallaxFromPerception + visionScoreModifierValue;
    // Final parallax is an integer and non-negative
    return Math.max(Math.round(totalCharacterParallax), 0);
}

// PRESERVE: Corresponds to int Character::point_shooting_limit(const item &gun) const (character.cpp)
export function calculatePointShootingLimit(
    skillLevel: number,
    gunSkillIdStr: string, // e.g., "pistol", "rifle"
    currentMaxSkill: number = MAX_SKILL
): number {
    /**Calculates best aim (min recoil/dispersion) from point shooting.*/
    // Ensure skillLevel is float for min comparison with float MAX_SKILL if it comes as int
    const cappedSkill = Math.min(skillLevel, currentMaxSkill);
    if (gunSkillIdStr === "archery") {
        // PRESERVE: return 30 + 220 / ( 1 + std::min( get_skill_level( gun_skill ), static_cast<float>( MAX_SKILL ) ) );
        return ARCHERY_PS_LIMIT_BASE + ARCHERY_PS_LIMIT_DIVISOR_FACTOR / (1.0 + cappedSkill);
    } else { // Firearms
        // PRESERVE: return 200 - 10 * std::min( get_skill_level( gun_skill ), static_cast<float>( MAX_SKILL ) );
        return FIREARM_PS_LIMIT_BASE - FIREARM_PS_LIMIT_SKILL_FACTOR * cappedSkill;
    }
}

// --- TypeScript Equivalents of Character Modifier Calculations ---
// These functions simulate the result of `Character::get_modifier(modifier_id, ...)`
// by implementing either the 'builtin' logic or the configured formula based on JSON.

// PRESERVE: Simulates `get_modifier(character_modifier_ranged_dispersion_vision_mod)`
//           which uses the configured formula from its JSON definition.
export function calculateModifierRangedDispersionVision(visionScoreVal: number): number {
    /**Calculates the vision modifier for parallax.
       'visionScoreVal' is the abstract result of Character::get_limb_score("vision").
    */
    // Ensure visionScoreVal is not zero to prevent division errors,
    // and not negative if it represents a capacity (game might handle this earlier).
    if (visionScoreVal <= 0) {
        // A very small positive value to simulate extreme penalty without breaking math
        visionScoreVal = 0.01;
    }

    // PRESERVE: Formula based on JSON: (nominator / score) - subtractor
    let score = (VISION_MOD_NOMINATOR / visionScoreVal) - VISION_MOD_SUBTRACTOR;
    // PRESERVE: Apply max cap from JSON
    score = Math.min(VISION_MOD_MAX_VAL, score);
    // Note: This modifier can be negative (a bonus to parallax).
    // The final non-negative clamp happens in calculateCharacterParallax.
    return score;
}

// PRESERVE: Simulates `get_modifier(character_modifier_aim_speed_dex_mod)`
//           which uses the 'aim_speed_dex_modifier' builtin.
//           Equivalent to static float aim_speed_dex_modifier(const Character &c, ...)
export function calculateModifierAimSpeedDex(dexLevel: number): number {
    /**Calculates the Dexterity modifier for aim speed.*/
    return (dexLevel - AIM_SPEED_DEX_MOD_BASE_DEX) * AIM_SPEED_DEX_MOD_FACTOR;
}

// PRESERVE: Simulates `get_modifier(character_modifier_aim_speed_skill_mod, gun_skill)`
//           which uses the 'aim_speed_skill_modifier' builtin.
//           Equivalent to static float aim_speed_skill_modifier(const Character &c, const skill_id &gun_skill)
export function calculateModifierAimSpeedSkill(
    skillLevel: number,
    gunSkillIdStr: string,
    currentMaxSkill: number = MAX_SKILL
): number {
    /**Calculates the skill modifier for aim speed.*/
    const cappedSkill = Math.min(skillLevel, currentMaxSkill);
    if (gunSkillIdStr === "archery") {
        return AIM_SPEED_SKILL_MOD_ARCHERY_MULT * cappedSkill + AIM_SPEED_SKILL_MOD_ARCHERY_BASE;
    } else { // Firearms
        return AIM_SPEED_SKILL_MOD_FIREARM_MULT * cappedSkill + AIM_SPEED_SKILL_MOD_FIREARM_BASE;
    }
}

// PRESERVE: Simulates `get_modifier(character_modifier_aim_speed_mod)`
//           which uses the configured formula from its JSON definition (limb scores).
export function calculateModifierAimSpeedGeneral(
    gripScoreVal: number,
    manipScoreVal: number,
    liftScoreVal: number
): number {
    /**Calculates the general aim speed multiplier.
       'gripScoreVal', 'manipScoreVal', 'liftScoreVal' are abstract results
       of Character::get_limb_score for "grip", "manip", and "lift".
    */
    // PRESERVE: Weighted sum of limb scores as per JSON
    const rawCombinedScore = (gripScoreVal * AIM_SPEED_GENERAL_MOD_GRIP_WEIGHT +
                              manipScoreVal * AIM_SPEED_GENERAL_MOD_MANIP_WEIGHT +
                              liftScoreVal * AIM_SPEED_GENERAL_MOD_LIFT_WEIGHT);
    
    // PRESERVE: Apply min/max caps from JSON
    return clamp(rawCombinedScore, AIM_SPEED_GENERAL_MOD_MIN, AIM_SPEED_GENERAL_MOD_MAX);
}

// PRESERVE: Simulates `get_modifier(character_modifier_ranged_dispersion_manip_mod)`
//           which uses the configured formula from its JSON definition.
export function calculateModifierRangedDispersionManip(handManipScoreVal: number): number {
    /**Calculates the manipulation-based dispersion penalty.
       'handManipScoreVal' is the abstract result of Character::get_limb_score("manip", "hand").
    */
    if (handManipScoreVal <= 0) {
        handManipScoreVal = 0.01; // Avoid division by zero, simulate extreme penalty
    }

    // PRESERVE: Formula based on JSON: (nominator / score) - subtractor
    let score = (MANIP_DISP_MOD_NOMINATOR / handManipScoreVal) - MANIP_DISP_MOD_SUBTRACTOR;
    // PRESERVE: Apply max cap from JSON
    score = Math.min(MANIP_DISP_MOD_MAX_VAL, score);
    // PRESERVE: Dispersion penalties are typically non-negative.
    return Math.max(0.0, score);
}