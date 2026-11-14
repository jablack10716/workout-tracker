import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
  AppState,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as KeepAwake from 'expo-keep-awake';
import { supabase } from '../../src/lib/supabase';
import { SetRow, formatRirLabel, getSetTypeBadgeMeta } from '../../src/components/SetRow';
import {
  useActiveWorkoutStore,
  ActiveWorkoutExercise,
  ActiveWorkoutSet,
  SetType,
} from '../../src/store/useActiveWorkoutStore';
import { usePreferencesStore } from '../../src/store/usePreferencesStore';
import { useExercises, Exercise } from '../../src/hooks/useExercises';
import {
  X,
  Check,
  Timer,
  Plus,
  Minus,
  FastForward,
  Dumbbell,
  Sparkles,
  ArrowDown,
  Layers,
  Flame,
  Zap,
  CheckCircle2,
  RefreshCw,
  Search,
} from 'lucide-react-native';
import { calculateEstimated1RM, isWorkingCompletedSet } from '../../src/utils/analyticsEngine';
import { getTargetRIR } from '../../src/utils/autoRegEngine';
import * as Haptics from 'expo-haptics';

const KEEP_AWAKE_TAG = 'active-workout';
const SET_TYPE_ORDER: readonly SetType[] = ['normal', 'warmup', 'drop', 'failure'];
const RIR_CYCLE: ReadonlyArray<number | null> = [null, 0, 1, 2, 3, 4];

function cycleSetTypeValue(current?: SetType): SetType {
  const idx = SET_TYPE_ORDER.indexOf(current || 'normal');
  return SET_TYPE_ORDER[(idx + 1) % SET_TYPE_ORDER.length];
}

function cycleRirValue(current?: number | null): number | null {
  const normalized = current !== null && current !== undefined && current >= 4 ? 4 : current ?? null;
  const idx = RIR_CYCLE.indexOf(normalized);
  return RIR_CYCLE[(idx + 1) % RIR_CYCLE.length];
}

function formatRepRange(min?: number | null, max?: number | null): string | null {
  if (min && max) {
    return min === max ? `${min} reps` : `${min}–${max} reps`;
  }
  const single = max || min;
  return single ? `${single} reps` : null;
}

interface ExerciseHistoryEntry {
  nextTargetWeight: number | null;
  nextTargetReps: number | null;
  lastCompletedWeight: number | null;
  lastCompletedReps: number | null;
  maxCompletedWeight: number | null;
  completedSets: Array<{ set_number: number; weight: number | null; reps: number | null }>;
}

