// src/features/comparison/core/types.ts

// CORRECTED: No longer imports FiringMode from the global types
import type { Item, GunSlot, AmmoSlot } from "../../../types";
import type { GunCategory } from "../utils/classify"; // Import the structured category

// =============================================================================
// SECTION: Core Data Structures for our Feature
// =============================================================================

export interface CombatProfile {
  strength: number;
  dexterity: number;
  perception: number;
  weaponSkillLevel: number;
  marksmanshipLevel: number;
  gripScore: number;
  handManipScore: number;
}

export interface FiringMode {
  id: string;
  name: string;
  shots: number;
}

// CORRECTED: HitProbabilities is now defined here as the canonical source
export type HitProbabilities = { [key in "Critical" | "Good" | "Normal" | "Graze" | "Miss"]: number };

export class DispersionSources {
  private normal_sources: number[] = [];
  private linear_sources: number[] = [];
  private multipliers: number[] = [1.0];
  private spread_val: number = 0.0;

  constructor(initial_normal_source: number = 0.0) {
    if (initial_normal_source !== 0.0) {
      this.normal_sources.push(initial_normal_source);
    }
  }

  add_range(new_source: number): void {
    if (new_source !== 0.0) {
      this.linear_sources.push(new_source);
    }
  }

  add_spread(new_spread: number): void {
    this.spread_val = new_spread;
  }

  max(): number {
    const linearSum = this.linear_sources.reduce((sum, val) => sum + val, 0);
    const normalSum = this.normal_sources.reduce((sum, val) => sum + val, 0);
    const totalSum = (linearSum + normalSum) * this.multipliers.reduce((prod, val) => prod * val, 1);
    return totalSum + this.spread_val;
  }

  roll(): number {
    const linearRoll = this.linear_sources.reduce((sum, val) => sum + Math.random() * val, 0);
    
    const normalRoll = this.normal_sources.reduce((sum, val) => {
        const mean = val / 2;
        const stddev = val / 4;
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const result = z0 * stddev + mean;
        return sum + Math.max(0, Math.min(result, val));
    }, 0);

    const totalRoll = (linearRoll + normalRoll) * this.multipliers.reduce((prod, val) => prod * val, 1);
    return totalRoll;
  }
}

export interface PotentialDamageInfo {
  damage: number;
  ammoName: string;
  ammoRecoil: number;
  inherentDispersionMoa: number;
  ammoItem: Item & AmmoSlot;
  pelletCount: number;
  ammoCritMultiplier: number;
}

export interface RepresentativeCombatInfo {
  id: string;
  name: string;
  category: GunCategory; // Use the structured type
  skillUsed: string;
  isNonStandard: boolean;
  standardAmmo: string;
  reloadMethod: string;
  compatibleMagazines: string;
  defaultReceiver: string;
  damagePerShot: number;
  meanTimeToKillStandardZombie: number;
  sustainedDps: number;
  magDumpDps: number;
  reloadTime: number;
  hitChancesAt10Tiles: string;
  _internal?: {
    dphInfo: PotentialDamageInfo | null;
    hitProbabilitiesAt10Tiles: HitProbabilities | null;
  };
}