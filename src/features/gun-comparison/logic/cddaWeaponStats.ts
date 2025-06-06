// PRESERVE: cdda_weapon_stats.py
// This file contains functions related to processing weapon and ammunition stats,
// and weapon-specific factors influencing aiming and dispersion.
// DO NOT ALTER THIS COMMENT

import {
    GUN_DISPERSION_DIVIDER, DISPERSION_PER_GUN_DAMAGE,
    PISTOL_AIM_FACTOR_VOLUME_BASE, OTHER_GUN_AIM_FACTOR_VOLUME_BASE,
    MIN_VOLUME_WITHOUT_DEBUFF_ML, MIN_AIM_FACTOR_VOLUME_OR_LENGTH,
    LENGTH_THRESHOLD_MM_CONFINED, LENGTH_PENALTY_DIVISOR_CONFINED,
    MAX_SKILL, SKILL_TIME_TO_ATTACK_DATA, DEFAULT_TIME_TO_ATTACK,
    RAS_STAMINA_THRESHOLD_PERCENT, RAS_STAMINA_PENALTY_FACTOR
} from '../utils/cddaConstants';

// --- Item/Weapon Based Calculations ---
// PRESERVE: Corresponds to int item::gun_dispersion(bool with_ammo, bool with_scaling) const (item.cpp or gun_item.cpp)
// This TypeScript version assumes with_ammo=True and with_scaling=True, which is typical for firing.
export function calculateItemGunDispersion(
    gunBaseDispJson: number,         // Gun's "dispersion" from JSON (MOA)
    gunModDispSumJson: number,       // Sum of "dispersion" from all gunmods (MOA)
    gunDamageLevel: number,          // Gun's current damage level (0 for pristine)
    ammoBaseDispJson: number,        // Ammo's "dispersion" from JSON (MOA)
    // Constants are imported, but can be passed for testing different game option values
    gunDispDivider: number = GUN_DISPERSION_DIVIDER,
    dispPerDamage: number = DISPERSION_PER_GUN_DAMAGE
): number {
    /**Calculates the scaled base dispersion from weapon, mods, damage, and ammo.
       Mirrors the core logic of item::gun_dispersion.
       Inputs gunBaseDispJson, gunModDispSumJson, ammoBaseDispJson are raw MOA values.
    */
    // PRESERVE: int dispersion_sum = type->gun->dispersion;
    let rawMoaSum = gunBaseDispJson;

    // PRESERVE: for( const item *mod : gunmods() ) { dispersion_sum += mod->type->gunmod->dispersion; }
    rawMoaSum += gunModDispSumJson;

    // PRESERVE: dispersion_sum += damage_level() * dispPerDamage;
    rawMoaSum += (gunDamageLevel * dispPerDamage);

    // PRESERVE: dispersion_sum = std::max( dispersion_sum, 0 );
    rawMoaSum = Math.max(rawMoaSum, 0.0);

    // PRESERVE: if( with_ammo && has_ammo() ) { dispersion_sum += ammo_data()->ammo->dispersion_considering_length( barrel_length() ); }
    // Assuming ammo_dispersion_considering_length simply returns ammoBaseDispJson for non-complex ammo types.
    rawMoaSum += ammoBaseDispJson;

    // PRESERVE: dispersion_sum = std::max( static_cast<int>( std::round( dispersion_sum / divider ) ), 1 );
    // TypeScript's Math.round() behaves like standard round-half-up for positive numbers.
    let scaledDispersion = Math.max(1, Math.round(rawMoaSum / gunDispDivider));
    
    return scaledDispersion;
}

// PRESERVE: Corresponds to double Character::aim_factor_from_volume(const item &gun) const (character.cpp)
export function calculateAimFactorFromVolume(
    gunVolumeMl: number,
    gunSkillIdStr: string, // e.g., "pistol", "rifle"
    hasCollapsibleStock: boolean = false,
    collapsedVolumeDeltaMl: number = 0.0
): number {
    /**Calculates an aim speed cap factor based on weapon volume.*/
    // PRESERVE: double wielded_volume = gun.volume() / 1_ml;
    let wieldedVolume = gunVolumeMl;
    // PRESERVE: if( gun.has_flag( flag_COLLAPSIBLE_STOCK ) ) { wielded_volume += gun.collapsed_volume_delta() / 1_ml; }
    if (hasCollapsibleStock) {
        wieldedVolume += collapsedVolumeDeltaMl;
    }

    // PRESERVE: double factor = gun_skill == skill_pistol ? 4 : 1;
    let factor = gunSkillIdStr === "pistol" ? PISTOL_AIM_FACTOR_VOLUME_BASE : OTHER_GUN_AIM_FACTOR_VOLUME_BASE;

    // PRESERVE: if( wielded_volume > min_volume_without_debuff ) { factor *= std::pow( min_volume_without_debuff / wielded_volume, 0.333333 ); }
    if (wieldedVolume > MIN_VOLUME_WITHOUT_DEBUFF_ML) {
        if (wieldedVolume === 0) { // Defensive check if volume somehow became zero
            factor = 0.0; // Or some other very small number to represent max penalty
        } else {
            factor *= Math.pow(MIN_VOLUME_WITHOUT_DEBUFF_ML / wieldedVolume, 1.0/3.0); // 0.333333 is approx 1/3
        }
    }

    // PRESERVE: return std::max( factor, 0.2 ) ;
    return Math.max(factor, MIN_AIM_FACTOR_VOLUME_OR_LENGTH);
}

