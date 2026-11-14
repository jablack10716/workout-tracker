import {
  MuscleGroup,
  MUSCLE_GROUPS,
  normalizeMuscleGroup,
  resolveExerciseEquipment,
} from './analyticsEngine';

export type SupersetSynergyType =
  | 'competing'
  | 'synergist_overlap'
  | 'antagonist'
  | 'upper_lower'
  | 'non_competing';

export interface SupersetSynergyResult {
  type: SupersetSynergyType;
  label: string;
  description: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}

export interface MuscleFractionEntry {
  muscle_group: string;
  fraction: number;
}

export interface SynergyExerciseInput {
  name?: string;
  muscle_groups?: MuscleFractionEntry[];
  exercise_muscle_groups?: MuscleFractionEntry[];
}

export interface SplitDayGuardrailExerciseInput extends SynergyExerciseInput {
  planned_sets?: number | string;
  target_reps?: number | string;
  target_rep_max?: number | string | null;
}

export interface SplitDayGuardrailsResult {
  heavyLiftWarning: string | null;
  fatigueWarnings: Array<{ muscleGroup: MuscleGroup; sets: number }>;
}

const VALID_MUSCLE_GROUP_SET: ReadonlySet<string> = new Set<MuscleGroup>(MUSCLE_GROUPS);
const UPPER_BODY_MUSCLES: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>([
  'Chest',
  'Lats',
  'Upper Back',
  'Shoulders',
  'Biceps',
  'Triceps',
]);
const LOWER_BODY_MUSCLES: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>([
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
]);

function toValidMuscleGroup(raw: string | undefined | null): MuscleGroup | null {
  if (!raw) return null;
  const normalized = normalizeMuscleGroup(raw);
  if (!VALID_MUSCLE_GROUP_SET.has(normalized)) return null;
  return normalized as MuscleGroup;
}

function getExerciseMuscleFractions(ex: SynergyExerciseInput): {
  primaries: MuscleGroup[];
  secondaries: MuscleGroup[];
} {
  const entries = ex.muscle_groups || ex.exercise_muscle_groups || [];
  const primaries: MuscleGroup[] = [];
  const secondaries: MuscleGroup[] = [];

  for (const entry of entries) {
    const mg = toValidMuscleGroup(entry.muscle_group);
    if (!mg) continue;
    const frac = Number(entry.fraction ?? 1.0);
    if (frac >= 1.0) {
      if (!primaries.includes(mg)) primaries.push(mg);
    } else if (frac > 0) {
      if (!secondaries.includes(mg)) secondaries.push(mg);
    }
  }

  return { primaries, secondaries };
}

/**
 * Classifies superset exercise pairings by evaluating both 1.0 primary and 0.5 secondary
 * muscle fractions plus upper-body vs. lower-body recovery non-interference.
 */
export function getSupersetSynergy(
  exercises: SynergyExerciseInput[]
): SupersetSynergyResult | null {
  if (!exercises || exercises.length < 2) return null;

  const perExercise = exercises.map(getExerciseMuscleFractions);

  const primaryCounts = new Map<MuscleGroup, number>();
  const secondaryCounts = new Map<MuscleGroup, number>();
  const allPrimaries = new Set<MuscleGroup>();

  for (const { primaries, secondaries } of perExercise) {
    for (const p of primaries) {
      primaryCounts.set(p, (primaryCounts.get(p) || 0) + 1);
      allPrimaries.add(p);
    }
    for (const s of secondaries) {
      secondaryCounts.set(s, (secondaryCounts.get(s) || 0) + 1);
    }
  }

  // 1. Competing primaries: 2+ exercises share a 1.0 primary muscle
  for (const count of primaryCounts.values()) {
    if (count > 1) {
      return {
        type: 'competing',
        label: 'Competing Primaries',
        description: 'Multiple lifts tax the same primary muscle (1.0x)',
        bgClass: 'bg-rose-500/20',
        borderClass: 'border-rose-500/40',
        textClass: 'text-rose-300',
      };
    }
  }

  // 2. Synergist overlap: 1.0 primary in one lift is 0.5 secondary in another,
  //    OR 2+ exercises share a 0.5 secondary muscle (e.g., Bench + Tricep Pushdown)
  let hasSynergistOverlap = false;
  for (const { primaries, secondaries } of perExercise) {
    for (const s of secondaries) {
      if (allPrimaries.has(s) || (secondaryCounts.get(s) || 0) > 1) {
        hasSynergistOverlap = true;
        break;
      }
    }
    if (hasSynergistOverlap) break;
  }

  if (hasSynergistOverlap) {
    return {
      type: 'synergist_overlap',
      label: 'Synergist Overlap',
      description: 'Primary & secondary (0.5x) fatigue overlaps across lifts',
      bgClass: 'bg-amber-500/20',
      borderClass: 'border-amber-500/40',
      textClass: 'text-amber-300',
    };
  }

  // 3. Antagonist pair: Chest+(Lats|Upper Back), Biceps+Triceps, or Quads+Hamstrings
  const isChestBack =
    allPrimaries.has('Chest') &&
    (allPrimaries.has('Lats') || allPrimaries.has('Upper Back'));
  const isBicepsTriceps = allPrimaries.has('Biceps') && allPrimaries.has('Triceps');
  const isQuadHam = allPrimaries.has('Quads') && allPrimaries.has('Hamstrings');

  const onlyUpper = Array.from(allPrimaries).every((mg) => UPPER_BODY_MUSCLES.has(mg));
  const onlyLower = Array.from(allPrimaries).every((mg) => LOWER_BODY_MUSCLES.has(mg));

  if (((isChestBack || isBicepsTriceps) && onlyUpper) || (isQuadHam && onlyLower)) {
    return {
      type: 'antagonist',
      label: 'Antagonist Pair',
      description: isQuadHam
        ? 'Opposing lower-body muscles alternate work & recovery'
        : 'Opposing upper-body muscles alternate work & recovery',
      bgClass: 'bg-emerald-500/20',
      borderClass: 'border-emerald-500/40',
      textClass: 'text-emerald-300',
    };
  }

  // 4. Upper / Lower split: Strictly upper-body primary + lower-body primary
  const hasUpperPrimary = Array.from(allPrimaries).some((mg) => UPPER_BODY_MUSCLES.has(mg));
  const hasLowerPrimary = Array.from(allPrimaries).some((mg) => LOWER_BODY_MUSCLES.has(mg));

  if (hasUpperPrimary && hasLowerPrimary) {
    return {
      type: 'upper_lower',
      label: 'Upper / Lower Split',
      description: 'Independent upper & lower regions preserve peak force',
      bgClass: 'bg-cyan-500/20',
      borderClass: 'border-cyan-500/40',
      textClass: 'text-cyan-300',
    };
  }

  // 5. Non-competing: Distinct muscles with no direct agonist/synergist overlap
  return {
    type: 'non_competing',
    label: 'Non-Competing',
    description: 'Distinct muscle groups train with minimal interference',
    bgClass: 'bg-indigo-500/20',
    borderClass: 'border-indigo-500/40',
    textClass: 'text-indigo-300',
  };
}

