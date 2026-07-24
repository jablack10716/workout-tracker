import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { SetRow } from '../../src/components/SetRow';
import { X, Check, Timer, Plus, FastForward, Dumbbell, Sparkles, ArrowRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

type SetData = {
  set_number: number;
  weight: string;
  reps: string;
  is_completed: boolean;
};

type WorkoutExerciseItem = {
  routine_exercise_id: string;
  exercise_id: string;
  name: string;
  default_rest_timer_seconds: number;
  is_bodyweight_only: boolean;
  prev_performance?: string;
  next_target_weight: string;
  sets: SetData[];
};

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeRoutine, setActiveRoutine] = useState<any>(null);
  const [activeDayName, setActiveDayName] = useState('Workout');
  const [workoutExercises, setWorkoutExercises] = useState<WorkoutExerciseItem[]>([]);
  const [startTime] = useState<number>(Date.now());

  // Rest Timer State
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerActive, setTimerActive] = useState(false);
  const timerIntervalRef = useRef<any>(null);

  // Timer Tick Engine
  useEffect(() => {
    if (timerActive && timerSeconds !== null && timerSeconds > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else if (timerSeconds === 0) {
      setTimerActive(false);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {}
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [timerActive, timerSeconds]);

  // Load Active Routine & Split Day Exercises
  useEffect(() => {
    loadActiveWorkout();
  }, []);

  const loadActiveWorkout = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      Alert.alert('Auth Required', 'Please log in to start a workout.');
      router.back();
      return;
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
      router.back();
      return;
    }

    const routine = routines[0];
    setActiveRoutine(routine);

    // Find current day in split
    const currentDayNum = routine.current_day || 1;
    const routineDay = routine.routine_days?.find((d: any) => d.day_number === currentDayNum) || routine.routine_days?.[0];

    if (routineDay) {
      setActiveDayName(routineDay.name || `Day ${currentDayNum}`);

      const rawExercises = routineDay.routine_exercises || [];
      // Sort by order_index
      rawExercises.sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));

      const items: WorkoutExerciseItem[] = rawExercises.map((re: any) => {
        const exObj = re.exercises || {};
        const plannedSetsCount = re.planned_sets || 3;
        const targetWeightVal = re.target_weight ? re.target_weight.toString() : (exObj.is_bodyweight_only ? '0' : '135');
        const targetRepsVal = re.target_reps ? re.target_reps.toString() : '10';

        const initialSets: SetData[] = [];
        for (let i = 1; i <= plannedSetsCount; i++) {
          initialSets.push({
            set_number: i,
            weight: targetWeightVal,
            reps: targetRepsVal,
            is_completed: false
          });
        }

        return {
          routine_exercise_id: re.id,
          exercise_id: exObj.id,
          name: exObj.name || 'Exercise',
          default_rest_timer_seconds: exObj.default_rest_timer_seconds || 90,
          is_bodyweight_only: exObj.is_bodyweight_only || false,
          prev_performance: exObj.is_bodyweight_only ? 'BW × 10' : `${targetWeightVal} lbs × ${targetRepsVal}`,
          next_target_weight: targetWeightVal,
          sets: initialSets
        };
      });

      setWorkoutExercises(items);
    }
    setLoading(false);
  };

  // Toggle Set Complete & Trigger Rest Timer
  const handleToggleSetComplete = (exIdx: number, setIdx: number) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      const targetSet = copy[exIdx].sets[setIdx];
      const willBeCompleted = !targetSet.is_completed;
      targetSet.is_completed = willBeCompleted;

      // Trigger Rest Timer if completed
      if (willBeCompleted) {
        const restDuration = copy[exIdx].default_rest_timer_seconds || 90;
        setTimerSeconds(restDuration);
        setTimerActive(true);
      }

      return copy;
    });
  };

  // Set Cloning Engine (Editing Set 1 auto-fills subsequent sets if uncompleted)
  const handleChangeWeight = (exIdx: number, setIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      copy[exIdx].sets[setIdx].weight = val;

      // Auto-clone Set 1 down to uncompleted sets
      if (setIdx === 0) {
        for (let i = 1; i < copy[exIdx].sets.length; i++) {
          if (!copy[exIdx].sets[i].is_completed) {
            copy[exIdx].sets[i].weight = val;
          }
        }
        copy[exIdx].next_target_weight = val;
      }

      return copy;
    });
  };

  const handleChangeReps = (exIdx: number, setIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      copy[exIdx].sets[setIdx].reps = val;

      // Auto-clone Set 1 reps
      if (setIdx === 0) {
        for (let i = 1; i < copy[exIdx].sets.length; i++) {
          if (!copy[exIdx].sets[i].is_completed) {
            copy[exIdx].sets[i].reps = val;
          }
        }
      }

      return copy;
    });
  };

  const handleChangeNextTarget = (exIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      copy[exIdx].next_target_weight = val;
      return copy;
    });
  };

  // Add extra set to exercise
  const handleAddSet = (exIdx: number) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      const currentSets = copy[exIdx].sets;
      const lastSet = currentSets[currentSets.length - 1];
      const newSetNumber = currentSets.length + 1;
      
      copy[exIdx].sets.push({
        set_number: newSetNumber,
        weight: lastSet ? lastSet.weight : '135',
        reps: lastSet ? lastSet.reps : '10',
        is_completed: false
      });
      return copy;
    });
  };

  // Finish Workout Action
  const handleFinishWorkout = () => {
    // Check if at least 1 set is completed
    const completedCount = workoutExercises.reduce(
      (acc, ex) => acc + ex.sets.filter((s) => s.is_completed).length,
      0
    );

    if (completedCount === 0) {
      Alert.alert('No Sets Logged', 'Please complete at least 1 set before finishing.');
      return;
    }

    const durationSeconds = Math.max(Math.round((Date.now() - startTime) / 1000), 60);

    // Navigate to completion summary with workout payload
    router.push({
      pathname: '/workout/complete',
      params: {
        routine_id: activeRoutine.id,
        current_day: activeRoutine.current_day,
        current_cycle: activeRoutine.current_cycle,
        days_in_split: activeRoutine.days_in_split,
        cycles_per_routine: activeRoutine.cycles_per_routine,
        duration_seconds: durationSeconds.toString(),
        payload: JSON.stringify(workoutExercises)
      }
    });
  };

  if (loading) {
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

  return (
    <View className="flex-1 bg-slate-950">
      {/* Top Navigation Header */}
      <View className="px-6 pt-12 pb-4 bg-slate-900 border-b border-slate-800 flex-row justify-between items-center">
        <View>
          <Text className="text-blue-400 font-bold text-xs uppercase tracking-wider">
            {activeRoutine?.name} • Day {activeRoutine?.current_day}
          </Text>
          <Text className="text-white text-2xl font-bold">{activeDayName}</Text>
        </View>
        <TouchableOpacity 
          onPress={() => {
            Alert.alert('Discard Workout?', 'Are you sure you want to exit without saving?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => router.back() }
            ]);
          }}
          className="w-10 h-10 bg-slate-800 rounded-full items-center justify-center"
        >
          <X color="#94a3b8" size={20} />
        </TouchableOpacity>
      </View>

      {/* Main Exercise Set Logger */}
      <ScrollView className="flex-1 px-4 pt-4">
        {workoutExercises.map((ex, exIdx) => (
          <View key={ex.routine_exercise_id || exIdx} className="bg-slate-900 p-4 rounded-3xl border border-slate-800 mb-6">
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-row items-center flex-1 mr-2">
                <View className="w-9 h-9 bg-blue-600/20 rounded-xl items-center justify-center mr-3 border border-blue-500/30">
                  <Dumbbell color="#60a5fa" size={18} />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-lg">{ex.name}</Text>
                  <Text className="text-slate-400 text-xs">
                    {ex.is_bodyweight_only ? 'Bodyweight' : 'Weighted'} • {ex.default_rest_timer_seconds}s Rest
                  </Text>
                </View>
              </View>
            </View>

            {/* Set Table Column Headers */}
            <View className="flex-row items-center py-2 px-3 mb-1">
              <Text className="w-10 text-slate-500 text-xs font-bold text-center">SET</Text>
              <Text className="w-24 text-slate-500 text-xs font-bold px-1">PREVIOUS</Text>
              <Text className="flex-1 text-slate-500 text-xs font-bold text-center">LBS</Text>
              <Text className="flex-1 text-slate-500 text-xs font-bold text-center">REPS</Text>
              <Text className="w-12 text-slate-500 text-xs font-bold text-right">DONE</Text>
            </View>

            {/* Set Rows */}
            {ex.sets.map((setData, setIdx) => (
              <SetRow
                key={setData.set_number}
                setIndex={setData.set_number}
                weight={setData.weight}
                reps={setData.reps}
                prevPerformance={ex.prev_performance}
                isCompleted={setData.is_completed}
                onToggleComplete={() => handleToggleSetComplete(exIdx, setIdx)}
                onChangeWeight={(v) => handleChangeWeight(exIdx, setIdx, v)}
                onChangeReps={(v) => handleChangeReps(exIdx, setIdx, v)}
              />
            ))}

            {/* Add Set Button */}
            <TouchableOpacity 
              onPress={() => handleAddSet(exIdx)}
              className="py-2.5 items-center justify-center bg-slate-800/60 rounded-xl border border-slate-700/50 mt-2 flex-row"
            >
              <Plus color="#94a3b8" size={16} className="mr-1" />
              <Text className="text-slate-300 font-semibold text-sm">Add Set</Text>
            </TouchableOpacity>

            {/* Fresh Memory Overload Target Input */}
            <View className="mt-4 pt-3 border-t border-slate-800 flex-row items-center justify-between">
              <View className="flex-row items-center">
                <Sparkles color="#a78bfa" size={16} className="mr-2" />
                <Text className="text-purple-300 text-xs font-semibold">Next Target Weight</Text>
              </View>
              <View className="flex-row items-center bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                <TextInput
                  className="text-white font-bold text-sm w-12 text-center"
                  keyboardType="numeric"
                  value={ex.next_target_weight}
                  onChangeText={(v) => handleChangeNextTarget(exIdx, v)}
                />
                <Text className="text-slate-400 text-xs font-medium ml-1">lbs</Text>
              </View>
            </View>
          </View>
        ))}

        {/* Finish Workout CTA Button */}
        <TouchableOpacity
          onPress={handleFinishWorkout}
          className="bg-emerald-600 p-4 rounded-2xl flex-row items-center justify-center mb-24 shadow-lg shadow-emerald-900/30"
        >
          <Check color="white" size={22} className="mr-2" />
          <Text className="text-white font-bold text-xl">Finish Workout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Floating Rest Timer Overlay Bar */}
      {timerSeconds !== null && timerSeconds > 0 && (
        <View className="absolute bottom-6 left-4 right-4 bg-slate-900/95 border border-indigo-500/50 p-4 rounded-2xl flex-row items-center justify-between shadow-2xl shadow-indigo-900/40 backdrop-blur-md">
          <View className="flex-row items-center">
            <View className="w-10 h-10 bg-indigo-600/30 rounded-xl items-center justify-center mr-3 border border-indigo-500/40">
              <Timer color="#a78bfa" size={20} />
            </View>
            <View>
              <Text className="text-slate-400 text-xs font-semibold uppercase">Rest Timer</Text>
              <Text className="text-white text-2xl font-bold font-mono">
                {formatTimer(timerSeconds)}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setTimerSeconds((t) => (t !== null ? t + 30 : 30))}
              className="bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 flex-row items-center"
            >
              <Plus color="#a78bfa" size={14} className="mr-1" />
              <Text className="text-indigo-300 text-xs font-bold">+30s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setTimerActive(false);
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
    </View>
  );
}
