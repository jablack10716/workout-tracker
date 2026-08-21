import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import {
  Trophy,
  TrendingUp,
  Download,
  ChevronLeft,
  Award,
  Sparkles,
  Activity,
  Flame,
  Dumbbell,
  Clock,
  Target,
  Zap,
} from 'lucide-react-native';
import {
  extractPersonalRecords,
  getExerciseE1RMHistory,
  getSessionVolumeHistory,
  getWeeklyVolumeHistory,
  getMuscleGroupVolumeStatusList,
  calculateWorkoutStreak,
  MUSCLE_GROUPS,
  PREntry,
} from '../../src/utils/analyticsEngine';
import { LineChart } from '../../src/components/charts/LineChart';
import { BarChart } from '../../src/components/charts/BarChart';
import { RadarChart } from '../../src/components/charts/RadarChart';
import { ConsistencyHeatmap } from '../../src/components/charts/ConsistencyHeatmap';

export default function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PREntry[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [timeRangeWeeks, setTimeRangeWeeks] = useState<number>(12);
  const [exporting, setExporting] = useState(false);

  const loadAnalyticsData = useCallback(async () => {
    setLoading(true);
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    if (userId) {
      const { data: sessionData, error } = await supabase
        .from('sessions')
        .select(
          '*, routines(name), session_exercises(*, exercises(id, name, is_bodyweight_only, exercise_muscle_groups(*)), session_sets(*))'
        )
        .eq('user_id', userId)
        .order('started_at', { ascending: true });

      if (!error && sessionData) {
        setSessions(sessionData);

        const prs = extractPersonalRecords(sessionData);
        setPersonalRecords(prs);

        // Select first exercise with PRs by default
        if (prs.length > 0 && !selectedExerciseId) {
          setSelectedExerciseId(prs[0].exerciseId);
        }
      }
    }
    setLoading(false);
  }, [selectedExerciseId]);

  useEffect(() => {
    loadAnalyticsData();
  }, [loadAnalyticsData]);

  // Derived Analytics Computations
  const streaks = calculateWorkoutStreak(sessions);
  const sessionVolumes = getSessionVolumeHistory(sessions);
  const weeklyVolumes = getWeeklyVolumeHistory(sessions, timeRangeWeeks);

  const totalLifetimeVolume = sessionVolumes.reduce((acc, s) => acc + s.volume, 0);
  const avgDensity =
    sessionVolumes.length > 0
      ? Math.round(
          sessionVolumes.reduce((acc, s) => acc + s.density, 0) / sessionVolumes.length
        )
      : 0;

  // Selected Exercise Progression Data
  const selectedExPR = personalRecords.find((p) => p.exerciseId === selectedExerciseId);
  const e1rmHistory = selectedExerciseId
    ? getExerciseE1RMHistory(sessions, selectedExerciseId)
    : [];

  const e1rmChartData = e1rmHistory.map((dp) => ({
    label: dp.date,
    value: Math.round(dp.e1rm),
    sublabel: `${dp.weight} lbs × ${dp.reps}`,
    isPR: selectedExPR && dp.e1rm >= selectedExPR.estimated1RM,
  }));

  // Weekly Volume Bar Chart Data
  const weeklyBarData = weeklyVolumes.map((w, idx) => ({
    label: w.weekLabel,
    value: w.totalVolume,
    sublabel: `${w.workoutCount} workouts`,
    isCurrent: idx === weeklyVolumes.length - 1,
  }));

  // Muscle Group Radar Data (Current Week)
  const currentWeekMuscleSets =
    weeklyVolumes.length > 0
      ? weeklyVolumes[weeklyVolumes.length - 1].muscleSets
      : ({} as Record<string, number>);

  const muscleRadarData = MUSCLE_GROUPS.map((mg) => ({
    label: mg,
    value: Math.round((currentWeekMuscleSets[mg] || 0) * 10) / 10,
    target: 14, // Exercise science target baseline: ~12-16 sets/week for hypertrophy
  }));

  const muscleStatuses = getMuscleGroupVolumeStatusList(currentWeekMuscleSets);

  // CSV Export Engine
  const handleExportCSV = async () => {
    setExporting(true);
    if (!sessions || sessions.length === 0) {
      setExporting(false);
      return;
    }

    let csvContent = 'Date,Routine,Cycle,Exercise,Set,Weight(lbs),Reps,Completed,Estimated1RM(lbs)\n';
    sessions.forEach((s) => {
      const date = new Date(s.started_at).toISOString().split('T')[0];
      const routineName = s.routines?.name || 'Workout';
      const cycleNum = s.cycle_number || 1;

      (s.session_exercises || []).forEach((se: any) => {
        const exName = se.exercises?.name || 'Exercise';
        (se.session_sets || []).forEach((st: any) => {
          const w = st.weight || 0;
          const r = st.reps || 0;
          const e1rm = w > 0 && r > 0 ? Math.round(w * (1 + r / 30)) : 0;
          csvContent += `"${date}","${routineName}",${cycleNum},"${exName}",${st.set_number},${w},${r},${st.is_completed},${e1rm}\n`;
        });
      });
    });

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `weightlifting_analytics_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setExporting(false);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Header */}
      <View className="flex-row justify-between items-center mb-5">
        <View className="flex-row items-center flex-1 mr-3 min-w-0">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 bg-slate-900 rounded-full mr-3 border border-slate-800 shrink-0"
          >
            <ChevronLeft color="#94a3b8" size={20} />
          </TouchableOpacity>
          <View className="flex-1 min-w-0">
            <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
              Best Damn Workout Tracker Ever
            </Text>
            <Text className="text-2xl font-black text-white" numberOfLines={1}>
              Performance Hub
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleExportCSV}
          disabled={exporting}
          className="bg-slate-800 px-3.5 py-2 rounded-full flex-row items-center border border-slate-700 shrink-0"
        >
          <Download color="#60a5fa" size={16} className="mr-1.5" />
          <Text className="text-blue-400 font-bold text-xs">Export CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 4-KPI Overview Row */}
        <View className="flex-row flex-wrap gap-2.5 mb-6">
          {/* Lifetime Volume */}
          <View className="flex-1 min-w-[45%] bg-gradient-to-br from-indigo-950/60 to-slate-900 p-4 rounded-2xl border border-indigo-500/30">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
                Lifetime Tonnage
              </Text>
              <Flame color="#a78bfa" size={16} />
            </View>
            <Text className="text-white text-xl font-black">
              {totalLifetimeVolume >= 1000000
                ? `${(totalLifetimeVolume / 1000000).toFixed(2)}M`
                : totalLifetimeVolume.toLocaleString()}{' '}
              <Text className="text-xs text-indigo-300 font-bold">lbs</Text>
            </Text>
            <Text className="text-slate-400 text-[10px] mt-0.5">
              {sessions.length} completed sessions
            </Text>
          </View>

          {/* Training Streak */}
          <View className="flex-1 min-w-[45%] bg-gradient-to-br from-emerald-950/60 to-slate-900 p-4 rounded-2xl border border-emerald-500/30">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                Consistency Streak
              </Text>
              <Zap color="#34d399" size={16} />
            </View>
            <Text className="text-white text-xl font-black">
              {streaks.currentStreakWeeks}{' '}
              <Text className="text-xs text-emerald-300 font-bold">weeks</Text>
            </Text>
            <Text className="text-slate-400 text-[10px] mt-0.5">
              Best: {streaks.longestStreakWeeks} consecutive wks
            </Text>
          </View>

          {/* Training Density */}
          <View className="flex-1 min-w-[45%] bg-gradient-to-br from-purple-950/60 to-slate-900 p-4 rounded-2xl border border-purple-500/30">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-purple-300 text-[10px] font-bold uppercase tracking-wider">
                Avg Session Density
              </Text>
              <Clock color="#c084fc" size={16} />
            </View>
            <Text className="text-white text-xl font-black">
              {avgDensity}{' '}
              <Text className="text-xs text-purple-300 font-bold">lbs/min</Text>
            </Text>
            <Text className="text-slate-400 text-[10px] mt-0.5">Training work-rate</Text>
          </View>

          {/* All-Time PRs count */}
          <View className="flex-1 min-w-[45%] bg-gradient-to-br from-amber-950/60 to-slate-900 p-4 rounded-2xl border border-amber-500/30">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                Personal Records
              </Text>
              <Trophy color="#fbbf24" size={16} />
            </View>
            <Text className="text-white text-xl font-black">
              {personalRecords.length}{' '}
              <Text className="text-xs text-amber-300 font-bold">lifts</Text>
            </Text>
            <Text className="text-slate-400 text-[10px] mt-0.5">All-time milestones</Text>
          </View>
        </View>

        {/* SECTION 1: STRENGTH PROGRESSION & 1-REP MAX */}
        <View className="mb-6">
          <View className="flex-row justify-between items-center mb-3">
            <View>
              <Text className="text-white text-lg font-bold">Strength Progression (1RM)</Text>
              <Text className="text-slate-400 text-xs">
                Estimated 1-Rep Max curves derived via Epley equation
              </Text>
            </View>
          </View>

          {/* Exercise Selector Chips */}
          {personalRecords.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-3">
              <View className="flex-row gap-2 py-1">
                {personalRecords.map((pr) => {
                  const isSelected = pr.exerciseId === selectedExerciseId;
                  return (
                    <TouchableOpacity
                      key={pr.exerciseId}
                      onPress={() => setSelectedExerciseId(pr.exerciseId)}
                      className={`px-3 py-1.5 rounded-xl border flex-row items-center ${
                        isSelected
                          ? 'bg-blue-600 border-blue-500 shadow-md shadow-blue-900/30'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <Dumbbell
                        color={isSelected ? '#ffffff' : '#94a3b8'}
                        size={14}
                        className="mr-1.5"
                      />
                      <Text
                        className={`text-xs font-bold ${
                          isSelected ? 'text-white' : 'text-slate-300'
                        }`}
                      >
                        {pr.exerciseName}
                      </Text>
                      {pr.estimated1RM > 0 && (
                        <Text
                          className={`text-[10px] font-black ml-1.5 ${
                            isSelected ? 'text-blue-200' : 'text-slate-400'
                          }`}
                        >
                          ({Math.round(pr.estimated1RM)} lbs)
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* Line Chart */}
          <LineChart
            data={e1rmChartData}
            title={selectedExPR ? `${selectedExPR.exerciseName} 1RM Trend` : 'Estimated 1RM'}
            subtitle="Session-by-session strength progression"
            unit="lbs"
            height={190}
            lineColor="#3b82f6"
            emptyMessage="Log at least 2 sessions with this exercise to display your 1RM progression curve."
          />
        </View>

        {/* SECTION 2: HYPERTROPHY VOLUME & MUSCLE BALANCE */}
        <View className="mb-6">
          <View className="flex-row justify-between items-center mb-3">
            <View>
              <Text className="text-white text-lg font-bold">Hypertrophy Volume Balance</Text>
              <Text className="text-slate-400 text-xs">
                Weekly working sets vs Maximum Adaptive Volume (MAV: 12-20s)
              </Text>
            </View>
          </View>

          {/* Radar Chart */}
          <View className="mb-4">
            <RadarChart
              data={muscleRadarData}
              title="7-Muscle Group Volumetric Matrix"
              subtitle="Fractional weekly volume distribution"
              size={280}
            />
          </View>

          {/* Scientific Status Badges */}
          <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 mb-4">
            <Text className="text-slate-300 text-xs font-bold uppercase tracking-wider mb-2.5">
              Current Weekly Stimulus by Muscle Group
            </Text>
            <View className="space-y-2">
              {muscleStatuses.map((ms) => (
                <View
                  key={ms.muscleGroup}
                  className="flex-row justify-between items-center bg-slate-800/40 p-2.5 rounded-xl"
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-2.5 h-2.5 rounded-full mr-2"
                      style={{ backgroundColor: ms.color }}
                    />
                    <Text className="text-white font-bold text-xs">{ms.muscleGroup}</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-slate-300 font-black text-xs">
                      {ms.weeklySets} sets
                    </Text>
                    <View
                      className="px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: `${ms.color}20` }}
                    >
                      <Text
                        className="text-[10px] font-bold"
                        style={{ color: ms.color }}
                      >
                        {ms.statusText}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Weekly Tonnage Bar Chart */}
          <BarChart
            data={weeklyBarData}
            title="Weekly Tonnage Progression"
            subtitle={`Total weight lifted over the past ${timeRangeWeeks} weeks`}
            unit="lbs"
            height={170}
            barColor="#818cf8"
            activeBarColor="#10b981"
          />
        </View>

        {/* SECTION 3: 12-WEEK CONSISTENCY HEATMAP */}
        <View className="mb-6">
          <ConsistencyHeatmap sessions={sessions} weeksCount={12} />
        </View>

        {/* SECTION 4: ALL-TIME PERSONAL RECORDS WALL */}
        <View className="mb-10">
          <View className="flex-row justify-between items-center mb-3">
            <View>
              <Text className="text-white text-lg font-bold">Personal Records Wall</Text>
              <Text className="text-slate-400 text-xs">
                All-time peak single-set load and estimated 1RMs
              </Text>
            </View>
          </View>

          {personalRecords.length === 0 ? (
            <View className="bg-slate-900 p-6 rounded-2xl border border-slate-800 items-center">
              <Trophy color="#64748b" size={32} className="mb-2" />
              <Text className="text-slate-400 text-center font-medium">
                Log completed workouts to record your all-time PRs!
              </Text>
            </View>
          ) : (
            <View className="space-y-3">
              {personalRecords.map((pr) => (
                <View
                  key={pr.exerciseId}
                  className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800/90 flex-row justify-between items-center shadow-sm"
                >
                  <View className="flex-row items-center flex-1 mr-2 min-w-0">
                    <View className="w-10 h-10 bg-amber-500/10 rounded-xl items-center justify-center mr-3 border border-amber-500/20 shrink-0">
                      <Award color="#f59e0b" size={20} />
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-white font-bold text-sm" numberOfLines={1}>
                        {pr.exerciseName}
                      </Text>
                      <Text className="text-slate-400 text-[11px]">
                        {pr.dateAchieved
                          ? new Date(pr.dateAchieved).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'Recorded'}
                      </Text>
                    </View>
                  </View>

                  <View className="items-end shrink-0">
                    <View className="bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/30 mb-0.5">
                      <Text className="text-amber-300 font-black text-xs">
                        {pr.isBodyweight
                          ? `BW × ${pr.maxRepsAtMaxWeight} reps`
                          : `${pr.maxWeight} lbs × ${pr.maxRepsAtMaxWeight}`}
                      </Text>
                    </View>
                    {!pr.isBodyweight && pr.estimated1RM > 0 && (
                      <Text className="text-purple-300 text-[10px] font-extrabold">
                        1RM: ~{Math.round(pr.estimated1RM)} lbs
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
