// PRESERVE: cdda_types.py
// This file contains TypeScript interfaces and classes that represent data structures or types from CDDA
// as derived from the Python simulation model, and custom types for our calculations.
// DO NOT ALTER THIS COMMENT

import { clamp, rngFloat, _normalRollCore } from './cddaUtils';
import { DISPERSION_ROLL_MAX_CAP } from './cddaConstants';

// PRESERVE: Corresponds to class dispersion_sources (dispersion.h / dispersion.cpp)
export class DispersionSources {
    // PRESERVE: std::vector<double> normal_sources; (dispersion.h)
    public normalSources: number[];
    // PRESERVE: std::vector<double> linear_sources; (dispersion.h)
    public linearSources: number[];
    // PRESERVE: std::vector<double> multipliers; (dispersion.h)
    public multipliers: number[];
    // PRESERVE: double spread_sources = 0.0; (dispersion.h)
    // Renamed to spreadVal to avoid confusion with the list names in Python
    public spreadVal: number;

    constructor(initialNormalSource: number = 0.0) {
        this.normalSources = [];
        this.linearSources = [];
        this.multipliers = [];
        this.spreadVal = 0.0;

        // PRESERVE: Logic from constructor dispersion_sources(double normal_source) (dispersion.cpp)
        if (initialNormalSource !== 0.0) {
            this.normalSources.push(initialNormalSource);
        }
    }

    // PRESERVE: Corresponds to void dispersion_sources::add_range(double new_source) (dispersion.cpp)
    public addRange(newSource: number): void {
        // Optimization: CDDA might add 0.0s, but for list processing, we can skip them
        if (newSource !== 0.0) {
            this.linearSources.push(newSource);
        }
    }

    // PRESERVE: Added for completeness if needed later (not directly in get_weapon_dispersion for initial normal_sources)
    public addNormalSource(newSource: number): void {
        if (newSource !== 0.0) {
            this.normalSources.push(newSource);
        }
    }

    // PRESERVE: Corresponds to void dispersion_sources::add_multiplier(double new_multiplier) (dispersion.cpp)
    public addMultiplier(newMultiplier: number): void {
        this.multipliers.push(newMultiplier);
    }

    // PRESERVE: Corresponds to void dispersion_sources::add_spread(double new_spread) (dispersion.cpp)
    public addSpread(newSpread: number): void {
        this.spreadVal = newSpread;
    }

    // PRESERVE: Helper for roll(), corresponds to inline double rng_normal(double hi)
    //           which calls rng_normal(0.0, hi) (rng.cpp / rng.h)
    private _rngNormalSingleParamInternal(hiParam: number): number {
        /**Internal equivalent of the single-argument rng_normal(hi_param) used in roll.*/
        const lo = 0.0;
        let hi = hiParam;

        if (lo > hi) {
            [lo, hi] = [hi, lo]; // Should not happen if hiParam is non-negative dispersion
        }

        // PRESERVE: const double range = ( hi - lo ) / 4; (from two-arg rng_normal)
        const rangeStddevParam = (hi - lo) / 4.0;
        if (rangeStddevParam === 0.0) { // Catches hi === lo, including hi === 0
            return hi;
        }

        // PRESERVE: double val = normal_roll( ( hi + lo ) / 2, range ); (from two-arg rng_normal)
        const mean = (hi + lo) / 2.0;
        const val = _normalRollCore(mean, rangeStddevParam); // _normalRollCore uses std::normal_distribution

        // PRESERVE: return clamp( val, lo, hi ); (from two-arg rng_normal)
        return clamp(val, lo, hi);
    }

    // PRESERVE: Corresponds to double dispersion_sources::roll() const (dispersion.cpp)
    public roll(): number {
        /**Calculates the actual angular deviation for a shot.*/
        let thisRoll = 0.0;

        // PRESERVE: for( const double &source : linear_sources ) { this_roll += rng_float( 0.0, source ); }
        for (const source of this.linearSources) {
            thisRoll += rngFloat(0.0, source);
        }

        // PRESERVE: for( const double &source : normal_sources ) { this_roll += rng_normal(source); }
        // Here, rng_normal(source) resolves to rng_normal(0.0, source) as per inline overload
        for (const source of this.normalSources) {
            thisRoll += this._rngNormalSingleParamInternal(source);
        }

        // PRESERVE: for( const double &source : multipliers ) { this_roll *= source; }
        for (const multiplierVal of this.multipliers) {
            thisRoll *= multiplierVal;
        }

        // PRESERVE: return std::min( this_roll, 3600.0 );
        return Math.min(thisRoll, DISPERSION_ROLL_MAX_CAP);
    }

    public max(): number {
        /**Calculates the maximum possible dispersion by summing all sources directly.*/
        let sumVal = 0.0;
        for (const source of this.linearSources) {
            sumVal += source;
        }
        for (const source of this.normalSources) {
            sumVal += source;
        }
        for (const multiplierVal of this.multipliers) {
            sumVal *= multiplierVal;
        }
        sumVal += this.spreadVal; // Add shotgun spread (if any)
        return sumVal;
    }

