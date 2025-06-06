// PRESERVE: cdda_aiming_core.py
// This file contains the core logic for calculating aiming progression,
// sight effectiveness, and dispersion characteristics.
// DO NOT ALTER THIS COMMENT

import {
    MAX_SKILL, DISP_FROM_SKILL_BASE_PENALTY_PER_SHORTFALL, DISP_FROM_SKILL_THRESHOLD,
    DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR, DISP_FROM_SKILL_PRE_THRESH_WEAP_DISP_BASE_FACTOR,
    DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR, P_VAL_FIREARMS, P_VAL_ARCHERY,
    IRON_SIGHT_FOV, POINT_SHOOTING_PISTOL_BASE_SPEED_MOD, POINT_SHOOTING_PISTOL_SKILL_SPEED_FACTOR,
    LASER_SIGHT_BASE_DISTANCE, LASER_SIGHT_LIGHT_LIMIT, BASE_AIM_SPEED_CONSTANT,
    AIM_SPEED_SKILL_DIVISOR_BASE, AIM_SPEED_SKILL_DIVISOR_SKILL_FACTOR, MAX_RECOIL,
    AIM_PER_MOVE_FINAL_SCALER, MIN_RECOIL_IMPROVEMENT
} from '../utils/cddaConstants';
import { logarithmicRange, clamp } from '../utils/cddaUtils';
import { DispersionSources, OpticalSightModInfo, AimingThresholds } from '../utils/cddaTypes';
import {
    calculateRangedDexMod, calculateCharacterParallax, calculatePointShootingLimit,
    calculateModifierRangedDispersionManip, calculateModifierAimSpeedSkill,
    calculateModifierAimSpeedDex, calculateModifierAimSpeedGeneral
} from './cddaCharacterModifiers';
import {
    calculateItemGunDispersion, calculateAimFactorFromVolume,
    calculateAimFactorFromLength
} from './cddaWeaponStats';

// --- Core Dispersion and Aiming Logic ---

// PRESERVE: Corresponds to static double dispersion_from_skill(double skill, double weapon_dispersion) (ranged.cpp)
// Note: In C++, weapon_dispersion is the P_VAL (e.g., 300/GUN_DISPERSION_DIVIDER).
// The pValPlaceholder is not used, pValToUse is determined internally based on gunSkillIdStr.
export function calculateDispersionFromSkill(
    avgSkill: number,
    pValPlaceholder: number, // This parameter is unused in the Python logic, kept for signature match
    gunSkillIdStr: string = "firearm",
    currentMaxSkill: number = MAX_SKILL
): number {
    /**Calculates dispersion penalty from skill.*/
    const avgSkillFloat = avgSkill;
    const currentMaxSkillFloat = currentMaxSkill;

    // PRESERVE: Determine which P_VAL to use based on skill type
    let pValToUse: number;
    if (gunSkillIdStr === "archery") {
        pValToUse = P_VAL_ARCHERY;
    } else { // Default to firearms
        pValToUse = P_VAL_FIREARMS;
    }
        
    // PRESERVE: if( skill >= MAX_SKILL ) { return 0.0; }
    if (avgSkillFloat >= currentMaxSkillFloat) {
        return 0.0;
    }
    
    // PRESERVE: double skill_shortfall = static_cast<double>( MAX_SKILL ) - skill;
    // PRESERVE: double dispersion_penalty = 10 * skill_shortfall;
    const skillShortfall = currentMaxSkillFloat - avgSkillFloat;
    let dispersionPenalty = DISP_FROM_SKILL_BASE_PENALTY_PER_SHORTFALL * skillShortfall;
    
    const skillThreshFloat = DISP_FROM_SKILL_THRESHOLD;
    // PRESERVE: if( skill >= skill_threshold ) { ... }
    if (avgSkillFloat >= skillThreshFloat) {
        const postThresholdSkillShortfall = skillShortfall; // In this branch, skill_shortfall is used
        // PRESERVE: Logic for skill >= threshold
        // ( weapon_dispersion * post_threshold_skill_shortfall * 1.25 ) / ( MAX_SKILL - skill_threshold )
        const denominatorPostThresh = currentMaxSkillFloat - skillThreshFloat;
        if (denominatorPostThresh === 0) { // Avoid division by zero
            // This case might imply a very high skill threshold or max skill, resulting in no penalty.
            // In C++, division by zero would likely be avoided by ensuring denominator is > 0,
            // or the result would be inf, handled by later clamps. For now, assume 1.0 for safety.
            dispersionPenalty += (pValToUse * postThresholdSkillShortfall * DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR);
        } else {
             const additionalPenalty = (pValToUse * postThresholdSkillShortfall *
                                       DISP_FROM_SKILL_POST_THRESH_WEAP_DISP_FACTOR) / 
                                      denominatorPostThresh;
            dispersionPenalty += additionalPenalty;
        }
    }
    // PRESERVE: else { ... } // Logic for skill < threshold
    else {
        const preThresholdSkillShortfall = skillThreshFloat - avgSkillFloat;
        // PRESERVE: dispersion_penalty += weapon_dispersion * ( 1.25 + pre_threshold_skill_shortfall * 10.0 / skill_threshold );
        // (10.0 / skill_threshold) is DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR (2.0)
        const additionalPenalty = pValToUse * 
                                  (DISP_FROM_SKILL_PRE_THRESH_WEAP_DISP_BASE_FACTOR +
                                   preThresholdSkillShortfall * DISP_FROM_SKILL_PRE_THRESH_CALC_FACTOR);
        dispersionPenalty += additionalPenalty;
    }
    return dispersionPenalty;
}

