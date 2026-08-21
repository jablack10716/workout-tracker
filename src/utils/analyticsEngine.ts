/**
 * Exercise Science Analytics & Metrics Engine
 * 
 * Implements standard biomechanics and exercise physiology models:
 * - 1-Rep Max estimation (Epley and Brzycki equations)
 * - Volume Load (Tonnage = Weight × Reps × Sets)
 * - Muscle Group Volume Allocation (Fractional Synergy Mapping)
 * - Training Density (Volume / Duration)
 * - Hypertrophy Volume Benchmarks (MEV, MAV, MRV thresholds)
 * - Personal Record (PR) Multi-Vector Detection
 * - Cycle-over-Cycle Progression Analytics
 */

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Legs',
  'Biceps',
  'Triceps',
  'Core',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface PREntry {
  exerciseId: string;
  exerciseName: string;
  maxWeight: number;
  maxRepsAtMaxWeight: number;
  maxVolumeSingleSet: number;
  estimated1RM: number;
  dateAchieved: string;
  sessionId?: string;
  isBodyweight: boolean;
}

export interface E1RMDataPoint {
  date: string;
  timestamp: number;
  e1rm: number;
  weight: number;
  reps: number;
  sessionId: string;
  cycleNumber?: number;
}

export interface VolumeDataPoint {
  date: string;
  timestamp: number;
  volume: number;
  sets: number;
  durationMinutes: number;
  density: number; // lbs/min
  sessionId: string;
  routineName: string;
}

export interface WeeklyVolumePoint {
  weekLabel: string;
  startDate: string;
  totalVolume: number;
  totalSets: number;
  workoutCount: number;
  muscleSets: Record<string, number>;
}

export interface MuscleGroupStatus {
  muscleGroup: string;
  weeklySets: number;
  status: 'low' | 'optimal' | 'high';
  statusText: string;
  color: string;
}

export interface CycleComparison {
  routineId: string;
  routineName: string;
  dayNumber: number;
  dayName: string;
  cycles: Array<{
    cycleNumber: number;
    sessionId: string;
    date: string;
    totalVolume: number;
    completedSets: number;
    durationMinutes: number;
    density: number;
    exercises: Array<{
      exerciseId: string;
      exerciseName: string;
      totalVolume: number;
      topWeight: number;
      topReps: number;
      topE1RM: number;
      sets: Array<{ set_number: number; weight: number; reps: number }>;
    }>;
  }>;
}

/**
 * 1-Rep Max estimation using the Epley formula:
 * 1RM = Weight × (1 + Reps / 30)
 * Note: When reps = 1, 1RM = Weight.
 * Reps > 15 are capped/weighted for metabolic conditioning accuracy.
 */
export function calculateEstimated1RM(weight: number, reps: number): number {
  if (!weight || weight <= 0 || !reps || reps <= 0) return 0;
  if (reps === 1) return Math.round(weight * 10) / 10;
  
  // Epley formula: valid up to ~12-15 reps with high accuracy
  const effectiveReps = Math.min(reps, 15);
  const e1rm = weight * (1 + effectiveReps / 30);
  return Math.round(e1rm * 10) / 10;
}

/**
 * Alternative Brzycki formula for 1RM:
 * 1RM = Weight × (36 / (37 - Reps))
 */
export function calculateBrzycki1RM(weight: number, reps: number): number {
  if (!weight || weight <= 0 || !reps || reps <= 0) return 0;
  if (reps >= 37) return weight;
  const e1rm = weight * (36 / (37 - reps));
  return Math.round(e1rm * 10) / 10;
}

/**
 * Computes all-time Personal Records across all user sessions.
 * Tracks Max Weight, Max Volume, and Estimated 1RM per exercise.
 */
