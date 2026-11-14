import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useActiveWorkoutStore } from '../../src/store/useActiveWorkoutStore';
import { usePreferencesStore } from '../../src/store/usePreferencesStore';
import {
  getSetTonnage,
  isWorkingCompletedSet,
  resolveExerciseEquipment,
} from '../../src/utils/analyticsEngine';
import { Trophy, Flame, Dumbbell, Clock, ArrowRight, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react-native';

export default function WorkoutCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const hasHydrated = useActiveWorkoutStore((s) => s._hasHydrated);
  const setSavedSessionId = useActiveWorkoutStore((s) => s.setSavedSessionId);
  const clearActiveWorkout = useActiveWorkoutStore((s) => s.clearActiveWorkout);

  const [saving, setSaving] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalVolume: 0,
    totalSets: 0,
    totalExercises: 0,
    durationSeconds: parseInt(params.duration_seconds as string, 10) || 1800,
    currentDay: parseInt(params.current_day as string, 10) || 1,
    daysInSplit: parseInt(params.days_in_split as string, 10) || 3,
  });

  const didAttemptSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const savedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || didAttemptSaveRef.current) return;
    didAttemptSaveRef.current = true;
    saveWorkoutSession();
  }, [hasHydrated]);

  const saveWorkoutSession = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      setSaving(true);
      setSaveError(null);

      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      const userId = authSession?.user?.id;

      if (!userId) {
        setSaveError('User authentication session expired. Please log in again.');
        return;
      }

      const storeDraft = useActiveWorkoutStore.getState().draft;
      const hasMatchingDraft = Boolean(storeDraft && storeDraft.userId === userId);

      const routineId = hasMatchingDraft
        ? storeDraft!.routineId
        : (params.routine_id as string);
      const routineDayId = hasMatchingDraft
        ? storeDraft!.routineDayId
        : (params.routine_day_id as string) || null;
      const currentDay = hasMatchingDraft
        ? storeDraft!.dayNumber
        : parseInt(params.current_day as string, 10) || 1;
      const currentCycle = hasMatchingDraft
        ? storeDraft!.cycleNumber
        : parseInt(params.current_cycle as string, 10) || 1;
      const daysInSplit = hasMatchingDraft
        ? storeDraft!.daysInSplit
        : parseInt(params.days_in_split as string, 10) || 3;
      const durationSeconds = hasMatchingDraft
        ? storeDraft!.durationSeconds || 60
        : parseInt(params.duration_seconds as string, 10) || 1800;
      const startedAtIso = hasMatchingDraft
        ? new Date(storeDraft!.startedAtTimestamp).toISOString()
        : new Date(Date.now() - durationSeconds * 1000).toISOString();

      const workoutPayload = hasMatchingDraft
        ? storeDraft!.workoutExercises
        : params.payload
        ? JSON.parse(params.payload as string)
        : [];

      let volumeSum = 0;
      let completedSetsSum = 0;
      const exerciseCount = workoutPayload.length;

      workoutPayload.forEach((ex: any) => {
        ex.sets?.forEach((s: any) => {
          if (isWorkingCompletedSet(s)) {
            completedSetsSum++;
            const w = parseFloat(s.weight) || 0;
            const r = parseInt(s.reps, 10) || 0;
            volumeSum += getSetTonnage(w, r, Boolean(ex.is_unilateral));
          }
        });
      });

      setStats({
        totalVolume: Math.round(volumeSum),
        totalSets: completedSetsSum,
        totalExercises: exerciseCount,
        durationSeconds,
        currentDay,
        daysInSplit,
      });

      if (!routineId || workoutPayload.length === 0) {
        setSaveError('No unsaved workout data found to sync.');
        return;
      }

      // 1. Resolve Session ID (idempotent across retries and app restarts)
      let sessionId =
        savedSessionIdRef.current || (hasMatchingDraft ? storeDraft!.savedSessionId || null : null);

      if (!sessionId) {
        if (routineId && routineDayId) {
          const { data: existingSession } = await supabase
            .from('sessions')
            .select('id')
            .eq('user_id', userId)
            .eq('routine_id', routineId)
            .eq('routine_day_id', routineDayId)
            .eq('cycle_number', currentCycle)
            .limit(1)
            .maybeSingle();

          if (existingSession?.id) {
            sessionId = existingSession.id;
            savedSessionIdRef.current = sessionId;
            if (hasMatchingDraft) setSavedSessionId(sessionId);
          }
        }

        if (!sessionId) {
          const sessionPayload: any = {
            user_id: userId,
            routine_id: routineId,
            cycle_number: currentCycle,
            status: 'completed',
            started_at: startedAtIso,
            completed_at: new Date().toISOString(),
            duration_seconds: durationSeconds,
          };

          if (routineDayId) {
            sessionPayload.routine_day_id = routineDayId;
          }

          const { data: sessionData, error: sessionErr } = await supabase
            .from('sessions')
            .insert([sessionPayload])
            .select()
            .single();

          if (sessionErr || !sessionData) throw sessionErr || new Error('Failed to create session');
          sessionId = sessionData.id;
          savedSessionIdRef.current = sessionId;
          if (hasMatchingDraft) setSavedSessionId(sessionId);
        }
      }

      // Fetch routine days once outside the loop to optimize queries
      let routineDayIds: string[] = [];
      if (routineId) {
        try {
          const { data: rDays } = await supabase
            .from('routine_days')
            .select('id')
            .eq('routine_id', routineId);
          if (rDays && rDays.length > 0) {
            routineDayIds = rDays.map((d: any) => d.id);
          }
        } catch (rDaysErr) {
          console.warn('Error fetching routine days for target sync:', rDaysErr);
        }
      }

      const maxDumbbellWeightLbs = usePreferencesStore.getState().maxDumbbellWeightLbs;

      // 2. Insert Session Exercises & Sets
      for (const ex of workoutPayload) {
        const workingSets = (ex.sets || []).filter((s: any) => isWorkingCompletedSet(s));
        const eq = resolveExerciseEquipment({
          equipment: ex.equipment,
          is_bodyweight_only: ex.is_bodyweight_only,
          name: ex.name,
        });
        const isDumbbell = eq === 'dumbbell';

        let resolvedTargetWeight: number | null = null;
        if (!ex.is_bodyweight_only) {
          const parsed = parseFloat(ex.next_target_weight);
          if (!isNaN(parsed) && parsed > 0) {
            resolvedTargetWeight = parsed;
          } else {
            const weights = workingSets
              .map((s: any) => parseFloat(s.weight))
              .filter((w: any) => !isNaN(w) && w > 0);
            if (weights.length > 0) {
              resolvedTargetWeight = Math.max(...weights);
            }
          }
          if (
            isDumbbell &&
            resolvedTargetWeight !== null &&
            maxDumbbellWeightLbs !== null &&
            maxDumbbellWeightLbs > 0 &&
            !ex.is_target_weight_manually_edited
          ) {
            resolvedTargetWeight = Math.min(resolvedTargetWeight, maxDumbbellWeightLbs);
          }
        }

        const reachedDbCap =
          !ex.is_bodyweight_only &&
          isDumbbell &&
          maxDumbbellWeightLbs !== null &&
          maxDumbbellWeightLbs > 0 &&
          resolvedTargetWeight !== null &&
          resolvedTargetWeight >= maxDumbbellWeightLbs;

        let resolvedTargetReps: number | null = null;
        if (ex.is_bodyweight_only || reachedDbCap) {
          const parsedReps = parseInt(ex.next_target_reps, 10);
          if (!isNaN(parsedReps) && parsedReps > 0) {
            resolvedTargetReps = parsedReps;
          } else {
            const repsList = workingSets
              .map((s: any) => parseInt(s.reps, 10))
              .filter((r: any) => !isNaN(r) && r > 0);
            if (repsList.length > 0) {
              resolvedTargetReps = Math.max(...repsList);
            }
          }
        }

        let seDataFinal: any = null;

        const { data: existingSe } = await supabase
          .from('session_exercises')
          .select('id')
          .eq('session_id', sessionId)
          .eq('exercise_id', ex.exercise_id)
          .limit(1)
          .maybeSingle();

        if (existingSe?.id) {
          seDataFinal = existingSe;
        } else {
          const { data: seData, error: seErr } = await supabase
            .from('session_exercises')
            .insert([
              {
                session_id: sessionId,
                exercise_id: ex.exercise_id,
                next_target_weight: resolvedTargetWeight,
                next_target_reps: resolvedTargetReps,
                superset_id: ex.superset_id || null,
                superset_order: ex.superset_order || 1,
              },
            ])
            .select()
            .single();

          if (seErr) {
            if (
              seErr.message?.includes('superset_id') ||
              seErr.details?.includes('superset_id') ||
              seErr.message?.includes('schema cache')
            ) {
              const { data: fallbackSeData, error: fallbackSeErr } = await supabase
                .from('session_exercises')
                .insert([
                  {
                    session_id: sessionId,
                    exercise_id: ex.exercise_id,
                    next_target_weight: resolvedTargetWeight,
                    next_target_reps: resolvedTargetReps,
                  },
                ])
                .select()
                .single();
              if (!fallbackSeErr && fallbackSeData) {
                seDataFinal = fallbackSeData;
              } else {
                throw fallbackSeErr || new Error(`Failed to save exercise "${ex.name || ex.exercise_id}"`);
              }
            } else {
              throw seErr;
            }
          } else if (seData) {
            seDataFinal = seData;
          }
        }

        if (!seDataFinal) {
          throw new Error(`Failed to save exercise "${ex.name || ex.exercise_id}"`);
        }

        const seId = seDataFinal.id;

        const { error: deleteSetsErr } = await supabase
          .from('session_sets')
          .delete()
          .eq('session_exercise_id', seId);
        if (deleteSetsErr) throw deleteSetsErr;

        const setRows = (ex.sets || []).map((s: any) => ({
          session_exercise_id: seId,
          set_number: s.set_number,
          weight: parseFloat(s.weight) || 0,
          reps: parseInt(s.reps, 10) || 0,
          is_completed: s.is_completed,
          set_type: s.set_type || 'normal',
          rir: s.rir !== undefined && s.rir !== null ? Number(s.rir) : null,
        }));

        if (setRows.length > 0) {
          const { error: setsErr } = await supabase.from('session_sets').insert(setRows);
          if (setsErr) {
            if (
              setsErr.message?.includes('set_type') ||
              setsErr.message?.includes('rir') ||
              setsErr.message?.includes('schema cache') ||
              setsErr.details?.includes('set_type') ||
              setsErr.details?.includes('rir')
            ) {
              const legacyRows = setRows.map(({ set_type, rir, ...rest }: any) => rest);
              const { error: legacySetsErr } = await supabase.from('session_sets').insert(legacyRows);
              if (legacySetsErr) throw legacySetsErr;
            } else {
              throw setsErr;
            }
          }
        }

        // Sync progressive overload target back to routine_exercises (never overwrite for session-only Swapped lifts)
        if (!ex.is_swapped) {
          const runUpdateWithFallback = async (
            payload: Record<string, any>,
            buildQuery: (p: Record<string, any>) => any
          ): Promise<{ rows: any[] | null; error: any }> => {
            const { data, error } = await buildQuery(payload).select('id');
            if (
              error &&
              (error.message?.includes('target_rep_min') ||
                error.message?.includes('target_rep_max') ||
                error.message?.includes('schema cache'))
            ) {
              const { target_rep_min, target_rep_max, ...legacyPayload } = payload;
              if (Object.keys(legacyPayload).length === 0) {
                return { rows: [], error: null };
              }
              const retry = await buildQuery(legacyPayload).select('id');
              return { rows: retry.data, error: retry.error };
            }
            return { rows: data, error };
          };

          const updateRoutineTargetRow = async (
            currentDayPayload: Record<string, any>,
            siblingWeight: number | null
          ) => {
            let matchedById = false;
            if (ex.routine_exercise_id) {
              const { rows } = await runUpdateWithFallback(currentDayPayload, (p) =>
                supabase.from('routine_exercises').update(p).eq('id', ex.routine_exercise_id)
              );
              matchedById = Boolean(rows && rows.length > 0);
            }

            // Guardrail #4 (Phase 2): if routine_exercises was replaced by Edit Split (0 rows affected by ID),
            // match by (routine_day_id, exercise_id).
            if (!matchedById && routineDayId && ex.exercise_id) {
              await runUpdateWithFallback(currentDayPayload, (p) =>
                supabase
                  .from('routine_exercises')
                  .update(p)
                  .eq('routine_day_id', routineDayId)
                  .eq('exercise_id', ex.exercise_id)
              );
            }

            // Guardrail #3 (Phase 3A): sync ONLY target_weight across sibling days so differing day rep ranges
            // never violate routine_exercises_rep_range_check (SQLSTATE 23514).
            const siblingDayIds = routineDayIds.filter((id) => id !== routineDayId);
            if (
              !ex.is_bodyweight_only &&
              siblingWeight !== null &&
              siblingDayIds.length > 0 &&
              ex.exercise_id
            ) {
              try {
                await runUpdateWithFallback({ target_weight: siblingWeight }, (p) =>
                  supabase
                    .from('routine_exercises')
                    .update(p)
                    .in('routine_day_id', siblingDayIds)
                    .eq('exercise_id', ex.exercise_id)
                );
              } catch (syncErr) {
                console.warn('Error syncing target across routine days:', syncErr);
              }
            }
          };

          const currentDayPayload: Record<string, any> = {};
          if (!ex.is_bodyweight_only && resolvedTargetWeight !== null) {
            currentDayPayload.target_weight = resolvedTargetWeight;
          }
          if ((ex.is_bodyweight_only || reachedDbCap) && resolvedTargetReps !== null) {
            const existingMin =
              Number(ex.target_rep_min) > 0 ? Number(ex.target_rep_min) : resolvedTargetReps;
            const existingMax =
              Number(ex.target_rep_max) >= existingMin
                ? Number(ex.target_rep_max)
                : Math.max(existingMin, resolvedTargetReps);
            const safeMin = Math.max(1, Math.min(existingMin, resolvedTargetReps));
            const safeMax = Math.max(safeMin, existingMax, resolvedTargetReps);

            currentDayPayload.target_reps = resolvedTargetReps;
            currentDayPayload.target_rep_min = safeMin;
            currentDayPayload.target_rep_max = safeMax;
          }

          if (Object.keys(currentDayPayload).length > 0) {
            await updateRoutineTargetRow(currentDayPayload, resolvedTargetWeight);
          }
        }
      }

      // 3. Cycle Rotation Engine — Advance split day
      let nextDay = currentDay + 1;
      let nextCycle = currentCycle;

      if (nextDay > daysInSplit) {
        nextDay = 1;
        nextCycle = currentCycle + 1;
      }

      const { error: routineErr } = await supabase
        .from('routines')
        .update({
          current_day: nextDay,
          current_cycle: nextCycle,
          updated_at: new Date().toISOString(),
        })
        .eq('id', routineId);

      if (routineErr) throw routineErr;

      // Clear crash-safe active workout store ONLY after all PostgREST writes succeed
      if (hasMatchingDraft) {
        clearActiveWorkout();
      }
      setSaved(true);
    } catch (err: any) {
      console.error('Error saving workout session:', err);
      setSaved(false);
      setSaveError(err.message || 'An unexpected error occurred while saving your workout.');
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const formatDuration = (secs: number) => {
    const mins = Math.max(Math.floor(secs / 60), 1);
    return `${mins} mins`;
  };

  return (
    <View className="flex-1 bg-slate-950 p-6 pt-16 justify-between">
      <ScrollView className="flex-1">
        {/* App Branding */}
        <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest text-center mb-2">
          Best Damn Workout Tracker Ever
        </Text>
        {/* Top Trophy Banner */}
        <View className="items-center my-6">
          <View className="w-20 h-20 bg-amber-500/20 rounded-full items-center justify-center border-2 border-amber-500/50 mb-4 shadow-xl shadow-amber-900/30">
            <Trophy color="#f59e0b" size={40} />
          </View>
          <Text className="text-white text-3xl font-bold mb-1">Workout Complete!</Text>
          <Text className="text-slate-400 text-sm font-medium">Great effort on the gym floor today.</Text>
        </View>

        {/* Error Notification if save failed */}
        {saveError && (
          <View className="bg-red-950/60 p-4 rounded-2xl border border-red-500/50 mb-6 flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-3">
              <AlertCircle color="#ef4444" size={24} className="mr-3" />
              <View className="flex-1">
                <Text className="text-red-200 font-bold text-base">Sync Pending</Text>
                <Text className="text-red-300 text-xs mt-0.5" numberOfLines={3}>
                  {saveError} Your sets remain saved safely on this device.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={saveWorkoutSession}
              disabled={saving}
              className="bg-red-600 px-3 py-2 rounded-xl flex-row items-center"
            >
              <RefreshCw color="white" size={14} className="mr-1" />
              <Text className="text-white text-xs font-bold">Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stats Grid */}
        <View className="flex-row gap-3 mb-6">
          <View className="flex-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 items-center">
            <Flame color="#f97316" size={24} className="mb-2" />
            <Text className="text-white font-bold text-xl">{stats.totalVolume.toLocaleString()}</Text>
            <Text className="text-slate-500 text-xs font-semibold uppercase mt-0.5">Total Volume (lbs)</Text>
          </View>

          <View className="flex-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 items-center">
            <Dumbbell color="#3b82f6" size={24} className="mb-2" />
            <Text className="text-white font-bold text-xl">{stats.totalSets}</Text>
            <Text className="text-slate-500 text-xs font-semibold uppercase mt-0.5">Completed Sets</Text>
          </View>

          <View className="flex-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 items-center">
            <Clock color="#a78bfa" size={24} className="mb-2" />
            <Text className="text-white font-bold text-xl">{formatDuration(stats.durationSeconds)}</Text>
            <Text className="text-slate-500 text-xs font-semibold uppercase mt-0.5">Duration</Text>
          </View>
        </View>

        {/* Cycle Progression Banner */}
        {saved && (
          <View className="bg-indigo-950/40 p-5 rounded-2xl border border-indigo-500/30 mb-8 flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <CheckCircle color="#34d399" size={24} className="mr-3" />
              <View>
                <Text className="text-white font-bold text-base">Cycle Advanced</Text>
                <Text className="text-indigo-200 text-xs mt-0.5">
                  Next workout: Day {stats.currentDay >= stats.daysInSplit ? 1 : stats.currentDay + 1} of {stats.daysInSplit}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Return to Dashboard CTA */}
      <View className="pt-4 pb-6 border-t border-slate-900">
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/')}
          disabled={saving}
          className={`${saved ? 'bg-blue-600' : saveError ? 'bg-slate-800' : 'bg-blue-600'} p-4 rounded-2xl flex-row items-center justify-center`}
        >
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Text className="text-white font-bold text-lg mr-2">
                {saved ? 'Return to Dashboard' : saveError ? 'Return Anyway' : 'Return to Dashboard'}
              </Text>
              <ArrowRight color="white" size={20} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