// PRESERVE: Corresponds to dispersion_sources Character::get_weapon_dispersion(const item &obj) const (character.cpp / ranged.cpp)
export function getWeaponDispersionSources(
    // Character inputs
    dexLevel: number, perLevel: number, visionScoreModifierVal: number,
    handManipScoreVal: number,
    avgSkillForDispCalc: number, gunSkillIdStr: string, // gunSkillIdStr for calculateDispersionFromSkill's P_VAL
    // Weapon inputs
    gunBaseDispJson: number, gunModDispSumJson: number, gunDamageLevel: number,
    ammoBaseDispJson: number,
    // Optional
    multipliersList: number[] | null = null // For enchantments etc.
): DispersionSources {
    /**
     * Calculates the base dispersion sources before aiming recoil.
     * Returns a DispersionSources object.
    */
    // PRESERVE: int weapon_dispersion = obj.gun_dispersion();
    const scaledBaseDisp = calculateItemGunDispersion(
        gunBaseDispJson, gunModDispSumJson, gunDamageLevel, ammoBaseDispJson
    );
    // PRESERVE: dispersion_sources dispersion( weapon_dispersion );
    const dispSourcesObj = new DispersionSources(scaledBaseDisp);

    // PRESERVE: dispersion.add_range( ranged_dex_mod() );
    const dexModPenalty = calculateRangedDexMod(dexLevel);
    dispSourcesObj.addRange(dexModPenalty);

    // PRESERVE: dispersion.add_range( get_modifier( character_modifier_ranged_dispersion_manip_mod ) );
    const manipModPenalty = calculateModifierRangedDispersionManip(handManipScoreVal);
    dispSourcesObj.addRange(manipModPenalty);

    // PRESERVE: Driving penalty logic skipped for this model

    // PRESERVE: dispersion.add_range( dispersion_from_skill( avgSkill, P_VAL_based_on_skill_type ) );
    // P_VAL is now determined inside calculateDispersionFromSkill based on gunSkillIdStr
    const skillPenalty = calculateDispersionFromSkill(avgSkillForDispCalc, 0, gunSkillIdStr);
    dispSourcesObj.addRange(skillPenalty);
    
    // PRESERVE: Enchantment and underwater logic skipped / handled by multipliersList
    if (multipliersList) {
        for (const m of multipliersList) {
            dispSourcesObj.addMultiplier(m);
        }
    }
            
    return dispSourcesObj;
}