export function extractPersonalRecords(sessions: any[]): PREntry[] {
  const prMap: Record<string, PREntry> = {};

  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  sortedSessions.forEach((session) => {
    const sessionDate = session.started_at || new Date().toISOString();
    const sessionId = session.id;

    (session.session_exercises || []).forEach((se: any) => {
      const exId = se.exercises?.id || se.exercise_id;
      const exName = se.exercises?.name || 'Exercise';
      const isBw = Boolean(se.exercises?.is_bodyweight_only);

      if (!exId) return;

      if (!prMap[exId]) {
        prMap[exId] = {
          exerciseId: exId,
          exerciseName: exName,
          maxWeight: 0,
          maxRepsAtMaxWeight: 0,
          maxVolumeSingleSet: 0,
          estimated1RM: 0,
          dateAchieved: sessionDate,
          sessionId,
          isBodyweight: isBw,
        };
      }

      (se.session_sets || []).forEach((st: any) => {
        if (!st.is_completed) return;
        const w = Number(st.weight) || 0;
        const r = Number(st.reps) || 0;
        const setVolume = w * r;
        const e1rm = calculateEstimated1RM(w, r);

        const currentPr = prMap[exId];

        if (w > currentPr.maxWeight) {
          currentPr.maxWeight = w;
          currentPr.maxRepsAtMaxWeight = r;
          currentPr.dateAchieved = sessionDate;
          currentPr.sessionId = sessionId;
        } else if (w === currentPr.maxWeight && r > currentPr.maxRepsAtMaxWeight) {
          currentPr.maxRepsAtMaxWeight = r;
          currentPr.dateAchieved = sessionDate;
          currentPr.sessionId = sessionId;
        }

        if (setVolume > currentPr.maxVolumeSingleSet) {
          currentPr.maxVolumeSingleSet = setVolume;
        }

        if (e1rm > currentPr.estimated1RM) {
          currentPr.estimated1RM = e1rm;
        }
      });
    });
  });

  return Object.values(prMap).filter(
    (pr) => pr.maxWeight > 0 || (pr.isBodyweight && pr.maxRepsAtMaxWeight > 0)
  );
}

/**
 * Extracts chronological Estimated 1RM history for a specific exercise.
 */
export function getExerciseE1RMHistory(
  sessions: any[],
  exerciseId: string
): E1RMDataPoint[] {
  const dataPoints: E1RMDataPoint[] = [];

  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  sortedSessions.forEach((session) => {
    const sessionDate = session.started_at;
    if (!sessionDate) return;

    (session.session_exercises || []).forEach((se: any) => {
      const exId = se.exercises?.id || se.exercise_id;
      if (exId !== exerciseId) return;

      let bestE1RM = 0;
      let bestWeight = 0;
      let bestReps = 0;

      (se.session_sets || []).forEach((st: any) => {
        if (!st.is_completed) return;
        const w = Number(st.weight) || 0;
        const r = Number(st.reps) || 0;
        if (w <= 0 || r <= 0) return;

        const currentE1RM = calculateEstimated1RM(w, r);
        if (currentE1RM > bestE1RM) {
          bestE1RM = currentE1RM;
          bestWeight = w;
          bestReps = r;
        }
      });

      if (bestE1RM > 0) {
        dataPoints.push({
          date: new Date(sessionDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
          timestamp: new Date(sessionDate).getTime(),
          e1rm: bestE1RM,
          weight: bestWeight,
          reps: bestReps,
          sessionId: session.id,
          cycleNumber: session.cycle_number,
        });
      }
    });
  });

  return dataPoints;
}

/**
 * Computes chronological workout volume data points and training density.
 */
export function getSessionVolumeHistory(sessions: any[]): VolumeDataPoint[] {
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  return sortedSessions.map((session) => {
    let volume = 0;
    let sets = 0;

    (session.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          sets += 1;
          const w = Number(st.weight) || 0;
          const r = Number(st.reps) || 0;
          volume += w * r;
        }
      });
    });

    const durationSecs =
      session.duration_seconds ||
      (session.completed_at && session.started_at
        ? Math.max(
            Math.round(
              (new Date(session.completed_at).getTime() -
                new Date(session.started_at).getTime()) /
                1000
            ),
            0
          )
        : 1800);

    const durationMinutes = Math.max(Math.round(durationSecs / 60), 1);
    const density = durationMinutes > 0 ? Math.round(volume / durationMinutes) : 0;

    return {
      date: new Date(session.started_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      timestamp: new Date(session.started_at).getTime(),
      volume: Math.round(volume),
      sets,
      durationMinutes,
      density,
      sessionId: session.id,
      routineName: session.routines?.name || 'Workout',
    };
  });
}

/**
 * Aggregates workout volume by calendar week with fractional muscle group tracking.
 */
