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
  ArrowDown,
  Layers,
  Flame,
  Zap,
  Trophy,
  Clock,
  CheckCircle2,
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
  is_target_weight_manually_edited?: boolean;
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
        lastCompletedWeight: number | null;
        lastCompletedReps: number | null;
        maxCompletedWeight: number | null;
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
            .in('exercise_id', exerciseIds);

          if (!pErr && pastData) {
            // Sort past sessions deterministically: most recently completed first
            pastData.sort((a: any, b: any) => {
              const dateA = new Date(a.sessions?.completed_at || a.sessions?.started_at || 0).getTime();
              const dateB = new Date(b.sessions?.completed_at || b.sessions?.started_at || 0).getTime();
              return dateB - dateA;
            });

            for (const row of pastData) {
              const exId = row.exercise_id;
              // Because rows are sorted by completed_at descending, take the most recent session for each exercise
              if (!exerciseHistoryMap[exId]) {
                const validSets = (row.session_sets || [])
                  .filter((s: any) => s.is_completed)
                  .sort((a: any, b: any) => (a.set_number || 0) - (b.set_number || 0));

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
                  nextTargetWeight: row.next_target_weight !== null && row.next_target_weight !== undefined ? Number(row.next_target_weight) : null,
                  nextTargetReps: row.next_target_reps !== null && row.next_target_reps !== undefined ? Number(row.next_target_reps) : null,
                  lastCompletedWeight: lastCompleted?.weight ?? null,
                  lastCompletedReps: lastCompleted?.reps ?? null,
                  maxCompletedWeight: maxCompletedW,
                  completedSets: completedSetsList
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
          const lastSet = history.completedSets[history.completedSets.length - 1];

          if (isBw) {
            baseWeight = '0';
            baseReps = history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : (lastSet?.reps?.toString() || firstSet?.reps?.toString() || re.target_reps?.toString() || '10');
            exPrevPerfSummary = lastSet?.reps !== undefined && lastSet?.reps !== null
              ? `BW × ${lastSet.reps}`
              : (firstSet?.reps !== undefined && firstSet?.reps !== null ? `BW × ${firstSet.reps}` : 'BW × 10');
          } else {
            // Prioritize: explicit next target weight -> last completed set weight -> max completed set weight -> first set weight -> routine target weight -> 135
            const resolvedWeight = history.nextTargetWeight !== null
              ? history.nextTargetWeight
              : (history.lastCompletedWeight ?? history.maxCompletedWeight ?? firstSet?.weight);

            if (resolvedWeight !== null && resolvedWeight !== undefined) {
              baseWeight = resolvedWeight.toString();
            } else {
              baseWeight = re.target_weight ? re.target_weight.toString() : '135';
            }

            baseReps = history.nextTargetReps !== null
              ? history.nextTargetReps.toString()
              : (lastSet?.reps?.toString() || firstSet?.reps?.toString() || re.target_reps?.toString() || '10');

            if (lastSet && lastSet.weight !== null && lastSet.reps !== null) {
              exPrevPerfSummary = `${lastSet.weight} lbs × ${lastSet.reps}`;
            } else if (firstSet && firstSet.weight !== null && firstSet.reps !== null) {
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
              // Editable input for each set starts at baseWeight (the final top weight achieved, 20 lbs)
              // But ghost text shows exactly what was done for this specific set
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
          is_target_weight_manually_edited: false,
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
    const targetEx = workoutExercises[exIdx];
    if (!targetEx || !targetEx.sets[setIdx]) return;

    const willBeCompleted = !targetEx.sets[setIdx].is_completed;
    let durationToSet: number | null = null;
    let cancelTimer = false;

    if (willBeCompleted) {
      if (targetEx.superset_id) {
        const supersetGroup = workoutExercises.filter((e) => e.superset_id === targetEx.superset_id);
        const isRoundComplete =
          supersetGroup.length > 0 &&
          supersetGroup.every((e) =>
            e === targetEx ? true : Boolean(e.sets[setIdx]?.is_completed)
          );

        if (isRoundComplete) {
          durationToSet = Math.max(
            ...supersetGroup.map((e) => e.default_rest_timer_seconds || 90)
          );
        } else {
          cancelTimer = true;
        }
      } else {
        durationToSet = targetEx.default_rest_timer_seconds || 90;
      }
    }

    setWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const nextSets = ex.sets.map((s, si) =>
          si === setIdx ? { ...s, is_completed: willBeCompleted } : s
        );

        let nextTarget = ex.next_target_weight;
        if (!ex.is_bodyweight_only && !ex.is_target_weight_manually_edited) {
          const completedWeights = nextSets
            .filter((s) => s.is_completed)
            .map((s) => parseFloat(s.weight))
            .filter((w) => !isNaN(w) && w > 0);
          if (completedWeights.length > 0) {
            nextTarget = Math.max(...completedWeights).toString();
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_weight: nextTarget
        };
      });
    });

    if (durationToSet !== null) {
      setTimerSeconds(durationToSet);
      setTimerActive(true);
    } else if (cancelTimer) {
      setTimerActive(false);
      setTimerSeconds(null);
    }
  };

  // Set Cloning Engine (Editing Set 1 auto-fills subsequent sets if uncompleted)
  const handleChangeWeight = (exIdx: number, setIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const nextSets = ex.sets.map((s, si) => {
          if (si === setIdx) {
            return { ...s, weight: val };
          }
          // Auto-clone Set 1 down to uncompleted sets
          if (setIdx === 0 && !s.is_completed) {
            return { ...s, weight: val };
          }
          return s;
        });

        let nextTarget = ex.next_target_weight;
        if (!ex.is_bodyweight_only && !ex.is_target_weight_manually_edited) {
          const completedWeights = nextSets
            .filter((s) => s.is_completed)
            .map((s) => parseFloat(s.weight))
            .filter((w) => !isNaN(w) && w > 0);
          if (completedWeights.length > 0) {
            nextTarget = Math.max(...completedWeights).toString();
          } else if (setIdx === 0) {
            nextTarget = val;
          }
        }

        return {
          ...ex,
          sets: nextSets,
          next_target_weight: nextTarget
        };
      });
    });
  };

  const handleChangeReps = (exIdx: number, setIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const nextSets = ex.sets.map((s, si) => {
          if (si === setIdx) {
            return { ...s, reps: val };
          }
          // Auto-clone Set 1 reps down to uncompleted sets
          if (setIdx === 0 && !s.is_completed) {
            return { ...s, reps: val };
          }
          return s;
        });

        return {
          ...ex,
          sets: nextSets
        };
      });
    });
  };

  const handleChangeNextTarget = (exIdx: number, val: string) => {
    setWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          next_target_weight: val,
          is_target_weight_manually_edited: true
        };
      });
    });
  };

  // Add extra set to exercise
  const handleAddSet = (exIdx: number) => {
    setWorkoutExercises((prev) => {
      return prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const currentSets = ex.sets;
        const lastSet = currentSets[currentSets.length - 1];
        const newSetNumber = currentSets.length + 1;

        return {
          ...ex,
          sets: [
            ...currentSets,
            {
              set_number: newSetNumber,
              weight: lastSet ? lastSet.weight : (ex.is_bodyweight_only ? '0' : '135'),
              reps: lastSet ? lastSet.reps : '10',
              prev_performance: ex.prev_performance || '—',
              is_completed: false
            }
          ]
        };
      });
    });
  };

  // Add round to all exercises in a superset
  const handleAddSupersetRound = (supersetId: string) => {
    setWorkoutExercises((prev) => {
      return prev.map((ex) => {
        if (ex.superset_id !== supersetId) return ex;
        const currentSets = ex.sets;
        const lastSet = currentSets[currentSets.length - 1];
        const newSetNumber = currentSets.length + 1;

        return {
          ...ex,
          sets: [
            ...currentSets,
            {
              set_number: newSetNumber,
              weight: lastSet ? lastSet.weight : (ex.is_bodyweight_only ? '0' : '135'),
              reps: lastSet ? lastSet.reps : '10',
              prev_performance: ex.prev_performance || '—',
              is_completed: false
            }
          ]
        };
      });
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
    router.replace({
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
            Best Damn Workout Tracker Ever
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
                .filter((item) => item.ex.superset_id === sId)
                .sort((a, b) => (a.ex.superset_order || 1) - (b.ex.superset_order || 1));

              const maxRounds = Math.max(...groupItems.map((item) => item.ex.sets.length), 1);
              const roundRestDuration = Math.max(
                ...groupItems.map((item) => item.ex.default_rest_timer_seconds || 90)
              );

              elements.push(
                <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-6">
                  {/* Superset Header Banner */}
                  <View className="mb-4 pb-3 border-b border-indigo-500/30">
                    <View className="flex-row justify-between items-center mb-1.5">
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
                    <Text className="text-slate-300 text-xs font-semibold pl-0.5">
                      {groupItems.map((g, idx) => `${letter}${g.ex.superset_order || idx + 1}: ${g.ex.name}`).join('  +  ')}
                    </Text>
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
                          <Text className="w-20 text-slate-500 text-[11px] font-bold text-center uppercase tracking-wider">
                            Weight
                          </Text>
                          <Text className="w-16 text-slate-500 text-[11px] font-bold text-center uppercase tracking-wider">
                            Reps
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
                          const prevSummary = setData.prev_performance || groupEx.prev_performance || '—';

                          return (
                            <View key={`ex_${originalExIdx}_set_${roundIdx}`}>
                              <View
                                className={`py-2 px-2.5 rounded-xl border flex-row items-center ${
                                  isDone
                                    ? 'bg-emerald-950/30 border-emerald-500/40'
                                    : 'bg-slate-800/80 border-slate-700/60'
                                }`}
                              >
                                {/* Left Exercise Info & Prev */}
                                <View className="flex-1 mr-2 justify-center">
                                  <View className="flex-row items-center mb-0.5">
                                    <View className="bg-indigo-500/30 border border-indigo-500/50 px-1.5 py-0.5 rounded mr-1.5">
                                      <Text className="text-indigo-300 font-mono font-bold text-[10px]">{tag}</Text>
                                    </View>
                                    <Text className="text-white font-bold text-xs flex-1" numberOfLines={1}>
                                      {groupEx.name}
                                    </Text>
                                  </View>
                                  <Text className="text-slate-400 text-[11px] pl-0.5" numberOfLines={1}>
                                    {prevSummary}
                                  </Text>
                                </View>

                                {/* Weight Input */}
                                <View className="w-20 px-1 justify-center">
                                  {groupEx.is_bodyweight_only ? (
                                    <View className="h-10 rounded-xl bg-slate-900/60 border border-slate-700 items-center justify-center">
                                      <Text className="text-slate-400 font-bold text-xs">BW</Text>
                                    </View>
                                  ) : (
                                    <TextInput
                                      className={`h-10 rounded-xl px-1.5 py-0 text-center font-bold text-sm border ${
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
                                <View className="w-16 px-1 justify-center">
                                  <TextInput
                                    className={`h-10 rounded-xl px-1.5 py-0 text-center font-bold text-sm border ${
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

                                {/* Done Toggle Button */}
                                <View className="w-10 items-end justify-center pl-1">
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

                  {/* Add Superset Round Button */}
                  <TouchableOpacity
                    onPress={() => handleAddSupersetRound(sId)}
                    className="py-2.5 items-center justify-center bg-indigo-900/40 rounded-xl border border-indigo-500/40 mb-4 flex-row"
                  >
                    <Plus color="#a78bfa" size={16} className="mr-1.5" />
                    <Text className="text-indigo-200 font-bold text-sm">Add Round to Superset {letter}</Text>
                  </TouchableOpacity>

                  {/* Superset Next Target Weights Section */}
                  <View className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800">
                    <View className="flex-row items-center mb-2.5">
                      <Sparkles color="#a78bfa" size={15} className="mr-1.5" />
                      <Text className="text-purple-300 text-xs font-bold uppercase tracking-wider">
                        Next Target Weights
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