// PRESERVE: Corresponds to int Character::effective_dispersion(int dispersion, bool zoom) const (character.cpp)
export function calculateEffectiveDispersion(baseSightDispersionMoa: number, characterParallaxMoa: number): number {
    /**Calculates effective dispersion of a sight including parallax.*/
    // C++ returns int, TypeScript will return float if inputs are float.
    // Parallax is int, baseSightDispersion can be float from JSON.
    return characterParallaxMoa + baseSightDispersionMoa;
}


// PRESERVE: Corresponds to int Character::most_accurate_aiming_method_limit(const item &gun) const (character.cpp)
export function calculateMostAccurateAimingMethodLimit(
    // Character inputs
    perLevel: number, visionScoreModifierVal: number, // For parallax
    gunSkillLevel: number, gunSkillIdStr: string,    // For point shooting limit
    // Weapon inputs
    gunIronSightBaseDispMoa: number,         // e.g. 60 for Glock
    hasIronSights: boolean,
    gunModsSightsInfo: OpticalSightModInfo[]                  // List of dicts: [{"base_disp":X, "is_zoomed":Y, "fov": W}, ...]
): number {
    /**Calculates the minimum recoil (best aim) achievable in MOA.*/
    // PRESERVE: int limit = point_shooting_limit( gun );
    let limit = calculatePointShootingLimit(gunSkillLevel, gunSkillIdStr);

    // PRESERVE: if( !gun.has_flag( flag_DISABLE_SIGHTS ) ) { ... }
    // Assuming has_iron_sights implies not having flag_DISABLE_SIGHTS, or that flag is handled elsewhere
    if (hasIronSights) {
        const parallaxNonZoomed = calculateCharacterParallax(perLevel, visionScoreModifierVal, false);
        const ironSightEffectiveDisp = calculateEffectiveDispersion(gunIronSightBaseDispMoa, parallaxNonZoomed);
        // PRESERVE: if( limit > iron_sight_limit ) { limit = iron_sight_limit; } (lower is better for dispersion)
        if (ironSightEffectiveDisp < limit) { // Corrected logic: if new limit is better (lower)
            limit = ironSightEffectiveDisp;
        }
            
    }
    // PRESERVE: for( const item *e : gun.gunmods() ) { ... }
    for (const sightInfo of gunModsSightsInfo) {
        // PRESERVE: if( mod.field_of_view > 0 && mod.sight_dispersion >= 0 )
        // Using optional chaining and nullish coalescing for safety with potentially missing properties
        if ((sightInfo.fov ?? 0) <= 0 || (sightInfo.base_disp ?? -1) < 0) { // Skip non-sights or invalid ones
            continue;
        }
        const parallaxForMod = calculateCharacterParallax(perLevel, visionScoreModifierVal, sightInfo.is_zoomed);
        const modEffectiveDisp = calculateEffectiveDispersion(sightInfo.base_disp, parallaxForMod);
        // PRESERVE: limit = std::min( limit, effective_dispersion( mod.sight_dispersion, e->has_flag( flag_ZOOM ) ) );
        limit = Math.min(limit, modEffectiveDisp);
    }
        
    return limit;
}


// PRESERVE: Corresponds to static double modified_sight_speed(...) (character.cpp)
export function calculateModifiedSightSpeed(
    intrinsicAimSpeedModOfSight: number,
    effectiveSightDispersionMoa: number, // Already includes parallax
    currentRecoilMoa: number
): number {
    /**Calculates speed contribution of a single sight, attenuated by current recoil.*/
    // PRESERVE: if( recoil <= effective_sight_dispersion ) { return 0; }
    if (currentRecoilMoa <= effectiveSightDispersionMoa) {
        return 0.0;
    }
    // PRESERVE: if( effective_sight_dispersion < 0 ) { return 0; } (Should not happen for valid sights)
    if (effectiveSightDispersionMoa < 0) {
        return 0.0;
    }

    // PRESERVE: double attenuation_factor = 1 - logarithmic_range( effective_sight_dispersion, 3 * effective_sight_dispersion + 1, recoil );
    const effDispFloat = effectiveSightDispersionMoa;
    const logRangeMax = 3.0 * effDispFloat + 1.0; // Ensure float arithmetic for range
    
    const attenuationFactor = 1.0 - logarithmicRange(effDispFloat, logRangeMax, currentRecoilMoa);

    // PRESERVE: return ( 10.0 + aim_speed_modifier ) * attenuation_factor;
    return (BASE_AIM_SPEED_CONSTANT + intrinsicAimSpeedModOfSight) * attenuationFactor;
}