export function getWeeklyVolumeHistory(
  sessions: any[],
  weeksCount: number = 8
): WeeklyVolumePoint[] {
  const now = new Date();
  const weekMap: Record<string, WeeklyVolumePoint> = {};

  // Build rolling week buckets
  for (let i = weeksCount - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const day = d.getDay();
    const diff = d.getDate() - (day === 0 ? 6 : day - 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    const key = monday.toISOString().split('T')[0];
    const weekLabel = `${monday.getMonth() + 1}/${monday.getDate()}`;

    const emptyMuscleSets: Record<string, number> = {};
    MUSCLE_GROUPS.forEach((g) => (emptyMuscleSets[g] = 0));

    weekMap[key] = {
      weekLabel,
      startDate: key,
      totalVolume: 0,
      totalSets: 0,
      workoutCount: 0,
      muscleSets: emptyMuscleSets,
    };
  }

  sessions.forEach((s) => {
    const sDate = new Date(s.started_at);
    const day = sDate.getDay();
    const diff = sDate.getDate() - (day === 0 ? 6 : day - 1);
    const monday = new Date(sDate.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().split('T')[0];

    if (!weekMap[key]) return;

    weekMap[key].workoutCount += 1;

    (s.session_exercises || []).forEach((se: any) => {
      const muscleMappings: Array<{ muscle_group: string; fraction: number }> =
        se.exercises?.exercise_muscle_groups || [];

      (se.session_sets || []).forEach((st: any) => {
        if (!st.is_completed) return;
        const w = Number(st.weight) || 0;
        const r = Number(st.reps) || 0;
        weekMap[key].totalSets += 1;
        weekMap[key].totalVolume += w * r;

        if (muscleMappings.length > 0) {
          muscleMappings.forEach((m) => {
            const grp = m.muscle_group;
            const frac = Number(m.fraction) || 1.0;
            if (weekMap[key].muscleSets[grp] !== undefined) {
              weekMap[key].muscleSets[grp] += frac;
            }
          });
        }
      });
    });
  });

  return Object.values(weekMap);
}

/**
 * Exercise Science Hypertrophy Volume Status:
 * Evaluates weekly direct+indirect sets against literature-backed ranges:
 * - < 6 sets/week: Low / Maintenance (sub-optimal for hypertrophy)
 * - 6-12 sets/week: Moderate (Minimum Effective Volume - MEV)
 * - 12-20 sets/week: Optimal Hypertrophy Range (Maximum Adaptive Volume - MAV)
 * - > 20 sets/week: High / Maximum Recoverable Volume (MRV risk of overreaching)
 */
export function evaluateHypertrophyVolume(weeklySets: number): MuscleGroupStatus['status'] {
  if (weeklySets < 6) return 'low';
  if (weeklySets <= 20) return 'optimal';
  return 'high';
}

export function getMuscleGroupVolumeStatusList(
  currentWeeklySets: Record<string, number>
): MuscleGroupStatus[] {
  return MUSCLE_GROUPS.map((mg) => {
    const sets = Math.round((currentWeeklySets[mg] || 0) * 10) / 10;
    const status = evaluateHypertrophyVolume(sets);
    let statusText = 'Optimal Volume (MAV)';
    let color = '#10b981'; // emerald-500

    if (status === 'low') {
      statusText = sets === 0 ? 'No Stimulus' : 'Sub-Optimal (<6s)';
      color = '#f59e0b'; // amber-500
    } else if (status === 'high') {
      statusText = 'High Fatigue (>20s)';
      color = '#ef4444'; // red-500
    }

    return {
      muscleGroup: mg,
      weeklySets: sets,
      status,
      statusText,
      color,
    };
  });
}

/**
 * Cycle-over-cycle comparative analyzer:
 * Compares performances for the same routine split day across successive cycles.
 */
export function analyzeCycleProgression(
  sessions: any[],
  routineId: string,
  dayNumber: number
): CycleComparison | null {
  const matchingSessions = sessions.filter(
    (s) => s.routine_id === routineId && (s.day_order === dayNumber || s.routine_day_id)
  );

  if (matchingSessions.length === 0) return null;

  const sortedSessions = [...matchingSessions].sort(
    (a, b) => (a.cycle_number || 0) - (b.cycle_number || 0)
  );

  const routineName = sortedSessions[0]?.routines?.name || 'Split Day';

  const cycles = sortedSessions.map((s) => {
    let totalVolume = 0;
    let completedSets = 0;
    const exMap: Record<string, any> = {};

    (s.session_exercises || []).forEach((se: any) => {
      const exId = se.exercises?.id || se.exercise_id;
      const exName = se.exercises?.name || 'Exercise';

      if (!exMap[exId]) {
        exMap[exId] = {
          exerciseId: exId,
          exerciseName: exName,
          totalVolume: 0,
          topWeight: 0,
          topReps: 0,
          topE1RM: 0,
          sets: [],
        };
      }

      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          completedSets++;
          const w = Number(st.weight) || 0;
          const r = Number(st.reps) || 0;
          const setVol = w * r;
          const e1rm = calculateEstimated1RM(w, r);

          totalVolume += setVol;
          exMap[exId].totalVolume += setVol;
          exMap[exId].sets.push({
            set_number: st.set_number,
            weight: w,
            reps: r,
          });

          if (w > exMap[exId].topWeight) {
            exMap[exId].topWeight = w;
            exMap[exId].topReps = r;
          }
          if (e1rm > exMap[exId].topE1RM) {
            exMap[exId].topE1RM = e1rm;
          }
        }
      });
    });

    const durationSecs = s.duration_seconds || 1800;
    const durationMinutes = Math.max(Math.round(durationSecs / 60), 1);

    return {
      cycleNumber: s.cycle_number || 1,
      sessionId: s.id,
      date: new Date(s.started_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      totalVolume: Math.round(totalVolume),
      completedSets,
      durationMinutes,
      density: durationMinutes > 0 ? Math.round(totalVolume / durationMinutes) : 0,
      exercises: Object.values(exMap),
    };
  });

  return {
    routineId,
    routineName,
    dayNumber,
    dayName: `Day ${dayNumber}`,
    cycles,
  };
}