    // No direct translation for __str__ / toString() is needed unless for explicit logging in TS.
    // public toString(): string {
    //     return `DispersionSources(Normal: [${this.normalSources.join(', ')}], Linear: [${this.linearSources.join(', ')}], Multipliers: [${this.multipliers.join(', ')}], Spread: ${this.spreadVal})`;
    // }
}

// Interfaces for input/output data structures in our calculation modules,
// derived from the Python simulation's input profiles.

export interface OpticalSightModInfo {
    base_disp: number;
    is_zoomed: boolean;
    intrinsic_aim_speed: number;
    fov: number;
    is_laser: boolean;
}

export interface CharacterProfile {
    dex_level: number;
    per_level: number;
    current_perception: number;
    gun_skill_level: number;
    skill_marksmanship_level: number; // Used for avg_skill_for_disp_calc
    vision_score_val: number;
    grip_score_val: number;
    manip_score_val: number;
    lift_score_val: number;
    hand_manip_score_val: number;
    is_confined_space: boolean;
    stamina_current: number;
    stamina_max: number;
}

export interface GunProfile {
    name: string;
    gun_skill_id_str: string; // e.g., "pistol", "rifle"
    gun_volume_ml: number;
    gun_length_mm: number;
    has_collapsible_stock: boolean;
    collapsed_volume_delta_ml: number;
    has_iron_sights: boolean;
    gun_iron_sight_base_disp_moa: number;
    gun_mods_sights_info: OpticalSightModInfo[];
    ammo_source_is_external_and_used_for_this_shot: boolean; // True for bows, some primitive guns
    external_ammo_reload_option_moves: number; // Moves if external ammo is used
    // Additional properties for base dispersion and hit chance calculations (from simulate_aiming_process.py)
    gun_base_disp_json: number; // Gun's "dispersion" from JSON (MOA)
    gun_mod_disp_sum_json: number; // Sum of "dispersion" from all gunmods (MOA)
    gun_damage_level: number; // Gun's current damage level (0 for pristine)
    ammo_base_disp_json: number; // Ammo's "dispersion" from JSON (MOA)
    ammo_shot_spread_val: number; // ammo_shot_spread_val from proj.shot_spread (0 for most bullets)
}

export interface ScenarioInputs {
    initial_character_recoil_moa: number; // Character's current Aim Dispersion (MOA) at the START of this aiming attempt.
    target_range_tiles: number;
    creature_size_str: string; // "tiny", "small", "medium", "large", "huge"
    target_light_level: number; // 0-120+, affects laser
    target_is_visible: boolean; // For laser
    max_aiming_moves_to_simulate: number;
    target_angular_size_moa: number; // Calculated field
}

// PRESERVE: Output of calculate_dynamic_aim_thresholds
export interface AimingThresholds {
    'Precise Aim': number;
    'Careful Aim'?: number; // Optional as it might not be meaningfully different
    'Regular Aim'?: number; // Optional as it might not be meaningfully different
}

// PRESERVE: For moves_at_threshold in the simulation loop
export interface AimingProgressRecord {
    'Current Aim (Start)': { moves: number; recoil: number };
    'Precise Aim'?: { moves: number; recoil: number };
    'Careful Aim'?: { moves: number; recoil: number };
    'Regular Aim'?: { moves: number; recoil: number };
}

// PRESERVE: Output of simulate_hit_probability_and_ui_chances
export interface HitPercentages {
    Critical: number;
    Good: number;
    Normal: number;
    Graze: number;
    Miss: number;
}

// PRESERVE: Output of simulate_hit_probability_and_ui_chances for UI Confidence
export interface UIConfidencePercentages {
    Great: number;
    Normal: number;
    Graze: number;
    Miss: number;
}

// Interface for the comprehensive combat simulation results (from gunDPSCalculator.ts)
export interface CombatResults {
    aimThresholds: AimingThresholds;
    baseAttackMoves: number;
    aimingProgress: AimingProgressRecord; // Summary of moves to reach each threshold
    finalRecoil: number; // Recoil at the end of max_aiming_moves_to_simulate
    finalMovesSpentPureAiming: number; // Pure aiming moves spent to reach finalRecoil
    // Hit probabilities for various aiming levels (can be calculated based on AimingProgressRecord)
    hitProbabilities: {
        'Current Aim (Start)'?: { actual: HitPercentages, ui: UIConfidencePercentages };
        'Precise Aim'?: { actual: HitPercentages, ui: UIConfidencePercentages };
        'Careful Aim'?: { actual: HitPercentages, ui: UIConfidencePercentages };
        'Regular Aim'?: { actual: HitPercentages, ui: UIConfidencePercentages };
    };
    // Additional DPS metrics will go here eventually
    // referenceSustainedDps: number;
    // dpsMagDumpNoReload: number;
    // dpsPreciseAimPerShotNoReload: number;
}