import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { Trophy, Flame, Dumbbell, Clock, ArrowRight, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react-native';

export default function WorkoutCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const routineId = params.routine_id as string;
  const routineDayId = (params.routine_day_id as string) || null;
  const currentDay = parseInt(params.current_day as string, 10) || 1;
  const currentCycle = parseInt(params.current_cycle as string, 10) || 1;
  const daysInSplit = parseInt(params.days_in_split as string, 10) || 3;
  const cyclesPerRoutine = parseInt(params.cycles_per_routine as string, 10) || 4;
  const durationSeconds = parseInt(params.duration_seconds as string, 10) || 1800;

  const [saving, setSaving] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalVolume: 0,
    totalSets: 0,
    totalExercises: 0
  });

  useEffect(() => {
    saveWorkoutSession();
  }, []);

  const saveWorkoutSession = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      const { data: { session: authSession } } = await supabase.auth.getSession();
      const userId = authSession?.user?.id;

      if (!userId) {
        setSaving(false);
        setSaveError('User authentication session expired. Please log in again.');
        return;
      }

      const workoutPayload = params.payload ? JSON.parse(params.payload as string) : [];

      let volumeSum = 0;
      let completedSetsSum = 0;
      let exerciseCount = workoutPayload.length;

      workoutPayload.forEach((ex: any) => {
        ex.sets?.forEach((s: any) => {
          if (s.is_completed) {
            completedSetsSum++;
            const w = parseFloat(s.weight) || 0;
            const r = parseInt(s.reps, 10) || 0;
            volumeSum += w * r;
          }
        });
      });

      setStats({
        totalVolume: Math.round(volumeSum),
        totalSets: completedSetsSum,
        totalExercises: exerciseCount
      });

      // 1. Insert Session (including status = 'completed', duration_seconds, and routine_day_id)
      const sessionPayload: any = {
        user_id: userId,
        routine_id: routineId,
        cycle_number: currentCycle,
        status: 'completed',
        started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds
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

      const sessionId = sessionData.id;

      // 2. Insert Session Exercises & Sets
      for (const ex of workoutPayload) {
        const { data: seData, error: seErr } = await supabase
          .from('session_exercises')
          .insert([{
            session_id: sessionId,
            exercise_id: ex.exercise_id,
            next_target_weight: ex.is_bodyweight_only ? null : parseFloat(ex.next_target_weight) || null
          }])
          .select()
          .single();

        if (seErr || !seData) continue;

        const seId = seData.id;

        const setRows = (ex.sets || []).map((s: any) => ({
          session_exercise_id: seId,
          set_number: s.set_number,
          weight: parseFloat(s.weight) || 0,
          reps: parseInt(s.reps, 10) || 0,
          is_completed: s.is_completed
        }));

        if (setRows.length > 0) {
          const { error: setsErr } = await supabase.from('session_sets').insert(setRows);
          if (setsErr) console.warn('Error inserting session sets:', setsErr);
        }
      }

      // 3. Cycle Rotation Engine — Advance split day
      let nextDay = currentDay + 1;
      let nextCycle = currentCycle;

      if (nextDay > daysInSplit) {
        nextDay = 1;
        nextCycle = currentCycle + 1;
      }

      await supabase
        .from('routines')
        .update({
          current_day: nextDay,
          current_cycle: nextCycle,
          updated_at: new Date().toISOString()
        })
        .eq('id', routineId);

      setSaving(false);
      setSaved(true);
    } catch (err: any) {
      console.error('Error saving workout session:', err);
      setSaving(false);
      setSaved(false);
      setSaveError(err.message || 'An unexpected error occurred while saving your workout.');
    }
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    return `${mins} mins`;
  };

  return (
    <View className="flex-1 bg-slate-950 p-6 pt-16 justify-between">
      <ScrollView className="flex-1">
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
                <Text className="text-red-200 font-bold text-base">Save Failed</Text>
                <Text className="text-red-300 text-xs mt-0.5" numberOfLines={2}>{saveError}</Text>
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
            <Text className="text-white font-bold text-xl">{formatDuration(durationSeconds)}</Text>
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
                  Next workout: Day {currentDay >= daysInSplit ? 1 : currentDay + 1} of {daysInSplit}
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
