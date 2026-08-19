import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import {
  Settings,
  Play,
  ChevronRight,
  Activity,
  Plus,
  Dumbbell,
  Flame,
  Trophy,
  CheckCircle2,
  Calendar,
  Clock,
  TrendingUp,
  Sparkles,
} from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { computeDashboardStats, DashboardStats } from '../../src/utils/dashboardMetrics';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');
  const [activeRoutine, setActiveRoutine] = useState<any>(null);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (user?.user_metadata?.display_name) {
        setDisplayName(user.user_metadata.display_name);
      } else if (user?.email) {
        setDisplayName(user.email.split('@')[0]);
      } else {
        setDisplayName('Lifter');
      }

      if (user) {
        // 1. Fetch Active Routine with routine_days, routine_exercises, exercises, and muscle groups
        const { data: routines } = await supabase
          .from('routines')
          .select(
            '*, routine_days(*, routine_exercises(*, exercises(*, exercise_muscle_groups(*))))'
          )
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1);

        const currentActiveRoutine = routines && routines.length > 0 ? routines[0] : null;
        setActiveRoutine(currentActiveRoutine);

        // 2. Fetch User Sessions with full exercise and set logs
        const { data: sessions } = await supabase
          .from('sessions')
          .select(
            '*, routines(name), session_exercises(*, exercises(id, name, is_bodyweight_only, exercise_muscle_groups(*)), session_sets(*))'
          )
          .eq('user_id', user.id)
          .order('started_at', { ascending: false });

        const sessionLogs = sessions || [];
        setAllSessions(sessionLogs);

        // 3. Compute Dynamic Dashboard Stats
        const calculatedStats = computeDashboardStats(currentActiveRoutine, sessionLogs);
        setStats(calculatedStats);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  const recentSessions = allSessions.slice(0, 3);

  // SVG parameters for the main Volume Impact circular ring
  const ringRadius = 38;
  const ringCircumference = 2 * Math.PI * ringRadius; // ~238.76
  const completionPct = stats?.weeklyCompletionPct ?? 0;
  const strokeOffset = ringCircumference - (ringCircumference * completionPct) / 100;

  // SVG parameters for top metric pill mini ring
  const miniRadius = 14;
  const miniCircumference = 2 * Math.PI * miniRadius; // ~87.96
  const miniOffset = miniCircumference - (miniCircumference * completionPct) / 100;

  return (
    <ScrollView
      className="flex-1 bg-slate-950"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
      }
    >
      <View className="px-5 pb-12" style={{ paddingTop: Math.max(insets.top, 16) }}>
        {/* Header */}
        <View className="flex-row justify-between items-center mb-6">
          <View className="flex-1 mr-3 min-w-0">
            <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
              Weight Lifting Tracker
            </Text>
            <Text className="text-slate-400 text-sm">Welcome back,</Text>
            <Text className="text-white text-2xl font-extrabold" numberOfLines={1}>{displayName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            className="w-11 h-11 bg-slate-900/90 rounded-full items-center justify-center border border-slate-800 shadow-sm shrink-0"
          >
            <Settings color="#94a3b8" size={20} />
          </TouchableOpacity>
        </View>

        {/* 3-Stat Metric Row */}
        <View className="flex-row gap-3 mb-6">
          {/* Workouts */}
          <View className="flex-1 bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800/90 items-center justify-center shadow-sm">
            <View className="w-8 h-8 rounded-full bg-blue-500/10 items-center justify-center mb-1 border border-blue-500/20">
              <Dumbbell color="#60a5fa" size={16} />
            </View>
            <Text className="text-white font-black text-xl leading-tight">
              {stats?.weeklyWorkoutsCount ?? 0}
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider mt-0.5">
              Workouts
            </Text>
          </View>

          {/* Tonnage */}
          <View className="flex-1 bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800/90 items-center justify-center shadow-sm">
            <View className="w-8 h-8 rounded-full bg-orange-500/10 items-center justify-center mb-1 border border-orange-500/20">
              <Flame color="#f97316" size={16} />
            </View>
            <Text className="text-white font-black text-xl leading-tight" numberOfLines={1}>
              {stats && stats.weeklyTonnage > 0
                ? stats.weeklyTonnage >= 10000
                  ? `${(stats.weeklyTonnage / 1000).toFixed(1)}k`
                  : stats.weeklyTonnage.toLocaleString()
                : '0'}
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider mt-0.5">
              Tonnage (lbs)
            </Text>
          </View>

          {/* Weekly Target % Ring */}
          <View className="flex-1 bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800/90 items-center justify-center shadow-sm">
            <View className="relative items-center justify-center mb-1">
              <Svg width="36" height="36">
                <Circle
                  cx="18"
                  cy="18"
                  r={miniRadius}
                  stroke="#334155"
                  strokeWidth="3.5"
                  fill="none"
                />
                <Circle
                  cx="18"
                  cy="18"
                  r={miniRadius}
                  stroke={completionPct >= 100 ? '#10b981' : '#8b5cf6'}
                  strokeWidth="3.5"
                  fill="none"
                  strokeDasharray={`${miniCircumference}`}
                  strokeDashoffset={miniOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 18 18)"
                />
              </Svg>
              <View className="absolute">
                <Text className="text-white font-bold text-[10px]">{completionPct}%</Text>
              </View>
            </View>
            <Text className="text-slate-300 font-bold text-xs leading-tight">
              {stats?.weeklyCompletedSets ?? 0}/{stats?.weeklyTargetSets ?? 0}
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider mt-0.5">
              Target Sets
            </Text>
          </View>
        </View>

        {/* HERO WORKOUT CARD */}
        {activeRoutine ? (
          <View className="bg-gradient-to-br from-indigo-950/60 to-slate-900/90 p-5 rounded-3xl border border-indigo-500/30 mb-6 shadow-xl shadow-indigo-950/40">
            {/* Split & Cycle Badges */}
            <View className="flex-row justify-between items-center mb-3">
              <View className="bg-indigo-500/20 px-3 py-1 rounded-full border border-indigo-500/30 flex-row items-center">
                <Sparkles color="#a78bfa" size={12} className="mr-1" />
                <Text className="text-indigo-300 text-xs font-bold uppercase tracking-wider">
                  Day {stats?.currentDayNumber || activeRoutine.current_day} of {activeRoutine.days_in_split}
                </Text>
              </View>

              <Text className="text-indigo-300 text-xs font-medium">
                Cycle {activeRoutine.current_cycle} of {activeRoutine.cycles_per_routine}
              </Text>
            </View>

            {/* Split Day Title */}
            <Text className="text-white text-2xl font-extrabold mb-1">
              {stats?.currentDayName || activeRoutine.name}
            </Text>
            <Text className="text-indigo-200/80 text-xs font-medium mb-4">
              Routine: {activeRoutine.name}
            </Text>

            {/* Scheduled Exercises Preview Chips */}
            {stats?.todayExercises && stats.todayExercises.length > 0 && (
              <View className="mb-5">
                <Text className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2">
                  Today's Scheduled Lifts ({stats.todayExercises.length})
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {stats.todayExercises.slice(0, 5).map((ex, i) => (
                    <View
                      key={ex.id || i}
                      className="bg-slate-900/80 px-2.5 py-1.5 rounded-xl border border-slate-700/60 flex-row items-center"
                    >
                      <Text className="text-slate-200 text-xs font-semibold">{ex.name}</Text>
                      {ex.targetWeight && !ex.isBodyweight && (
                        <Text className="text-indigo-400 text-xs font-bold ml-1.5">
                          {ex.targetWeight} lbs
                        </Text>
                      )}
                      {ex.plannedSets > 0 && (
                        <Text className="text-slate-400 text-[10px] ml-1">
                          ({ex.plannedSets}s)
                        </Text>
                      )}
                    </View>
                  ))}
                  {stats.todayExercises.length > 5 && (
                    <View className="bg-slate-900/80 px-2 py-1.5 rounded-xl border border-slate-700/60 items-center justify-center">
                      <Text className="text-slate-400 text-xs font-medium">
                        +{stats.todayExercises.length - 5} more
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Contextual Action Button */}
            {stats?.isCompletedToday ? (
              <View className="bg-emerald-950/40 p-4 rounded-2xl border border-emerald-500/30">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <CheckCircle2 color="#10b981" size={18} className="mr-2" />
                    <Text className="text-emerald-300 font-bold text-sm">
                      Today's Workout Complete!
                    </Text>
                  </View>
                  <Text className="text-emerald-400 text-xs font-bold">
                    {stats.todaySummary?.durationMinutes} min
                  </Text>
                </View>

                <View className="flex-row items-center justify-between pt-2 border-t border-emerald-500/20">
                  <Text className="text-emerald-200/80 text-xs">
                    {stats.todaySummary?.tonnage.toLocaleString()} lbs • {stats.todaySummary?.completedSets} completed sets
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push('/workout/active')}
                    className="bg-emerald-600/80 px-3 py-1 rounded-xl"
                  >
                    <Text className="text-white text-xs font-bold">Log Again</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => router.push('/workout/active')}
                className="bg-indigo-600 active:bg-indigo-500 flex-row items-center justify-center p-4 rounded-2xl shadow-lg shadow-indigo-600/30"
              >
                <Play color="white" fill="white" size={18} className="mr-2" />
                <Text className="text-white font-black text-base">
                  Start Workout • Day {stats?.currentDayNumber || activeRoutine.current_day}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          /* Onboarding Card when no routine is active */
          <View className="bg-slate-900/80 p-6 rounded-3xl border border-slate-800 mb-6">
            <View className="flex-row items-center mb-3">
              <Activity color="#60a5fa" size={24} className="mr-3" />
              <Text className="text-white text-xl font-bold">No Active Routine</Text>
            </View>
            <Text className="text-slate-400 mb-5 leading-5 text-sm">
              Create a custom routine to organize your workout split, assign exercises, and track progressive overload targets.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/routine-builder/new')}
              className="bg-blue-600 flex-row items-center justify-center p-4 rounded-2xl"
            >
              <Plus color="white" size={20} className="mr-2" />
              <Text className="text-white font-bold text-base">Create Routine</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* WEEKLY VOLUME IMPACT & MUSCLE GROUP BREAKDOWN */}
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-white text-lg font-bold">Weekly Volume Impact</Text>
          <TouchableOpacity onPress={() => router.push('/analytics')}>
            <Text className="text-indigo-400 text-xs font-bold">Full Analytics</Text>
          </TouchableOpacity>
        </View>

        <View className="bg-slate-900/70 rounded-3xl border border-slate-800 p-5 mb-6">
          {/* Main Progress Ring & Summary */}
          <View className="flex-row items-center mb-5 pb-5 border-b border-slate-800/80">
            <View className="relative items-center justify-center mr-5">
              <Svg width="96" height="96">
                <Circle
                  cx="48"
                  cy="48"
                  r={ringRadius}
                  stroke="#1e293b"
                  strokeWidth="10"
                  fill="none"
                />
                <Circle
                  cx="48"
                  cy="48"
                  r={ringRadius}
                  stroke={completionPct >= 100 ? '#10b981' : '#8b5cf6'}
                  strokeWidth="10"
                  fill="none"
                  strokeDasharray={`${ringCircumference}`}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 48 48)"
                />
              </Svg>
              <View className="absolute items-center">
                <Text className="text-white font-black text-xl">{completionPct}%</Text>
              </View>
            </View>

            <View className="flex-1">
              <Text className="text-white font-bold text-base mb-1">
                {completionPct >= 100
                  ? 'Weekly Target Achieved! 🎯'
                  : `${stats?.weeklyCompletedSets ?? 0} of ${stats?.weeklyTargetSets ?? 0} Sets Hit`}
              </Text>
              <Text className="text-slate-400 text-xs leading-4">
                {activeRoutine
                  ? stats?.weeklyTargetSets && stats.weeklyTargetSets > 0
                    ? `${Math.max(0, stats.weeklyTargetSets - stats.weeklyCompletedSets)} working sets remaining this calendar week.`
                    : 'Add exercises with target sets to your routine to compute volume.'
                  : 'Activate a routine to calculate your target volume.'}
              </Text>
            </View>
          </View>

          {/* Muscle Group Breakdown Bars */}
          {stats?.muscleGroups && stats.muscleGroups.some((g) => g.targetSets > 0 || g.completedSets > 0) ? (
            <View className="space-y-3">
              <Text className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2">
                Muscle Group Target Sets
              </Text>
              {stats.muscleGroups
                .filter((g) => g.targetSets > 0 || g.completedSets > 0)
                .map((group) => {
                  const barPct = Math.min(100, group.percentage);
                  return (
                    <View key={group.name} className="mb-2.5">
                      <View className="flex-row justify-between items-center mb-1">
                        <Text className="text-slate-200 text-xs font-semibold">{group.name}</Text>
                        <Text className="text-slate-400 text-xs font-medium">
                          <Text
                            className={
                              group.completedSets >= group.targetSets && group.targetSets > 0
                                ? 'text-emerald-400 font-bold'
                                : 'text-white font-bold'
                            }
                          >
                            {group.completedSets}
                          </Text>
                          {' / '}
                          {group.targetSets} sets ({group.percentage}%)
                        </Text>
                      </View>
                      <View className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <View
                          className={`h-full rounded-full ${
                            group.completedSets >= group.targetSets && group.targetSets > 0
                              ? 'bg-emerald-500'
                              : 'bg-indigo-500'
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </View>
                    </View>
                  );
                })}
            </View>
          ) : (
            <View className="items-center py-2">
              <Text className="text-slate-500 text-xs text-center">
                Muscle group volume will track here as you log completed sets.
              </Text>
            </View>
          )}
        </View>

        {/* RECENT WORKOUT LOGS */}
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-white text-lg font-bold">Recent Logs</Text>
          <TouchableOpacity onPress={() => router.push('/history')}>
            <Text className="text-indigo-400 text-xs font-bold">View All</Text>
          </TouchableOpacity>
        </View>

        {recentSessions.length > 0 ? (
          <View className="space-y-3">
            {recentSessions.map((session, i) => {
              const hasPR = stats?.prSessionIds.has(session.id);
              const dateStr = new Date(session.started_at).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });

              let sessionTonnage = 0;
              let sessionSets = 0;
              (session.session_exercises || []).forEach((se: any) => {
                (se.session_sets || []).forEach((st: any) => {
                  if (st.is_completed) {
                    sessionSets += 1;
                    sessionTonnage += (Number(st.weight) || 0) * (Number(st.reps) || 0);
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
              const durationMins = Math.max(Math.round(durationSecs / 60), 1);

              return (
                <TouchableOpacity
                  key={session.id || i}
                  onPress={() => router.push(`/history/${session.id}`)}
                  className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800/90 flex-row items-center mb-3 shadow-sm"
                >
                  <View
                    className={`w-11 h-11 rounded-xl items-center justify-center mr-3.5 border ${
                      hasPR
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-indigo-500/10 border-indigo-500/20'
                    }`}
                  >
                    {hasPR ? (
                      <Trophy color="#f59e0b" size={20} />
                    ) : (
                      <Activity color="#818cf8" size={20} />
                    )}
                  </View>

                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text className="text-white font-bold text-sm mr-2" numberOfLines={1}>
                        {session.routines?.name || 'Workout Session'}
                      </Text>
                      {hasPR && (
                        <View className="bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-500/30">
                          <Text className="text-amber-300 text-[10px] font-extrabold">PR 🏆</Text>
                        </View>
                      )}
                    </View>

                    <Text className="text-slate-400 text-xs mt-0.5">
                      {dateStr} • Cycle {session.cycle_number} • {durationMins}m
                    </Text>

                    <View className="flex-row items-center gap-3 mt-1.5">
                      <Text className="text-slate-300 text-xs font-semibold">
                        🏋️ {sessionTonnage.toLocaleString()} lbs
                      </Text>
                      <Text className="text-slate-400 text-xs">
                        • {sessionSets} completed sets
                      </Text>
                    </View>
                  </View>

                  <ChevronRight color="#64748b" size={18} />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/60 items-center">
            <Activity color="#475569" size={28} className="mb-2" />
            <Text className="text-slate-400 text-sm font-medium">No workouts completed yet.</Text>
            <Text className="text-slate-500 text-xs mt-1 text-center">
              Complete your first session to track your volume impact and PR milestones!
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
