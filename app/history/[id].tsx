import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { ChevronLeft, Dumbbell, Flame, Clock, Calendar, Sparkles } from 'lucide-react-native';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadSessionDetail();
  }, [id]);

  const loadSessionDetail = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('*, routines(name), session_exercises(*, exercises(name, is_bodyweight_only), session_sets(*))')
      .eq('id', id)
      .single();

    if (!error && data) {
      setSession(data);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!session) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center p-6">
        <Text className="text-slate-400">Workout session not found.</Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4 bg-slate-800 px-4 py-2 rounded-xl">
          <Text className="text-white">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = new Date(session.started_at).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  let totalVolume = 0;
  let completedSetsCount = 0;

  (session.session_exercises || []).forEach((se: any) => {
    (se.session_sets || []).forEach((st: any) => {
      if (st.is_completed) {
        completedSetsCount++;
        totalVolume += (st.weight || 0) * (st.reps || 0);
      }
    });
  });

  const calculatedSecs = session.completed_at && session.started_at
    ? Math.max(Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000), 0)
    : 1800;
  const durationSecs = session.duration_seconds || calculatedSecs;
  const mins = Math.max(Math.round(durationSecs / 60), 1);

  return (
    <View className="flex-1 bg-slate-950 p-4 pt-12">
      {/* Navigation Header */}
      <View className="flex-row items-center mb-6">
        <TouchableOpacity onPress={() => router.back()} className="p-2 bg-slate-900 rounded-full mr-3 border border-slate-800">
          <ChevronLeft color="#94a3b8" size={20} />
        </TouchableOpacity>
        <View>
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest mb-0.5">
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-slate-400 text-xs font-semibold uppercase">{session.routines?.name || 'Workout'}</Text>
          <Text className="text-white text-xl font-bold">{dateStr}</Text>
        </View>
      </View>

      {/* Summary Cards */}
      <View className="flex-row gap-3 mb-6">
        <View className="flex-1 bg-slate-900 p-3.5 rounded-2xl border border-slate-800 items-center">
          <Flame color="#f97316" size={20} className="mb-1" />
          <Text className="text-white font-bold text-base">{Math.round(totalVolume).toLocaleString()}</Text>
          <Text className="text-slate-500 text-xs">Volume (lbs)</Text>
        </View>

        <View className="flex-1 bg-slate-900 p-3.5 rounded-2xl border border-slate-800 items-center">
          <Dumbbell color="#3b82f6" size={20} className="mb-1" />
          <Text className="text-white font-bold text-base">{completedSetsCount}</Text>
          <Text className="text-slate-500 text-xs">Sets</Text>
        </View>

        <View className="flex-1 bg-slate-900 p-3.5 rounded-2xl border border-slate-800 items-center">
          <Clock color="#a78bfa" size={20} className="mb-1" />
          <Text className="text-white font-bold text-base">{mins}m</Text>
          <Text className="text-slate-500 text-xs">Duration</Text>
        </View>
      </View>

      {/* Exercise Set Detail Breakdown */}
      <ScrollView className="flex-1">
        {(session.session_exercises || []).map((se: any, idx: number) => (
          <View key={se.id || idx} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-4">
            <Text className="text-white font-bold text-lg mb-3">{se.exercises?.name || 'Exercise'}</Text>

            {/* Sets list */}
            <View className="space-y-2">
              {(se.session_sets || []).map((st: any) => (
                <View key={st.id || st.set_number} className="flex-row justify-between items-center bg-slate-800/60 p-2.5 rounded-xl mb-1.5">
                  <Text className="text-slate-400 font-bold text-sm">Set {st.set_number}</Text>
                  <Text className="text-white font-bold text-base">
                    {se.exercises?.is_bodyweight_only ? 'Bodyweight' : `${st.weight} lbs`} × {st.reps} reps
                  </Text>
                </View>
              ))}
            </View>

            {se.next_target_weight && (
              <View className="mt-3 pt-2.5 border-t border-slate-800 flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Sparkles color="#a78bfa" size={14} className="mr-1.5" />
                  <Text className="text-purple-300 text-xs font-semibold">Recorded Next Target</Text>
                </View>
                <Text className="text-white font-bold text-xs">{se.next_target_weight} lbs</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