/**
 * Calculates consistency streak (consecutive weeks with ≥ 1 workout).
 */
export function calculateWorkoutStreak(sessions: any[]): {
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  totalWorkouts: number;
} {
  if (!sessions || sessions.length === 0) {
    return { currentStreakWeeks: 0, longestStreakWeeks: 0, totalWorkouts: 0 };
  }

  // Get unique week keys in descending order
  const weeksWithWorkouts = new Set<string>();
  sessions.forEach((s) => {
    const d = new Date(s.started_at);
    const day = d.getDay();
    const diff = d.getDate() - (day === 0 ? 6 : day - 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    weeksWithWorkouts.add(monday.toISOString().split('T')[0]);
  });

  const sortedWeeks = Array.from(weeksWithWorkouts).sort().reverse();
  const currentWeekMonday = new Date();
  const currDay = currentWeekMonday.getDay();
  const currDiff = currentWeekMonday.getDate() - (currDay === 0 ? 6 : currDay - 1);
  const currentMonday = new Date(currentWeekMonday.setDate(currDiff));
  currentMonday.setHours(0, 0, 0, 0);
  const currentMondayKey = currentMonday.toISOString().split('T')[0];

  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevMondayKey = prevMonday.toISOString().split('T')[0];

  let currentStreak = 0;
  let maxStreak = 0;
  let tempStreak = 0;

  // Check if current week or last week has a workout to maintain active streak
  let activeCheckDate = weeksWithWorkouts.has(currentMondayKey)
    ? currentMonday
    : weeksWithWorkouts.has(prevMondayKey)
    ? prevMonday
    : null;

  if (activeCheckDate) {
    const iter = new Date(activeCheckDate);
    while (weeksWithWorkouts.has(iter.toISOString().split('T')[0])) {
      currentStreak++;
      iter.setDate(iter.getDate() - 7);
    }
  }

  // Calculate longest streak across history
  for (let i = 0; i < sortedWeeks.length; i++) {
    tempStreak = 1;
    let iter = new Date(sortedWeeks[i]);
    iter.setDate(iter.getDate() - 7);
    while (weeksWithWorkouts.has(iter.toISOString().split('T')[0])) {
      tempStreak++;
      iter.setDate(iter.getDate() - 7);
    }
    if (tempStreak > maxStreak) {
      maxStreak = tempStreak;
    }
  }

  return {
    currentStreakWeeks: currentStreak,
    longestStreakWeeks: Math.max(maxStreak, currentStreak),
    totalWorkouts: sessions.length,
  };
}