// PRESERVE: Corresponds to double Character::fastest_aiming_method_speed(...) (character.cpp)
export function calculateFastestAimingMethodSpeed(
    // Character inputs
    perLevel: number, visionScoreModifierVal: number, // For parallax
    gunSkillLevel: number, gunSkillIdStr: string,    // For point shooting
    currentPerception: number,                   // Character's current effective perception (per_cur)
    // Weapon inputs
    gunIronSightBaseDispMoa: number,
    hasIronSights: boolean,
    gunModsSightsInfo: OpticalSightModInfo[], // List of dicts: [{"base_disp":X, "is_zoomed":Y, "intrinsic_aim_speed":Z, "fov": W, "is_laser":T/F}, ...]
    // Target attributes (simplified for this model)
    targetRangeTiles: number, targetLightLevel: number, targetIsVisible: boolean, targetAngularSizeMoa: number,
    // Current state
    currentRecoilMoa: number
): number {
    /**Calculates the sight_speed_modifier for aim_per_move.*/
    // PRESERVE: Point shooting speed modifier calculation
    let psIntrinsicSpeed = 0.0;
    const cappedSkillForPs = Math.min(gunSkillLevel, MAX_SKILL);
    if (gunSkillIdStr === "pistol") {
        psIntrinsicSpeed = POINT_SHOOTING_PISTOL_BASE_SPEED_MOD + 
                             POINT_SHOOTING_PISTOL_SKILL_SPEED_FACTOR * cappedSkillForPs;
    } else if (gunSkillIdStr !== "archery") { // Other firearms (not bows/crossbows)
         psIntrinsicSpeed = cappedSkillForPs; // C++: get_skill_level(gun_skill) which is capped by MAX_SKILL contextually
    }
    // Archery point shooting intrinsic speed is skill_level, if we modeled archery specific aim_speed_skill_mod fully

    const psLimitMoa = calculatePointShootingLimit(gunSkillLevel, gunSkillIdStr);
    let currentBestAimSpeedModifier = calculateModifiedSightSpeed(
        psIntrinsicSpeed, psLimitMoa, currentRecoilMoa
    );

    // PRESERVE: Iron sight speed calculation
    if (hasIronSights) {
        const parallaxNonZoomed = calculateCharacterParallax(perLevel, visionScoreModifierVal, false);
        const ironEffDisp = calculateEffectiveDispersion(gunIronSightBaseDispMoa, parallaxNonZoomed);
        // PRESERVE: if( effective_iron_sight_dispersion < recoil && ... && recoil <= iron_sight_FOV )
        if (ironEffDisp < currentRecoilMoa && currentRecoilMoa <= IRON_SIGHT_FOV) {
            const ironSightSpeed = calculateModifiedSightSpeed(0, ironEffDisp, currentRecoilMoa); // 0 intrinsic speed for iron sights
            if (ironSightSpeed > currentBestAimSpeedModifier) {
                currentBestAimSpeedModifier = ironSightSpeed;
            }
        }
    }
            
    // PRESERVE: Gunmod sights speed calculation
    for (const sightInfo of gunModsSightsInfo) {
        // PRESERVE: if( mod.sight_dispersion < 0 || mod.field_of_view <= 0 ) { continue; }
        if ((sightInfo.fov ?? 0) <= 0 || (sightInfo.base_disp ?? -1) < 0) {
            continue;
        }

        // PRESERVE: Laser sight availability check
        if (sightInfo.is_laser) {
            // PRESERVE: bool laser_light_available = target_attributes.range <= ( base_distance + per_cur ) * std::max( 1.0f - target_attributes.light / light_limit, 0.0f ) && target_attributes.visible;
            const laserEffectiveRangeFactor = LASER_SIGHT_LIGHT_LIMIT > 0 ? 
                Math.max(1.0 - targetLightLevel / LASER_SIGHT_LIGHT_LIMIT, 0.0) :
                (targetLightLevel === 0 ? 1.0 : 0.0);
            const laserMaxDist = (LASER_SIGHT_BASE_DISTANCE + currentPerception) * laserEffectiveRangeFactor;
            if (!(targetRangeTiles <= laserMaxDist && targetIsVisible)) {
                continue; // Laser not usable in this situation
            }
        }

        const parallaxForMod = calculateCharacterParallax(perLevel, visionScoreModifierVal, sightInfo.is_zoomed);
        const modEffDisp = calculateEffectiveDispersion(sightInfo.base_disp, parallaxForMod);
        
        let modIntrinsicSpeedVal = sightInfo.intrinsic_aim_speed ?? 0.0;
        // PRESERVE: Penalty for parallax on small/distant targets for gunmod intrinsic speed
        // double effective_aim_speed_modifier = 4 * parallax > target_attributes.size_in_moa ? std::min( 0.0, mod.aim_speed_modifier ) : mod.aim_speed_modifier;
        if (targetAngularSizeMoa > 0 && (4 * parallaxForMod) > targetAngularSizeMoa) {
             modIntrinsicSpeedVal = Math.min(0.0, modIntrinsicSpeedVal); // Can make intrinsic bonus zero or negative
        }

        // PRESERVE: if( e_effective_dispersion < recoil && recoil <= mod.field_of_view )
        if (modEffDisp < currentRecoilMoa && currentRecoilMoa <= sightInfo.fov) {
            const modSpeed = calculateModifiedSightSpeed(modIntrinsicSpeedVal, modEffDisp, currentRecoilMoa);
            if (modSpeed > currentBestAimSpeedModifier) {
                currentBestAimSpeedModifier = modSpeed;
            }
        }
            
    }
    return currentBestAimSpeedModifier;
}


