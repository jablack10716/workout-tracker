import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { ChevronLeft, Dumbbell, Flame, Clock, Calendar, Sparkles, Layers } from 'lucide-react-native';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Navigation Header */}
      <View className="flex-row items-center mb-6">
        <TouchableOpacity onPress={() => router.back()} className="p-2 bg-slate-900 rounded-full mr-3 border border-slate-800 shrink-0">
          <ChevronLeft color="#94a3b8" size={20} />
        </TouchableOpacity>
        <View className="flex-1 min-w-0">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-slate-400 text-xs font-semibold uppercase" numberOfLines={1}>{session.routines?.name || 'Workout'}</Text>
          <Text className="text-white text-xl font-bold" numberOfLines={1}>{dateStr}</Text>
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
        {(() => {
          const sessionExercises = session.session_exercises || [];
          const supersetLetterMap: Record<string, string> = {};
          let letterCode = 65; // 'A'

          sessionExercises.forEach((se: any) => {
            if (se.superset_id && !supersetLetterMap[se.superset_id]) {
              supersetLetterMap[se.superset_id] = String.fromCharCode(letterCode++);
            }
          });

          const processedSupersets = new Set<string>();
          const elements: any[] = [];

          for (let i = 0; i < sessionExercises.length; i++) {
            const se = sessionExercises[i];

            if (!se.superset_id) {
              elements.push(
                <View key={se.id || `standalone_${i}`} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 mb-4">
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
              );
            } else if (!processedSupersets.has(se.superset_id)) {
              processedSupersets.add(se.superset_id);
              const sId = se.superset_id;
              const letter = supersetLetterMap[sId] || 'A';
              const groupItems = sessionExercises.filter((item: any) => item.superset_id === sId);

              elements.push(
                <View key={`superset_${sId}`} className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-4">
                  {/* Superset Header */}
                  <View className="flex-row justify-between items-center mb-3 pb-2 border-b border-indigo-500/20">
                    <View className="flex-row items-center">
                      <View className="bg-indigo-600 px-2.5 py-1 rounded-lg mr-2 flex-row items-center">
                        <Layers color="white" size={12} className="mr-1" />
                        <Text className="text-white font-extrabold text-xs tracking-wider">SUPERSET {letter}</Text>
                      </View>
                      <Text className="text-indigo-200 text-xs font-semibold">
                        {groupItems.map((g: any) => g.exercises?.name || 'Exercise').join(' + ')}
                      </Text>
                    </View>
                  </View>

                  {groupItems.map((groupEx: any, subIdx: number) => {
                    const tag = `${letter}${groupEx.superset_order || subIdx + 1}`;
                    return (
                      <View key={groupEx.id || `sub_${subIdx}`} className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 mb-2.5">
                        <View className="flex-row items-center mb-2.5">
                          <View className="bg-indigo-500/30 border border-indigo-500/50 px-2 py-0.5 rounded mr-2">
                            <Text className="text-indigo-300 font-mono font-bold text-xs">{tag}</Text>
                          </View>
                          <Text className="text-white font-bold text-base">{groupEx.exercises?.name || 'Exercise'}</Text>
                        </View>

                        <View className="space-y-1.5">
                          {(groupEx.session_sets || []).map((st: any) => (
                            <View key={st.id || st.set_number} className="flex-row justify-between items-center bg-slate-800/60 p-2.5 rounded-xl mb-1.5">
                              <Text className="text-slate-400 font-bold text-sm">Set {st.set_number}</Text>
                              <Text className="text-white font-bold text-base">
                                {groupEx.exercises?.is_bodyweight_only ? 'Bodyweight' : `${st.weight} lbs`} × {st.reps} reps
                              </Text>
                            </View>
                          ))}
                        </View>

                        {groupEx.next_target_weight && (
                          <View className="mt-2.5 pt-2 border-t border-slate-800 flex-row items-center justify-between">
                            <View className="flex-row items-center">
                              <Sparkles color="#a78bfa" size={12} className="mr-1" />
                              <Text className="text-purple-300 text-xs font-semibold">Recorded Next Target</Text>
                            </View>
                            <Text className="text-white font-bold text-xs">{groupEx.next_target_weight} lbs</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            }
          }

          return elements;
        })()}
      </ScrollView>
    </View>
  );
}
