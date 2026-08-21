import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { X, Plus, Trash2, ChevronRight, Check, Sparkles, AlertCircle, Dumbbell, Search, Layers, Link2, Unlink } from 'lucide-react-native';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Core'] as const;

// Helper to determine muscle synergy for a group of exercises
const getSupersetSynergy = (exercises: RoutineExerciseItem[]) => {
  if (exercises.length < 2) return null;

  const primaryMuscles: string[] = [];
  exercises.forEach((ex) => {
    ex.muscle_groups?.forEach((mg) => {
      if (mg.fraction >= 1.0) {
        primaryMuscles.push(mg.muscle_group);
      }
    });
  });

  const uniquePrimaries = new Set(primaryMuscles);

  // If there are duplicate primary muscles, it's competing
  if (primaryMuscles.length > uniquePrimaries.size) {
    return {
      type: 'competing',
      label: 'Competing Muscles',
      description: 'Multiple exercises target the same primary muscle'
    };
  }

  // Check for antagonist pairings
  const isChestBack = uniquePrimaries.has('Chest') && uniquePrimaries.has('Back');
  const isBicepsTriceps = uniquePrimaries.has('Biceps') && uniquePrimaries.has('Triceps');
  const isLegsUpper = uniquePrimaries.has('Legs') && (uniquePrimaries.has('Chest') || uniquePrimaries.has('Back') || uniquePrimaries.has('Shoulders'));

  if (isChestBack || isBicepsTriceps) {
    return {
      type: 'antagonist',
      label: 'Antagonist Synergy',
      description: 'Opposing muscle groups maximize recovery'
    };
  }

  return {
    type: 'non_competing',
    label: 'Non-Competing Pair',
    description: 'Independent muscle groups run efficiently'
  };
};

type ExerciseOption = {
  id: string;
  name: string;
  is_bodyweight_only: boolean;
  exercise_muscle_groups?: Array<{ muscle_group: string; fraction: number }>;
};

type RoutineExerciseItem = {
  exercise_id: string;
  name: string;
  planned_sets: number | string;
  target_reps: number | string;
  target_weight: number | string | null;
  is_bodyweight_only: boolean;
  muscle_groups: Array<{ muscle_group: string; fraction: number }>;
  superset_id?: string | null;
  superset_order?: number;
};