// PRESERVE: Corresponds to double Character::aim_per_move(...) (character.cpp)
export function calculateAimPerMove(
    // Character inputs
    dexLevel: number, perLevel: number, visionScoreModifierVal: number,
    gunSkillLevel: number, gunSkillIdStr: string,
    currentPerception: number, // For laser sights, effective perception
    gripScoreVal: number, manipScoreVal: number, liftScoreVal: number, // For aim_speed_mod
    // Weapon inputs
    gunVolumeMl: number, gunLengthMm: number,
    gunIronSightBaseDispMoa: number, hasIronSights: boolean,
    gunModsSightsInfo: OpticalSightModInfo[], // For fastest_aiming_method_speed & most_accurate_aiming_method_limit
    hasCollapsibleStock: boolean, collapsedVolumeDeltaMl: number,
    // Target attributes (simplified)
    targetRangeTiles: number, targetLightLevel: number, targetIsVisible: boolean, targetAngularSizeMoa: number,
    // Current state
    currentRecoilMoa: number,
    isConfinedSpace: boolean // Boolean, simplified from map obstacle check
): number {
    /**Calculates recoil reduction for one game move of aiming.*/
    // PRESERVE: double sight_speed_modifier = fastest_aiming_method_speed(...);
    const sightSpeedModVal = calculateFastestAimingMethodSpeed(
        perLevel, visionScoreModifierVal, gunSkillLevel, gunSkillIdStr, currentPerception,
        gunIronSightBaseDispMoa, hasIronSights, gunModsSightsInfo,
        targetRangeTiles, targetLightLevel, targetIsVisible, targetAngularSizeMoa,
        currentRecoilMoa
    );

    // PRESERVE: int limit = most_accurate_aiming_method_limit(gun);
    const aimingLimitMoa = calculateMostAccurateAimingMethodLimit(
        perLevel, visionScoreModifierVal, gunSkillLevel, gunSkillIdStr,
        gunIronSightBaseDispMoa, hasIronSights, gunModsSightsInfo
    );

    // PRESERVE: if( sight_speed_modifier == INT_MIN ) { return 0; }
    // Our TypeScript version of calculateFastestAimingMethodSpeed returns 0 if no improvement possible.
    // The final check `recoil - limit` will also handle if already at limit.

    // PRESERVE: double aim_speed = 10.0;
    let aimSpeed = BASE_AIM_SPEED_CONSTANT;
    // PRESERVE: aim_speed += sight_speed_modifier;
    aimSpeed += sightSpeedModVal;

    // PRESERVE: Character Stat/Skill Modifiers from get_modifier calls
    const aimSpeedSkillModVal = calculateModifierAimSpeedSkill(gunSkillLevel, gunSkillIdStr);
    aimSpeed += aimSpeedSkillModVal;
    
    const aimSpeedDexModVal = calculateModifierAimSpeedDex(dexLevel);
    aimSpeed += aimSpeedDexModVal;
    
    const aimSpeedGeneralModVal = calculateModifierAimSpeedGeneral(gripScoreVal, manipScoreVal, liftScoreVal);
    aimSpeed *= aimSpeedGeneralModVal;

    // PRESERVE: aim_speed /= std::max( 1.0, 2.5 - 0.2 * get_skill_level( gun_skill ) );
    const cappedSkillForDivisor = Math.min(gunSkillLevel, MAX_SKILL);
    const skillDivisor = Math.max(1.0, AIM_SPEED_SKILL_DIVISOR_BASE -
                        AIM_SPEED_SKILL_DIVISOR_SKILL_FACTOR * cappedSkillForDivisor);
    if (skillDivisor !== 0) { // Should always be true due to Math.max(1.0, ...)
        aimSpeed /= skillDivisor;
    } else { // Should not be reached
        aimSpeed = 0; 
    }

    // PRESERVE: Recoil Scaling Factor (U-Shaped Curve)
    // aim_speed *= std::max( recoil / MAX_RECOIL, 1 - logarithmic_range( 0, MAX_RECOIL, recoil ) );
    const currentRecoilFloat = currentRecoilMoa;
    const term1RecoilScaling = MAX_RECOIL > 0 ? currentRecoilFloat / MAX_RECOIL : 0.0;
    const term2RecoilScaling = 1.0 - logarithmicRange(0.0, MAX_RECOIL, currentRecoilFloat);
    const recoilScaleFactor = Math.max(term1RecoilScaling, term2RecoilScaling);
    aimSpeed *= recoilScaleFactor;

    // PRESERVE: Aim Speed Cap (Skill and Weapon Geometry)
    // base_aim_speed_cap = 5.0 +  1.0 * get_skill_level( gun_skill ) + std::max( 10.0, 3.0 * get_skill_level( gun_skill ) );
    const cappedSkillForCap = Math.min(gunSkillLevel, MAX_SKILL);
    const baseAimSpeedCapVal = (5.0 + 1.0 * cappedSkillForCap +
                             Math.max(10.0, 3.0 * cappedSkillForCap));

    const aimFactorVolVal = calculateAimFactorFromVolume(
        gunVolumeMl, gunSkillIdStr, hasCollapsibleStock, collapsedVolumeDeltaMl
    );
    aimSpeed = Math.min(aimSpeed, baseAimSpeedCapVal * aimFactorVolVal);

    const aimFactorLenVal = calculateAimFactorFromLength(gunLengthMm, isConfinedSpace);
    aimSpeed = Math.min(aimSpeed, baseAimSpeedCapVal * aimFactorLenVal);

    // PRESERVE: aim_speed *= 2.4; (Final Scaler)
    aimSpeed *= AIM_PER_MOVE_FINAL_SCALER;

    // PRESERVE: aim_speed = std::max( aim_speed, MIN_RECOIL_IMPROVEMENT );
    aimSpeed = Math.max(aimSpeed, MIN_RECOIL_IMPROVEMENT);
    
    // PRESERVE: return std::min( aim_speed, recoil - limit );
    // Ensure we don't reduce recoil below the limit, and reduction is non-negative.
    if (currentRecoilMoa <= aimingLimitMoa) {
        return 0.0; // Already at or better than limit
    }
    
    const recoilReduction = Math.min(aimSpeed, currentRecoilMoa - aimingLimitMoa);
    
    return Math.max(0.0, recoilReduction); // Should not be negative if logic above is sound
}