async function fetchExerciseHistoryMap(
  userId: string,
  exerciseIds: string[]
): Promise<Record<string, ExerciseHistoryEntry>> {
  const exerciseHistoryMap: Record<string, ExerciseHistoryEntry> = {};
  if (!userId || exerciseIds.length === 0) return exerciseHistoryMap;

  try {
    const { data: pastData, error: pErr } = await supabase
      .from('session_exercises')
      .select(
        `
          id,
          exercise_id,
          next_target_weight,
          next_target_reps,
          sessions!inner (
            id,
            user_id,
            status,
            completed_at,
            started_at
          ),
          session_sets (*)
        `
      )
      .eq('sessions.user_id', userId)
      .eq('sessions.status', 'completed')
      .in('exercise_id', exerciseIds);

    if (!pErr && pastData) {
      pastData.sort((a: any, b: any) => {
        const dateA = new Date(a.sessions?.completed_at || a.sessions?.started_at || 0).getTime();
        const dateB = new Date(b.sessions?.completed_at || b.sessions?.started_at || 0).getTime();
        return dateB - dateA;
      });

      for (const row of pastData) {
        const exId = row.exercise_id;
        if (exerciseHistoryMap[exId]) continue;

        // Guardrail: exclude prior warmup sets when resolving working targets & ghost text
        const validSets = (row.session_sets || [])
          .filter((s: any) => isWorkingCompletedSet(s))
          .sort((a: any, b: any) => (a.set_number || 0) - (b.set_number || 0));

        const hasTargets =
          (row.next_target_weight !== null && row.next_target_weight !== undefined) ||
          (row.next_target_reps !== null && row.next_target_reps !== undefined);

        if (validSets.length === 0 && !hasTargets) {
          continue;
        }

        const completedSetsList = validSets.map((s: any) => ({
          set_number: s.set_number,
          weight: s.weight !== null && s.weight !== undefined ? Number(s.weight) : null,
          reps: s.reps !== null && s.reps !== undefined ? Number(s.reps) : null,
        }));

        const lastCompleted = completedSetsList[completedSetsList.length - 1];
        const validWeights = completedSetsList
          .map((s: any) => s.weight)
          .filter((w: any): w is number => w !== null && !isNaN(w));
        const maxCompletedW = validWeights.length > 0 ? Math.max(...validWeights) : null;

        exerciseHistoryMap[exId] = {
          nextTargetWeight:
            row.next_target_weight !== null && row.next_target_weight !== undefined
              ? Number(row.next_target_weight)
              : null,
          nextTargetReps:
            row.next_target_reps !== null && row.next_target_reps !== undefined
              ? Number(row.next_target_reps)
              : null,
          lastCompletedWeight: lastCompleted?.weight ?? null,
          lastCompletedReps: lastCompleted?.reps ?? null,
          maxCompletedWeight: maxCompletedW,
          completedSets: completedSetsList,
        };
      }
    }
  } catch (err) {
    console.warn('Error fetching exercise history:', err);
  }

  return exerciseHistoryMap;
}

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [, setClockTick] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const didInitRef = useRef(false);

  const [swapTargetIndex, setSwapTargetIndex] = useState<number | null>(null);
  const [swapSearch, setSwapSearch] = useState('');
  const [swapping, setSwapping] = useState(false);

  const { exercises: catalogExercises, loading: catalogLoading, refetch: refreshCatalog } = useExercises();

  const filteredSwapExercises = useMemo(() => {
    const q = swapSearch.trim().toLowerCase();
    if (!q) return catalogExercises;
    return catalogExercises.filter((ex) => {
      const nameMatch = ex.name.toLowerCase().includes(q);
      const muscleMatch = ex.exercise_muscle_groups?.some((m) =>
        m.muscle_group.toLowerCase().includes(q)
      );
      return nameMatch || muscleMatch;
    });
  }, [catalogExercises, swapSearch]);

  const draft = useActiveWorkoutStore((s) => s.draft);
  const hasHydrated = useActiveWorkoutStore((s) => s._hasHydrated);
  const initializeDraft = useActiveWorkoutStore((s) => s.initializeDraft);
  const updateWorkoutExercises = useActiveWorkoutStore((s) => s.updateWorkoutExercises);
  const setRestTimer = useActiveWorkoutStore((s) => s.setRestTimer);
  const markPendingSync = useActiveWorkoutStore((s) => s.markPendingSync);
  const clearActiveWorkout = useActiveWorkoutStore((s) => s.clearActiveWorkout);

  const defaultRestSeconds = usePreferencesStore((s) => s.defaultRestSeconds);
  const supersetTransitionSeconds = usePreferencesStore((s) => s.supersetTransitionSeconds);
  const hapticsEnabled = usePreferencesStore((s) => s.hapticsEnabled);

  const workoutExercises = draft?.workoutExercises ?? [];
  const restTimerEndTimestamp = draft?.restTimerEndTimestamp ?? null;
  const restTimerTotalSeconds = draft?.restTimerTotalSeconds ?? null;
  const restTimerLabel = draft?.restTimerLabel ?? null;
  const startedAtTimestamp = draft?.startedAtTimestamp ?? Date.now();
  const routineName = draft?.routineName || 'Routine';
  const dayNumber = draft?.dayNumber || 1;
  const activeDayName = draft?.dayName || `Day ${dayNumber}`;
  const cycleNumber = draft?.cycleNumber || 1;
  const cyclesPerRoutine = draft?.cyclesPerRoutine || 4;
  const targetCycleRIR = getTargetRIR(cycleNumber);

  // 1. Keep screen awake while workout is open (Expo SDK 57 API + safe web guard)
  useEffect(() => {
    let isMounted = true;

    const enableKeepAwake = async () => {
      try {
        const available = await KeepAwake.isAvailableAsync();
        if (available && isMounted) {
          await KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        }
      } catch {
        // Ignore WakeLock errors on unsupported browsers or hidden tabs
      }
    };

    enableKeepAwake();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        enableKeepAwake();
      }
    });

    return () => {
      isMounted = false;
      appStateSub.remove();
      KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  // 2. Wall-clock countdown timer + foreground AppState reconciliation (zero drift)
  useEffect(() => {
    if (!restTimerEndTimestamp) {
      setTimerSeconds(null);
      return;
    }

    const syncTimer = (): boolean => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((restTimerEndTimestamp - now) / 1000));
      setTimerSeconds(remaining);

      if (remaining === 0) {
        const expiredAgoMs = now - restTimerEndTimestamp;
        setRestTimer(null, null);
        if (hapticsEnabled && expiredAgoMs < 5000) {
          try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {}
        }
        return true;
      }
      return false;
    };

    if (syncTimer()) {
      return;
    }

    const intervalId = setInterval(() => {
      if (syncTimer()) {
        clearInterval(intervalId);
      }
    }, 500);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncTimer();
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [restTimerEndTimestamp, hapticsEnabled, setRestTimer]);

  // 3. Periodic UI refresh for live elapsed density indicator
  useEffect(() => {
    const id = setInterval(() => {
      setClockTick((t) => t + 1);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  // 4. Hydrate from AsyncStorage draft or initialize from active routine
  useEffect(() => {
    if (!hasHydrated || didInitRef.current) return;
    didInitRef.current = true;
    loadActiveWorkout();
  }, [hasHydrated]);

  const loadActiveWorkout = async () => {
    setLoading(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      Alert.alert('Auth Required', 'Please log in to start a workout.');
      setLoading(false);
      router.back();
      return;
    }

    // Resume or recover persisted draft belonging to the signed-in user
    const existingDraft = useActiveWorkoutStore.getState().draft;
    if (existingDraft && existingDraft.userId === userId) {
      if (existingDraft.syncStatus === 'pending_sync') {
        setLoading(false);
        router.replace('/workout/complete');
        return;
      }
      if (existingDraft.syncStatus === 'in_progress') {
        setLoading(false);
        return;
      }
    }

    // 1. Fetch active routine
    const { data: routines, error: rErr } = await supabase
      .from('routines')
      .select('*, routine_days(*, routine_exercises(*, exercises(*)))')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1);

    if (rErr || !routines || routines.length === 0) {
      Alert.alert('No Active Routine', 'Please create and activate a routine first!');
      setLoading(false);
      router.back();
      return;
    }

    const routine = routines[0];
    const currentDayNum = routine.current_day || 1;
    const routineDay =
      routine.routine_days?.find((d: any) => d.day_number === currentDayNum) ||
      routine.routine_days?.[0];

    if (!routineDay) {
      Alert.alert('Split Day Missing', 'Could not find exercises for the active routine day.');
      setLoading(false);
      router.back();
      return;
    }

    const rawExercises = routineDay.routine_exercises || [];
    rawExercises.sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));

    const exerciseIds = rawExercises
      .map((re: any) => re.exercise_id || re.exercises?.id)
      .filter(Boolean);

    const exerciseHistoryMap = await fetchExerciseHistoryMap(userId, exerciseIds);
    const fallbackRest = usePreferencesStore.getState().defaultRestSeconds || 90;

    const items: ActiveWorkoutExercise[] = rawExercises.map((re: any) => {
      const exObj = re.exercises || {};
      const exId = exObj.id || re.exercise_id;
      const isBw = exObj.is_bodyweight_only || false;
      const plannedSetsCount = re.planned_sets || 3;
      const history = exerciseHistoryMap[exId];
      const prescribedMaxReps = re.target_rep_max ?? re.target_reps ?? null;
      const prescribedMinReps = re.target_rep_min ?? re.target_reps ?? null;

      let baseWeight: string;
      let baseReps: string;
      let exPrevPerfSummary: string = '—';

      if (
        history &&
        (history.nextTargetWeight !== null ||
          history.nextTargetReps !== null ||
          history.completedSets.length > 0)
      ) {
        const firstSet = history.completedSets[0];
        const lastSet = history.completedSets[history.completedSets.length - 1];

        if (isBw) {
          baseWeight = '0';
          baseReps =
            history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : lastSet?.reps?.toString() ||
                firstSet?.reps?.toString() ||
                prescribedMaxReps?.toString() ||
                '10';
          exPrevPerfSummary =
            lastSet?.reps !== undefined && lastSet?.reps !== null
              ? `BW × ${lastSet.reps}`
              : firstSet?.reps !== undefined && firstSet?.reps !== null
              ? `BW × ${firstSet.reps}`
              : '—';
        } else {
          const resolvedWeight =
            history.nextTargetWeight !== null
              ? history.nextTargetWeight
              : history.lastCompletedWeight ?? history.maxCompletedWeight ?? firstSet?.weight;

          if (resolvedWeight !== null && resolvedWeight !== undefined) {
            baseWeight = resolvedWeight.toString();
          } else {
            baseWeight = re.target_weight ? re.target_weight.toString() : '135';
          }

          baseReps =
            history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : lastSet?.reps?.toString() ||
                firstSet?.reps?.toString() ||
                prescribedMaxReps?.toString() ||
                '10';

          if (lastSet && lastSet.weight !== null && lastSet.reps !== null) {
            exPrevPerfSummary = `${lastSet.weight} lbs × ${lastSet.reps}`;
          } else if (firstSet && firstSet.weight !== null && firstSet.reps !== null) {
            exPrevPerfSummary = `${firstSet.weight} lbs × ${firstSet.reps}`;
          } else if (re.target_weight) {
            exPrevPerfSummary = `${re.target_weight} lbs × ${prescribedMaxReps || 10}`;
          }
        }
      } else {
        if (isBw) {
          baseWeight = '0';
          baseReps = prescribedMaxReps ? prescribedMaxReps.toString() : '10';
          exPrevPerfSummary = '—';
        } else {
          baseWeight = re.target_weight ? re.target_weight.toString() : '135';
          baseReps = prescribedMaxReps ? prescribedMaxReps.toString() : '10';
          exPrevPerfSummary = re.target_weight
            ? `${re.target_weight} lbs × ${prescribedMaxReps || 10}`
            : '—';
        }
      }

      const initialSets: ActiveWorkoutSet[] = [];
      for (let i = 1; i <= plannedSetsCount; i++) {
        const prevSetData = history?.completedSets?.[i - 1];
        const setWeight = baseWeight;
        let setReps = baseReps;
        let setPrevPerf = exPrevPerfSummary;

        if (prevSetData) {
          if (isBw) {
            if (prevSetData.reps !== null && prevSetData.reps !== undefined) {
              setReps = prevSetData.reps.toString();
              setPrevPerf = `BW × ${prevSetData.reps}`;
            }
          } else {
            if (prevSetData.reps !== null && prevSetData.reps !== undefined) {
              setReps = prevSetData.reps.toString();
            }
            if (
              prevSetData.weight !== null &&
              prevSetData.weight !== undefined &&
              prevSetData.reps !== null &&
              prevSetData.reps !== undefined
            ) {
              setPrevPerf = `${prevSetData.weight} lbs × ${prevSetData.reps}`;
            }
          }
        }

        initialSets.push({
          set_number: i,
          weight: setWeight,
          reps: setReps,
          prev_performance: setPrevPerf,
          is_completed: false,
          set_type: 'normal',
          rir: null,
        });
      }

      return {
        routine_exercise_id: re.id,
        exercise_id: exId,
        name: exObj.name || 'Exercise',
        default_rest_timer_seconds: exObj.default_rest_timer_seconds || fallbackRest,
        is_bodyweight_only: isBw,
        prev_performance: exPrevPerfSummary,
        next_target_weight: baseWeight,
        is_target_weight_manually_edited: false,
        next_target_reps: baseReps,
        is_target_reps_manually_edited: false,
        target_rep_min: prescribedMinReps,
        target_rep_max: prescribedMaxReps,
        is_swapped: false,
        superset_id: re.superset_id || null,
        superset_order: re.superset_order || 1,
        sets: initialSets,
      };
    });

    initializeDraft({
      userId,
      routineId: routine.id,
      routineName: routine.name || 'Routine',
      routineDayId: routineDay.id || null,
      dayNumber: currentDayNum,
      dayName: routineDay.name || `Day ${currentDayNum}`,
      cycleNumber: routine.current_cycle || 1,
      daysInSplit: routine.days_in_split || 3,
      cyclesPerRoutine: routine.cycles_per_routine || 4,
      startedAtTimestamp: Date.now(),
      durationSeconds: 0,
      workoutExercises: items,
      restTimerEndTimestamp: null,
      restTimerTotalSeconds: null,
      restTimerLabel: null,
      syncStatus: 'in_progress',
      savedSessionId: null,
    });

    setLoading(false);
  };

  // Toggle Set Complete & Trigger Smart Rest / Superset Transition Breather Timer
  const handleToggleSetComplete = (exIdx: number, setIdx: number) => {
    const targetEx = workoutExercises[exIdx];
    if (!targetEx || !targetEx.sets[setIdx]) return;

    const willBeCompleted = !targetEx.sets[setIdx].is_completed;
    let durationToSet: number | null = null;
    let timerLabelToSet: string = 'Rest Timer';
    let cancelTimer = false;
    const fallbackRest = defaultRestSeconds || 90;

    if (willBeCompleted) {
      if (targetEx.superset_id && hapticsEnabled) {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }

      if (targetEx.superset_id) {
        const supersetGroup = workoutExercises.filter((e) => e.superset_id === targetEx.superset_id);
        const isRoundComplete =
          supersetGroup.length > 0 &&
          supersetGroup.every((e) =>
            e === targetEx ? true : Boolean(e.sets[setIdx]?.is_completed)
          );

        if (isRoundComplete) {
          durationToSet = Math.max(
            ...supersetGroup.map((e) => e.default_rest_timer_seconds || fallbackRest)
          );
          timerLabelToSet = 'Rest Timer';
        } else if (supersetTransitionSeconds > 0) {
          durationToSet = supersetTransitionSeconds;
          timerLabelToSet = 'Transition • Next Lift';
        } else {
          cancelTimer = true;
        }
      } else {
        durationToSet = targetEx.default_rest_timer_seconds || fallbackRest;
        timerLabelToSet = 'Rest Timer';
      }
    }

    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const nextSets = ex.sets.map((s, si) =>
          si === setIdx ? { ...s, is_completed: willBeCompleted } : s
        );

        let nextTargetWeight = ex.next_target_weight;
        if (!ex.is_bodyweight_only && !ex.is_target_weight_manually_edited) {
          const completedWeights = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseFloat(s.weight))
            .filter((w) => !isNaN(w) && w > 0);
          if (completedWeights.length > 0) {
            nextTargetWeight = Math.max(...completedWeights).toString();
          }
        }

        let nextTargetReps = ex.next_target_reps || '';
        if (ex.is_bodyweight_only && !ex.is_target_reps_manually_edited) {
          const completedReps = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseInt(s.reps, 10))
            .filter((r) => !isNaN(r) && r > 0);
          if (completedReps.length > 0) {
            nextTargetReps = Math.max(...completedReps).toString();
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_weight: nextTargetWeight,
          next_target_reps: nextTargetReps,
        };
      });
    });

    if (durationToSet !== null) {
      setRestTimer(Date.now() + durationToSet * 1000, durationToSet, timerLabelToSet);
    } else if (cancelTimer) {
      setRestTimer(null, null, null);
    }
  };

  // Guardrail #1: Auto-clone from the first working set (never overwrite working sets from warmup edits)
  const handleChangeWeight = (exIdx: number, setIdx: number, val: string) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const editedType = ex.sets[setIdx]?.set_type || 'normal';
        const isEditingWarmup = editedType === 'warmup';
        const firstWorkingIdx = ex.sets.findIndex((s) => (s.set_type || 'normal') !== 'warmup');
        const shouldCloneDown =
          !isEditingWarmup && firstWorkingIdx !== -1 && setIdx === firstWorkingIdx;

        const nextSets = ex.sets.map((s, si) => {
          if (si === setIdx) {
            return { ...s, weight: val };
          }
          if (
            shouldCloneDown &&
            si > firstWorkingIdx &&
            !s.is_completed &&
            (s.set_type || 'normal') !== 'warmup'
          ) {
            return { ...s, weight: val };
          }
          return s;
        });

        let nextTarget = ex.next_target_weight;
        if (!ex.is_bodyweight_only && !ex.is_target_weight_manually_edited && !isEditingWarmup) {
          const completedWeights = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseFloat(s.weight))
            .filter((w) => !isNaN(w) && w > 0);
          if (completedWeights.length > 0) {
            nextTarget = Math.max(...completedWeights).toString();
          } else if (shouldCloneDown) {
            nextTarget = val;
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_weight: nextTarget,
        };
      });
    });
  };

  const handleChangeReps = (exIdx: number, setIdx: number, val: string) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const editedType = ex.sets[setIdx]?.set_type || 'normal';
        const isEditingWarmup = editedType === 'warmup';
        const firstWorkingIdx = ex.sets.findIndex((s) => (s.set_type || 'normal') !== 'warmup');
        const shouldCloneDown =
          !isEditingWarmup && firstWorkingIdx !== -1 && setIdx === firstWorkingIdx;

        const nextSets = ex.sets.map((s, si) => {
          if (si === setIdx) {
            return { ...s, reps: val };
          }
          if (
            shouldCloneDown &&
            si > firstWorkingIdx &&
            !s.is_completed &&
            (s.set_type || 'normal') !== 'warmup'
          ) {
            return { ...s, reps: val };
          }
          return s;
        });

        let nextTargetReps = ex.next_target_reps || '';
        if (ex.is_bodyweight_only && !ex.is_target_reps_manually_edited && !isEditingWarmup) {
          const completedReps = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseInt(s.reps, 10))
            .filter((r) => !isNaN(r) && r > 0);
          if (completedReps.length > 0) {
            nextTargetReps = Math.max(...completedReps).toString();
          } else if (shouldCloneDown) {
            nextTargetReps = val;
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_reps: nextTargetReps,
        };
      });
    });
  };

  const handleCycleSetType = (exIdx: number, setIdx: number) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const nextSets = ex.sets.map((s, si) =>
          si === setIdx ? { ...s, set_type: cycleSetTypeValue(s.set_type) } : s
        );

        let nextTargetWeight = ex.next_target_weight;
        if (!ex.is_bodyweight_only && !ex.is_target_weight_manually_edited) {
          const completedWeights = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseFloat(s.weight))
            .filter((w) => !isNaN(w) && w > 0);
          if (completedWeights.length > 0) {
            nextTargetWeight = Math.max(...completedWeights).toString();
          }
        }

        let nextTargetReps = ex.next_target_reps || '';
        if (ex.is_bodyweight_only && !ex.is_target_reps_manually_edited) {
          const completedReps = nextSets
            .filter((s) => isWorkingCompletedSet(s))
            .map((s) => parseInt(s.reps, 10))
            .filter((r) => !isNaN(r) && r > 0);
          if (completedReps.length > 0) {
            nextTargetReps = Math.max(...completedReps).toString();
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_weight: nextTargetWeight,
          next_target_reps: nextTargetReps,
        };
      });
    });
  };

  const handleCycleRir = (exIdx: number, setIdx: number) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, si) =>
            si === setIdx ? { ...s, rir: cycleRirValue(s.rir) } : s
          ),
        };
      });
    });
  };

  const handleChangeNextTarget = (exIdx: number, val: string) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          next_target_weight: val,
          is_target_weight_manually_edited: true,
        };
      });
    });
  };

  const handleChangeNextTargetReps = (exIdx: number, val: string) => {
    const cleanVal = val.replace(/[^0-9]/g, '');
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          next_target_reps: cleanVal,
          is_target_reps_manually_edited: true,
        };
      });
    });
  };

  // Add extra set to exercise
  const handleAddSet = (exIdx: number) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const currentSets = ex.sets;
        const lastWorkingSet =
          [...currentSets].reverse().find((s) => (s.set_type || 'normal') !== 'warmup') ||
          currentSets[currentSets.length - 1];
        const newSetNumber = currentSets.length + 1;

        return {
          ...ex,
          sets: [
            ...currentSets,
            {
              set_number: newSetNumber,
              weight: lastWorkingSet ? lastWorkingSet.weight : ex.is_bodyweight_only ? '0' : '135',
              reps: lastWorkingSet ? lastWorkingSet.reps : '10',
              prev_performance: ex.prev_performance || '—',
              is_completed: false,
              set_type: 'normal',
              rir: null,
            },
          ],
        };
      });
    });
  };

  // Delete trailing uncompleted set on standalone cards (when >1 set)
  const handleRemoveTrailingSet = (exIdx: number) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx || ex.sets.length <= 1) return ex;
        const lastSet = ex.sets[ex.sets.length - 1];
        if (lastSet.is_completed) return ex;
        return {
          ...ex,
          sets: ex.sets.slice(0, -1),
        };
      });
    });
  };

  // Add round to all exercises in a superset
  const handleAddSupersetRound = (supersetId: string) => {
    updateWorkoutExercises((prev) => {
      return prev.map((ex) => {
        if (ex.superset_id !== supersetId) return ex;
        const currentSets = ex.sets;
        const lastWorkingSet =
          [...currentSets].reverse().find((s) => (s.set_type || 'normal') !== 'warmup') ||
          currentSets[currentSets.length - 1];
        const newSetNumber = currentSets.length + 1;

        return {
          ...ex,
          sets: [
            ...currentSets,
            {
              set_number: newSetNumber,
              weight: lastWorkingSet ? lastWorkingSet.weight : ex.is_bodyweight_only ? '0' : '135',
              reps: lastWorkingSet ? lastWorkingSet.reps : '10',
              prev_performance: ex.prev_performance || '—',
              is_completed: false,
              set_type: 'normal',
              rir: null,
            },
          ],
        };
      });
    });
  };

  // Delete trailing uncompleted round across a superset card (when >1 round)
  const handleRemoveTrailingSupersetRound = (supersetId: string) => {
    updateWorkoutExercises((prev) => {
      const group = prev.filter((ex) => ex.superset_id === supersetId);
      const maxRounds = Math.max(...group.map((ex) => ex.sets.length), 1);
      if (maxRounds <= 1) return prev;

      const trailingRoundCompleted = group.some((ex) => Boolean(ex.sets[maxRounds - 1]?.is_completed));
      if (trailingRoundCompleted) return prev;

      return prev.map((ex) => {
        if (ex.superset_id !== supersetId || ex.sets.length < maxRounds) return ex;
        return {
          ...ex,
          sets: ex.sets.slice(0, maxRounds - 1),
        };
      });
    });
  };

  // Open Crowded-Gym Swap Exercise Modal
  const handleOpenSwapModal = (exIdx: number) => {
    setSwapTargetIndex(exIdx);
    setSwapSearch('');
    if (catalogExercises.length === 0) {
      refreshCatalog();
    }
  };

  // Swap exercise in place while keeping superset_id / superset_order & loading history for new lift
  const handleConfirmSwapExercise = async (newEx: Exercise) => {
    if (swapTargetIndex === null || swapping) return;
    setSwapping(true);

    try {
      const userId = draft?.userId || '';
      const historyMap = await fetchExerciseHistoryMap(userId, [newEx.id]);
      const history = historyMap[newEx.id];
      const fallbackRest = defaultRestSeconds || 90;
      const isBw = Boolean(newEx.is_bodyweight_only);

      updateWorkoutExercises((prev) => {
        return prev.map((oldEx, idx) => {
          if (idx !== swapTargetIndex) return oldEx;

          const firstSet = history?.completedSets?.[0];
          const lastSet = history?.completedSets?.[history.completedSets.length - 1];
          const prescribedReps = oldEx.target_rep_max ?? oldEx.target_rep_min ?? 10;

          let baseWeight = isBw ? '0' : '135';
          let baseReps = String(prescribedReps);
          let summary = '—';

          if (history) {
            if (isBw) {
              baseReps =
                history.nextTargetReps !== null
                  ? String(history.nextTargetReps)
                  : lastSet?.reps !== null && lastSet?.reps !== undefined
                  ? String(lastSet.reps)
                  : firstSet?.reps !== null && firstSet?.reps !== undefined
                  ? String(firstSet.reps)
                  : String(prescribedReps);
              summary =
                lastSet?.reps !== null && lastSet?.reps !== undefined
                  ? `BW × ${lastSet.reps}`
                  : '—';
            } else {
              const resolvedW =
                history.nextTargetWeight !== null
                  ? history.nextTargetWeight
                  : history.lastCompletedWeight ?? history.maxCompletedWeight ?? firstSet?.weight;
              baseWeight = resolvedW !== null && resolvedW !== undefined ? String(resolvedW) : '135';
              baseReps =
                history.nextTargetReps !== null
                  ? String(history.nextTargetReps)
                  : lastSet?.reps !== null && lastSet?.reps !== undefined
                  ? String(lastSet.reps)
                  : String(prescribedReps);
              if (lastSet && lastSet.weight !== null && lastSet.reps !== null) {
                summary = `${lastSet.weight} lbs × ${lastSet.reps}`;
              }
            }
          }

          const newSets: ActiveWorkoutSet[] = oldEx.sets.map((s, sIdx) => {
            const histSet = history?.completedSets?.[sIdx];
            const setPrev = histSet
              ? isBw
                ? histSet.reps !== null
                  ? `BW × ${histSet.reps}`
                  : summary
                : histSet.weight !== null && histSet.reps !== null
                ? `${histSet.weight} lbs × ${histSet.reps}`
                : summary
              : summary;

            return {
              set_number: s.set_number,
              weight: baseWeight,
              reps: histSet?.reps !== null && histSet?.reps !== undefined ? String(histSet.reps) : baseReps,
              prev_performance: setPrev,
              is_completed: false,
              set_type: s.set_type || 'normal',
              rir: null,
            };
          });

          return {
            ...oldEx,
            routine_exercise_id: '', // Do not overwrite original routine template on finish
            is_swapped: true,
            exercise_id: newEx.id,
            name: newEx.name,
            default_rest_timer_seconds: newEx.default_rest_timer_seconds || fallbackRest,
            is_bodyweight_only: isBw,
            prev_performance: summary,
            next_target_weight: baseWeight,
            is_target_weight_manually_edited: false,
            next_target_reps: baseReps,
            is_target_reps_manually_edited: false,
            sets: newSets,
          };
        });
      });

      setSwapTargetIndex(null);
      setSwapSearch('');
    } finally {
      setSwapping(false);
    }
  };

  // Finish Workout Action (transitions Zustand draft to pending_sync and hands off without URL JSON params)
  const handleFinishWorkout = () => {
    const completedCount = workoutExercises.reduce(
      (acc, ex) => acc + ex.sets.filter((s) => s.is_completed).length,
      0
    );

    if (completedCount === 0) {
      if (Platform.OS === 'web') {
        window.alert('No Sets Logged: Please complete at least 1 set before finishing.');
      } else {
        Alert.alert('No Sets Logged', 'Please complete at least 1 set before finishing.');
      }
      return;
    }

    const durationSeconds = Math.max(Math.round((Date.now() - startedAtTimestamp) / 1000), 60);
    markPendingSync(durationSeconds);
    router.replace('/workout/complete');
  };

  if (loading || !hasHydrated) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-slate-400 mt-4 font-medium">Loading Gym Floor Logger...</Text>
      </View>
    );
  }

  // Format timer text
  const formatTimer = (secs: number | null) => {
    if (secs === null) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleCloseWorkout = () => {
    const exitWorkout = () => {
      clearActiveWorkout();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Discard Workout? Are you sure you want to exit without saving?')) {
        exitWorkout();
      }
    } else {
      Alert.alert(
        'Discard Workout?',
        'Are you sure you want to exit without saving?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: exitWorkout }
        ]
      );
    }
  };

  let liveTonnage = 0;
  let liveCompletedSets = 0;
  let liveTotalSets = 0;

  workoutExercises.forEach((ex) => {
    ex.sets.forEach((st) => {
      if ((st.set_type || 'normal') !== 'warmup') {
        liveTotalSets++;
      }
      if (isWorkingCompletedSet(st)) {
        liveCompletedSets++;
        liveTonnage += (parseFloat(st.weight) || 0) * (parseInt(st.reps, 10) || 0);
      }
    });
  });

  const elapsedSecs = Math.max(Math.round((Date.now() - startedAtTimestamp) / 1000), 1);
  const elapsedMins = Math.max(Math.round(elapsedSecs / 60), 1);
  const liveDensity = elapsedMins > 0 ? Math.round(liveTonnage / elapsedMins) : 0;
  const isTransitionTimer = restTimerLabel === 'Transition • Next Lift';
  const swapTargetExercise = swapTargetIndex !== null ? workoutExercises[swapTargetIndex] : null;

  return (
    <View className="flex-1 bg-slate-950">
      {/* Top Navigation Header */}
      <View 
        style={{ paddingTop: Math.max(insets.top, 16) + 8 }}
        className="px-6 pb-3 bg-slate-900 border-b border-slate-800 flex-row justify-between items-center"
      >
        <View className="flex-1 mr-3">
          <View className="flex-row items-center flex-wrap gap-2 mb-0.5">
            <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest">
              Best Damn Workout Tracker Ever
            </Text>
            <View className="bg-indigo-500/20 px-2 py-0.5 rounded-md border border-indigo-500/30">
              <Text className="text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
                Cycle {cycleNumber}/{cyclesPerRoutine} • Target {targetCycleRIR} RIR
              </Text>
            </View>
          </View>
          <Text className="text-slate-400 font-semibold text-xs uppercase tracking-wider">
            {routineName} • Day {dayNumber}
          </Text>
          <Text className="text-white text-2xl font-bold">{activeDayName}</Text>
        </View>
        <TouchableOpacity 
          onPress={handleCloseWorkout}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          activeOpacity={0.7}
          className="w-11 h-11 bg-slate-800 rounded-full items-center justify-center border border-slate-700"
        >
          <X color="#94a3b8" size={22} />
        </TouchableOpacity>
      </View>

      {/* Live Gym-Floor Real-Time Dashboard Bar */}
      <View className="bg-slate-900/95 px-4 py-2.5 border-b border-slate-800/90 flex-row justify-between items-center">
        <View className="flex-row items-center">
          <Flame color="#f97316" size={16} className="mr-1" />
          <Text className="text-white font-black text-xs">
            {Math.round(liveTonnage).toLocaleString()} <Text className="text-slate-400 font-normal">lbs</Text>
          </Text>
        </View>

        <View className="flex-row items-center">
          <Dumbbell color="#60a5fa" size={14} className="mr-1" />
          <Text className="text-white font-black text-xs">
            {liveCompletedSets}/{liveTotalSets} <Text className="text-slate-400 font-normal">sets</Text>
          </Text>
        </View>

        <View className="flex-row items-center">
          <Zap color="#34d399" size={14} className="mr-1" />
          <Text className="text-white font-black text-xs">
            {liveDensity} <Text className="text-slate-400 font-normal">lbs/m</Text>
          </Text>
        </View>
      </View>

      {/* Main Exercise Set Logger */}
      <ScrollView className="flex-1 px-4 pt-4">
        {(() => {
          const supersetLetterMap: Record<string, string> = {};
          let letterCode = 65; // 'A'

          workoutExercises.forEach((ex) => {
            if (ex.superset_id && !supersetLetterMap[ex.superset_id]) {
              supersetLetterMap[ex.superset_id] = String.fromCharCode(letterCode++);
            }
          });

          const processedSupersets = new Set<string>();
          const elements: any[] = [];

          for (let i = 0; i < workoutExercises.length; i++) {
            const ex = workoutExercises[i];

            if (!ex.superset_id) {
              const exIdx = i;
              let topSetE1RM = 0;
              ex.sets.forEach((st) => {
                if (isWorkingCompletedSet(st)) {
                  const e1rm = calculateEstimated1RM(parseFloat(st.weight) || 0, parseInt(st.reps, 10) || 0);
                  if (e1rm > topSetE1RM) topSetE1RM = e1rm;
                }
              });

              const repRangeLabel = formatRepRange(ex.target_rep_min, ex.target_rep_max);
              const canRemoveSet =
                ex.sets.length > 1 && !ex.sets[ex.sets.length - 1].is_completed;

              elements.push(
                <View key={ex.routine_exercise_id || `standalone_${exIdx}`} className="bg-slate-900 p-4 rounded-3xl border border-slate-800 mb-6">
                  <View className="flex-row justify-between items-start mb-3">
                    <View className="flex-row items-center flex-1 mr-2">
                      <View className="w-9 h-9 bg-blue-600/20 rounded-xl items-center justify-center mr-3 border border-blue-500/30">
                        <Dumbbell color="#60a5fa" size={18} />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center flex-wrap gap-1.5">
                          <Text className="text-white font-bold text-lg">{ex.name}</Text>
                          {ex.is_swapped && (
                            <View className="bg-cyan-500/20 px-1.5 py-0.5 rounded border border-cyan-500/40">
                              <Text className="text-cyan-300 text-[9px] font-bold uppercase">Swapped</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-slate-400 text-xs">
                          {ex.is_bodyweight_only ? 'Bodyweight' : 'Weighted'} • {ex.default_rest_timer_seconds}s Rest
                          {repRangeLabel ? ` • Target ${repRangeLabel}` : ''}
                        </Text>
                      </View>
                    </View>

                    <View className="items-end gap-1.5">
                      <TouchableOpacity
                        onPress={() => handleOpenSwapModal(exIdx)}
                        activeOpacity={0.7}
                        className="bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-700 flex-row items-center"
                      >
                        <RefreshCw color="#94a3b8" size={12} className="mr-1" />
                        <Text className="text-slate-300 text-[11px] font-bold">Swap</Text>
                      </TouchableOpacity>
                      {topSetE1RM > 0 && !ex.is_bodyweight_only && (
                        <View className="bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">
                          <Text className="text-purple-300 text-[10px] font-black">
                            1RM ~{Math.round(topSetE1RM)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Set Table Column Headers */}
                  <View className="flex-row items-center py-2 px-2.5 mb-1">
                    <Text className="w-8 text-slate-500 text-xs font-bold text-center">SET</Text>
                    <Text className="w-16 text-slate-500 text-xs font-bold px-1">PREV</Text>
                    <Text className="flex-1 text-slate-500 text-xs font-bold text-center">
                      {ex.is_bodyweight_only ? 'LOAD' : 'LBS'}
                    </Text>
                    <Text className="flex-1 text-slate-500 text-xs font-bold text-center">REPS</Text>
                    <Text className="w-11 text-slate-500 text-xs font-bold text-center">RIR</Text>
                    <Text className="w-10 text-slate-500 text-xs font-bold text-right">DONE</Text>
                  </View>

                  {/* Set Rows */}
                  {ex.sets.map((setData, setIdx) => (
                    <SetRow
                      key={setData.set_number}
                      setIndex={setData.set_number}
                      setType={setData.set_type || 'normal'}
                      rir={setData.rir ?? null}
                      isBodyweightOnly={ex.is_bodyweight_only}
                      weight={setData.weight}
                      reps={setData.reps}
                      prevPerformance={setData.prev_performance || ex.prev_performance}
                      isCompleted={setData.is_completed}
                      onToggleComplete={() => handleToggleSetComplete(exIdx, setIdx)}
                      onChangeWeight={(v) => handleChangeWeight(exIdx, setIdx, v)}
                      onChangeReps={(v) => handleChangeReps(exIdx, setIdx, v)}
                      onCycleSetType={() => handleCycleSetType(exIdx, setIdx)}
                      onCycleRir={() => handleCycleRir(exIdx, setIdx)}
                    />
                  ))}

                  {/* Add / Remove Trailing Uncompleted Set Row */}
                  <View className="flex-row gap-2 mt-2">
                    <TouchableOpacity 
                      onPress={() => handleAddSet(exIdx)}
                      className="flex-1 py-2.5 items-center justify-center bg-slate-800/60 rounded-xl border border-slate-700/50 flex-row"
                    >
                      <Plus color="#94a3b8" size={16} className="mr-1" />
                      <Text className="text-slate-300 font-semibold text-sm">Add Set</Text>
                    </TouchableOpacity>
                    {canRemoveSet && (
                      <TouchableOpacity
                        onPress={() => handleRemoveTrailingSet(exIdx)}
                        className="px-4 py-2.5 items-center justify-center bg-slate-800/60 rounded-xl border border-rose-500/30 flex-row"
                      >
                        <Minus color="#fb7185" size={15} className="mr-1" />
                        <Text className="text-rose-300 font-semibold text-sm">Remove Set</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Fresh Memory Overload Target Input */}
                  <View className="mt-4 pt-3 border-t border-slate-800 flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <Sparkles color="#a78bfa" size={16} className="mr-2" />
                      <Text className="text-purple-300 text-xs font-semibold">
                        {ex.is_bodyweight_only ? 'Next Target Reps' : 'Next Target Weight'}
                      </Text>
                    </View>
                    {ex.is_bodyweight_only ? (
                      <View className="flex-row items-center bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                        <TextInput
                          className="text-white font-bold text-sm w-16 text-center"
                          style={{ textAlignVertical: 'center', includeFontPadding: false }}
                          keyboardType="numeric"
                          value={ex.next_target_reps || ''}
                          onChangeText={(v) => handleChangeNextTargetReps(exIdx, v)}
                          selectTextOnFocus
                        />
                        <Text className="text-slate-400 text-xs font-medium ml-1">reps</Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                        <TextInput
                          className="text-white font-bold text-sm w-16 text-center"
                          style={{ textAlignVertical: 'center', includeFontPadding: false }}
                          keyboardType="numeric"
                          value={ex.next_target_weight}
                          onChangeText={(v) => handleChangeNextTarget(exIdx, v)}
                          selectTextOnFocus
                        />
                        <Text className="text-slate-400 text-xs font-medium ml-1">lbs</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            } else if (!processedSupersets.has(ex.superset_id)) {
              processedSupersets.add(ex.superset_id);
              const sId = ex.superset_id;
              const letter = supersetLetterMap[sId] || 'A';
              const groupItems = workoutExercises
                .map((e, idx) => ({ ex: e, originalIndex: idx }))
                .filter((item) => item.ex.superset_id === sId)
                .sort((a, b) => (a.ex.superset_order || 1) - (b.ex.superset_order || 1));

              const maxRounds = Math.max(...groupItems.map((item) => item.ex.sets.length), 1);
              const roundRestDuration = Math.max(
                ...groupItems.map((item) => item.ex.default_rest_timer_seconds || 90)
              );
              const canRemoveTrailingRound =
                maxRounds > 1 &&
                !groupItems.some((item) => Boolean(item.ex.sets[maxRounds - 1]?.is_completed));

              elements.push(
                <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-6">
                  {/* Superset Header Banner */}
                  <View className="mb-4 pb-3 border-b border-indigo-500/30">
                    <View className="flex-row justify-between items-center mb-2">
                      <View className="flex-row items-center">
                        <View className="bg-indigo-600 px-3 py-1 rounded-xl mr-2 flex-row items-center">
                          <Layers color="white" size={14} className="mr-1.5" />
                          <Text className="text-white font-extrabold text-xs tracking-wider">SUPERSET {letter}</Text>
                        </View>
                        <View className="bg-indigo-500/20 px-2 py-0.5 rounded-lg border border-indigo-500/30">
                          <Text className="text-indigo-300 text-[10px] font-bold">
                            {groupItems.length} Exercises • {maxRounds} Rounds
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row items-center">
                        <Timer color="#a78bfa" size={13} className="mr-1" />
                        <Text className="text-indigo-300 text-xs font-semibold">{roundRestDuration}s Rest</Text>
                      </View>
                    </View>

                    {/* Per-Slot Rep Targets & Swap Chips */}
                    <View className="gap-1.5">
                      {groupItems.map((g, idx) => {
                        const tag = `${letter}${g.ex.superset_order || idx + 1}`;
                        const slotRange = formatRepRange(g.ex.target_rep_min, g.ex.target_rep_max);
                        return (
                          <View
                            key={`slot_hdr_${g.originalIndex}`}
                            className="flex-row items-center justify-between bg-slate-900/70 px-2.5 py-1.5 rounded-xl border border-indigo-500/20"
                          >
                            <View className="flex-row items-center flex-1 mr-2">
                              <View className="bg-indigo-500/30 px-1.5 py-0.5 rounded mr-1.5">
                                <Text className="text-indigo-200 font-mono font-bold text-[10px]">{tag}</Text>
                              </View>
                              <Text className="text-slate-200 text-xs font-semibold flex-1" numberOfLines={1}>
                                {g.ex.name}
                              </Text>
                              {slotRange && (
                                <Text className="text-indigo-300/80 text-[10px] font-medium ml-1.5">
                                  {slotRange}
                                </Text>
                              )}
                            </View>
                            <TouchableOpacity
                              onPress={() => handleOpenSwapModal(g.originalIndex)}
                              activeOpacity={0.7}
                              className="bg-slate-800 px-2 py-1 rounded-lg border border-slate-700 flex-row items-center"
                            >
                              <RefreshCw color="#94a3b8" size={11} className="mr-1" />
                              <Text className="text-slate-300 text-[10px] font-bold">Swap</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  {/* Superset Rounds */}
                  {Array.from({ length: maxRounds }).map((_, roundIdx) => {
                    const roundNumber = roundIdx + 1;
                    const roundExercises = groupItems.filter((item) => Boolean(item.ex.sets[roundIdx]));
                    const isRoundComplete =
                      roundExercises.length > 0 &&
                      roundExercises.every((item) => item.ex.sets[roundIdx]?.is_completed);

                    return (
                      <View
                        key={`round_${sId}_${roundNumber}`}
                        className={`p-3.5 rounded-2xl border mb-4 ${
                          isRoundComplete
                            ? 'bg-emerald-950/20 border-emerald-500/30'
                            : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        {/* Round Header Bar */}
                        <View className="flex-row justify-between items-center mb-3 pb-2 border-b border-slate-800/80">
                          <View className="flex-row items-center">
                            <View
                              className={`w-6 h-6 rounded-full items-center justify-center mr-2 ${
                                isRoundComplete ? 'bg-emerald-500/20' : 'bg-indigo-600/30'
                              }`}
                            >
                              <Text
                                className={`font-black text-xs ${
                                  isRoundComplete ? 'text-emerald-400' : 'text-indigo-300'
                                }`}
                              >
                                {roundNumber}
                              </Text>
                            </View>
                            <Text className="text-white font-extrabold text-sm tracking-wide">
                              ROUND {roundNumber}
                            </Text>
                          </View>

                          {isRoundComplete ? (
                            <View className="bg-emerald-500/20 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex-row items-center">
                              <CheckCircle2 color="#34d399" size={12} className="mr-1" />
                              <Text className="text-emerald-300 text-[11px] font-bold">Round Completed</Text>
                            </View>
                          ) : (
                            <View className="bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-700">
                              <Text className="text-slate-400 text-[11px] font-medium">In Progress</Text>
                            </View>
                          )}
                        </View>

                        {/* Column Subheaders */}
                        <View className="flex-row items-center px-1 mb-1.5">
                          <Text className="flex-1 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                            Exercise / Prev
                          </Text>
                          <Text className="w-16 text-slate-500 text-[11px] font-bold text-center uppercase tracking-wider">
                            Load
                          </Text>
                          <Text className="w-14 text-slate-500 text-[11px] font-bold text-center uppercase tracking-wider">
                            Reps
                          </Text>
                          <Text className="w-10 text-slate-500 text-[11px] font-bold text-center uppercase tracking-wider">
                            RIR
                          </Text>
                          <Text className="w-10 text-slate-500 text-[11px] font-bold text-right uppercase tracking-wider">
                            Done
                          </Text>
                        </View>

                        {/* Exercise Rows within this Round */}
                        {groupItems.map((item, subIdx) => {
                          const groupEx = item.ex;
                          const originalExIdx = item.originalIndex;
                          const setData = groupEx.sets[roundIdx];
                          if (!setData) return null;

                          const tag = `${letter}${groupEx.superset_order || subIdx + 1}`;
                          const isDone = setData.is_completed;
                          const activeSetType: SetType = setData.set_type || 'normal';
                          const typeBadgeMeta = getSetTypeBadgeMeta(activeSetType, tag);
                          const tagDisplayLabel =
                            activeSetType === 'normal' ? tag : `${typeBadgeMeta.label}•${tag}`;
                          const prevSummary = setData.prev_performance || groupEx.prev_performance || '—';

                          return (
                            <View key={`ex_${originalExIdx}_set_${roundIdx}`}>
                              <View
                                className={`py-2 px-2 rounded-xl border flex-row items-center ${
                                  isDone
                                    ? activeSetType === 'warmup'
                                      ? 'bg-amber-950/20 border-amber-500/40'
                                      : 'bg-emerald-950/30 border-emerald-500/40'
                                    : activeSetType === 'warmup'
                                    ? 'bg-slate-800/80 border-amber-500/30'
                                    : 'bg-slate-800/80 border-slate-700/60'
                                }`}
                              >
                                {/* Left Exercise Info & Tap-to-Cycle Type Tag */}
                                <View className="flex-1 mr-1.5 justify-center">
                                  <View className="flex-row items-center mb-0.5">
                                    <TouchableOpacity
                                      onPress={() => handleCycleSetType(originalExIdx, roundIdx)}
                                      activeOpacity={0.7}
                                      className={`px-1.5 py-0.5 rounded mr-1.5 ${
                                        activeSetType === 'normal'
                                          ? 'bg-indigo-500/30 border border-indigo-500/50'
                                          : typeBadgeMeta.containerClass
                                      }`}
                                    >
                                      <Text
                                        className={`font-mono font-bold text-[10px] ${
                                          activeSetType === 'normal'
                                            ? 'text-indigo-300'
                                            : typeBadgeMeta.textClass
                                        }`}
                                      >
                                        {tagDisplayLabel}
                                      </Text>
                                    </TouchableOpacity>
                                    <Text className="text-white font-bold text-xs flex-1" numberOfLines={1}>
                                      {groupEx.name}
                                    </Text>
                                  </View>
                                  <Text className="text-slate-400 text-[11px] pl-0.5" numberOfLines={1}>
                                    {prevSummary}
                                  </Text>
                                </View>

                                {/* Weight Input */}
                                <View className="w-16 px-0.5 justify-center">
                                  {groupEx.is_bodyweight_only ? (
                                    <View className="h-10 rounded-xl bg-slate-900/60 border border-slate-700 items-center justify-center">
                                      <Text className="text-slate-300 font-bold text-xs">BW</Text>
                                    </View>
                                  ) : (
                                    <TextInput
                                      className={`h-10 rounded-xl px-1 py-0 text-center font-bold text-sm border ${
                                        isDone
                                          ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
                                          : 'bg-slate-900 text-white border-slate-700'
                                      }`}
                                      style={{ textAlignVertical: 'center', includeFontPadding: false }}
                                      keyboardType="numeric"
                                      placeholder="lbs"
                                      placeholderTextColor="#475569"
                                      value={setData.weight}
                                      onChangeText={(v) => handleChangeWeight(originalExIdx, roundIdx, v)}
                                      editable={!isDone}
                                      selectTextOnFocus
                                    />
                                  )}
                                </View>

                                {/* Reps Input */}
                                <View className="w-14 px-0.5 justify-center">
                                  <TextInput
                                    className={`h-10 rounded-xl px-1 py-0 text-center font-bold text-sm border ${
                                      isDone
                                        ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
                                        : 'bg-slate-900 text-white border-slate-700'
                                    }`}
                                    style={{ textAlignVertical: 'center', includeFontPadding: false }}
                                    keyboardType="numeric"
                                    placeholder="reps"
                                    placeholderTextColor="#475569"
                                    value={setData.reps}
                                    onChangeText={(v) => handleChangeReps(originalExIdx, roundIdx, v)}
                                    editable={!isDone}
                                    selectTextOnFocus
                                  />
                                </View>

                                {/* Tap-to-Cycle RIR Pill */}
                                <View className="w-10 px-0.5 justify-center items-center">
                                  <TouchableOpacity
                                    onPress={() => handleCycleRir(originalExIdx, roundIdx)}
                                    activeOpacity={0.7}
                                    className={`h-10 w-full rounded-xl items-center justify-center border ${
                                      setData.rir !== null && setData.rir !== undefined
                                        ? 'bg-indigo-500/20 border-indigo-500/40'
                                        : 'bg-slate-900 border-slate-700'
                                    }`}
                                  >
                                    <Text
                                      className={`font-bold text-xs ${
                                        setData.rir !== null && setData.rir !== undefined
                                          ? 'text-indigo-200'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {formatRirLabel(setData.rir)}
                                    </Text>
                                  </TouchableOpacity>
                                </View>

                                {/* Done Toggle Button */}
                                <View className="w-10 items-end justify-center pl-0.5">
                                  <TouchableOpacity
                                    onPress={() => handleToggleSetComplete(originalExIdx, roundIdx)}
                                    className={`w-9 h-9 rounded-xl items-center justify-center border ${
                                      isDone
                                        ? 'bg-emerald-500 border-emerald-400'
                                        : 'bg-slate-900 border-slate-700'
                                    }`}
                                  >
                                    {isDone ? (
                                      <Check color="white" size={18} strokeWidth={3} />
                                    ) : (
                                      <View className="w-2.5 h-2.5 rounded-sm bg-slate-600" />
                                    )}
                                  </TouchableOpacity>
                                </View>
                              </View>

                              {/* Connector arrow between exercises inside the same round */}
                              {subIdx < groupItems.length - 1 && (
                                <View className="items-center my-1.5 flex-row justify-center">
                                  <View className="h-[1px] bg-indigo-500/20 flex-1 mr-2" />
                                  <View className="bg-indigo-950 px-2 py-0.5 rounded-full border border-indigo-500/30 flex-row items-center">
                                    <ArrowDown color="#818cf8" size={10} className="mr-1" />
                                    <Text className="text-indigo-300 text-[9px] font-bold uppercase tracking-wider">
                                      Superset Next
                                    </Text>
                                  </View>
                                  <View className="h-[1px] bg-indigo-500/20 flex-1 ml-2" />
                                </View>
                              )}
                            </View>
                          );
                        })}

                        {/* Round Completion / Recovery status footer */}
                        {isRoundComplete && (
                          <View className="mt-2.5 pt-2 border-t border-emerald-500/20 flex-row items-center justify-between">
                            <View className="flex-row items-center">
                              <CheckCircle2 color="#34d399" size={13} className="mr-1.5" />
                              <Text className="text-emerald-300 text-xs font-semibold">Round {roundNumber} Completed</Text>
                            </View>
                            <Text className="text-emerald-400 text-[11px] font-mono font-medium">
                              {roundRestDuration}s Recovery
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Add / Remove Trailing Uncompleted Superset Round Buttons */}
                  <View className="flex-row gap-2 mb-4">
                    <TouchableOpacity
                      onPress={() => handleAddSupersetRound(sId)}
                      className="flex-1 py-2.5 items-center justify-center bg-indigo-900/40 rounded-xl border border-indigo-500/40 flex-row"
                    >
                      <Plus color="#a78bfa" size={16} className="mr-1.5" />
                      <Text className="text-indigo-200 font-bold text-sm">Add Round to {letter}</Text>
                    </TouchableOpacity>
                    {canRemoveTrailingRound && (
                      <TouchableOpacity
                        onPress={() => handleRemoveTrailingSupersetRound(sId)}
                        className="px-4 py-2.5 items-center justify-center bg-slate-900/80 rounded-xl border border-rose-500/30 flex-row"
                      >
                        <Minus color="#fb7185" size={15} className="mr-1" />
                        <Text className="text-rose-300 font-semibold text-sm">Remove Round</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Superset Next Session Targets Section */}
                  <View className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800">
                    <View className="flex-row items-center mb-2.5">
                      <Sparkles color="#a78bfa" size={15} className="mr-1.5" />
                      <Text className="text-purple-300 text-xs font-bold uppercase tracking-wider">
                        Next Session Targets
                      </Text>
                    </View>
                    <View className="space-y-2">
                      {groupItems.map((item, subIdx) => {
                        const groupEx = item.ex;
                        const originalExIdx = item.originalIndex;
                        const tag = `${letter}${groupEx.superset_order || subIdx + 1}`;
                        return (
                          <View
                            key={`target_${originalExIdx}`}
                            className="flex-row items-center justify-between bg-slate-800/60 px-3 py-2 rounded-xl border border-slate-700/50 mb-1.5"
                          >
                            <View className="flex-row items-center flex-1 mr-2">
                              <View className="bg-indigo-500/30 px-1.5 py-0.5 rounded mr-1.5">
                                <Text className="text-indigo-300 font-mono font-bold text-[10px]">{tag}</Text>
                              </View>
                              <Text className="text-slate-200 text-xs font-semibold flex-1" numberOfLines={1}>
                                {groupEx.name}
                              </Text>
                            </View>
                            {groupEx.is_bodyweight_only ? (
                              <View className="flex-row items-center bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
                                <TextInput
                                  className="text-white font-bold text-xs w-14 text-center"
                                  style={{ textAlignVertical: 'center', includeFontPadding: false }}
                                  keyboardType="numeric"
                                  value={groupEx.next_target_reps || ''}
                                  onChangeText={(v) => handleChangeNextTargetReps(originalExIdx, v)}
                                  selectTextOnFocus
                                />
                                <Text className="text-slate-400 text-[10px] font-medium ml-1">reps</Text>
                              </View>
                            ) : (
                              <View className="flex-row items-center bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
                                <TextInput
                                  className="text-white font-bold text-xs w-14 text-center"
                                  style={{ textAlignVertical: 'center', includeFontPadding: false }}
                                  keyboardType="numeric"
                                  value={groupEx.next_target_weight}
                                  onChangeText={(v) => handleChangeNextTarget(originalExIdx, v)}
                                  selectTextOnFocus
                                />
                                <Text className="text-slate-400 text-[10px] font-medium ml-1">lbs</Text>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              );
            }
          }

          return elements;
        })()}

        {/* Finish Workout CTA Button */}
        <TouchableOpacity
          onPress={handleFinishWorkout}
          className="bg-emerald-600 p-4 rounded-2xl flex-row items-center justify-center mb-24 shadow-lg shadow-emerald-900/30"
        >
          <Check color="white" size={22} className="mr-2" />
          <Text className="text-white font-bold text-xl">Finish Workout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Floating Rest / Transition Timer Overlay Bar */}
      {timerSeconds !== null && timerSeconds > 0 && (
        <View
          className={`absolute bottom-6 left-4 right-4 bg-slate-900/95 p-4 rounded-2xl flex-row items-center justify-between shadow-2xl backdrop-blur-md border ${
            isTransitionTimer
              ? 'border-cyan-500/50 shadow-cyan-900/40'
              : 'border-indigo-500/50 shadow-indigo-900/40'
          }`}
        >
          <View className="flex-row items-center flex-1 mr-2">
            <View
              className={`w-10 h-10 rounded-xl items-center justify-center mr-3 border ${
                isTransitionTimer
                  ? 'bg-cyan-600/30 border-cyan-500/40'
                  : 'bg-indigo-600/30 border-indigo-500/40'
              }`}
            >
              <Timer color={isTransitionTimer ? '#22d3ee' : '#a78bfa'} size={20} />
            </View>
            <View className="flex-1">
              <Text
                className={`text-xs font-semibold uppercase ${
                  isTransitionTimer ? 'text-cyan-300' : 'text-slate-400'
                }`}
                numberOfLines={1}
              >
                {restTimerLabel || 'Rest Timer'}
              </Text>
              <Text className="text-white text-2xl font-bold font-mono">
                {formatTimer(timerSeconds)}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => {
                const baseEnd = restTimerEndTimestamp ?? Date.now();
                const newEnd = Math.max(Date.now(), baseEnd) + 30 * 1000;
                const newTotal = (restTimerTotalSeconds ?? timerSeconds ?? 0) + 30;
                setRestTimer(newEnd, newTotal, restTimerLabel);
              }}
              className="bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 flex-row items-center"
            >
              <Plus color={isTransitionTimer ? '#22d3ee' : '#a78bfa'} size={14} className="mr-1" />
              <Text
                className={`text-xs font-bold ${
                  isTransitionTimer ? 'text-cyan-300' : 'text-indigo-300'
                }`}
              >
                +30s
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRestTimer(null, null);
                setTimerSeconds(null);
              }}
              className="bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 flex-row items-center"
            >
              <FastForward color="#94a3b8" size={14} className="mr-1" />
              <Text className="text-slate-300 text-xs font-semibold">Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Crowded-Gym Swap Exercise Modal */}
      <Modal
        visible={swapTargetIndex !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!swapping) setSwapTargetIndex(null);
        }}
      >
        <View className="flex-1 bg-black/75 justify-end">
          <View className="bg-slate-900 rounded-t-3xl border-t border-slate-800 px-5 pt-5 pb-8 max-h-[82%]">
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 mr-3">
                <Text className="text-white text-xl font-bold">Swap Exercise</Text>
                <Text className="text-slate-400 text-xs mt-0.5" numberOfLines={1}>
                  Replacing: {swapTargetExercise?.name || 'Exercise'} (session-only)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (!swapping) setSwapTargetIndex(null);
                }}
                className="w-9 h-9 bg-slate-800 rounded-full items-center justify-center border border-slate-700"
              >
                <X color="#94a3b8" size={18} />
              </TouchableOpacity>
            </View>

            <View className="flex-row items-center bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-700 mb-3">
              <Search color="#94a3b8" size={16} className="mr-2" />
              <TextInput
                className="flex-1 text-white text-sm font-medium"
                placeholder="Search by exercise or muscle group..."
                placeholderTextColor="#64748b"
                value={swapSearch}
                onChangeText={setSwapSearch}
                autoCapitalize="none"
              />
            </View>

            {catalogLoading || swapping ? (
              <View className="py-10 items-center justify-center">
                <ActivityIndicator color="#60a5fa" size="large" />
                <Text className="text-slate-400 text-xs mt-3">
                  {swapping ? 'Loading exercise history...' : 'Loading exercise catalog...'}
                </Text>
              </View>
            ) : (
              <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
                {filteredSwapExercises.map((catEx) => {
                  const muscles = (catEx.exercise_muscle_groups || [])
                    .map((m) => m.muscle_group)
                    .join(', ');
                  return (
                    <TouchableOpacity
                      key={catEx.id}
                      onPress={() => handleConfirmSwapExercise(catEx)}
                      activeOpacity={0.7}
                      className="bg-slate-800/80 border border-slate-700/70 rounded-2xl px-4 py-3 mb-2 flex-row items-center justify-between"
                    >
                      <View className="flex-1 mr-3">
                        <Text className="text-white font-bold text-sm">{catEx.name}</Text>
                        <Text className="text-slate-400 text-xs mt-0.5">
                          {catEx.is_bodyweight_only ? 'Bodyweight' : 'Weighted'}
                          {muscles ? ` • ${muscles}` : ''}
                        </Text>
                      </View>
                      <View className="bg-blue-600/20 px-2.5 py-1 rounded-lg border border-blue-500/30">
                        <Text className="text-blue-300 text-xs font-bold">Select</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {filteredSwapExercises.length === 0 && (
                  <View className="py-8 items-center">
                    <Text className="text-slate-400 text-sm">No matching exercises found.</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