export interface SupersetEquipmentTip {
  label: string;
  description: string;
}

/**
 * Surfaces a non-blocking equipment tip when 2+ dumbbell exercises in a superset require different weights.
 */
export function getSupersetEquipmentTip(
  exercises: Array<{
    equipment?: string | null;
    is_bodyweight_only?: boolean | null;
    target_weight?: number | string | null;
    name?: string | null;
  }>
): SupersetEquipmentTip | null {
  if (!exercises || exercises.length < 2) return null;

  const dbWeights = exercises
    .filter((ex) => !ex.is_bodyweight_only && resolveExerciseEquipment(ex) === 'dumbbell')
    .map((ex) => Number(ex.target_weight))
    .filter((w) => Number.isFinite(w) && w > 0);

  if (dbWeights.length < 2) return null;
  const distinct = Array.from(new Set(dbWeights)).sort((a, b) => a - b);
  if (distinct.length < 2) return null;

  const minW = distinct[0];
  const maxW = distinct[distinct.length - 1];
  return {
    label: `⚡ Dial Change (${minW} ↔ ${maxW} lb)`,
    description: 'Pair with a bodyweight move or add 15s transition if dialing one DB set',
  };
}

/**
 * Evaluates a single split day for non-blocking science guardrails:
 * 1) >2 heavy low-rep lifts (<=6 reps) OR a heavy low-rep lift ordered after higher-rep work
 * 2) >15 fractional planned sets for any muscle group inside a single session
 */
export function evaluateSplitDayGuardrails(
  exercises: SplitDayGuardrailExerciseInput[]
): SplitDayGuardrailsResult {
  if (!exercises || exercises.length === 0) {
    return { heavyLiftWarning: null, fatigueWarnings: [] };
  }

  let heavyCount = 0;
  let seenHigherRep = false;
  let heavyAfterHigherRep = false;

  const dayMuscleSets = {} as Record<MuscleGroup, number>;
  MUSCLE_GROUPS.forEach((mg) => {
    dayMuscleSets[mg] = 0;
  });

  for (const ex of exercises) {
    const rawRepMax = Number(ex.target_rep_max ?? ex.target_reps ?? 10);
    const effectiveRepMax = Number.isFinite(rawRepMax) && rawRepMax > 0 ? rawRepMax : 10;

    if (effectiveRepMax <= 6) {
      heavyCount += 1;
      if (seenHigherRep) {
        heavyAfterHigherRep = true;
      }
    } else {
      seenHigherRep = true;
    }

    const sets = Math.max(0, Number(ex.planned_sets) || 0);
    const entries = ex.muscle_groups || ex.exercise_muscle_groups || [];
    for (const entry of entries) {
      const mg = toValidMuscleGroup(entry.muscle_group);
      if (!mg) continue;
      const frac = Number(entry.fraction ?? 1.0);
      if (frac > 0) {
        dayMuscleSets[mg] += sets * frac;
      }
    }
  }

  let heavyLiftWarning: string | null = null;
  if (heavyCount > 2 && heavyAfterHigherRep) {
    heavyLiftWarning =
      `${heavyCount} heavy low-rep lifts (<=6 reps) scheduled today, with heavy work placed after higher-rep sets. Consider limiting heavy neural compounds to 1–2 lifts ordered first.`;
  } else if (heavyCount > 2) {
    heavyLiftWarning =
      `${heavyCount} heavy low-rep lifts (<=6 reps) in one day increases CNS fatigue. Consider keeping heavy primary lifts to 1–2 per session.`;
  } else if (heavyAfterHigherRep) {
    heavyLiftWarning =
      `A heavy low-rep lift (<=6 reps) is ordered after higher-rep work. Move heavy strength compounds to the top of the session for fresher output.`;
  }

  const fatigueWarnings = MUSCLE_GROUPS.map((mg) => ({
    muscleGroup: mg,
    sets: Math.round(dayMuscleSets[mg] * 10) / 10,
  })).filter((entry) => entry.sets > 15);

  return {
    heavyLiftWarning,
    fatigueWarnings,
  };
}