// PRESERVE: Corresponds to dispersion_sources Character::total_gun_dispersion(...) (character.cpp)
export function calculateTotalGunDispersionSources(
    // Character inputs for base dispersion
    dexLevel: number, perLevel: number, visionScoreModifierVal: number,
    handManipScoreVal: number,
    avgSkillForDispCalc: number, gunSkillIdStr: string, // gunSkillIdStr for getWeaponDispersionSources
    // Weapon inputs for base dispersion
    gunBaseDispJson: number, gunModDispSumJson: number, gunDamageLevel: number,
    // Ammo inputs
    ammoBaseDispJson: number, ammoShotSpreadVal: number, // ammoShotSpreadVal from proj.shot_spread
    // Current state
    currentAimingRecoilMoa: number,
    // Optional
    baseDispMultipliersList: number[] | null = null
): DispersionSources {
    /**
     * Calculates the final DispersionSources object for a shot, including aiming recoil.
    */
    // PRESERVE: dispersion_sources dispersion = get_weapon_dispersion( gun );
    const dispObj = getWeaponDispersionSources(
        dexLevel, perLevel, visionScoreModifierVal, handManipScoreVal,
        avgSkillForDispCalc, gunSkillIdStr,
        gunBaseDispJson, gunModDispSumJson, gunDamageLevel,
        ammoBaseDispJson,
        baseDispMultipliersList
    );

    // PRESERVE: dispersion.add_range( recoil );
    dispObj.addRange(currentAimingRecoilMoa);

    // PRESERVE: dispersion.add_spread( spread );
    dispObj.addSpread(ammoShotSpreadVal);

    return dispObj;
}

