/**
 * Auto-Regulation & Progression Engine Logic
 */

export interface SetVolumeDelta {
  deltaSets: number;
}

export interface NextTarget {
  weightKg: number;
  reps: number;
}

/**
 * Compute the next week's load and reps.
 * NextWeight = CurrentWeight * 1.03 (3% increase).
 * If the difference is less than minIncrement (e.g., 2.5kg), keep weight and add 1 rep.
 */
export const calculateNextLoadAndReps = (
  currentWeight: number,
  currentReps: number,
  minIncrement: number = 2.5
): NextTarget => {
  const nextWeight = currentWeight * 1.03;
  if (nextWeight - currentWeight < minIncrement) {
    return {
      weightKg: currentWeight,
      reps: currentReps + 1,
    };
  }
  
  // Round to nearest minIncrement
  const roundedWeight = Math.round(nextWeight / minIncrement) * minIncrement;
  return {
    weightKg: roundedWeight,
    reps: currentReps, // keep reps same as previous if weight increased, or could drop reps slightly depending on model. For now keeping same.
  };
};

/**
 * Implement subjective feedback scoring model based on Pump (P), Soreness (S), and Workload (F)
 * IF Soreness == 3 OR Workload == 3 -> Decrease volume: Set Delta = -1 (or -2 if both).
 * IF Soreness == 1, Workload == 1, and Pump <= 2 -> Increase volume: Set Delta = +1.
 * Otherwise -> Maintain volume: Set Delta = 0.
 *
 * Constrains volume modifications to 0 if joint_integrity_flag is true.
 */
export const calculateVolumeDelta = (
  pump: number, // 1 to 3
  soreness: number, // 1 to 3
  workload: number, // 1 to 3
  jointIntegrityFlag: 0 | 1
): SetVolumeDelta => {
  if (jointIntegrityFlag === 1) {
    return { deltaSets: 0 }; // Cap volume modifications if joint pain
  }

  let deltaSets = 0;

  if (soreness === 3 || workload === 3) {
    if (soreness === 3 && workload === 3) {
      deltaSets = -2;
    } else {
      deltaSets = -1;
    }
  } else if (soreness === 1 && workload === 1 && pump <= 2) {
    deltaSets = 1;
  }

  return { deltaSets };
};

/**
 * Returns the target RIR for a given week index in a 5-week mesocycle.
 * Week 1: 3 RIR
 * Week 2: 2 RIR
 * Week 3: 1 RIR
 * Week 4: 0 RIR
 * Week 5: Deload (special handling for volume reduction usually done outside this function)
 */
export const getTargetRIR = (weekIndex: number): number => {
  switch (weekIndex) {
    case 1: return 3;
    case 2: return 2;
    case 3: return 1;
    case 4: return 0;
    case 5: return 3; // Week 5 is deload, RIR is usually pushed back up or weight/volume reduced
    default: return 3;
  }
};
