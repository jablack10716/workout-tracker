import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_OPTIONS,
  EquipmentType,
  usePreferencesStore,
} from '../../src/store/usePreferencesStore';
import {
  MUSCLE_GROUPS,
  EquipmentFilterMode,
  isWorkingCompletedSet,
  getHypertrophyVolumeMeta,
  normalizeMuscleGroup,
  resolveExerciseEquipment,
  matchesEquipmentFilter,
  getDefaultStartingWeight,
  buildLegacyMuscleGroupRows,
} from '../../src/utils/analyticsEngine';
import {
  getSupersetSynergy,
  evaluateSplitDayGuardrails,
  getSupersetEquipmentTip,
} from '../../src/utils/supersetSynergy';
import {
  X,
  Plus,
  Trash2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Check,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  Dumbbell,
  Search,
  Layers,
  Link2,
  Unlink,
  Clock,
} from 'lucide-react-native';

function isMissingColumnError(err: any, colNames: string[]): boolean {
  const haystack = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`.toLowerCase();
  if (haystack.includes('schema cache')) return true;
  return colNames.some((col) => haystack.includes(col.toLowerCase()));
}

function isLegacyEnumError(err: any): boolean {
  const haystack = `${err?.message || ''} ${err?.details || ''} ${err?.code || ''}`.toLowerCase();
  return haystack.includes('invalid input value for enum') || haystack.includes('22p02');
}

function getDefaultDayName(dayNumber: number, totalDays: number): string {
  if (totalDays === 2) {
    return dayNumber === 1 ? 'Full Body A' : 'Full Body B';
  }
  return `Day ${dayNumber}`;
}

type ExerciseOption = {
  id: string;
  name: string;
  is_bodyweight_only: boolean;
  is_unilateral?: boolean;
  equipment?: string;
  default_rest_timer_seconds?: number;
  exercise_muscle_groups?: Array<{ muscle_group: string; fraction: number }>;
};

type RoutineExerciseItem = {
  exercise_id: string;
  name: string;
  planned_sets: number | string;
  target_reps: number | string;
  target_rep_min: number | string;
  target_rep_max: number | string;
  target_weight: number | string | null;
  is_bodyweight_only: boolean;
  is_unilateral?: boolean;
  equipment?: EquipmentType;
  default_rest_timer_seconds?: number;
  muscle_groups: Array<{ muscle_group: string; fraction: number }>;
  superset_id?: string | null;
  superset_order?: number;
};

type DaySplit = {
  id?: string;
  day_number: number;
  name: string;
  exercises: RoutineExerciseItem[];
};

type DayBlockMeta =
  | { type: 'standalone'; indices: [number] }
  | { type: 'superset'; supersetId: string; indices: number[] };

function estimateSplitDayMinutes(
  dayExercises: RoutineExerciseItem[],
  blocks: DayBlockMeta[],
  options: {
    defaultRestSeconds: number;
    lockRestTimerToDefault: boolean;
    supersetTransitionSeconds: number;
  }
): number {
  if (!dayExercises.length || !blocks.length) return 0;

  let totalSec = 0;
  blocks.forEach((block, blockIdx) => {
    const isLastBlock = blockIdx === blocks.length - 1;
    if (block.type === 'standalone') {
      const ex = dayExercises[block.indices[0]];
      if (!ex) return;
      const sets = Math.max(1, parseInt(String(ex.planned_sets || 3), 10) || 3);
      const workSec = ex.is_unilateral ? 55 : 35;
      const restSec = options.lockRestTimerToDefault
        ? options.defaultRestSeconds
        : ex.default_rest_timer_seconds || options.defaultRestSeconds || 60;
      const restIntervals = isLastBlock ? Math.max(0, sets - 1) : sets;
      totalSec += sets * workSec + restIntervals * restSec;
    } else {
      const members = block.indices.map((idx) => dayExercises[idx]).filter(Boolean);
      if (members.length === 0) return;
      const rounds = Math.max(
        1,
        ...members.map((m) => parseInt(String(m.planned_sets || 3), 10) || 3)
      );
      for (let round = 1; round <= rounds; round++) {
        const active = members.filter(
          (m) => (parseInt(String(m.planned_sets || 3), 10) || 3) >= round
        );
        if (active.length === 0) continue;
        active.forEach((m) => {
          totalSec += m.is_unilateral ? 55 : 35;
        });
        totalSec += Math.max(0, active.length - 1) * options.supersetTransitionSeconds;
        const isVeryLastSetOfDay = isLastBlock && round === rounds;
        if (!isVeryLastSetOfDay) {
          const restSec = options.lockRestTimerToDefault
            ? options.defaultRestSeconds
            : Math.max(
                ...active.map(
                  (m) => m.default_rest_timer_seconds || options.defaultRestSeconds || 60
                )
              );
          totalSec += restSec;
        }
      }
    }
  });

  return totalSec > 0 ? Math.max(1, Math.round(totalSec / 60)) : 0;
}

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ routineId?: string }>();
  const editingRoutineId = Array.isArray(params.routineId) ? params.routineId[0] : params.routineId;
  const insets = useSafeAreaInsets();
  const defaultRestSeconds = usePreferencesStore((s) => s.defaultRestSeconds);
  const lockRestTimerToDefault = usePreferencesStore((s) => s.lockRestTimerToDefault);
  const supersetTransitionSeconds = usePreferencesStore((s) => s.supersetTransitionSeconds);
  const filterByMyGym = usePreferencesStore((s) => s.filterByMyGym);
  const allowedEquipment = usePreferencesStore((s) => s.allowedEquipment);
  const maxDumbbellWeightLbs = usePreferencesStore((s) => s.maxDumbbellWeightLbs);
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Setup, 2: Assign, 3: Volumetric Sandbox Review
  const [loading, setLoading] = useState(false);
  const [hydratingRoutine, setHydratingRoutine] = useState(Boolean(editingRoutineId));
  const [existingStatus, setExistingStatus] = useState<'draft' | 'active' | 'completed'>('draft');
  const [existingCurrentDay, setExistingCurrentDay] = useState(1);

  // Step 1 State
  const [routineName, setRoutineName] = useState('My Custom Split');
  const [daysInSplit, setDaysInSplit] = useState(3);
  const [cyclesPerRoutine, setCyclesPerRoutine] = useState(4);

  // Step 2 State
  const [days, setDays] = useState<DaySplit[]>([
    { day_number: 1, name: 'Day 1', exercises: [] },
    { day_number: 2, name: 'Day 2', exercises: [] },
    { day_number: 3, name: 'Day 3', exercises: [] },
  ]);
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const handleDaysInSplitChange = (newCount: number) => {
    setDaysInSplit(newCount);
    setDays((prevDays) => {
      if (newCount === prevDays.length) return prevDays;
      if (newCount > prevDays.length) {
        const updated = [...prevDays].map((d, idx) => {
          if (newCount === 2 && !editingRoutineId && /^Day \d+$/.test(d.name)) {
            return { ...d, name: getDefaultDayName(idx + 1, 2) };
          }
          if (newCount > 2 && !editingRoutineId && (d.name === 'Full Body A' || d.name === 'Full Body B')) {
            return { ...d, name: `Day ${idx + 1}` };
          }
          return d;
        });
        for (let i = prevDays.length; i < newCount; i++) {
          updated.push({
            day_number: i + 1,
            name: getDefaultDayName(i + 1, newCount),
            exercises: [],
          });
        }
        return updated;
      } else {
        const sliced = prevDays.slice(0, newCount);
        if (newCount === 2 && !editingRoutineId) {
          return sliced.map((d, idx) =>
            /^Day \d+$/.test(d.name) ? { ...d, name: getDefaultDayName(idx + 1, 2) } : d
          );
        }
        return sliced;
      }
    });
    setActiveDayIndex((prev) => (prev >= newCount ? newCount - 1 : prev));
  };

  const handleGoToStep2 = () => {
    setDays((prevDays) => {
      if (daysInSplit === prevDays.length) return prevDays;
      if (daysInSplit > prevDays.length) {
        const updated = [...prevDays];
        for (let i = prevDays.length; i < daysInSplit; i++) {
          updated.push({
            day_number: i + 1,
            name: getDefaultDayName(i + 1, daysInSplit),
            exercises: [],
          });
        }
        return updated;
      } else {
        return prevDays.slice(0, daysInSplit);
      }
    });
    setActiveDayIndex((prev) => (prev >= daysInSplit ? daysInSplit - 1 : prev));
    setStep(2);
  };

  // Exercise Picker Modal State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [targetSupersetIdForPicker, setTargetSupersetIdForPicker] = useState<string | null>(null);
  const [availableExercises, setAvailableExercises] = useState<ExerciseOption[]>([]);
  const [fetchingExercises, setFetchingExercises] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerEquipmentFilter, setPickerEquipmentFilter] = useState<EquipmentFilterMode>(
    filterByMyGym ? 'my_gym' : 'all'
  );

  useEffect(() => {
    setPickerEquipmentFilter(filterByMyGym ? 'my_gym' : 'all');
  }, [filterByMyGym]);

  const myGymChipLabel =
    allowedEquipment.length === 2 &&
    allowedEquipment.includes('dumbbell') &&
    allowedEquipment.includes('bodyweight')
      ? 'My Gym (DB + BW)'
      : 'My Gym';

  // Filtered exercises based on equipment chip & search query
  const filteredExercises = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return availableExercises.filter((ex) => {
      if (!matchesEquipmentFilter(ex, pickerEquipmentFilter, allowedEquipment)) {
        return false;
      }
      if (!q) return true;
      const eqLabel = EQUIPMENT_LABELS[resolveExerciseEquipment(ex)].toLowerCase();
      const nameMatch = ex.name.toLowerCase().includes(q) || eqLabel.includes(q);
      const muscleMatch = ex.exercise_muscle_groups?.some((m) => {
        const raw = m.muscle_group.toLowerCase();
        const norm = String(normalizeMuscleGroup(m.muscle_group)).toLowerCase();
        return raw.includes(q) || norm.includes(q);
      });
      return nameMatch || muscleMatch;
    });
  }, [availableExercises, searchQuery, pickerEquipmentFilter, allowedEquipment]);

  // New Exercise Inline Creation State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExPrimaryMuscle, setNewExPrimaryMuscle] = useState<string>('Chest');
  const [newExSecondaryMuscles, setNewExSecondaryMuscles] = useState<string[]>([]);
  const [newExEquipment, setNewExEquipment] = useState<EquipmentType>('dumbbell');
  const [newExIsBodyweight, setNewExIsBodyweight] = useState(false);
  const [newExIsUnilateral, setNewExIsUnilateral] = useState(false);

  // Load available exercises from library
  const fetchAvailableExercises = async () => {
    setFetchingExercises(true);
    const { data, error } = await supabase
      .from('exercises')
      .select('*, exercise_muscle_groups(*)')
      .order('name');
    if (!error && data) {
      setAvailableExercises(data);
    }
    setFetchingExercises(false);
  };

  useEffect(() => {
    fetchAvailableExercises();
  }, []);

  // Hydrate existing split when editing via ?routineId=<id>
  useEffect(() => {
    if (!editingRoutineId) {
      setHydratingRoutine(false);
      return;
    }

    let cancelled = false;
    const hydrateExistingRoutine = async () => {
      setHydratingRoutine(true);
      try {
        const { data: routineData, error: rErr } = await supabase
          .from('routines')
          .select('*')
          .eq('id', editingRoutineId)
          .single();

        if (rErr || !routineData) {
          throw rErr || new Error('Routine not found');
        }

        const { data: dayRows, error: dErr } = await supabase
          .from('routine_days')
          .select('*, routine_exercises(*, exercises(*, exercise_muscle_groups(*)))')
          .eq('routine_id', editingRoutineId)
          .order('day_number', { ascending: true });

        if (dErr) throw dErr;

        if (cancelled) return;

        const cleanSplitCount = Math.max(
          2,
          Math.min(7, Number(routineData.days_in_split) || (dayRows?.length || 3))
        );

        setRoutineName(routineData.name || 'My Custom Split');
        setDaysInSplit(cleanSplitCount);
        setCyclesPerRoutine(Math.max(1, Number(routineData.cycles_per_routine) || 4));
        setExistingStatus(routineData.status || 'draft');
        setExistingCurrentDay(Math.max(1, Number(routineData.current_day) || 1));

        const sortedDays = [...(dayRows || [])].sort(
          (a: any, b: any) => (a.day_number || 0) - (b.day_number || 0)
        );
        const dayByNumber = new Map<number, any>();
        sortedDays.forEach((rd: any) => {
          dayByNumber.set(Number(rd.day_number), rd);
        });

        const hydratedDays: DaySplit[] = [];
        for (let dayNum = 1; dayNum <= cleanSplitCount; dayNum++) {
          const rd = dayByNumber.get(dayNum);
          const rawExercises = [...(rd?.routine_exercises || [])].sort(
            (a: any, b: any) => (a.order_index || 0) - (b.order_index || 0)
          );

          hydratedDays.push({
            id: rd?.id,
            day_number: dayNum,
            name: rd?.name?.trim() || getDefaultDayName(dayNum, cleanSplitCount),
            exercises: rawExercises.map((re: any) => {
              const exObj = re.exercises || {};
              const rawMax = Number(re.target_rep_max ?? re.target_reps ?? 12);
              const cleanMax = Number.isFinite(rawMax) && rawMax >= 1 ? rawMax : 12;
              const rawMin = Number(re.target_rep_min ?? re.target_reps ?? Math.min(8, cleanMax));
              const cleanMin = Number.isFinite(rawMin) && rawMin >= 1 ? Math.min(rawMin, cleanMax) : cleanMax;

              return {
                exercise_id: re.exercise_id || exObj.id,
                name: exObj.name || 'Exercise',
                planned_sets: re.planned_sets ?? 3,
                target_reps: cleanMax,
                target_rep_min: cleanMin,
                target_rep_max: cleanMax,
                target_weight:
                  re.target_weight !== null && re.target_weight !== undefined
                    ? Number(re.target_weight)
                    : null,
                is_bodyweight_only: Boolean(exObj.is_bodyweight_only),
                is_unilateral: Boolean(exObj.is_unilateral),
                equipment: resolveExerciseEquipment(exObj),
                default_rest_timer_seconds:
                  Number(exObj.default_rest_timer_seconds) || defaultRestSeconds || 60,
                muscle_groups: (exObj.exercise_muscle_groups || []).map((m: any) => ({
                  ...m,
                  muscle_group: String(normalizeMuscleGroup(m.muscle_group)),
                })),
                superset_id: re.superset_id || null,
                superset_order: re.superset_order || 1,
              };
            }),
          });
        }

        setDays(hydratedDays);
        setActiveDayIndex(0);
      } catch (err: any) {
        console.error('Hydrate split error:', err);
        const msg = err?.message || 'Failed to load existing split';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Load Error', msg);
      } finally {
        if (!cancelled) setHydratingRoutine(false);
      }
    };

    hydrateExistingRoutine();
    return () => {
      cancelled = true;
    };
  }, [editingRoutineId]);

  // Handle creating custom exercise and auto-selecting it
  const handleCreateAndSelectExercise = async () => {
    if (!newExName.trim()) {
      Alert.alert('Required', 'Please enter an exercise name.');
      return;
    }

    setCreatingExercise(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      Alert.alert('Error', 'You must be logged in to create an exercise.');
      setCreatingExercise(false);
      return;
    }

    try {
      // 1. Insert exercise with fallback for unmigrated schema
      const baseInsertPayload = {
        user_id: userId,
        name: newExName.trim(),
        is_bodyweight_only: newExIsBodyweight,
        default_rest_timer_seconds: defaultRestSeconds || 60,
        updated_at: new Date().toISOString(),
      };
      let { data: exData, error: exErr } = await supabase
        .from('exercises')
        .insert([{ ...baseInsertPayload, is_unilateral: newExIsUnilateral, equipment: newExEquipment }])
        .select()
        .single();

      if (exErr && isMissingColumnError(exErr, ['is_unilateral', 'equipment'])) {
        const retryEx = await supabase
          .from('exercises')
          .insert([baseInsertPayload])
          .select()
          .single();
        exData = retryEx.data;
        exErr = retryEx.error;
      }

      if (exErr || !exData) throw exErr || new Error('Failed to create exercise');

      // 2. Insert muscle groups (with legacy enum fallback)
      const muscleRows = [
        { exercise_id: exData.id, muscle_group: newExPrimaryMuscle, fraction: 1.0 },
        ...newExSecondaryMuscles
          .filter((m) => m !== newExPrimaryMuscle)
          .map((m) => ({
            exercise_id: exData.id,
            muscle_group: m,
            fraction: 0.5,
          })),
      ];

      let { error: muscleErr } = await supabase.from('exercise_muscle_groups').insert(muscleRows);
      if (muscleErr && isLegacyEnumError(muscleErr)) {
        const retryMuscles = await supabase
          .from('exercise_muscle_groups')
          .insert(buildLegacyMuscleGroupRows(muscleRows));
        muscleErr = retryMuscles.error;
      }
      if (muscleErr) throw muscleErr;

      const createdOption: ExerciseOption = {
        id: exData.id,
        name: exData.name,
        is_bodyweight_only: exData.is_bodyweight_only,
        is_unilateral: exData.is_unilateral ?? newExIsUnilateral,
        equipment: exData.equipment ?? newExEquipment,
        default_rest_timer_seconds: exData.default_rest_timer_seconds ?? (defaultRestSeconds || 60),
        exercise_muscle_groups: muscleRows.map((r) => ({
          muscle_group: r.muscle_group,
          fraction: r.fraction,
        })),
      };

      // Refresh list & select exercise
      await fetchAvailableExercises();
      await handleAddExerciseToActiveDay(createdOption, targetSupersetIdForPicker);

      // Reset create state
      setCreatingExercise(false);
      setShowCreateForm(false);
      setNewExName('');
      setNewExPrimaryMuscle('Chest');
      setNewExSecondaryMuscles([]);
      setNewExEquipment('dumbbell');
      setNewExIsBodyweight(false);
      setNewExIsUnilateral(false);
    } catch (err: any) {
      setCreatingExercise(false);
      Alert.alert('Create Error', err.message || 'Failed to create exercise');
    }
  };

  // Add exercise to currently active day (optionally to a superset)
  const handleAddExerciseToActiveDay = async (ex: ExerciseOption, supersetId?: string | null) => {
    const resolvedEq = resolveExerciseEquipment(ex);
    const clampDbCap = (w: number) =>
      resolvedEq === 'dumbbell' && maxDumbbellWeightLbs && maxDumbbellWeightLbs > 0
        ? Math.min(w, maxDumbbellWeightLbs)
        : w;

    let initialWeight: number | null = null;

    if (!ex.is_bodyweight_only) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          let { data, error } = await supabase
            .from('session_sets')
            .select('weight, set_type, is_completed, session_exercises!inner(exercise_id, sessions!inner(user_id))')
            .eq('session_exercises.exercise_id', ex.id)
            .eq('session_exercises.sessions.user_id', session.user.id)
            .eq('is_completed', true)
            .not('weight', 'is', null)
            .order('created_at', { ascending: false })
            .limit(15);

          if (error && isMissingColumnError(error, ['set_type'])) {
            const fallbackRes = await supabase
              .from('session_sets')
              .select('weight, is_completed, session_exercises!inner(exercise_id, sessions!inner(user_id))')
              .eq('session_exercises.exercise_id', ex.id)
              .eq('session_exercises.sessions.user_id', session.user.id)
              .eq('is_completed', true)
              .not('weight', 'is', null)
              .order('created_at', { ascending: false })
              .limit(5);
            data = fallbackRes.data as any;
          }

          const workingSet = (data || []).find((row: any) => isWorkingCompletedSet(row));
          if (workingSet && workingSet.weight !== null && workingSet.weight !== undefined) {
            initialWeight = clampDbCap(Number(workingSet.weight));
          }
        }
      } catch (err) {
        console.error('Error fetching last completed weight:', err);
      }

      // Guardrail #4: Brand-new dumbbell lifts default to 25 (unilateral) / 35 (bilateral) clamped to cap
      if (initialWeight === null) {
        initialWeight = getDefaultStartingWeight(ex, maxDumbbellWeightLbs);
      }
    }

    setDays((prevDays) => {
      const copy = [...prevDays];
      const currentDayExercises = [...copy[activeDayIndex].exercises];

      let supersetOrder = 1;
      if (supersetId) {
        const existingInSuperset = currentDayExercises.filter((e) => e.superset_id === supersetId);
        supersetOrder = existingInSuperset.length + 1;
      }

      const newExerciseItem: RoutineExerciseItem = {
        exercise_id: ex.id,
        name: ex.name,
        planned_sets: 3,
        target_reps: 12,
        target_rep_min: 8,
        target_rep_max: 12,
        target_weight: initialWeight,
        is_bodyweight_only: ex.is_bodyweight_only,
        is_unilateral: Boolean(ex.is_unilateral),
        equipment: resolvedEq,
        default_rest_timer_seconds:
          Number(ex.default_rest_timer_seconds) || defaultRestSeconds || 60,
        muscle_groups: (ex.exercise_muscle_groups || []).map((m) => ({
          ...m,
          muscle_group: String(normalizeMuscleGroup(m.muscle_group)),
        })),
        superset_id: supersetId || null,
        superset_order: supersetId ? supersetOrder : 1,
      };

      if (supersetId) {
        // Insert right after the last exercise of this superset if found
        let lastSupersetIdx = -1;
        for (let i = 0; i < currentDayExercises.length; i++) {
          if (currentDayExercises[i].superset_id === supersetId) {
            lastSupersetIdx = i;
          }
        }
        if (lastSupersetIdx >= 0) {
          currentDayExercises.splice(lastSupersetIdx + 1, 0, newExerciseItem);
        } else {
          currentDayExercises.push(newExerciseItem);
        }
      } else {
        currentDayExercises.push(newExerciseItem);
      }

      copy[activeDayIndex] = { ...copy[activeDayIndex], exercises: currentDayExercises };
      return copy;
    });

    setTargetSupersetIdForPicker(null);
    setPickerVisible(false);
  };

  // Start creating a new Superset block
  const handleStartAddSuperset = () => {
    const newSupersetId = `ss_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setTargetSupersetIdForPicker(newSupersetId);
    setPickerVisible(true);
  };

  // Add another exercise to an existing superset
  const handleAddExerciseToSuperset = (supersetId: string) => {
    setTargetSupersetIdForPicker(supersetId);
    setPickerVisible(true);
  };

  // Link exercise with adjacent exercise into a superset
  const handleLinkWithNext = (dayIdx: number, exIdx: number) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const dayExercises = copy[dayIdx].exercises;
      if (exIdx >= dayExercises.length - 1) return prevDays;

      const currentEx = dayExercises[exIdx];
      const nextEx = dayExercises[exIdx + 1];

      const targetSupersetId = currentEx.superset_id || nextEx.superset_id || `ss_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      currentEx.superset_id = targetSupersetId;
      nextEx.superset_id = targetSupersetId;

      // Re-index superset_order for all exercises in this superset
      let orderCounter = 1;
      dayExercises.forEach((e) => {
        if (e.superset_id === targetSupersetId) {
          e.superset_order = orderCounter++;
        }
      });

      return copy;
    });
  };

  // Unlink an exercise from a superset
  const handleUnlinkExercise = (dayIdx: number, exIdx: number) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const dayExercises = copy[dayIdx].exercises;
      const targetSupersetId = dayExercises[exIdx].superset_id;

      if (!targetSupersetId) return prevDays;

      dayExercises[exIdx].superset_id = null;
      dayExercises[exIdx].superset_order = 1;

      // Check remaining exercises in this superset
      const remaining = dayExercises.filter(e => e.superset_id === targetSupersetId);
      if (remaining.length === 1) {
        // If only 1 remains, convert it back to standalone
        remaining[0].superset_id = null;
        remaining[0].superset_order = 1;
      } else {
        // Re-index orders
        let orderCounter = 1;
        dayExercises.forEach((e) => {
          if (e.superset_id === targetSupersetId) {
            e.superset_order = orderCounter++;
          }
        });
      }

      return copy;
    });
  };

  // Remove exercise from active day
  const handleRemoveExercise = (dayIdx: number, exIdx: number) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const dayExercises = copy[dayIdx].exercises;
      const targetSupersetId = dayExercises[exIdx].superset_id;

      dayExercises.splice(exIdx, 1);

      if (targetSupersetId) {
        const remaining = dayExercises.filter(e => e.superset_id === targetSupersetId);
        if (remaining.length === 1) {
          remaining[0].superset_id = null;
          remaining[0].superset_order = 1;
        } else {
          let orderCounter = 1;
          dayExercises.forEach((e) => {
            if (e.superset_id === targetSupersetId) {
              e.superset_order = orderCounter++;
            }
          });
        }
      }

      return copy;
    });
  };

  // Update exercise properties (sets, rep range, weight)
  const handleUpdateExerciseProp = (dayIdx: number, exIdx: number, key: keyof RoutineExerciseItem, val: any) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const updatedEx: RoutineExerciseItem = {
        ...copy[dayIdx].exercises[exIdx],
        [key]: val,
      };
      if (key === 'target_rep_max') {
        updatedEx.target_reps = val;
      }
      const nextExercises = [...copy[dayIdx].exercises];
      nextExercises[exIdx] = updatedEx;
      copy[dayIdx] = { ...copy[dayIdx], exercises: nextExercises };
      return copy;
    });
  };

  // Group day exercises into ordered blocks (standalone or contiguous superset group)
  const getDayBlocks = (exercises: RoutineExerciseItem[]) => {
    const processedSupersets = new Set<string>();
    const blocks: Array<
      | { type: 'standalone'; indices: [number] }
      | { type: 'superset'; supersetId: string; indices: number[] }
    > = [];

    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      if (!ex.superset_id) {
        blocks.push({ type: 'standalone', indices: [i] });
      } else if (!processedSupersets.has(ex.superset_id)) {
        processedSupersets.add(ex.superset_id);
        const sId = ex.superset_id;
        const indices: number[] = [];
        for (let j = i; j < exercises.length; j++) {
          if (exercises[j].superset_id === sId) {
            indices.push(j);
          }
        }
        blocks.push({ type: 'superset', supersetId: sId, indices });
      }
    }
    return blocks;
  };

  // Move a standalone lift or whole superset block up/down
  const handleMoveBlock = (dayIdx: number, blockIdx: number, direction: 'up' | 'down') => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const dayExercises = [...copy[dayIdx].exercises];
      const blocks = getDayBlocks(dayExercises);
      const targetIdx = direction === 'up' ? blockIdx - 1 : blockIdx + 1;
      if (targetIdx < 0 || targetIdx >= blocks.length) return prevDays;

      const reorderedBlocks = [...blocks];
      const temp = reorderedBlocks[blockIdx];
      reorderedBlocks[blockIdx] = reorderedBlocks[targetIdx];
      reorderedBlocks[targetIdx] = temp;

      const flattened: RoutineExerciseItem[] = [];
      for (const blk of reorderedBlocks) {
        if (blk.type === 'standalone') {
          flattened.push(dayExercises[blk.indices[0]]);
        } else {
          blk.indices.forEach((origIdx, orderPos) => {
            flattened.push({
              ...dayExercises[origIdx],
              superset_order: orderPos + 1,
            });
          });
        }
      }

      copy[dayIdx] = { ...copy[dayIdx], exercises: flattened };
      return copy;
    });
  };

  // Reorder exercises inside a superset (A1 <-> A2)
  const handleMoveInSuperset = (
    dayIdx: number,
    supersetId: string,
    slotIdx: number,
    direction: 'up' | 'down'
  ) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      const dayExercises = [...copy[dayIdx].exercises];
      const groupIndices: number[] = [];
      dayExercises.forEach((e, idx) => {
        if (e.superset_id === supersetId) groupIndices.push(idx);
      });

      const targetSlotIdx = direction === 'up' ? slotIdx - 1 : slotIdx + 1;
      if (targetSlotIdx < 0 || targetSlotIdx >= groupIndices.length) return prevDays;

      const idxA = groupIndices[slotIdx];
      const idxB = groupIndices[targetSlotIdx];
      const temp = dayExercises[idxA];
      dayExercises[idxA] = dayExercises[idxB];
      dayExercises[idxB] = temp;

      // Normalize superset_order (1..k)
      groupIndices.forEach((idx, pos) => {
        dayExercises[idx] = {
          ...dayExercises[idx],
          superset_order: pos + 1,
        };
      });

      copy[dayIdx] = { ...copy[dayIdx], exercises: dayExercises };
      return copy;
    });
  };

  // Calculate Real-time Volumetric Vector Impact across entire routine (11 sub-muscles)
  const muscleVolumes = useMemo(() => {
    const volumes: Record<string, number> = {};
    MUSCLE_GROUPS.forEach((mg) => {
      volumes[mg] = 0;
    });

    days.forEach((day) => {
      day.exercises.forEach((ex) => {
        const sets = Number(ex.planned_sets) || 0;
        ex.muscle_groups.forEach((m) => {
          const groupName = String(normalizeMuscleGroup(m.muscle_group));
          const fraction = Number(m.fraction) || 1.0;
          if (volumes[groupName] !== undefined) {
            volumes[groupName] += sets * fraction;
          }
        });
      });
    });

    return volumes;
  }, [days]);

  // Helper to insert routine_exercises rows with graceful PostgREST schema-cache fallbacks
  const insertDayExercisesWithFallback = async (
    exerciseRows: Array<{
      routine_day_id: string;
      exercise_id: string;
      order_index: number;
      planned_sets: number;
      target_reps: number;
      target_rep_min: number;
      target_rep_max: number;
      target_weight: number | null;
      superset_id: string | null;
      superset_order: number;
    }>
  ) => {
    if (exerciseRows.length === 0) return;

    const { error: exErr } = await supabase.from('routine_exercises').insert(exerciseRows);
    if (!exErr) return;

    // Tier 2 fallback: omit Migration #8 rep-range columns if remote schema cache lags
    if (isMissingColumnError(exErr, ['target_rep_min', 'target_rep_max'])) {
      const withoutRepRangeRows = exerciseRows.map(
        ({ target_rep_min, target_rep_max, ...rest }) => rest
      );
      const { error: tier2Err } = await supabase
        .from('routine_exercises')
        .insert(withoutRepRangeRows);
      if (!tier2Err) return;

      if (isMissingColumnError(tier2Err, ['superset_id', 'superset_order'])) {
        const baseRows = withoutRepRangeRows.map(
          ({ superset_id, superset_order, ...rest }) => rest
        );
        const { error: tier3Err } = await supabase.from('routine_exercises').insert(baseRows);
        if (tier3Err) throw tier3Err;
        return;
      }
      throw tier2Err;
    }

    // Fallback: omit superset columns if remote DB lags older migration
    if (isMissingColumnError(exErr, ['superset_id', 'superset_order'])) {
      const withoutSupersetRows = exerciseRows.map(
        ({ superset_id, superset_order, ...rest }) => rest
      );
      const { error: fallbackErr } = await supabase
        .from('routine_exercises')
        .insert(withoutSupersetRows);
      if (!fallbackErr) return;

      if (isMissingColumnError(fallbackErr, ['target_rep_min', 'target_rep_max'])) {
        const baseRows = withoutSupersetRows.map(
          ({ target_rep_min, target_rep_max, ...rest }) => rest
        );
        const { error: tier3Err } = await supabase.from('routine_exercises').insert(baseRows);
        if (tier3Err) throw tier3Err;
        return;
      }
      throw fallbackErr;
    }

    throw exErr;
  };

  // Save Routine to Supabase (Supports FK-safe Create & Edit)
  const handleCommitRoutine = async (shouldActivate: boolean) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        setLoading(false);
        const msg = 'You must be logged in to save a routine.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Error', msg);
        return;
      }

      const cleanDaysInSplit = Math.max(2, Math.min(7, Number(daysInSplit) || 3));
      const cleanCycles = Math.max(1, Number(cyclesPerRoutine) || 3);
      const cleanName = routineName.trim() || 'My Custom Split';

      let targetRoutineId = editingRoutineId || '';

      if (editingRoutineId) {
        // 1a. Update existing routine header, clamping current_day to new split length
        const clampedCurrentDay = Math.max(1, Math.min(existingCurrentDay || 1, cleanDaysInSplit));
        const { data: updatedRoutine, error: updateErr } = await supabase
          .from('routines')
          .update({
            name: cleanName,
            status: shouldActivate ? 'active' : 'draft',
            days_in_split: cleanDaysInSplit,
            cycles_per_routine: cleanCycles,
            current_day: clampedCurrentDay,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRoutineId)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateErr || !updatedRoutine) {
          throw updateErr || new Error('Failed to update routine');
        }
        targetRoutineId = updatedRoutine.id;
      } else {
        // 1b. Insert new routine header
        const { data: routineData, error: routineErr } = await supabase
          .from('routines')
          .insert([{
            user_id: userId,
            name: cleanName,
            status: shouldActivate ? 'active' : 'draft',
            days_in_split: cleanDaysInSplit,
            cycles_per_routine: cleanCycles,
            current_day: 1,
            current_cycle: 1,
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (routineErr || !routineData) {
          throw routineErr || new Error('Failed to create routine header');
        }
        targetRoutineId = routineData.id;
      }

      // If set to active, deactivate other active routines for this user (preserve completed routines)
      if (shouldActivate) {
        const { error: deactErr } = await supabase
          .from('routines')
          .update({ status: 'draft' })
          .eq('user_id', userId)
          .eq('status', 'active')
          .neq('id', targetRoutineId);
        if (deactErr) console.warn('Could not deactivate other active routines:', deactErr);
      }

      // Ensure days array has exactly cleanDaysInSplit elements
      const finalDays: DaySplit[] = [...days.slice(0, cleanDaysInSplit)];
      while (finalDays.length < cleanDaysInSplit) {
        finalDays.push({
          day_number: finalDays.length + 1,
          name: getDefaultDayName(finalDays.length + 1, cleanDaysInSplit),
          exercises: [],
        });
      }

      // 2. FK-Safe Routine Days & Exercises persistence
      for (let i = 0; i < finalDays.length; i++) {
        const d = finalDays[i];
        const dayNumber = i + 1;
        const cleanDayName = d.name?.trim() || getDefaultDayName(dayNumber, cleanDaysInSplit);

        let dayData: any = null;
        let dayErr: any = null;

        if (editingRoutineId) {
          // Upsert by (routine_id, day_number) so existing routine_days.id UUIDs stay intact!
          const upsertRes = await supabase
            .from('routine_days')
            .upsert(
              {
                routine_id: targetRoutineId,
                day_number: dayNumber,
                name: cleanDayName,
              },
              { onConflict: 'routine_id,day_number' }
            )
            .select()
            .single();
          dayData = upsertRes.data;
          dayErr = upsertRes.error;

          if (dayErr && isMissingColumnError(dayErr, ['name'])) {
            const fallbackUpsert = await supabase
              .from('routine_days')
              .upsert(
                {
                  routine_id: targetRoutineId,
                  day_number: dayNumber,
                },
                { onConflict: 'routine_id,day_number' }
              )
              .select()
              .single();
            dayData = fallbackUpsert.data;
            dayErr = fallbackUpsert.error;
          }
        } else {
          const insertRes = await supabase
            .from('routine_days')
            .insert([{
              routine_id: targetRoutineId,
              day_number: dayNumber,
              name: cleanDayName,
            }])
            .select()
            .single();
          dayData = insertRes.data;
          dayErr = insertRes.error;

          if (dayErr && isMissingColumnError(dayErr, ['name'])) {
            const fallbackInsert = await supabase
              .from('routine_days')
              .insert([{
                routine_id: targetRoutineId,
                day_number: dayNumber,
              }])
              .select()
              .single();
            dayData = fallbackInsert.data;
            dayErr = fallbackInsert.error;
          }
        }

        if (dayErr || !dayData) {
          throw dayErr || new Error(`Failed to save routine day ${dayNumber}`);
        }

        const dayId = dayData.id;

        if (editingRoutineId) {
          const { error: delExErr } = await supabase
            .from('routine_exercises')
            .delete()
            .eq('routine_day_id', dayId);
          if (delExErr) throw delExErr;
        }

        if (d.exercises && d.exercises.length > 0) {
          const exerciseRows = d.exercises.map((ex, idx) => {
            const rawSets = parseInt(String(ex.planned_sets), 10);
            const rawMaxReps = parseInt(String(ex.target_rep_max ?? ex.target_reps), 10);
            const cleanMaxReps = isNaN(rawMaxReps) || rawMaxReps < 1 ? 12 : rawMaxReps;
            const rawMinReps = parseInt(String(ex.target_rep_min ?? cleanMaxReps), 10);
            const cleanMinReps =
              isNaN(rawMinReps) || rawMinReps < 1
                ? Math.min(8, cleanMaxReps)
                : Math.min(rawMinReps, cleanMaxReps);
            const rawWeight = ex.target_weight;
            const parsedWeight =
              rawWeight !== null && rawWeight !== undefined && rawWeight !== '' && !isNaN(Number(rawWeight))
                ? Number(rawWeight)
                : null;

            return {
              routine_day_id: dayId,
              exercise_id: ex.exercise_id,
              order_index: idx + 1,
              planned_sets: isNaN(rawSets) || rawSets < 1 ? 3 : rawSets,
              target_reps: cleanMaxReps,
              target_rep_min: cleanMinReps,
              target_rep_max: cleanMaxReps,
              target_weight: ex.is_bodyweight_only ? null : parsedWeight,
              superset_id: ex.superset_id || null,
              superset_order: Number(ex.superset_order) || 1,
            };
          });

          await insertDayExercisesWithFallback(exerciseRows);
        }
      }

      // If shrinking an existing split, remove only trailing routine_days > cleanDaysInSplit
      // (sessions.routine_day_id uses ON DELETE SET NULL so historical sessions remain intact)
      if (editingRoutineId) {
        const { error: pruneDaysErr } = await supabase
          .from('routine_days')
          .delete()
          .eq('routine_id', targetRoutineId)
          .gt('day_number', cleanDaysInSplit);
        if (pruneDaysErr) throw pruneDaysErr;
      }

      setLoading(false);
      router.replace('/(tabs)/routines');
    } catch (err: any) {
      console.error('Save routine error:', err);
      setLoading(false);
      const errMsg = err?.message || 'Failed to save routine';
      if (Platform.OS === 'web') {
        window.alert(`Save Error: ${errMsg}`);
      } else {
        Alert.alert('Save Error', errMsg);
      }
    }
  };

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Header & Step Wizard Bar */}
      <View className="flex-row justify-between items-center mb-6">
        <View className="flex-1 mr-3 min-w-0">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
            Best Damn Workout Tracker Ever
          </Text>
          <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Step {step} of 3 • {editingRoutineId ? 'Edit Split' : 'Sandbox Mode'}
          </Text>
          <Text className="text-white text-2xl font-bold" numberOfLines={1}>
            {step === 1
              ? editingRoutineId
                ? 'Edit Split Setup'
                : 'Split Setup'
              : step === 2
              ? 'Assign Exercises'
              : 'Volumetric Review'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-slate-800 rounded-full items-center justify-center shrink-0">
          <X color="#94a3b8" size={20} />
        </TouchableOpacity>
      </View>

      {/* Step Progress Indicators */}
      <View className="flex-row gap-2 mb-6">
        <View className={`flex-1 h-1.5 rounded-full ${step >= 1 ? 'bg-blue-500' : 'bg-slate-800'}`} />
        <View className={`flex-1 h-1.5 rounded-full ${step >= 2 ? 'bg-blue-500' : 'bg-slate-800'}`} />
        <View className={`flex-1 h-1.5 rounded-full ${step >= 3 ? 'bg-indigo-500' : 'bg-slate-800'}`} />
      </View>

      {hydratingRoutine ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text className="text-slate-400 text-sm mt-3">Loading split configuration...</Text>
        </View>
      ) : (
        <>
          {/* STEP 1: ROUTINE SETUP */}
          {step === 1 && (
            <ScrollView className="flex-1 space-y-6">
              <View className="bg-slate-900 p-5 rounded-2xl border border-slate-800 mb-6">
                <Text className="text-slate-400 text-sm mb-2 font-medium">Routine Name</Text>
                <TextInput
                  className="bg-slate-800 text-white p-4 rounded-xl font-bold text-lg border border-slate-700"
                  value={routineName}
                  onChangeText={setRoutineName}
                  placeholder="e.g. Hypertrophy Split"
                  placeholderTextColor="#64748b"
                />
              </View>

              {/* Days in Split Picker */}
              <View className="bg-slate-900 p-5 rounded-2xl border border-slate-800 mb-6">
                <Text className="text-slate-400 text-sm mb-2 font-medium">Days in Split Rotation</Text>
                <View className="flex-row justify-between gap-1.5 mb-4">
                  {[2, 3, 4, 5, 6, 7].map((num) => (
                    <TouchableOpacity
                      key={num}
                      onPress={() => handleDaysInSplitChange(num)}
                      className={`flex-1 h-12 rounded-xl items-center justify-center border ${
                        daysInSplit === num ? 'bg-blue-600 border-blue-400' : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <Text className={`font-bold text-base ${daysInSplit === num ? 'text-white' : 'text-slate-400'}`}>
                        {num}d
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text className="text-slate-400 text-sm mb-2 font-medium">Total Cycles Before Reset</Text>
                <View className="flex-row justify-between">
                  {[2, 3, 4, 6].map((num) => (
                    <TouchableOpacity
                      key={num}
                      onPress={() => setCyclesPerRoutine(num)}
                      className={`px-4 py-2.5 rounded-xl border ${
                        cyclesPerRoutine === num ? 'bg-purple-600/30 border-purple-500' : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <Text className={`font-bold ${cyclesPerRoutine === num ? 'text-purple-300' : 'text-slate-400'}`}>
                        {num} Cycles
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                onPress={handleGoToStep2}
                className="bg-blue-600 p-4 rounded-2xl flex-row items-center justify-center mb-10"
              >
                <Text className="text-white font-bold text-lg mr-2">Next: Assign Exercises</Text>
                <ChevronRight color="white" size={20} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* STEP 2: ASSIGN EXERCISES */}
          {step === 2 && (
            <View className="flex-1">
              {/* Horizontal Day Tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2 mb-4 max-h-12">
                {days.map((d, idx) => (
                  <TouchableOpacity
                    key={d.day_number}
                    onPress={() => setActiveDayIndex(idx)}
                    className={`px-4 py-2.5 rounded-xl border mr-2 ${
                      activeDayIndex === idx
                        ? 'bg-blue-600 border-blue-400'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <Text className={`font-bold ${activeDayIndex === idx ? 'text-white' : 'text-slate-400'}`}>
                      {d.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Active Day Exercise List */}
              <ScrollView className="flex-1">
                {(() => {
                  const activeDay = days[activeDayIndex];
                  const activeBlocks = getDayBlocks(activeDay?.exercises || []);
                  const estMinutes = estimateSplitDayMinutes(
                    activeDay?.exercises || [],
                    activeBlocks,
                    {
                      defaultRestSeconds,
                      lockRestTimerToDefault,
                      supersetTransitionSeconds,
                    }
                  );
                  const badgeStyle =
                    estMinutes <= 20
                      ? {
                          container: 'bg-emerald-500/20 border-emerald-500/40',
                          text: 'text-emerald-300',
                          icon: '#6ee7b7',
                        }
                      : estMinutes <= 30
                      ? {
                          container: 'bg-amber-500/20 border-amber-500/40',
                          text: 'text-amber-300',
                          icon: '#fcd34d',
                        }
                      : {
                          container: 'bg-indigo-500/20 border-indigo-500/40',
                          text: 'text-indigo-300',
                          icon: '#a5b4fc',
                        };

                  return (
                    <View className="mb-4">
                      <View className="flex-row items-center gap-2 mb-2.5">
                        <TextInput
                          className="flex-1 text-white font-bold text-lg bg-slate-900/90 px-4 py-2.5 rounded-xl border border-slate-800"
                          value={activeDay?.name}
                          placeholder="Day Name"
                          placeholderTextColor="#64748b"
                          onChangeText={(text) => {
                            setDays((prev) => {
                              const copy = [...prev];
                              copy[activeDayIndex] = { ...copy[activeDayIndex], name: text };
                              return copy;
                            });
                          }}
                        />
                        {estMinutes > 0 && (
                          <View
                            className={`px-3 py-2.5 rounded-xl border flex-row items-center ${badgeStyle.container}`}
                          >
                            <Clock color={badgeStyle.icon} size={14} className="mr-1.5" />
                            <Text className={`text-xs font-extrabold ${badgeStyle.text}`}>
                              ~{estMinutes} min
                            </Text>
                          </View>
                        )}
                      </View>
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => {
                            setTargetSupersetIdForPicker(null);
                            setPickerVisible(true);
                          }}
                          className="flex-1 bg-blue-600/30 border border-blue-500/50 py-2.5 px-3 rounded-xl flex-row items-center justify-center"
                        >
                          <Plus color="#60a5fa" size={16} className="mr-1.5" />
                          <Text className="text-blue-300 font-bold text-xs sm:text-sm">+ Exercise</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={handleStartAddSuperset}
                          className="flex-1 bg-indigo-600/30 border border-indigo-500/50 py-2.5 px-3 rounded-xl flex-row items-center justify-center"
                        >
                          <Layers color="#a78bfa" size={16} className="mr-1.5" />
                          <Text className="text-indigo-300 font-bold text-xs sm:text-sm">+ Superset</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}

                {days[activeDayIndex]?.exercises.length === 0 ? (
                  <View className="bg-slate-900/40 border border-dashed border-slate-800 p-8 rounded-2xl items-center justify-center my-6">
                    <Dumbbell color="#64748b" size={32} className="mb-2" />
                    <Text className="text-slate-400 text-center font-medium mb-4">No exercises assigned to this day yet.</Text>
                    <View className="flex-row gap-3">
                      <TouchableOpacity
                        onPress={() => {
                          setTargetSupersetIdForPicker(null);
                          setPickerVisible(true);
                        }}
                        className="bg-blue-600 px-4 py-2.5 rounded-xl flex-row items-center"
                      >
                        <Plus color="white" size={16} className="mr-1.5" />
                        <Text className="text-white font-bold text-sm">Add Exercise</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleStartAddSuperset}
                        className="bg-indigo-600 px-4 py-2.5 rounded-xl flex-row items-center"
                      >
                        <Layers color="white" size={16} className="mr-1.5" />
                        <Text className="text-white font-bold text-sm">Add Superset</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  (() => {
                    const currentExercises = days[activeDayIndex]?.exercises || [];
                    const guardrails = evaluateSplitDayGuardrails(currentExercises);
                    const blocks = getDayBlocks(currentExercises);
                    const supersetLetterMap: Record<string, string> = {};
                    let letterCode = 65; // 'A'

                    currentExercises.forEach((ex) => {
                      if (ex.superset_id && !supersetLetterMap[ex.superset_id]) {
                        supersetLetterMap[ex.superset_id] = String.fromCharCode(letterCode++);
                      }
                    });

                    return (
                      <>
                        {/* Non-blocking Science Coaching Guardrails */}
                        {(guardrails.heavyLiftWarning || guardrails.fatigueWarnings.length > 0) && (
                          <View className="mb-3 space-y-2">
                            {guardrails.heavyLiftWarning && (
                              <View className="bg-indigo-950/50 border border-indigo-500/40 p-3 rounded-2xl flex-row items-start mb-2">
                                <AlertCircle color="#93c5fd" size={16} className="mr-2 mt-0.5 shrink-0" />
                                <View className="flex-1">
                                  <Text className="text-indigo-200 font-bold text-xs mb-0.5">
                                    Programming Coach Tip
                                  </Text>
                                  <Text className="text-indigo-300/90 text-[11px] leading-4">
                                    {guardrails.heavyLiftWarning}
                                  </Text>
                                </View>
                              </View>
                            )}
                            {guardrails.fatigueWarnings.length > 0 && (
                              <View className="bg-amber-950/40 border border-amber-500/40 p-3 rounded-2xl flex-row items-start mb-2">
                                <AlertTriangle color="#fbbf24" size={16} className="mr-2 mt-0.5 shrink-0" />
                                <View className="flex-1">
                                  <Text className="text-amber-300 font-bold text-xs mb-0.5">
                                    High Single-Session Fatigue Warning (&gt;15 sets/day)
                                  </Text>
                                  <Text className="text-amber-200/90 text-[11px] leading-4">
                                    {guardrails.fatigueWarnings
                                      .map((w) => `${w.muscleGroup}: ${w.sets} fractional sets`)
                                      .join(' • ')}{' '}
                                    — Consider spreading extra sets to another day.
                                  </Text>
                                </View>
                              </View>
                            )}
                          </View>
                        )}

                        {blocks.map((block, blockIdx) => {
                          const canMoveUp = blockIdx > 0;
                          const canMoveDown = blockIdx < blocks.length - 1;

                          if (block.type === 'standalone') {
                            const exIdx = block.indices[0];
                            const ex = currentExercises[exIdx];
                            const canLinkNext = exIdx < currentExercises.length - 1;

                            return (
                              <View key={`standalone_${exIdx}`} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-3">
                                <View className="flex-row justify-between items-center mb-3">
                                  <View className="flex-1 mr-2">
                                    <View className="flex-row items-center flex-wrap gap-1.5">
                                      <Text className="text-white font-bold text-base">{ex.name}</Text>
                                      {ex.is_unilateral ? (
                                        <View className="bg-cyan-500/20 border border-cyan-500/40 px-1.5 py-0.5 rounded">
                                          <Text className="text-cyan-300 text-[9px] font-extrabold tracking-wider">PER SIDE</Text>
                                        </View>
                                      ) : null}
                                    </View>
                                    <Text className="text-slate-400 text-xs">
                                      {ex.muscle_groups?.map(m => m.muscle_group).join(', ') || 'No muscle group'}
                                    </Text>
                                  </View>
                                  <View className="flex-row items-center gap-1.5">
                                    <TouchableOpacity
                                      onPress={() => handleMoveBlock(activeDayIndex, blockIdx, 'up')}
                                      disabled={!canMoveUp}
                                      className={`p-1.5 rounded-lg border ${canMoveUp ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-35'}`}
                                    >
                                      <ChevronUp color="#cbd5e1" size={14} />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => handleMoveBlock(activeDayIndex, blockIdx, 'down')}
                                      disabled={!canMoveDown}
                                      className={`p-1.5 rounded-lg border ${canMoveDown ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-35'}`}
                                    >
                                      <ChevronDown color="#cbd5e1" size={14} />
                                    </TouchableOpacity>
                                    {canLinkNext && (
                                      <TouchableOpacity
                                        onPress={() => handleLinkWithNext(activeDayIndex, exIdx)}
                                        className="bg-indigo-950/80 border border-indigo-500/40 px-2 py-1.5 rounded-xl flex-row items-center"
                                      >
                                        <Link2 color="#a78bfa" size={13} className="mr-1" />
                                        <Text className="text-indigo-300 text-xs font-semibold">Pair</Text>
                                      </TouchableOpacity>
                                    )}
                                    <TouchableOpacity onPress={() => handleRemoveExercise(activeDayIndex, exIdx)} className="p-1">
                                      <Trash2 color="#ef4444" size={17} />
                                    </TouchableOpacity>
                                  </View>
                                </View>

                                <View className="flex-row gap-2">
                                  <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                                    <Text className="text-slate-400 text-[11px] mb-1">Sets</Text>
                                    <TextInput
                                      className="text-white font-bold text-sm"
                                      keyboardType="number-pad"
                                      value={ex.planned_sets !== undefined && ex.planned_sets !== null ? String(ex.planned_sets) : ''}
                                      onChangeText={(t) => {
                                        const cleanVal = t.replace(/[^0-9]/g, '');
                                        handleUpdateExerciseProp(activeDayIndex, exIdx, 'planned_sets', cleanVal);
                                      }}
                                      placeholder="3"
                                      placeholderTextColor="#64748b"
                                    />
                                  </View>
                                  <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                                    <Text className="text-slate-400 text-[11px] mb-1">Rep Min</Text>
                                    <TextInput
                                      className="text-white font-bold text-sm"
                                      keyboardType="number-pad"
                                      value={ex.target_rep_min !== undefined && ex.target_rep_min !== null ? String(ex.target_rep_min) : ''}
                                      onChangeText={(t) => {
                                        const cleanVal = t.replace(/[^0-9]/g, '');
                                        handleUpdateExerciseProp(activeDayIndex, exIdx, 'target_rep_min', cleanVal);
                                      }}
                                      placeholder="8"
                                      placeholderTextColor="#64748b"
                                    />
                                  </View>
                                  <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                                    <Text className="text-slate-400 text-[11px] mb-1">Rep Max</Text>
                                    <TextInput
                                      className="text-white font-bold text-sm"
                                      keyboardType="number-pad"
                                      value={ex.target_rep_max !== undefined && ex.target_rep_max !== null ? String(ex.target_rep_max) : ''}
                                      onChangeText={(t) => {
                                        const cleanVal = t.replace(/[^0-9]/g, '');
                                        handleUpdateExerciseProp(activeDayIndex, exIdx, 'target_rep_max', cleanVal);
                                      }}
                                      placeholder="12"
                                      placeholderTextColor="#64748b"
                                    />
                                  </View>
                                  {!ex.is_bodyweight_only && (
                                    <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                                      <Text className="text-slate-400 text-[11px] mb-1">
                                        {ex.is_unilateral ? 'Target lbs (ea)' : 'Target lbs'}
                                      </Text>
                                      <TextInput
                                        className="text-white font-bold text-sm"
                                        keyboardType="decimal-pad"
                                        value={ex.target_weight !== undefined && ex.target_weight !== null ? String(ex.target_weight) : ''}
                                        onChangeText={(t) => {
                                          const cleanVal = t.replace(/[^0-9.]/g, '');
                                          handleUpdateExerciseProp(activeDayIndex, exIdx, 'target_weight', cleanVal === '' ? null : cleanVal);
                                        }}
                                        placeholder="—"
                                        placeholderTextColor="#64748b"
                                      />
                                    </View>
                                  )}
                                </View>
                              </View>
                            );
                          }

                          const sId = block.supersetId;
                          const letter = supersetLetterMap[sId] || 'A';
                          const groupItems = block.indices.map((origIdx) => ({
                            exercise: currentExercises[origIdx],
                            originalIndex: origIdx,
                          }));
                          const synergy = getSupersetSynergy(groupItems.map((g) => g.exercise));
                          const equipTip = getSupersetEquipmentTip(groupItems.map((g) => g.exercise));

                          return (
                            <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-4">
                              {/* Superset Header */}
                              <View className="flex-row justify-between items-center mb-3 pb-2.5 border-b border-indigo-500/20">
                                <View className="flex-row items-center flex-wrap gap-1.5 flex-1 mr-2">
                                  <View className="bg-indigo-600 px-2.5 py-1 rounded-lg flex-row items-center">
                                    <Layers color="white" size={12} className="mr-1" />
                                    <Text className="text-white font-extrabold text-xs tracking-wider">SUPERSET {letter}</Text>
                                  </View>
                                  {synergy && (
                                    <View className={`px-2 py-0.5 rounded-md border ${synergy.bgClass} ${synergy.borderClass}`}>
                                      <Text className={`text-[11px] font-bold ${synergy.textClass}`}>
                                        {synergy.label}
                                      </Text>
                                    </View>
                                  )}
                                  {equipTip && (
                                    <View className="px-2 py-0.5 rounded-md border bg-amber-500/20 border-amber-500/40">
                                      <Text className="text-[11px] font-bold text-amber-300">
                                        {equipTip.label}
                                      </Text>
                                    </View>
                                  )}
                                </View>

                                <View className="flex-row items-center gap-1.5">
                                  <TouchableOpacity
                                    onPress={() => handleMoveBlock(activeDayIndex, blockIdx, 'up')}
                                    disabled={!canMoveUp}
                                    className={`p-1.5 rounded-lg border ${canMoveUp ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-35'}`}
                                  >
                                    <ChevronUp color="#cbd5e1" size={13} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => handleMoveBlock(activeDayIndex, blockIdx, 'down')}
                                    disabled={!canMoveDown}
                                    className={`p-1.5 rounded-lg border ${canMoveDown ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-35'}`}
                                  >
                                    <ChevronDown color="#cbd5e1" size={13} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => handleAddExerciseToSuperset(sId)}
                                    className="bg-indigo-600/30 border border-indigo-500/50 px-2 py-1 rounded-lg flex-row items-center"
                                  >
                                    <Plus color="#a78bfa" size={12} className="mr-0.5" />
                                    <Text className="text-indigo-200 text-xs font-bold">Add Paired</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>

                              {/* Superset Exercises */}
                              {groupItems.map((item, subIdx) => {
                                const exItem = item.exercise;
                                const originalIdx = item.originalIndex;
                                const tag = `${letter}${exItem.superset_order || subIdx + 1}`;
                                const canMoveSlotUp = subIdx > 0;
                                const canMoveSlotDown = subIdx < groupItems.length - 1;

                                return (
                                  <View key={`sub_${originalIdx}`} className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 mb-2.5">
                                    <View className="flex-row justify-between items-center mb-2.5">
                                      <View className="flex-row items-center flex-1 mr-2">
                                        <View className="bg-indigo-500/30 border border-indigo-500/50 px-2 py-0.5 rounded mr-2">
                                          <Text className="text-indigo-300 font-mono font-bold text-xs">{tag}</Text>
                                        </View>
                                        <View className="flex-1">
                                          <View className="flex-row items-center flex-wrap gap-1.5">
                                            <Text className="text-white font-bold text-sm">{exItem.name}</Text>
                                            {exItem.is_unilateral ? (
                                              <View className="bg-cyan-500/20 border border-cyan-500/40 px-1.5 py-0.5 rounded">
                                                <Text className="text-cyan-300 text-[9px] font-extrabold tracking-wider">PER SIDE</Text>
                                              </View>
                                            ) : null}
                                          </View>
                                          <Text className="text-slate-400 text-[11px]">
                                            {exItem.muscle_groups?.map(m => m.muscle_group).join(', ') || 'No muscle group'}
                                          </Text>
                                        </View>
                                      </View>

                                      <View className="flex-row items-center gap-1">
                                        {groupItems.length > 1 && (
                                          <>
                                            <TouchableOpacity
                                              onPress={() => handleMoveInSuperset(activeDayIndex, sId, subIdx, 'up')}
                                              disabled={!canMoveSlotUp}
                                              className={`p-1 rounded-md border ${canMoveSlotUp ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-30'}`}
                                            >
                                              <ChevronUp color="#94a3b8" size={12} />
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                              onPress={() => handleMoveInSuperset(activeDayIndex, sId, subIdx, 'down')}
                                              disabled={!canMoveSlotDown}
                                              className={`p-1 rounded-md border ${canMoveSlotDown ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-30'}`}
                                            >
                                              <ChevronDown color="#94a3b8" size={12} />
                                            </TouchableOpacity>
                                          </>
                                        )}
                                        <TouchableOpacity
                                          onPress={() => handleUnlinkExercise(activeDayIndex, originalIdx)}
                                          className="bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg flex-row items-center"
                                        >
                                          <Unlink color="#94a3b8" size={12} className="mr-1" />
                                          <Text className="text-slate-300 text-[11px] font-semibold">Unlink</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => handleRemoveExercise(activeDayIndex, originalIdx)} className="p-1">
                                          <Trash2 color="#ef4444" size={16} />
                                        </TouchableOpacity>
                                      </View>
                                    </View>

                                    <View className="flex-row gap-2">
                                      <View className="flex-1 bg-slate-800 p-2 rounded-xl">
                                        <Text className="text-slate-400 text-[10px] mb-0.5">Sets</Text>
                                        <TextInput
                                          className="text-white font-bold text-sm"
                                          keyboardType="number-pad"
                                          value={exItem.planned_sets !== undefined && exItem.planned_sets !== null ? String(exItem.planned_sets) : ''}
                                          onChangeText={(t) => {
                                            const cleanVal = t.replace(/[^0-9]/g, '');
                                            handleUpdateExerciseProp(activeDayIndex, originalIdx, 'planned_sets', cleanVal);
                                          }}
                                          placeholder="3"
                                          placeholderTextColor="#64748b"
                                        />
                                      </View>
                                      <View className="flex-1 bg-slate-800 p-2 rounded-xl">
                                        <Text className="text-slate-400 text-[10px] mb-0.5">Rep Min</Text>
                                        <TextInput
                                          className="text-white font-bold text-sm"
                                          keyboardType="number-pad"
                                          value={exItem.target_rep_min !== undefined && exItem.target_rep_min !== null ? String(exItem.target_rep_min) : ''}
                                          onChangeText={(t) => {
                                            const cleanVal = t.replace(/[^0-9]/g, '');
                                            handleUpdateExerciseProp(activeDayIndex, originalIdx, 'target_rep_min', cleanVal);
                                          }}
                                          placeholder="8"
                                          placeholderTextColor="#64748b"
                                        />
                                      </View>
                                      <View className="flex-1 bg-slate-800 p-2 rounded-xl">
                                        <Text className="text-slate-400 text-[10px] mb-0.5">Rep Max</Text>
                                        <TextInput
                                          className="text-white font-bold text-sm"
                                          keyboardType="number-pad"
                                          value={exItem.target_rep_max !== undefined && exItem.target_rep_max !== null ? String(exItem.target_rep_max) : ''}
                                          onChangeText={(t) => {
                                            const cleanVal = t.replace(/[^0-9]/g, '');
                                            handleUpdateExerciseProp(activeDayIndex, originalIdx, 'target_rep_max', cleanVal);
                                          }}
                                          placeholder="12"
                                          placeholderTextColor="#64748b"
                                        />
                                      </View>
                                      {!exItem.is_bodyweight_only && (
                                        <View className="flex-1 bg-slate-800 p-2 rounded-xl">
                                          <Text className="text-slate-400 text-[10px] mb-0.5">
                                            {exItem.is_unilateral ? 'Target lbs (ea)' : 'Target lbs'}
                                          </Text>
                                          <TextInput
                                            className="text-white font-bold text-sm"
                                            keyboardType="decimal-pad"
                                            value={exItem.target_weight !== undefined && exItem.target_weight !== null ? String(exItem.target_weight) : ''}
                                            onChangeText={(t) => {
                                              const cleanVal = t.replace(/[^0-9.]/g, '');
                                              handleUpdateExerciseProp(activeDayIndex, originalIdx, 'target_weight', cleanVal === '' ? null : cleanVal);
                                            }}
                                            placeholder="—"
                                            placeholderTextColor="#64748b"
                                          />
                                        </View>
                                      )}
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })}
                      </>
                    );
                  })()
                )}
              </ScrollView>

              {/* Navigation & Action Buttons */}
              <View className="pt-3 border-t border-slate-900 mt-2">
                <TouchableOpacity
                  onPress={() => setStep(3)}
                  className="bg-indigo-600 p-4 rounded-2xl flex-row items-center justify-center mb-3"
                >
                  <Text className="text-white font-bold text-base mr-2">Next: Review & Save Routine</Text>
                  <ChevronRight color="white" size={20} />
                </TouchableOpacity>

                <View className="flex-row gap-3">
                  <TouchableOpacity onPress={() => setStep(1)} className="bg-slate-800 p-3.5 rounded-2xl flex-1 items-center justify-center">
                    <Text className="text-slate-300 font-semibold">Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleCommitRoutine(editingRoutineId ? existingStatus === 'active' : true)}
                    disabled={loading}
                    className="bg-blue-600 p-3.5 rounded-2xl flex-1 items-center flex-row justify-center"
                  >
                    {loading ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Check color="white" size={16} className="mr-1.5" />
                        <Text className="text-white font-bold text-sm">
                          {editingRoutineId ? 'Save Changes' : 'Save & Activate'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* STEP 3: VOLUMETRIC SANDBOX REVIEW */}
          {step === 3 && (
            <ScrollView className="flex-1">
              <View className="bg-indigo-950/40 p-5 rounded-2xl border border-indigo-500/30 mb-4">
                <View className="flex-row items-center mb-2">
                  <Sparkles color="#a78bfa" size={20} className="mr-2" />
                  <Text className="text-white font-bold text-lg">Volumetric Impact Dashboard</Text>
                </View>
                <Text className="text-indigo-200 text-xs leading-5 mb-3">
                  Evaluates weekly planned working sets per sub-muscle against ACSM umbrella-review landmarks (Optimal Hypertrophy: 10–22 fractional sets/week).
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {days.map((d) => {
                    const mins = estimateSplitDayMinutes(d.exercises, getDayBlocks(d.exercises), {
                      defaultRestSeconds,
                      lockRestTimerToDefault,
                      supersetTransitionSeconds,
                    });
                    const colorCls =
                      mins <= 20
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : mins <= 30
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200';
                    return (
                      <View key={d.day_number} className={`px-2.5 py-1 rounded-lg border ${colorCls.split(' ').slice(0, 2).join(' ')}`}>
                        <Text className={`text-[11px] font-bold ${colorCls.split(' ')[2]}`}>
                          {d.name}: ~{mins} min
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Muscle Progress Bars */}
              <View className="space-y-4 mb-8">
                {MUSCLE_GROUPS.map((group) => {
                  const sets = Math.round((muscleVolumes[group] || 0) * 10) / 10;
                  const percentage = Math.min(Math.round((sets / 22) * 100), 100);
                  const volumeMeta = getHypertrophyVolumeMeta(sets);

                  return (
                    <View key={group} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-3">
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="text-white font-bold text-base">{group}</Text>
                        <Text className="text-slate-300 font-semibold">{sets} sets / week</Text>
                      </View>
                      <View className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                        <View style={{ width: `${percentage}%`, backgroundColor: volumeMeta.color }} className="h-full" />
                      </View>
                      <Text style={{ color: volumeMeta.color }} className="text-xs font-semibold mt-1.5">
                        {volumeMeta.statusText}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Commit Actions */}
              <View className="space-y-3 mb-10">
                <TouchableOpacity
                  onPress={() => handleCommitRoutine(true)}
                  disabled={loading}
                  className="bg-blue-600 p-4 rounded-2xl items-center flex-row justify-center mb-3"
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Check color="white" size={20} className="mr-2" />
                      <Text className="text-white font-bold text-lg">
                        {editingRoutineId ? 'Save & Activate Split' : 'Save & Activate Routine'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleCommitRoutine(false)}
                  disabled={loading}
                  className="bg-slate-800 p-4 rounded-2xl items-center mb-3"
                >
                  <Text className="text-slate-300 font-semibold">Save as Draft</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setStep(2)} className="p-3 items-center">
                  <Text className="text-slate-400">Back to Edit Exercises</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </>
      )}

      {/* Exercise Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View className="flex-1 bg-slate-950/95 p-6 pt-12">
          <View className="flex-row justify-between items-center mb-6">
            <View>
              <Text className="text-white text-2xl font-bold">
                {showCreateForm ? 'Create Exercise' : 'Select Exercise'}
              </Text>
              {!showCreateForm && (
                <Text className="text-slate-400 text-xs mt-0.5">
                  Pick an exercise or add a new one to library
                </Text>
              )}
            </View>
            <View className="flex-row items-center gap-2">
              {!showCreateForm ? (
                <TouchableOpacity
                  onPress={() => setShowCreateForm(true)}
                  className="bg-blue-600/30 border border-blue-500/50 px-3 py-1.5 rounded-xl flex-row items-center"
                >
                  <Plus color="#60a5fa" size={16} className="mr-1" />
                  <Text className="text-blue-300 font-bold text-xs">+ Add New</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowCreateForm(false)}
                  className="bg-slate-800 px-3 py-1.5 rounded-xl mr-1"
                >
                  <Text className="text-slate-300 font-semibold text-xs">Back to List</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  setPickerVisible(false);
                  setShowCreateForm(false);
                }}
                className="p-2 bg-slate-800 rounded-full"
              >
                <X color="#94a3b8" size={20} />
              </TouchableOpacity>
            </View>
          </View>

          {showCreateForm ? (
            <ScrollView className="flex-1 space-y-4">
              {/* Exercise Name */}
              <View className="mb-3">
                <Text className="text-slate-400 text-xs font-semibold uppercase mb-1">Exercise Name</Text>
                <TextInput
                  className="bg-slate-900 border border-slate-800 text-white p-3.5 rounded-xl font-medium"
                  placeholder="e.g. Incline Dumbbell Press"
                  placeholderTextColor="#64748b"
                  value={newExName}
                  onChangeText={setNewExName}
                />
              </View>

              {/* Primary Muscle Group */}
              <View className="mb-3">
                <Text className="text-slate-400 text-xs font-semibold uppercase mb-2">Primary Muscle Group (1.0x Volume)</Text>
                <View className="flex-row flex-wrap gap-2">
                  {MUSCLE_GROUPS.map((m) => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => {
                        setNewExPrimaryMuscle(m);
                        setNewExSecondaryMuscles(prev => prev.filter(sec => sec !== m));
                      }}
                      className={`px-3.5 py-2 rounded-xl border mr-1 mb-1 ${
                        newExPrimaryMuscle === m
                          ? 'bg-blue-600 border-blue-500'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <Text className={`font-semibold text-xs ${newExPrimaryMuscle === m ? 'text-white' : 'text-slate-400'}`}>
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Secondary Muscle Groups */}
              <View className="mb-3">
                <Text className="text-slate-400 text-xs font-semibold uppercase mb-2">Secondary Muscle Groups (0.5x Volume)</Text>
                <View className="flex-row flex-wrap gap-2">
                  {MUSCLE_GROUPS.filter(m => m !== newExPrimaryMuscle).map((m) => {
                    const isSelected = newExSecondaryMuscles.includes(m);
                    return (
                      <TouchableOpacity
                        key={m}
                        onPress={() => {
                          if (isSelected) {
                            setNewExSecondaryMuscles(prev => prev.filter(sec => sec !== m));
                          } else {
                            setNewExSecondaryMuscles(prev => [...prev, m]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-xl border mr-1 mb-1 ${
                          isSelected
                            ? 'bg-indigo-600/40 border-indigo-500'
                            : 'bg-slate-900/60 border-slate-800'
                        }`}
                      >
                        <Text className={`font-semibold text-xs ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                          {m}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Equipment Selector */}
              <View className="mb-3">
                <Text className="text-slate-400 text-xs font-semibold uppercase mb-2">Equipment</Text>
                <View className="flex-row flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((eq) => {
                    const selected = newExEquipment === eq;
                    return (
                      <TouchableOpacity
                        key={eq}
                        onPress={() => {
                          setNewExEquipment(eq);
                          setNewExIsBodyweight(eq === 'bodyweight' || eq === 'pullup_dip_bar');
                        }}
                        className={`px-3 py-1.5 rounded-xl border ${
                          selected
                            ? 'bg-emerald-600/30 border-emerald-500'
                            : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        <Text className={`font-semibold text-xs ${selected ? 'text-emerald-200' : 'text-slate-400'}`}>
                          {EQUIPMENT_LABELS[eq]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Unilateral Toggle */}
              <TouchableOpacity
                onPress={() => setNewExIsUnilateral(!newExIsUnilateral)}
                className="flex-row justify-between items-center bg-slate-900 border border-slate-800 p-4 rounded-xl mb-3"
              >
                <View className="flex-1 mr-3">
                  <Text className="text-white font-semibold text-sm">Unilateral (Per-Side)</Text>
                  <Text className="text-slate-500 text-xs">Logs per-limb weight & doubles tonnage</Text>
                </View>
                <View className={`w-6 h-6 rounded-md items-center justify-center ${newExIsUnilateral ? 'bg-cyan-600' : 'bg-slate-800 border border-slate-700'}`}>
                  {newExIsUnilateral && <Check color="white" size={14} />}
                </View>
              </TouchableOpacity>

              {/* Bodyweight Toggle */}
              <TouchableOpacity
                onPress={() => {
                  const nextVal = !newExIsBodyweight;
                  setNewExIsBodyweight(nextVal);
                  if (nextVal && newExEquipment !== 'bodyweight' && newExEquipment !== 'pullup_dip_bar') {
                    setNewExEquipment('bodyweight');
                  } else if (!nextVal && (newExEquipment === 'bodyweight' || newExEquipment === 'pullup_dip_bar')) {
                    setNewExEquipment('dumbbell');
                  }
                }}
                className="flex-row justify-between items-center bg-slate-900 border border-slate-800 p-4 rounded-xl mb-4"
              >
                <View className="flex-1 mr-3">
                  <Text className="text-white font-semibold text-sm">Bodyweight-Only Exercise</Text>
                  <Text className="text-slate-500 text-xs">Strips weight inputs across workout screens</Text>
                </View>
                <View className={`w-6 h-6 rounded-md items-center justify-center ${newExIsBodyweight ? 'bg-blue-600' : 'bg-slate-800 border border-slate-700'}`}>
                  {newExIsBodyweight && <Check color="white" size={14} />}
                </View>
              </TouchableOpacity>

              {/* Action Button */}
              <TouchableOpacity
                onPress={handleCreateAndSelectExercise}
                disabled={creatingExercise}
                className="bg-blue-600 p-4 rounded-2xl items-center flex-row justify-center mb-8"
              >
                {creatingExercise ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Plus color="white" size={18} className="mr-2" />
                    <Text className="text-white font-bold text-base">Create & Add to Routine</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          ) : fetchingExercises ? (
            <ActivityIndicator color="#3b82f6" size="large" className="my-10" />
          ) : (
            <View className="flex-1">
              {/* Search Bar */}
              <View className="flex-row items-center bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 mb-3">
                <Search color="#94a3b8" size={18} className="mr-2" />
                <TextInput
                  className="flex-1 text-white font-medium text-sm"
                  placeholder="Search exercises by name, equipment, or muscle..."
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
                    <X color="#94a3b8" size={16} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Equipment Filter Chips */}
              <View className="mb-3">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {(
                    [
                      { key: 'my_gym', label: myGymChipLabel },
                      { key: 'dumbbell', label: 'Dumbbell' },
                      { key: 'bodyweight', label: 'Bodyweight' },
                      { key: 'all', label: 'All' },
                    ] as const
                  ).map((chip) => {
                    const active = pickerEquipmentFilter === chip.key;
                    return (
                      <TouchableOpacity
                        key={chip.key}
                        onPress={() => setPickerEquipmentFilter(chip.key)}
                        className={`px-3.5 py-1.5 rounded-full border ${
                          active
                            ? 'bg-emerald-600/25 border-emerald-500'
                            : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        <Text className={`text-xs font-bold ${active ? 'text-emerald-300' : 'text-slate-300'}`}>
                          {chip.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {filteredExercises.length === 0 ? (
                <View className="flex-1 items-center justify-center py-10 px-4">
                  <Dumbbell color="#64748b" size={32} className="mb-2" />
                  <Text className="text-slate-400 text-center font-medium mb-4">
                    {searchQuery
                      ? `No exercises found matching "${searchQuery}"`
                      : 'No exercises match this equipment filter.'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setNewExName(searchQuery);
                      setShowCreateForm(true);
                    }}
                    className="bg-blue-600 px-4 py-2 rounded-xl flex-row items-center"
                  >
                    <Plus color="white" size={16} className="mr-1" />
                    <Text className="text-white font-bold text-sm">Create "{searchQuery}"</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView className="flex-1 space-y-3">
                  {filteredExercises.map((ex) => {
                    const eqLabel = EQUIPMENT_LABELS[resolveExerciseEquipment(ex)];
                    return (
                      <TouchableOpacity
                        key={ex.id}
                        onPress={() => handleAddExerciseToActiveDay(ex, targetSupersetIdForPicker)}
                        className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex-row justify-between items-center mb-3"
                      >
                        <View className="flex-1 mr-3">
                          <View className="flex-row items-center flex-wrap gap-1.5">
                            <Text className="text-white font-bold text-base">{ex.name}</Text>
                            {ex.is_unilateral ? (
                              <View className="bg-cyan-500/20 px-1.5 py-0.5 rounded border border-cyan-500/40">
                                <Text className="text-cyan-300 text-[9px] font-extrabold">PER SIDE</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text className="text-slate-400 text-xs mt-1">
                            {eqLabel} •{' '}
                            {ex.exercise_muscle_groups
                              ?.map((m) => `${normalizeMuscleGroup(m.muscle_group)} (${m.fraction}x)`)
                              .join(', ') || 'No muscle mapped'}
                          </Text>
                        </View>
                        <Plus color="#3b82f6" size={20} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