// PRESERVE: Corresponds to logic in Character::get_aim_types (character.cpp)
export function calculateDynamicAimThresholds(preciseAimLimitMoa: number): AimingThresholds {
    /**Calculates Regular and Careful aim MOA thresholds based on the precise limit.*/
    const thresholds: AimingThresholds = { 'Precise Aim': 0 }; // Initialize with precise aim
    // Ensure preciseAimLimitMoa is float for calcs, and non-negative
    const preciseLimitFloat = Math.max(0.0, preciseAimLimitMoa);
    
    thresholds['Precise Aim'] = preciseLimitFloat;

    // PRESERVE: static_cast<int>( ( ( MAX_RECOIL - sight_dispersion ) / 40.0 ) + sight_dispersion )
    // Careful Aim: sight_dispersion + 2.5% of (MAX_RECOIL - sight_dispersion)
    const carefulMoaFloat = (MAX_RECOIL - preciseLimitFloat) * 0.025 + preciseLimitFloat;
    const carefulMoa = Math.floor(carefulMoaFloat); // CDDA uses static_cast<int> which truncates/floors for positive
    
    // Only add if it's a meaningful step worse than precise and better than MAX_RECOIL
    if (carefulMoa > preciseLimitFloat && carefulMoa < MAX_RECOIL) {
        thresholds['Careful Aim'] = carefulMoa;
    }
    
    // PRESERVE: static_cast<int>( ( ( MAX_RECOIL - sight_dispersion ) / 10.0 ) + sight_dispersion )
    // Regular Aim: sight_dispersion + 10% of (MAX_RECOIL - sight_dispersion)
    const regularMoaFloat = (MAX_RECOIL - preciseLimitFloat) * 0.10 + preciseLimitFloat;
    const regularMoa = Math.floor(regularMoaFloat);
    
    // Must be worse (higher MOA) than careful (or precise if careful isn't distinct/valid)
    // And better than MAX_RECOIL
    const currentWorseThanRegularThreshold = thresholds['Careful Aim'] ?? preciseLimitFloat;
    if (regularMoa > currentWorseThanRegularThreshold && regularMoa < MAX_RECOIL) {
        thresholds['Regular Aim'] = regularMoa;
    }
        
    return thresholds;
}