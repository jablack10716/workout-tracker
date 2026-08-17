/**
 * Dashboard Metrics & Analytics Calculation Engine
 */

export interface MuscleGroupVolume {
  name: string;
  targetSets: number;
  completedSets: number;
  percentage: number;
}

export interface DashboardStats {
  weeklyWorkoutsCount: number;
  weeklyTonnage: number;
  weeklyTargetSets: number;
  weeklyCompletedSets: number;
  weeklyCompletionPct: number;
  muscleGroups: MuscleGroupVolume[];
  isCompletedToday: boolean;
  todaySummary: {
    tonnage: number;
    completedSets: number;
    durationMinutes: number;
  } | null;
  prSessionIds: Set<string>;
  todayExercises: Array<{
    id: string;
    name: string;
    plannedSets: number;
    targetWeight: number | null;
    targetReps: number | null;
    isBodyweight: boolean;
  }>;
  currentDayName: string;
  currentDayNumber: number;
}

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps'] as const;

/**
 * Returns the start of the current week (Monday at 00:00:00.000 local time).
 */
export function getStartOfWeek(refDate: Date = new Date()): Date {
  const date = new Date(refDate);
  const day = date.getDay(); // 0 is Sunday, 1 is Monday...
  const diff = date.getDate() - (day === 0 ? 6 : day - 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Computes all dashboard statistics dynamically from raw Supabase routine and session payloads.
 */
export function computeDashboardStats(
  activeRoutine: any | null,
  allSessions: any[] = []
): DashboardStats {
  const startOfWeek = getStartOfWeek();
  const todayDateStr = new Date().toDateString();

  // 1. Determine all-time PRs per exercise across all sessions
  const maxWeightPerExercise: Record<string, number> = {};
  const prSessionIds = new Set<string>();

  const sortedSessions = [...allSessions].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  sortedSessions.forEach((session) => {
    let sessionHadPR = false;
    (session.session_exercises || []).forEach((se: any) => {
      const exId = se.exercises?.id || se.exercise_id;
      if (!exId) return;

      const prevMax = maxWeightPerExercise[exId] || 0;
      let sessionMax = 0;

      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed && st.weight && st.weight > 0) {
          if (st.weight > sessionMax) {
            sessionMax = st.weight;
          }
        }
      });

      if (sessionMax > 0 && sessionMax > prevMax) {
        maxWeightPerExercise[exId] = sessionMax;
        if (prevMax > 0) {
          sessionHadPR = true;
        }
      }
    });

    if (sessionHadPR) {
      prSessionIds.add(session.id);
    }
  });

  // 2. Filter sessions completed this calendar week (from Monday 00:00:00)
  const thisWeekSessions = allSessions.filter((s) => {
    const sessionTime = new Date(s.started_at).getTime();
    return sessionTime >= startOfWeek.getTime();
  });

  const weeklyWorkoutsCount = thisWeekSessions.length;

  // 3. Compute Weekly Tonnage & Completed Sets
  let weeklyTonnage = 0;
  let weeklyCompletedSets = 0;
  const completedMuscleSets: Record<string, number> = {};
  MUSCLE_GROUPS.forEach((g) => (completedMuscleSets[g] = 0));

  thisWeekSessions.forEach((s) => {
    (s.session_exercises || []).forEach((se: any) => {
      const muscleMappings: Array<{ muscle_group: string; fraction: number }> =
        se.exercises?.exercise_muscle_groups || [];

      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          weeklyCompletedSets += 1;
          const w = Number(st.weight) || 0;
          const r = Number(st.reps) || 0;
          weeklyTonnage += w * r;

          // Attribute completed set to muscle groups using fractions
          if (muscleMappings.length > 0) {
            muscleMappings.forEach((m) => {
              const grp = m.muscle_group;
              const frac = Number(m.fraction) || 1.0;
              if (completedMuscleSets[grp] !== undefined) {
                completedMuscleSets[grp] += frac;
              }
            });
          }
        }
      });
    });
  });

  // 4. Compute Weekly Target Sets from Active Routine
  let weeklyTargetSets = 0;
  const targetMuscleSets: Record<string, number> = {};
  MUSCLE_GROUPS.forEach((g) => (targetMuscleSets[g] = 0));

  let todayExercises: DashboardStats['todayExercises'] = [];
  let currentDayName = 'Workout Day';
  let currentDayNumber = 1;

  if (activeRoutine) {
    currentDayNumber = activeRoutine.current_day || 1;
    const routineDays: any[] = activeRoutine.routine_days || [];

    routineDays.forEach((day: any) => {
      const isCurrentDay = day.day_number === currentDayNumber;
      if (isCurrentDay && day.name) {
        currentDayName = day.name;
      }

      const rExercises: any[] = day.routine_exercises || [];
      const sortedExercises = [...rExercises].sort(
        (a, b) => (a.order_index || 0) - (b.order_index || 0)
      );

      sortedExercises.forEach((re: any) => {
        const planned = Number(re.planned_sets) || 0;
        weeklyTargetSets += planned;

        const muscleMappings: Array<{ muscle_group: string; fraction: number }> =
          re.exercises?.exercise_muscle_groups || [];

        if (muscleMappings.length > 0) {
          muscleMappings.forEach((m) => {
            const grp = m.muscle_group;
            const frac = Number(m.fraction) || 1.0;
            if (targetMuscleSets[grp] !== undefined) {
              targetMuscleSets[grp] += planned * frac;
            }
          });
        }

        if (isCurrentDay) {
          todayExercises.push({
            id: re.id || re.exercise_id,
            name: re.exercises?.name || 'Exercise',
            plannedSets: planned,
            targetWeight: re.target_weight !== null && re.target_weight !== undefined ? Number(re.target_weight) : null,
            targetReps: re.target_reps !== null && re.target_reps !== undefined ? Number(re.target_reps) : null,
            isBodyweight: Boolean(re.exercises?.is_bodyweight_only),
          });
        }
      });
    });
  }

  // 5. Compute Completion Percentage
  const weeklyCompletionPct =
    weeklyTargetSets > 0
      ? Math.min(100, Math.round((weeklyCompletedSets / weeklyTargetSets) * 100))
      : 0;

  // 6. Muscle Group breakdown list
  const muscleGroups: MuscleGroupVolume[] = MUSCLE_GROUPS.map((name) => {
    const target = Math.round(targetMuscleSets[name] * 10) / 10;
    const completed = Math.round(completedMuscleSets[name] * 10) / 10;
    const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
    return {
      name,
      targetSets: target,
      completedSets: completed,
      percentage: pct,
    };
  });

  // 7. Check if workout was completed today
  const todaySession = allSessions.find((s) => {
    return new Date(s.started_at).toDateString() === todayDateStr;
  });

  const isCompletedToday = Boolean(todaySession);
  let todaySummary: DashboardStats['todaySummary'] = null;

  if (todaySession) {
    let todayTonnage = 0;
    let todaySets = 0;
    (todaySession.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          todaySets += 1;
          todayTonnage += (Number(st.weight) || 0) * (Number(st.reps) || 0);
        }
      });
    });

    const durationSecs =
      todaySession.duration_seconds ||
      (todaySession.completed_at && todaySession.started_at
        ? Math.max(
            Math.round(
              (new Date(todaySession.completed_at).getTime() -
                new Date(todaySession.started_at).getTime()) /
                1000
            ),
            0
          )
        : 1800);

    todaySummary = {
      tonnage: Math.round(todayTonnage),
      completedSets: todaySets,
      durationMinutes: Math.max(Math.round(durationSecs / 60), 1),
    };
  }

  return {
    weeklyWorkoutsCount,
    weeklyTonnage: Math.round(weeklyTonnage),
    weeklyTargetSets,
    weeklyCompletedSets,
    weeklyCompletionPct,
    muscleGroups,
    isCompletedToday,
    todaySummary,
    prSessionIds,
    todayExercises,
    currentDayName,
    currentDayNumber,
  };
}
