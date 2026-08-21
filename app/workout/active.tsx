import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { SetRow } from '../../src/components/SetRow';
import {
  X,
  Check,
  Timer,
  Plus,
  FastForward,
  Dumbbell,
  Sparkles,
  ArrowRight,
  Layers,
  Flame,
  Zap,
  Trophy,
  Clock,
} from 'lucide-react-native';
import { calculateEstimated1RM } from '../../src/utils/analyticsEngine';
import * as Haptics from 'expo-haptics';

type SetData = {
  set_number: number;
  weight: string;
  reps: string;
  prev_performance?: string;
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
  superset_id?: string | null;
  superset_order?: number;
  sets: SetData[];
};

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [activeRoutine, setActiveRoutine] = useState<any>(null);
  const [activeDayName, setActiveDayName] = useState('Workout');
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
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
      setActiveDayId(routineDay.id || null);

      const rawExercises = routineDay.routine_exercises || [];
      // Sort by order_index
      rawExercises.sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));

      // Query latest completed workout history for each exercise in this day
      const exerciseIds = rawExercises
        .map((re: any) => re.exercise_id || re.exercises?.id)
        .filter(Boolean);

      const exerciseHistoryMap: Record<string, {
        nextTargetWeight: number | null;
        nextTargetReps: number | null;
        completedSets: Array<{ set_number: number; weight: number | null; reps: number | null }>;
      }> = {};

      if (exerciseIds.length > 0) {
        try {
          const { data: pastData, error: pErr } = await supabase
            .from('session_exercises')
            .select(`
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
              session_sets (
                id,
                set_number,
                weight,
                reps,
                is_completed
              )
            `)
            .eq('sessions.user_id', userId)
            .eq('sessions.status', 'completed')
            .in('exercise_id', exerciseIds)
            .order('completed_at', { referencedTable: 'sessions', ascending: false });

          if (!pErr && pastData) {
            for (const row of pastData) {
              const exId = row.exercise_id;
              // Because rows are ordered by completed_at descending, take the most recent session for each exercise
              if (!exerciseHistoryMap[exId]) {
                const validSets = (row.session_sets || [])
                  .filter((s: any) => s.is_completed)
                  .sort((a: any, b: any) => (a.set_number || 0) - (b.set_number || 0));

                exerciseHistoryMap[exId] = {
                  nextTargetWeight: row.next_target_weight !== null && row.next_target_weight !== undefined ? Number(row.next_target_weight) : null,
                  nextTargetReps: row.next_target_reps !== null && row.next_target_reps !== undefined ? Number(row.next_target_reps) : null,
                  completedSets: validSets.map((s: any) => ({
                    set_number: s.set_number,
                    weight: s.weight !== null && s.weight !== undefined ? Number(s.weight) : null,
                    reps: s.reps !== null && s.reps !== undefined ? Number(s.reps) : null,
                  }))
                };
              }
            }
          }
        } catch (err) {
          console.warn('Error fetching exercise history:', err);
        }
      }

      const items: WorkoutExerciseItem[] = rawExercises.map((re: any) => {
        const exObj = re.exercises || {};
        const exId = exObj.id || re.exercise_id;
        const isBw = exObj.is_bodyweight_only || false;
        const plannedSetsCount = re.planned_sets || 3;
        const history = exerciseHistoryMap[exId];

        // Determine baseline weight & reps from most recent session or fallback to routine configuration
        let baseWeight: string;
        let baseReps: string;
        let exPrevPerfSummary: string = '—';

        if (history && (history.nextTargetWeight !== null || history.completedSets.length > 0)) {
          const firstSet = history.completedSets[0];

          if (isBw) {
            baseWeight = '0';
            baseReps = history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : (firstSet?.reps?.toString() || re.target_reps?.toString() || '10');
            exPrevPerfSummary = firstSet?.reps !== undefined && firstSet?.reps !== null ? `BW × ${firstSet.reps}` : 'BW × 10';
          } else {
            if (history.nextTargetWeight !== null) {
              baseWeight = history.nextTargetWeight.toString();
            } else if (firstSet && firstSet.weight !== null) {
              baseWeight = firstSet.weight.toString();
            } else {
              baseWeight = re.target_weight ? re.target_weight.toString() : '135';
            }

            baseReps = history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : (firstSet?.reps?.toString() || re.target_reps?.toString() || '10');

            if (firstSet && firstSet.weight !== null && firstSet.reps !== null) {
              exPrevPerfSummary = `${firstSet.weight} lbs × ${firstSet.reps}`;
            } else if (re.target_weight) {
              exPrevPerfSummary = `${re.target_weight} lbs × ${re.target_reps || 10}`;
            }
          }
        } else {
          // First time doing this exercise
          if (isBw) {
            baseWeight = '0';
            baseReps = re.target_reps ? re.target_reps.toString() : '10';
            exPrevPerfSummary = '—';
          } else {
            baseWeight = re.target_weight ? re.target_weight.toString() : '135';
            baseReps = re.target_reps ? re.target_reps.toString() : '10';
            exPrevPerfSummary = re.target_weight ? `${re.target_weight} lbs × ${re.target_reps || 10}` : '—';
          }
        }

        // Construct initial sets with set-specific previous performance if available
        const initialSets: SetData[] = [];
        for (let i = 1; i <= plannedSetsCount; i++) {
          const prevSetData = history?.completedSets?.[i - 1];
          let setWeight = baseWeight;
          let setReps = baseReps;
          let setPrevPerf = exPrevPerfSummary;

          if (prevSetData) {
            if (isBw) {
              if (prevSetData.reps !== null && prevSetData.reps !== undefined) {
                setReps = prevSetData.reps.toString();
                setPrevPerf = `BW × ${prevSetData.reps}`;
              }
            } else {
              if (prevSetData.weight !== null && prevSetData.weight !== undefined) {
                setWeight = history?.nextTargetWeight !== null ? history.nextTargetWeight.toString() : prevSetData.weight.toString();
              }
              if (prevSetData.reps !== null && prevSetData.reps !== undefined) {
                setReps = prevSetData.reps.toString();
              }
              if (prevSetData.weight !== null && prevSetData.weight !== undefined && prevSetData.reps !== null && prevSetData.reps !== undefined) {
                setPrevPerf = `${prevSetData.weight} lbs × ${prevSetData.reps}`;
              }
            }
          }

          initialSets.push({
            set_number: i,
            weight: setWeight,
            reps: setReps,
            prev_performance: setPrevPerf,
            is_completed: false
          });
        }

        return {
          routine_exercise_id: re.id,
          exercise_id: exId,
          name: exObj.name || 'Exercise',
          default_rest_timer_seconds: exObj.default_rest_timer_seconds || 90,
          is_bodyweight_only: isBw,
          prev_performance: exPrevPerfSummary,
          next_target_weight: baseWeight,
          superset_id: re.superset_id || null,
          superset_order: re.superset_order || 1,
          sets: initialSets
        };
      });

      setWorkoutExercises(items);
    }
    setLoading(false);
  };

  // Toggle Set Complete & Trigger Smart Rest Timer
  const handleToggleSetComplete = (exIdx: number, setIdx: number) => {
    setWorkoutExercises((prev) => {
      const copy = [...prev];
      const currentEx = copy[exIdx];
      const targetSet = currentEx.sets[setIdx];
      const willBeCompleted = !targetSet.is_completed;
      targetSet.is_completed = willBeCompleted;

      // Trigger Rest Timer if completed
      if (willBeCompleted) {
        if (currentEx.superset_id) {
          // Check if this is the last exercise in the superset group for this round
          const supersetGroup = copy.filter((e) => e.superset_id === currentEx.superset_id);
          const currentOrder = currentEx.superset_order || 1;
          const maxOrder = Math.max(...supersetGroup.map((e) => e.superset_order || 1));

          const isLastInRound = currentOrder === maxOrder;

          if (isLastInRound) {
            // Completed the full superset round: start recovery rest timer
            const roundRestDuration = Math.max(
              ...supersetGroup.map((e) => e.default_rest_timer_seconds || 90)
            );
            setTimerSeconds(roundRestDuration);
            setTimerActive(true);
          } else {
            // Intra-superset: instant switch (no rest delay)
            setTimerActive(false);
            setTimerSeconds(null);
          }
        } else {
          // Standalone straight set: start standard rest timer
          const restDuration = currentEx.default_rest_timer_seconds || 90;
          setTimerSeconds(restDuration);
          setTimerActive(true);
        }
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
        prev_performance: copy[exIdx].prev_performance || '—',
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
        routine_day_id: activeDayId || '',
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

  const handleCloseWorkout = () => {
    const exitWorkout = () => {
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
      liveTotalSets++;
      if (st.is_completed) {
        liveCompletedSets++;
        liveTonnage += (parseFloat(st.weight) || 0) * (parseInt(st.reps, 10) || 0);
      }
    });
  });

  const elapsedSecs = Math.max(Math.round((Date.now() - startTime) / 1000), 1);
  const elapsedMins = Math.max(Math.round(elapsedSecs / 60), 1);
  const liveDensity = elapsedMins > 0 ? Math.round(liveTonnage / elapsedMins) : 0;

  return (
    <View className="flex-1 bg-slate-950">
      {/* Top Navigation Header */}
      <View 
        style={{ paddingTop: Math.max(insets.top, 16) + 8 }}
        className="px-6 pb-3 bg-slate-900 border-b border-slate-800 flex-row justify-between items-center"
      >
        <View className="flex-1 mr-3">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest mb-0.5">
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-slate-400 font-semibold text-xs uppercase tracking-wider">
            {activeRoutine?.name} • Day {activeRoutine?.current_day}
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
                if (st.is_completed) {
                  const e1rm = calculateEstimated1RM(parseFloat(st.weight) || 0, parseInt(st.reps, 10) || 0);
                  if (e1rm > topSetE1RM) topSetE1RM = e1rm;
                }
              });

              elements.push(
                <View key={ex.routine_exercise_id || `standalone_${exIdx}`} className="bg-slate-900 p-4 rounded-3xl border border-slate-800 mb-6">
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
                    {topSetE1RM > 0 && !ex.is_bodyweight_only && (
                      <View className="bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">
                        <Text className="text-purple-300 text-[10px] font-black">
                          1RM ~{Math.round(topSetE1RM)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Set Table Column Headers */}
                  <View className="flex-row items-center py-2 px-3 mb-1">
                    <Text className="w-8 text-slate-500 text-xs font-bold text-center">SET</Text>
                    <Text className="w-20 text-slate-500 text-xs font-bold px-1">PREVIOUS</Text>
                    <Text className="flex-1 text-slate-500 text-xs font-bold text-center">LBS</Text>
                    <Text className="flex-1 text-slate-500 text-xs font-bold text-center">REPS</Text>
                    <Text className="w-10 text-slate-500 text-xs font-bold text-right">DONE</Text>
                  </View>

                  {/* Set Rows */}
                  {ex.sets.map((setData, setIdx) => (
                    <SetRow
                      key={setData.set_number}
                      setIndex={setData.set_number}
                      weight={setData.weight}
                      reps={setData.reps}
                      prevPerformance={setData.prev_performance || ex.prev_performance}
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
                        className="text-white font-bold text-sm w-16 text-center"
                        style={{ textAlignVertical: 'center', includeFontPadding: false }}
                        keyboardType="numeric"
                        value={ex.next_target_weight}
                        onChangeText={(v) => handleChangeNextTarget(exIdx, v)}
                        selectTextOnFocus
                      />
                      <Text className="text-slate-400 text-xs font-medium ml-1">lbs</Text>
                    </View>
                  </View>
                </View>
              );
            } else if (!processedSupersets.has(ex.superset_id)) {
              processedSupersets.add(ex.superset_id);
              const sId = ex.superset_id;
              const letter = supersetLetterMap[sId] || 'A';
              const groupItems = workoutExercises
                .map((e, idx) => ({ ex: e, originalIndex: idx }))
                .filter(item => item.ex.superset_id === sId);

              elements.push(
                <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-6">
                  {/* Superset Header Banner */}
                  <View className="flex-row justify-between items-center mb-4 pb-3 border-b border-indigo-500/30">
                    <View className="flex-row items-center flex-1 mr-2">
                      <View className="bg-indigo-600 px-3 py-1 rounded-xl mr-2 flex-row items-center">
                        <Layers color="white" size={14} className="mr-1.5" />
                        <Text className="text-white font-extrabold text-xs tracking-wider">SUPERSET {letter}</Text>
                      </View>
                      <Text className="text-indigo-200 text-xs font-semibold flex-1" numberOfLines={1}>
                        {groupItems.map(g => g.ex.name).join(' + ')}
                      </Text>
                    </View>
                  </View>

                  {/* Superset Exercises */}
                  {groupItems.map((item, subIdx) => {
                    const groupEx = item.ex;
                    const originalExIdx = item.originalIndex;
                    const tag = `${letter}${groupEx.superset_order || subIdx + 1}`;

                    let topSetE1RM = 0;
                    groupEx.sets.forEach((st) => {
                      if (st.is_completed) {
                        const e1rm = calculateEstimated1RM(parseFloat(st.weight) || 0, parseInt(st.reps, 10) || 0);
                        if (e1rm > topSetE1RM) topSetE1RM = e1rm;
                      }
                    });

                    return (
                      <View key={groupEx.routine_exercise_id || `sub_${originalExIdx}`} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-4">
                        <View className="flex-row justify-between items-center mb-3">
                          <View className="flex-row items-center flex-1 mr-2">
                            <View className="bg-indigo-500/30 border border-indigo-500/50 px-2.5 py-1 rounded-lg mr-2.5">
                              <Text className="text-indigo-300 font-mono font-bold text-xs">{tag}</Text>
                            </View>
                            <View className="flex-1">
                              <Text className="text-white font-bold text-base">{groupEx.name}</Text>
                              <Text className="text-slate-400 text-xs">
                                {groupEx.is_bodyweight_only ? 'Bodyweight' : 'Weighted'} • {groupEx.default_rest_timer_seconds}s Rest
                              </Text>
                            </View>
                          </View>
                          {topSetE1RM > 0 && !groupEx.is_bodyweight_only && (
                            <View className="bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">
                              <Text className="text-purple-300 text-[10px] font-black">
                                1RM ~{Math.round(topSetE1RM)}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Set Table Column Headers */}
                        <View className="flex-row items-center py-2 px-3 mb-1">
                          <Text className="w-8 text-slate-500 text-xs font-bold text-center">SET</Text>
                          <Text className="w-20 text-slate-500 text-xs font-bold px-1">PREVIOUS</Text>
                          <Text className="flex-1 text-slate-500 text-xs font-bold text-center">LBS</Text>
                          <Text className="flex-1 text-slate-500 text-xs font-bold text-center">REPS</Text>
                          <Text className="w-10 text-slate-500 text-xs font-bold text-right">DONE</Text>
                        </View>

                        {/* Set Rows */}
                        {groupEx.sets.map((setData, setIdx) => (
                          <SetRow
                            key={setData.set_number}
                            setIndex={setData.set_number}
                            weight={setData.weight}
                            reps={setData.reps}
                            prevPerformance={setData.prev_performance || groupEx.prev_performance}
                            isCompleted={setData.is_completed}
                            onToggleComplete={() => handleToggleSetComplete(originalExIdx, setIdx)}
                            onChangeWeight={(v) => handleChangeWeight(originalExIdx, setIdx, v)}
                            onChangeReps={(v) => handleChangeReps(originalExIdx, setIdx, v)}
                          />
                        ))}

                        {/* Add Set Button */}
                        <TouchableOpacity 
                          onPress={() => handleAddSet(originalExIdx)}
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
                              className="text-white font-bold text-sm w-16 text-center"
                              style={{ textAlignVertical: 'center', includeFontPadding: false }}
                              keyboardType="numeric"
                              value={groupEx.next_target_weight}
                              onChangeText={(v) => handleChangeNextTarget(originalExIdx, v)}
                              selectTextOnFocus
                            />
                            <Text className="text-slate-400 text-xs font-medium ml-1">lbs</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
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