type DaySplit = {
  day_number: number;
  name: string;
  exercises: RoutineExerciseItem[];
};

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Setup, 2: Assign, 3: Volumetric Sandbox Review
  const [loading, setLoading] = useState(false);
  
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
        const updated = [...prevDays];
        for (let i = prevDays.length; i < newCount; i++) {
          updated.push({
            day_number: i + 1,
            name: `Day ${i + 1}`,
            exercises: [],
          });
        }
        return updated;
      } else {
        return prevDays.slice(0, newCount);
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
            name: `Day ${i + 1}`,
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

  // Filtered exercises based on search query
  const filteredExercises = useMemo(() => {
    if (!searchQuery.trim()) return availableExercises;
    const q = searchQuery.toLowerCase().trim();
    return availableExercises.filter((ex) => {
      const nameMatch = ex.name.toLowerCase().includes(q);
      const muscleMatch = ex.exercise_muscle_groups?.some(m =>
        m.muscle_group.toLowerCase().includes(q)
      );
      return nameMatch || muscleMatch;
    });
  }, [availableExercises, searchQuery]);

  // New Exercise Inline Creation State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExPrimaryMuscle, setNewExPrimaryMuscle] = useState<string>('Chest');
  const [newExSecondaryMuscles, setNewExSecondaryMuscles] = useState<string[]>([]);
  const [newExIsBodyweight, setNewExIsBodyweight] = useState(false);

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
      // 1. Insert exercise
      const { data: exData, error: exErr } = await supabase
        .from('exercises')
        .insert([{
          user_id: userId,
          name: newExName.trim(),
          is_bodyweight_only: newExIsBodyweight,
          default_rest_timer_seconds: 90,
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (exErr || !exData) throw exErr || new Error('Failed to create exercise');

      // 2. Insert muscle groups
      const muscleRows = [
        { exercise_id: exData.id, muscle_group: newExPrimaryMuscle, fraction: 1.0 },
        ...newExSecondaryMuscles.filter(m => m !== newExPrimaryMuscle).map(m => ({
          exercise_id: exData.id,
          muscle_group: m,
          fraction: 0.5
        }))
      ];

      await supabase.from('exercise_muscle_groups').insert(muscleRows);

      const createdOption: ExerciseOption = {
        id: exData.id,
        name: exData.name,
        is_bodyweight_only: exData.is_bodyweight_only,
        exercise_muscle_groups: muscleRows.map(r => ({ muscle_group: r.muscle_group, fraction: r.fraction }))
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
      setNewExIsBodyweight(false);
    } catch (err: any) {
      setCreatingExercise(false);
      Alert.alert('Create Error', err.message || 'Failed to create exercise');
    }
  };

  // Add exercise to currently active day (optionally to a superset)
  const handleAddExerciseToActiveDay = async (ex: ExerciseOption, supersetId?: string | null) => {
    let initialWeight: number | null = null;

    if (!ex.is_bodyweight_only) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data } = await supabase
            .from('session_sets')
            .select('weight, session_exercises!inner(exercise_id, sessions!inner(user_id))')
            .eq('session_exercises.exercise_id', ex.id)
            .eq('session_exercises.sessions.user_id', session.user.id)
            .eq('is_completed', true)
            .not('weight', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);

          if (data && data.length > 0 && data[0].weight !== null && data[0].weight !== undefined) {
            initialWeight = Number(data[0].weight);
          }
        }
      } catch (err) {
        console.error('Error fetching last completed weight:', err);
      }
    }

    setDays((prevDays) => {
      const copy = [...prevDays];
      const currentDayExercises = copy[activeDayIndex].exercises;

      let supersetOrder = 1;
      if (supersetId) {
        const existingInSuperset = currentDayExercises.filter(e => e.superset_id === supersetId);
        supersetOrder = existingInSuperset.length + 1;
      }

      const newExerciseItem: RoutineExerciseItem = {
        exercise_id: ex.id,
        name: ex.name,
        planned_sets: 3,
        target_reps: 10,
        target_weight: initialWeight,
        is_bodyweight_only: ex.is_bodyweight_only,
        muscle_groups: ex.exercise_muscle_groups || [],
        superset_id: supersetId || null,
        superset_order: supersetId ? supersetOrder : 1
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

  // Update exercise properties (sets, reps, weight)
  const handleUpdateExerciseProp = (dayIdx: number, exIdx: number, key: keyof RoutineExerciseItem, val: any) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      copy[dayIdx].exercises[exIdx] = {
        ...copy[dayIdx].exercises[exIdx],
        [key]: val
      };
      return copy;
    });
  };

  // Calculate Real-time Volumetric Vector Impact across entire routine
  const muscleVolumes = useMemo(() => {
    const volumes: Record<string, number> = {
      Chest: 0,
      Back: 0,
      Shoulders: 0,
      Legs: 0,
      Biceps: 0,
      Triceps: 0,
      Core: 0
    };

    days.forEach((day) => {
      day.exercises.forEach((ex) => {
        const sets = Number(ex.planned_sets) || 0;
        ex.muscle_groups.forEach((m) => {
          const groupName = m.muscle_group;
          const fraction = Number(m.fraction) || 1.0;
          if (volumes[groupName] !== undefined) {
            volumes[groupName] += sets * fraction;
          }
        });
      });
    });

    return volumes;
  }, [days]);

  // Save Routine to Supabase
  const handleCommitRoutine = async (shouldActivate: boolean) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        setLoading(false);
        const msg = 'You must be logged in to create a routine.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Error', msg);
        return;
      }

      const cleanDaysInSplit = Math.max(3, Math.min(7, Number(daysInSplit) || 3));
      const cleanCycles = Math.max(1, Number(cyclesPerRoutine) || 3);
      const cleanName = routineName.trim() || 'My Custom Split';

      // 1. Insert Routine
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

      const routineId = routineData.id;

      // If set to active, deactivate other routines for this user
      if (shouldActivate) {
        const { error: deactErr } = await supabase
          .from('routines')
          .update({ status: 'draft' })
          .eq('user_id', userId)
          .neq('id', routineId);
        if (deactErr) console.warn('Could not deactivate other routines:', deactErr);
      }

      // Ensure days array has exactly cleanDaysInSplit elements
      const finalDays: DaySplit[] = [...days.slice(0, cleanDaysInSplit)];
      while (finalDays.length < cleanDaysInSplit) {
        finalDays.push({
          day_number: finalDays.length + 1,
          name: `Day ${finalDays.length + 1}`,
          exercises: [],
        });
      }

      // 2. Insert Routine Days & Exercises
      for (let i = 0; i < finalDays.length; i++) {
        const d = finalDays[i];
        const dayNumber = i + 1;

        const { data: dayData, error: dayErr } = await supabase
          .from('routine_days')
          .insert([{
            routine_id: routineId,
            day_number: dayNumber,
          }])
          .select()
          .single();

        if (dayErr || !dayData) {
          throw dayErr || new Error(`Failed to create routine day ${dayNumber}`);
        }

        const dayId = dayData.id;

        // Insert Exercises for this day
        if (d.exercises && d.exercises.length > 0) {
          const exerciseRows = d.exercises.map((ex, idx) => {
            const rawSets = parseInt(String(ex.planned_sets), 10);
            const rawReps = parseInt(String(ex.target_reps), 10);
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
              target_reps: isNaN(rawReps) || rawReps < 1 ? 10 : rawReps,
              target_weight: ex.is_bodyweight_only ? null : parsedWeight,
              superset_id: ex.superset_id || null,
              superset_order: Number(ex.superset_order) || 1,
            };
          });

          const { error: exErr } = await supabase.from('routine_exercises').insert(exerciseRows);
          if (exErr) {
            // Fallback: If superset_id column does not exist on remote schema cache, retry without superset columns
            if (exErr.message?.includes('superset_id') || exErr.details?.includes('superset_id') || exErr.message?.includes('schema cache')) {
              const fallbackRows = exerciseRows.map(({ superset_id, superset_order, ...rest }) => rest);
              const { error: fallbackErr } = await supabase.from('routine_exercises').insert(fallbackRows);
              if (fallbackErr) throw fallbackErr;
            } else {
              throw exErr;
            }
          }
        }
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
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Step {step} of 3 • Sandbox Mode
          </Text>
          <Text className="text-white text-2xl font-bold" numberOfLines={1}>
            {step === 1 ? 'Split Setup' : step === 2 ? 'Assign Exercises' : 'Volumetric Review'}
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
            <View className="flex-row justify-between mb-4">
              {[3, 4, 5, 6, 7].map((num) => (
                <TouchableOpacity
                  key={num}
                  onPress={() => handleDaysInSplitChange(num)}
                  className={`w-12 h-12 rounded-xl items-center justify-center border ${
                    daysInSplit === num ? 'bg-blue-600 border-blue-400' : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <Text className={`font-bold text-lg ${daysInSplit === num ? 'text-white' : 'text-slate-400'}`}>
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
            <View className="mb-4">
              <TextInput
                className="text-white font-bold text-lg bg-slate-900/90 px-4 py-2.5 rounded-xl border border-slate-800 mb-2.5"
                value={days[activeDayIndex]?.name}
                placeholder="Day Name"
                placeholderTextColor="#64748b"
                onChangeText={(text) => {
                  setDays((prev) => {
                    const copy = [...prev];
                    copy[activeDayIndex].name = text;
                    return copy;
                  });
                }}
              />
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
                const supersetLetterMap: Record<string, string> = {};
                let letterCode = 65; // 'A'

                currentExercises.forEach((ex) => {
                  if (ex.superset_id && !supersetLetterMap[ex.superset_id]) {
                    supersetLetterMap[ex.superset_id] = String.fromCharCode(letterCode++);
                  }
                });

                const processedSupersets = new Set<string>();
                const elements: any[] = [];

                for (let i = 0; i < currentExercises.length; i++) {
                  const ex = currentExercises[i];

                  if (!ex.superset_id) {
                    const exIdx = i;
                    const canLinkNext = exIdx < currentExercises.length - 1;

                    elements.push(
                      <View key={`standalone_${exIdx}`} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-3">
                        <View className="flex-row justify-between items-center mb-3">
                          <View className="flex-1 mr-2">
                            <Text className="text-white font-bold text-base">{ex.name}</Text>
                            <Text className="text-slate-400 text-xs">
                              {ex.muscle_groups?.map(m => m.muscle_group).join(', ') || 'No muscle group'}
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-2">
                            {canLinkNext && (
                              <TouchableOpacity
                                onPress={() => handleLinkWithNext(activeDayIndex, exIdx)}
                                className="bg-indigo-950/80 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl flex-row items-center"
                              >
                                <Link2 color="#a78bfa" size={13} className="mr-1" />
                                <Text className="text-indigo-300 text-xs font-semibold">Pair Next</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity onPress={() => handleRemoveExercise(activeDayIndex, exIdx)} className="p-1">
                              <Trash2 color="#ef4444" size={18} />
                            </TouchableOpacity>
                          </View>
                        </View>

                        <View className="flex-row gap-3">
                          <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                            <Text className="text-slate-400 text-xs mb-1">Sets</Text>
                            <TextInput
                              className="text-white font-bold text-base"
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
                            <Text className="text-slate-400 text-xs mb-1">Target Reps</Text>
                            <TextInput
                              className="text-white font-bold text-base"
                              keyboardType="number-pad"
                              value={ex.target_reps !== undefined && ex.target_reps !== null ? String(ex.target_reps) : ''}
                              onChangeText={(t) => {
                                const cleanVal = t.replace(/[^0-9]/g, '');
                                handleUpdateExerciseProp(activeDayIndex, exIdx, 'target_reps', cleanVal);
                              }}
                              placeholder="10"
                              placeholderTextColor="#64748b"
                            />
                          </View>
                          {!ex.is_bodyweight_only && (
                            <View className="flex-1 bg-slate-800 p-2.5 rounded-xl">
                              <Text className="text-slate-400 text-xs mb-1">Target (lbs)</Text>
                              <TextInput
                                className="text-white font-bold text-base"
                                keyboardType="decimal-pad"
                                value={ex.target_weight !== undefined && ex.target_weight !== null ? String(ex.target_weight) : ''}
                                onChangeText={(t) => {
                                  const cleanVal = t.replace(/[^0-9.]/g, '');
                                  handleUpdateExerciseProp(activeDayIndex, exIdx, 'target_weight', cleanVal === '' ? null : cleanVal);
                                }}
                                placeholder="Blank"
                                placeholderTextColor="#64748b"
                              />
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  } else if (!processedSupersets.has(ex.superset_id)) {
                    processedSupersets.add(ex.superset_id);
                    const sId = ex.superset_id;
                    const letter = supersetLetterMap[sId] || 'A';
                    const groupItems = currentExercises
                      .map((e, idx) => ({ exercise: e, originalIndex: idx }))
                      .filter(item => item.exercise.superset_id === sId);

                    const synergy = getSupersetSynergy(groupItems.map(g => g.exercise));

                    elements.push(
                      <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-4">
                        {/* Superset Header */}
                        <View className="flex-row justify-between items-center mb-3 pb-2.5 border-b border-indigo-500/20">
                          <View className="flex-row items-center flex-wrap gap-1.5 flex-1 mr-2">
                            <View className="bg-indigo-600 px-2.5 py-1 rounded-lg flex-row items-center">
                              <Layers color="white" size={12} className="mr-1" />
                              <Text className="text-white font-extrabold text-xs tracking-wider">SUPERSET {letter}</Text>
                            </View>
                            {synergy && (
                              <View className={`px-2 py-0.5 rounded-md border ${
                                synergy.type === 'antagonist'
                                  ? 'bg-emerald-500/20 border-emerald-500/40'
                                  : synergy.type === 'non_competing'
                                  ? 'bg-teal-500/20 border-teal-500/40'
                                  : 'bg-amber-500/20 border-amber-500/40'
                              }`}>
                                <Text className={`text-[11px] font-bold ${
                                  synergy.type === 'antagonist'
                                    ? 'text-emerald-300'
                                    : synergy.type === 'non_competing'
                                    ? 'text-teal-300'
                                    : 'text-amber-300'
                                }`}>
                                  {synergy.label}
                                </Text>
                              </View>
                            )}
                          </View>

                          <TouchableOpacity
                            onPress={() => handleAddExerciseToSuperset(sId)}
                            className="bg-indigo-600/30 border border-indigo-500/50 px-2 py-1 rounded-lg flex-row items-center"
                          >
                            <Plus color="#a78bfa" size={12} className="mr-0.5" />
                            <Text className="text-indigo-200 text-xs font-bold">+ Add Paired</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Superset Exercises */}
                        {groupItems.map((item, subIdx) => {
                          const exItem = item.exercise;
                          const originalIdx = item.originalIndex;
                          const tag = `${letter}${exItem.superset_order || subIdx + 1}`;

                          return (
                            <View key={`sub_${originalIdx}`} className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 mb-2.5">
                              <View className="flex-row justify-between items-center mb-2.5">
                                <View className="flex-row items-center flex-1 mr-2">
                                  <View className="bg-indigo-500/30 border border-indigo-500/50 px-2 py-0.5 rounded mr-2">
                                    <Text className="text-indigo-300 font-mono font-bold text-xs">{tag}</Text>
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-white font-bold text-sm">{exItem.name}</Text>
                                    <Text className="text-slate-400 text-[11px]">
                                      {exItem.muscle_groups?.map(m => m.muscle_group).join(', ') || 'No muscle group'}
                                    </Text>
                                  </View>
                                </View>

                                <View className="flex-row items-center gap-2">
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
                                  <Text className="text-slate-400 text-[11px] mb-0.5">Sets</Text>
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
                                  <Text className="text-slate-400 text-[11px] mb-0.5">Target Reps</Text>
                                  <TextInput
                                    className="text-white font-bold text-sm"
                                    keyboardType="number-pad"
                                    value={exItem.target_reps !== undefined && exItem.target_reps !== null ? String(exItem.target_reps) : ''}
                                    onChangeText={(t) => {
                                      const cleanVal = t.replace(/[^0-9]/g, '');
                                      handleUpdateExerciseProp(activeDayIndex, originalIdx, 'target_reps', cleanVal);
                                    }}
                                    placeholder="10"
                                    placeholderTextColor="#64748b"
                                  />
                                </View>
                                {!exItem.is_bodyweight_only && (
                                  <View className="flex-1 bg-slate-800 p-2 rounded-xl">
                                    <Text className="text-slate-400 text-[11px] mb-0.5">Target (lbs)</Text>
                                    <TextInput
                                      className="text-white font-bold text-sm"
                                      keyboardType="decimal-pad"
                                      value={exItem.target_weight !== undefined && exItem.target_weight !== null ? String(exItem.target_weight) : ''}
                                      onChangeText={(t) => {
                                        const cleanVal = t.replace(/[^0-9.]/g, '');
                                        handleUpdateExerciseProp(activeDayIndex, originalIdx, 'target_weight', cleanVal === '' ? null : cleanVal);
                                      }}
                                      placeholder="Blank"
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
                  }
                }

                return elements;
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
                onPress={() => handleCommitRoutine(true)}
                disabled={loading}
                className="bg-blue-600 p-3.5 rounded-2xl flex-1 items-center flex-row justify-center"
              >
                {loading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Check color="white" size={16} className="mr-1.5" />
                    <Text className="text-white font-bold text-sm">Save & Activate</Text>
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
          <View className="bg-indigo-950/40 p-5 rounded-2xl border border-indigo-500/30 mb-6">
            <View className="flex-row items-center mb-2">
              <Sparkles color="#a78bfa" size={20} className="mr-2" />
              <Text className="text-white font-bold text-lg">Volumetric Impact Dashboard</Text>
            </View>
            <Text className="text-indigo-200 text-xs leading-5">
              Calculates target weekly working sets per muscle group across your full split:  
              Total Sets = SUM(Planned Sets × Muscle Fraction).
            </Text>
          </View>

          {/* Muscle Progress Bars */}
          <View className="space-y-4 mb-8">
            {MUSCLE_GROUPS.map((group) => {
              const sets = muscleVolumes[group] || 0;
              // Target range: 10-20 sets/week optimal
              const percentage = Math.min(Math.round((sets / 20) * 100), 100);
              const statusColor = sets < 6 ? 'bg-amber-500' : sets <= 20 ? 'bg-emerald-500' : 'bg-rose-500';

              return (
                <View key={group} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-3">
                  <View className="flex-row justify-between items-center mb-2">
                    <Text className="text-white font-bold text-base">{group}</Text>
                    <Text className="text-slate-300 font-semibold">{sets} sets / week</Text>
                  </View>
                  <View className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                    <View style={{ width: `${percentage}%` }} className={`h-full ${statusColor}`} />
                  </View>
                  <Text className="text-slate-500 text-xs mt-1">
                    {sets < 6 ? 'Sub-optimal stimulus (<6 sets)' : sets <= 20 ? 'Optimal Hypertrophy Range (6-20 sets)' : 'High fatigue risk (>20 sets)'}
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
                  <Text className="text-white font-bold text-lg">Save & Activate Routine</Text>
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

              {/* Bodyweight Toggle */}
              <TouchableOpacity
                onPress={() => setNewExIsBodyweight(!newExIsBodyweight)}
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
              <View className="flex-row items-center bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 mb-4">
                <Search color="#94a3b8" size={18} className="mr-2" />
                <TextInput
                  className="flex-1 text-white font-medium text-sm"
                  placeholder="Search exercises by name or muscle..."
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

              {filteredExercises.length === 0 ? (
                <View className="flex-1 items-center justify-center py-10 px-4">
                  <Dumbbell color="#64748b" size={32} className="mb-2" />
                  <Text className="text-slate-400 text-center font-medium mb-4">
                    No exercises found matching "{searchQuery}"
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
                  {filteredExercises.map((ex) => (
                    <TouchableOpacity
                      key={ex.id}
                      onPress={() => handleAddExerciseToActiveDay(ex, targetSupersetIdForPicker)}
                      className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex-row justify-between items-center mb-3"
                    >
                      <View>
                        <Text className="text-white font-bold text-base">{ex.name}</Text>
                        <Text className="text-slate-400 text-xs mt-1">
                          {ex.exercise_muscle_groups?.map(m => `${m.muscle_group} (${m.fraction}x)`).join(', ') || 'No muscle mapped'}
                        </Text>
                      </View>
                      <Plus color="#3b82f6" size={20} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