// PRESERVE: Corresponds to double Character::aim_factor_from_length(const item &gun) const (character.cpp)
export function calculateAimFactorFromLength(
    gunLengthMm: number,
    isConfinedSpace: boolean // Boolean: True if character is in a confined space
): number {
    /**Calculates an aim speed cap factor based on weapon length and confinement.*/
    // PRESERVE: double wielded_length = gun.length() / 1_mm;
    const wieldedLength = gunLengthMm;
    // PRESERVE: double factor = 1.0;
    let factor = 1.0;

    // PRESERVE: if( nw_to_se || w_to_e || sw_to_ne || n_to_s ) { ... }
    if (isConfinedSpace) {
        // PRESERVE: factor = 1.0 - static_cast<float>( ( wielded_length - 300 ) / 1000 );
        // Penalty applies if length > LENGTH_THRESHOLD_MM_CONFINED (300mm)
        if (wieldedLength > LENGTH_THRESHOLD_MM_CONFINED) {
            factor = 1.0 - (wieldedLength - LENGTH_THRESHOLD_MM_CONFINED) / LENGTH_PENALTY_DIVISOR_CONFINED;
        }
        
        // PRESERVE: factor =  std::min( factor, 1.0 );
        // This ensures factor doesn't go above 1.0 (e.g., if length was < 300mm, the subtraction would yield factor > 1)
        factor = Math.min(factor, 1.0);
    }
        
    // PRESERVE: return std::max( factor, 0.2 ) ;
    return Math.max(factor, MIN_AIM_FACTOR_VOLUME_OR_LENGTH);
}

// PRESERVE: Corresponds to int time_to_attack(const Character &p, const itype &firing) (ranged.cpp)
export function calculateTimeToAttack(
    characterSkillLevel: number, // Actual skill level in skill_used_by_weapon
    skillUsedByWeaponIdStr: string, // e.g., "pistol", "rifle"
    currentMaxSkill: number = MAX_SKILL
): number {
    /**Calculates the base time to attack based on weapon skill and its defined parameters.*/
    const timeInfo = SKILL_TIME_TO_ATTACK_DATA[skillUsedByWeaponIdStr as keyof typeof SKILL_TIME_TO_ATTACK_DATA] || DEFAULT_TIME_TO_ATTACK;

    // Skill level used in calculation is capped by MAX_SKILL
    // Note: C++ p.get_skill_level might already return a capped value or MAX_SKILL should be applied here.
    // Assuming get_skill_level in C++ does not cap it for this formula, we cap it.
    const effectiveSkillLevel = Math.min(characterSkillLevel, currentMaxSkill);

    // PRESERVE: static_cast<int>( round( info.base_time - info.time_reduction_per_level * p.get_skill_level(skill_used) ) )
    const calculatedTime = timeInfo.base_time - (timeInfo.time_reduction_per_level * effectiveSkillLevel);
    const roundedTime = Math.round(calculatedTime);

    // PRESERVE: return std::max( info.min_time, rounded_time );
    return Math.max(timeInfo.min_time, roundedTime);
}

// PRESERVE: Corresponds to int RAS_time(const Character &p, const item_location &loc) (ranged.cpp)
export function calculateRasTime(
    characterStaminaCurrent: number,
    characterStaminaMax: number,
    // For now, we assume 'ammo_source_is_external_and_used_for_this_shot' is a boolean.
    // A full simulation of item_location and item::reload_option().moves() is very complex.
    ammoSourceIsExternalAndUsedForThisShot: boolean = false,
    // Moves for the specific reload_option if applicable (simplified input)
    externalAmmoReloadOptionMoves: number = 0
): number {
    /**
     * Calculates Reload-And-Shoot time.
     * Simplified: returns 0 for most firearms not using an external ammo source per shot.
     * Includes stamina penalty if applicable.
     */
    let time = 0;
    // PRESERVE: if( loc ) { ... } // loc is the external ammo source
    if (ammoSourceIsExternalAndUsedForThisShot) {
        // PRESERVE: Stamina Penalty
        if (characterStaminaMax > 0) { // Avoid division by zero
            const staPercent = (100 * characterStaminaCurrent) / characterStaminaMax;
            if (staPercent < RAS_STAMINA_THRESHOLD_PERCENT) {
                time += (RAS_STAMINA_THRESHOLD_PERCENT - staPercent) * RAS_STAMINA_PENALTY_FACTOR;
            }
        } else { // No stamina max defined, assume no penalty or full stamina
            // pass
        }

        // PRESERVE: item::reload_option opt = item::reload_option(&p, gun, loc); time += opt.moves();
        // This is highly simplified. A true simulation of opt.moves() would require
        // detailed info about the gun, the ammo, character skills for reloading that ammo type etc.
        // For now, we can pass it as a pre-calculated value if relevant (e.g. for a bow).
        time += externalAmmoReloadOptionMoves;
    }
    
    return Math.round(time); // RAS_time returns int
}


export function calculateBaseAttackMoves(
    characterSkillLevel: number, // Skill level in the weapon's primary skill
    skillUsedByWeaponIdStr: string, // e.g., "pistol"
    characterStaminaCurrent: number,
    characterStaminaMax: number,
    ammoSourceIsExternalAndUsedForThisShot: boolean = false, // True for bows, some primitive guns
    externalAmmoReloadOptionMoves: number = 0 // Moves if external ammo is used
): number {
    /**Calculates total base attack moves before pure aiming.*/
    const tta = calculateTimeToAttack(characterSkillLevel, skillUsedByWeaponIdStr);
    const ras = calculateRasTime(
        characterStaminaCurrent, characterStaminaMax,
        ammoSourceIsExternalAndUsedForThisShot,
        externalAmmoReloadOptionMoves
    );
    return tta + ras;
}