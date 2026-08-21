import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import {
  ChevronLeft,
  Dumbbell,
  Flame,
  Clock,
  Calendar,
  Sparkles,
  Layers,
  TrendingUp,
  Award,
  Trophy,
  ArrowRightLeft,
  Zap,
} from 'lucide-react-native';
import { calculateEstimated1RM, MUSCLE_GROUPS } from '../../src/utils/analyticsEngine';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<any>(null);
  const [previousCycleSession, setPreviousCycleSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadSessionDetail();
  }, [id]);

  const loadSessionDetail = async () => {
    setLoading(true);
    const { data: currentSession, error } = await supabase
      .from('sessions')
      .select(
        '*, routines(name), session_exercises(*, exercises(id, name, is_bodyweight_only, exercise_muscle_groups(*)), session_sets(*))'
      )
      .eq('id', id)
      .single();

    if (!error && currentSession) {
      setSession(currentSession);

      // Fetch previous cycle session on the same routine day if available
      if (currentSession.routine_id && currentSession.cycle_number > 1) {
        const prevCycleNum = currentSession.cycle_number - 1;
        const query = supabase
          .from('sessions')
          .select(
            '*, session_exercises(*, exercises(id, name, is_bodyweight_only), session_sets(*))'
          )
          .eq('user_id', currentSession.user_id)
          .eq('routine_id', currentSession.routine_id)
          .eq('cycle_number', prevCycleNum)
          .limit(1);

        if (currentSession.routine_day_id) {
          query.eq('routine_day_id', currentSession.routine_day_id);
        }

        const { data: prevData } = await query;
        if (prevData && prevData.length > 0) {
          setPreviousCycleSession(prevData[0]);
        }
      }
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
    year: 'numeric',
  });

  // Calculate session metrics
  let totalVolume = 0;
  let completedSetsCount = 0;
  const muscleSets: Record<string, number> = {};
  MUSCLE_GROUPS.forEach((g) => (muscleSets[g] = 0));

  (session.session_exercises || []).forEach((se: any) => {
    const muscleMappings: Array<{ muscle_group: string; fraction: number }> =
      se.exercises?.exercise_muscle_groups || [];

    (se.session_sets || []).forEach((st: any) => {
      if (st.is_completed) {
        completedSetsCount++;
        const w = Number(st.weight) || 0;
        const r = Number(st.reps) || 0;
        totalVolume += w * r;

        if (muscleMappings.length > 0) {
          muscleMappings.forEach((m) => {
            const grp = m.muscle_group;
            const frac = Number(m.fraction) || 1.0;
            if (muscleSets[grp] !== undefined) {
              muscleSets[grp] += frac;
            }
          });
        }
      }
    });
  });

  const durationSecs =
    session.duration_seconds ||
    (session.completed_at && session.started_at
      ? Math.max(
          Math.round(
            (new Date(session.completed_at).getTime() -
              new Date(session.started_at).getTime()) /
              1000
          ),
          0
        )
      : 1800);
  const mins = Math.max(Math.round(durationSecs / 60), 1);
  const density = mins > 0 ? Math.round(totalVolume / mins) : 0;

  // Previous Cycle Comparison
  let prevTotalVolume = 0;
  if (previousCycleSession) {
    (previousCycleSession.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          prevTotalVolume += (Number(st.weight) || 0) * (Number(st.reps) || 0);
        }
      });
    });
  }

  const volumeGrowthPct =
    prevTotalVolume > 0
      ? Math.round(((totalVolume - prevTotalVolume) / prevTotalVolume) * 100)
      : null;

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Navigation Header */}
      <View className="flex-row items-center justify-between mb-5">
        <View className="flex-row items-center flex-1 mr-3 min-w-0">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 bg-slate-900 rounded-full mr-3 border border-slate-800 shrink-0"
          >
            <ChevronLeft color="#94a3b8" size={20} />
          </TouchableOpacity>
          <View className="flex-1 min-w-0">
            <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
              Session Performance Report
            </Text>
            <Text className="text-white text-xl font-extrabold" numberOfLines={1}>
              {session.routines?.name || 'Workout'} • Cycle {session.cycle_number}
            </Text>
            <Text className="text-slate-400 text-xs">{dateStr}</Text>
          </View>
        </View>

        {session.routine_id && (
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/history/compare',
                params: {
                  routine_id: session.routine_id,
                  day_number: session.day_order || 1,
                  routine_day_id: session.routine_day_id || '',
                },
              })
            }
            className="bg-indigo-600/30 border border-indigo-500/40 px-3 py-1.5 rounded-full flex-row items-center shrink-0"
          >
            <ArrowRightLeft color="#a78bfa" size={14} className="mr-1" />
            <Text className="text-indigo-300 font-bold text-xs">Compare</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 4-KPI Metric Row */}
        <View className="flex-row gap-2.5 mb-5">
          <View className="flex-1 bg-slate-900/90 p-3 rounded-2xl border border-slate-800 items-center">
            <Flame color="#f97316" size={18} className="mb-0.5" />
            <Text className="text-white font-black text-base" numberOfLines={1}>
              {Math.round(totalVolume).toLocaleString()}
            </Text>
            <Text className="text-slate-400 text-[10px] uppercase font-bold">Tonnage (lbs)</Text>
          </View>

          <View className="flex-1 bg-slate-900/90 p-3 rounded-2xl border border-slate-800 items-center">
            <Dumbbell color="#3b82f6" size={18} className="mb-0.5" />
            <Text className="text-white font-black text-base">{completedSetsCount}</Text>
            <Text className="text-slate-400 text-[10px] uppercase font-bold">Sets</Text>
          </View>

          <View className="flex-1 bg-slate-900/90 p-3 rounded-2xl border border-slate-800 items-center">
            <Clock color="#a78bfa" size={18} className="mb-0.5" />
            <Text className="text-white font-black text-base">{mins}m</Text>
            <Text className="text-slate-400 text-[10px] uppercase font-bold">Duration</Text>
          </View>

          <View className="flex-1 bg-slate-900/90 p-3 rounded-2xl border border-slate-800 items-center">
            <Zap color="#34d399" size={18} className="mb-0.5" />
            <Text className="text-white font-black text-base" numberOfLines={1}>{density}</Text>
            <Text className="text-slate-400 text-[10px] uppercase font-bold">lbs/min</Text>
          </View>
        </View>

        {/* Previous Cycle Progression Badge */}
        {previousCycleSession && volumeGrowthPct !== null && (
          <View className="bg-gradient-to-r from-indigo-950/60 to-purple-950/40 p-4 rounded-2xl border border-indigo-500/30 mb-5 flex-row justify-between items-center">
            <View className="flex-row items-center flex-1 mr-2">
              <Sparkles color="#c084fc" size={18} className="mr-2" />
              <View>
                <Text className="text-white font-bold text-xs">
                  Progressive Overload vs Cycle {previousCycleSession.cycle_number}
                </Text>
                <Text className="text-purple-200/80 text-[11px]">
                  Prev: {Math.round(prevTotalVolume).toLocaleString()} lbs → Current: {Math.round(totalVolume).toLocaleString()} lbs
                </Text>
              </View>
            </View>
            <View
              className={`px-2.5 py-1 rounded-xl flex-row items-center ${
                volumeGrowthPct >= 0 ? 'bg-emerald-500/20' : 'bg-rose-500/20'
              }`}
            >
              <TrendingUp
                color={volumeGrowthPct >= 0 ? '#10b981' : '#f43f5e'}
                size={14}
                className="mr-1"
              />
              <Text
                className={`font-black text-xs ${
                  volumeGrowthPct >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {volumeGrowthPct >= 0 ? `+${volumeGrowthPct}%` : `${volumeGrowthPct}%`}
              </Text>
            </View>
          </View>
        )}

        {/* Muscle Volume Breakdown for this Session */}
        <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 mb-5">
          <Text className="text-slate-300 text-xs font-bold uppercase tracking-wider mb-3">
            Muscle Volume Stimulus (Session Attribution)
          </Text>
          <View className="space-y-2">
            {MUSCLE_GROUPS.filter((g) => (muscleSets[g] || 0) > 0).map((g) => {
              const sets = Math.round((muscleSets[g] || 0) * 10) / 10;
              const barPct = Math.min(100, (sets / 10) * 100);
              return (
                <View key={g}>
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-slate-200 text-xs font-semibold">{g}</Text>
                    <Text className="text-indigo-400 font-bold text-xs">{sets} working sets</Text>
                  </View>
                  <View className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${barPct}%` }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Exercise Set Detail Breakdown */}
        <Text className="text-white text-lg font-bold mb-3">Exercise Performance Details</Text>

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
              // Calculate top e1RM for this exercise
              let topE1RM = 0;
              let topWeight = 0;
              (se.session_sets || []).forEach((st: any) => {
                if (st.is_completed) {
                  const w = Number(st.weight) || 0;
                  const r = Number(st.reps) || 0;
                  const curE1RM = calculateEstimated1RM(w, r);
                  if (curE1RM > topE1RM) topE1RM = curE1RM;
                  if (w > topWeight) topWeight = w;
                }
              });

              elements.push(
                <View
                  key={se.id || `standalone_${i}`}
                  className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800/90 mb-4 shadow-sm"
                >
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-white font-bold text-base flex-1 mr-2" numberOfLines={1}>
                      {se.exercises?.name || 'Exercise'}
                    </Text>
                    {topE1RM > 0 && !se.exercises?.is_bodyweight_only && (
                      <View className="bg-blue-500/10 px-2.5 py-1 rounded-xl border border-blue-500/30">
                        <Text className="text-blue-300 font-extrabold text-xs">
                          Est. 1RM: {Math.round(topE1RM)} lbs
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Sets list */}
                  <View className="space-y-1.5">
                    {(se.session_sets || []).map((st: any) => (
                      <View
                        key={st.id || st.set_number}
                        className="flex-row justify-between items-center bg-slate-800/50 px-3 py-2 rounded-xl mb-1"
                      >
                        <Text className="text-slate-400 font-bold text-xs">Set {st.set_number}</Text>
                        <Text className="text-white font-black text-sm">
                          {se.exercises?.is_bodyweight_only
                            ? 'Bodyweight'
                            : `${st.weight} lbs`}{' '}
                          × {st.reps} reps
                        </Text>
                      </View>
                    ))}
                  </View>

                  {se.next_target_weight && (
                    <View className="mt-3 pt-2.5 border-t border-slate-800 flex-row items-center justify-between">
                      <View className="flex-row items-center">
                        <Sparkles color="#a78bfa" size={14} className="mr-1.5" />
                        <Text className="text-purple-300 text-xs font-semibold">
                          Recorded Next Target
                        </Text>
                      </View>
                      <Text className="text-white font-bold text-xs">
                        {se.next_target_weight} lbs
                      </Text>
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
                <View
                  key={`superset_${sId}`}
                  className="bg-indigo-950/20 border-2 border-indigo-500/40 rounded-3xl p-4 mb-4"
                >
                  {/* Superset Header */}
                  <View className="flex-row justify-between items-center mb-3 pb-2 border-b border-indigo-500/20">
                    <View className="flex-row items-center">
                      <View className="bg-indigo-600 px-2.5 py-1 rounded-lg mr-2 flex-row items-center">
                        <Layers color="white" size={12} className="mr-1" />
                        <Text className="text-white font-extrabold text-xs tracking-wider">
                          SUPERSET {letter}
                        </Text>
                      </View>
                      <Text className="text-indigo-200 text-xs font-semibold">
                        {groupItems.map((g: any) => g.exercises?.name || 'Exercise').join(' + ')}
                      </Text>
                    </View>
                  </View>

                  {groupItems.map((groupEx: any, subIdx: number) => {
                    const tag = `${letter}${groupEx.superset_order || subIdx + 1}`;
                    return (
                      <View
                        key={groupEx.id || `sub_${subIdx}`}
                        className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 mb-2.5"
                      >
                        <View className="flex-row items-center mb-2.5">
                          <View className="bg-indigo-500/30 border border-indigo-500/50 px-2 py-0.5 rounded mr-2">
                            <Text className="text-indigo-300 font-mono font-bold text-xs">{tag}</Text>
                          </View>
                          <Text className="text-white font-bold text-base">
                            {groupEx.exercises?.name || 'Exercise'}
                          </Text>
                        </View>

                        <View className="space-y-1">
                          {(groupEx.session_sets || []).map((st: any) => (
                            <View
                              key={st.id || st.set_number}
                              className="flex-row justify-between items-center bg-slate-800/50 px-3 py-2 rounded-xl mb-1"
                            >
                              <Text className="text-slate-400 font-bold text-xs">
                                Set {st.set_number}
                              </Text>
                              <Text className="text-white font-black text-sm">
                                {groupEx.exercises?.is_bodyweight_only
                                  ? 'Bodyweight'
                                  : `${st.weight} lbs`}{' '}
                                × {st.reps} reps
                              </Text>
                            </View>
                          ))}
                        </View>

                        {groupEx.next_target_weight && (
                          <View className="mt-2.5 pt-2 border-t border-slate-800 flex-row items-center justify-between">
                            <View className="flex-row items-center">
                              <Sparkles color="#a78bfa" size={12} className="mr-1" />
                              <Text className="text-purple-300 text-xs font-semibold">
                                Recorded Next Target
                              </Text>
                            </View>
                            <Text className="text-white font-bold text-xs">
                              {groupEx.next_target_weight} lbs
                            </Text>
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
