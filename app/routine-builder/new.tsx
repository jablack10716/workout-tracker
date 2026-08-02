import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { X, Plus, Trash2, ChevronRight, Check, Sparkles, AlertCircle, Dumbbell } from 'lucide-react-native';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps'] as const;

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
};

type DaySplit = {
  day_number: number;
  name: string;
  exercises: RoutineExerciseItem[];
};

export default function RoutineBuilderScreen() {
  const router = useRouter();
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

  // Exercise Picker Modal State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<ExerciseOption[]>([]);
  const [fetchingExercises, setFetchingExercises] = useState(false);

  // Sync days array when daysInSplit changes
  useEffect(() => {
    setDays((prevDays) => {
      const updated: DaySplit[] = [];
      for (let i = 1; i <= daysInSplit; i++) {
        const existing = prevDays.find(d => d.day_number === i);
        if (existing) {
          updated.push(existing);
        } else {
          updated.push({
            day_number: i,
            name: `Day ${i}`,
            exercises: []
          });
        }
      }
      return updated;
    });
  }, [daysInSplit]);

  // Load available exercises from library
  useEffect(() => {
    setFetchingExercises(true);
    supabase
      .from('exercises')
      .select('*, exercise_muscle_groups(*)')
      .order('name')
      .then(({ data, error }) => {
        if (!error && data) {
          setAvailableExercises(data);
        }
        setFetchingExercises(false);
      });
  }, []);

  // Starter Template Presets
  const applyTemplate = (templateType: 'PPL' | 'UpperLower' | 'FullBody') => {
    if (templateType === 'PPL') {
      setRoutineName('Push / Pull / Legs Split');
      setDaysInSplit(3);
      setCyclesPerRoutine(4);
      setDays([
        { day_number: 1, name: 'Push Day', exercises: [] },
        { day_number: 2, name: 'Pull Day', exercises: [] },
        { day_number: 3, name: 'Leg Day', exercises: [] },
      ]);
    } else if (templateType === 'UpperLower') {
      setRoutineName('Upper / Lower Split');
      setDaysInSplit(4);
      setCyclesPerRoutine(4);
      setDays([
        { day_number: 1, name: 'Upper Body A', exercises: [] },
        { day_number: 2, name: 'Lower Body A', exercises: [] },
        { day_number: 3, name: 'Upper Body B', exercises: [] },
        { day_number: 4, name: 'Lower Body B', exercises: [] },
      ]);
    } else if (templateType === 'FullBody') {
      setRoutineName('Full Body 3-Day Split');
      setDaysInSplit(3);
      setCyclesPerRoutine(4);
      setDays([
        { day_number: 1, name: 'Full Body A', exercises: [] },
        { day_number: 2, name: 'Full Body B', exercises: [] },
        { day_number: 3, name: 'Full Body C', exercises: [] },
      ]);
    }
  };

  // Add exercise to currently active day (default target lbs to last completed set or null)
  const handleAddExerciseToActiveDay = async (ex: ExerciseOption) => {
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

    const newExerciseItem: RoutineExerciseItem = {
      exercise_id: ex.id,
      name: ex.name,
      planned_sets: 3,
      target_reps: 10,
      target_weight: initialWeight,
      is_bodyweight_only: ex.is_bodyweight_only,
      muscle_groups: ex.exercise_muscle_groups || []
    };

    setDays((prevDays) => {
      const copy = [...prevDays];
      copy[activeDayIndex].exercises.push(newExerciseItem);
      return copy;
    });

    setPickerVisible(false);
  };

  // Remove exercise from active day
  const handleRemoveExercise = (dayIdx: number, exIdx: number) => {
    setDays((prevDays) => {
      const copy = [...prevDays];
      copy[dayIdx].exercises.splice(exIdx, 1);
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
      Triceps: 0
    };

    days.forEach((day) => {
      day.exercises.forEach((ex) => {
        const sets = ex.planned_sets || 0;
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
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      Alert.alert('Error', 'You must be logged in to create a routine.');
      setLoading(false);
      return;
    }

    try {
      // 1. Insert Routine
      const { data: routineData, error: routineErr } = await supabase
        .from('routines')
        .insert([{
          user_id: userId,
          name: routineName.trim(),
          status: shouldActivate ? 'active' : 'draft',
          days_in_split: daysInSplit,
          cycles_per_routine: cyclesPerRoutine,
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
        await supabase
          .from('routines')
          .update({ status: 'draft' })
          .eq('user_id', userId)
          .neq('id', routineId);
      }

      // 2. Insert Routine Days & Exercises
      for (const d of days) {
        const { data: dayData, error: dayErr } = await supabase
          .from('routine_days')
          .insert([{
            routine_id: routineId,
            day_number: d.day_number,
          }])
          .select()
          .single();

        if (dayErr || !dayData) throw dayErr;

        const dayId = dayData.id;

        // Insert Exercises for this day
        if (d.exercises.length > 0) {
          const exerciseRows = d.exercises.map((ex, idx) => ({
            routine_day_id: dayId,
            exercise_id: ex.exercise_id,
            order_index: idx + 1,
            planned_sets: Number(ex.planned_sets) || 3,
            target_reps: Number(ex.target_reps) || 10,
            target_weight: ex.is_bodyweight_only || ex.target_weight === null || ex.target_weight === ''
              ? null
              : Number(ex.target_weight)
          }));

          const { error: exErr } = await supabase.from('routine_exercises').insert(exerciseRows);
          if (exErr) throw exErr;
        }
      }

      setLoading(false);
      router.replace('/(tabs)/routines');
    } catch (err: any) {
      setLoading(false);
      Alert.alert('Save Error', err.message || 'Failed to save routine');
    }
  };

  return (
    <View className="flex-1 bg-slate-950 p-6 pt-12">
      {/* Header & Step Wizard Bar */}
      <View className="flex-row justify-between items-center mb-6">
        <View>
          <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Step {step} of 3 • Sandbox Mode
          </Text>
          <Text className="text-white text-2xl font-bold">
            {step === 1 ? 'Split Setup' : step === 2 ? 'Assign Exercises' : 'Volumetric Review'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-slate-800 rounded-full items-center justify-center">
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
                  onPress={() => setDaysInSplit(num)}
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

          {/* Starter Templates */}
          <View className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 mb-6">
            <View className="flex-row items-center mb-3">
              <Sparkles color="#a78bfa" size={18} className="mr-2" />
              <Text className="text-white font-bold text-base">Start from Template</Text>
            </View>
            <View className="flex-row gap-2">
              <TouchableOpacity onPress={() => applyTemplate('PPL')} className="flex-1 bg-slate-800 p-3 rounded-xl border border-slate-700 items-center">
                <Text className="text-indigo-300 font-semibold text-xs">PPL 3-Day</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => applyTemplate('UpperLower')} className="flex-1 bg-slate-800 p-3 rounded-xl border border-slate-700 items-center">
                <Text className="text-indigo-300 font-semibold text-xs">Upper/Lower</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => applyTemplate('FullBody')} className="flex-1 bg-slate-800 p-3 rounded-xl border border-slate-700 items-center">
                <Text className="text-indigo-300 font-semibold text-xs">Full Body</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setStep(2)}
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
            <View className="flex-row justify-between items-center mb-4">
              <TextInput
                className="text-white font-bold text-xl bg-slate-900/80 px-3 py-2 rounded-xl flex-1 border border-slate-800 mr-2"
                value={days[activeDayIndex]?.name}
                onChangeText={(text) => {
                  setDays((prev) => {
                    const copy = [...prev];
                    copy[activeDayIndex].name = text;
                    return copy;
                  });
                }}
              />
              <TouchableOpacity
                onPress={() => setPickerVisible(true)}
                className="bg-blue-600/30 border border-blue-500/50 px-3 py-2 rounded-xl flex-row items-center"
              >
                <Plus color="#60a5fa" size={16} className="mr-1" />
                <Text className="text-blue-300 font-bold text-sm">Add Exercise</Text>
              </TouchableOpacity>
            </View>

            {days[activeDayIndex]?.exercises.length === 0 ? (
              <View className="bg-slate-900/40 border border-dashed border-slate-800 p-8 rounded-2xl items-center justify-center my-6">
                <Dumbbell color="#64748b" size={32} className="mb-2" />
                <Text className="text-slate-400 text-center font-medium">No exercises assigned to this day yet.</Text>
                <TouchableOpacity onPress={() => setPickerVisible(true)} className="mt-4 bg-slate-800 px-4 py-2 rounded-xl">
                  <Text className="text-blue-400 font-semibold">+ Select from Library</Text>
                </TouchableOpacity>
              </View>
            ) : (
              days[activeDayIndex]?.exercises.map((ex, exIdx) => (
                <View key={exIdx} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-3">
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-white font-bold text-base">{ex.name}</Text>
                    <TouchableOpacity onPress={() => handleRemoveExercise(activeDayIndex, exIdx)}>
                      <Trash2 color="#ef4444" size={18} />
                    </TouchableOpacity>
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
              ))
            )}
          </ScrollView>

          {/* Navigation Buttons */}
          <View className="flex-row gap-3 pt-3">
            <TouchableOpacity onPress={() => setStep(1)} className="bg-slate-800 p-4 rounded-2xl flex-1 items-center">
              <Text className="text-slate-300 font-bold">Back</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep(3)} className="bg-indigo-600 p-4 rounded-2xl flex-2 flex-row items-center justify-center">
              <Text className="text-white font-bold text-base mr-2">Volumetric Review</Text>
              <Sparkles color="white" size={18} />
            </TouchableOpacity>
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
            <Text className="text-white text-2xl font-bold">Select Exercise</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)} className="p-2 bg-slate-800 rounded-full">
              <X color="#94a3b8" size={20} />
            </TouchableOpacity>
          </View>

          {fetchingExercises ? (
            <ActivityIndicator color="#3b82f6" size="large" className="my-10" />
          ) : (
            <ScrollView className="flex-1 space-y-3">
              {availableExercises.map((ex) => (
                <TouchableOpacity
                  key={ex.id}
                  onPress={() => handleAddExerciseToActiveDay(ex)}
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
      </Modal>
    </View>
  );
}
