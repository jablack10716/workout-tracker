import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import {
  Calendar,
  ChevronRight,
  Activity,
  Clock,
  Flame,
  Dumbbell,
  Award,
  BarChart2,
  ArrowRightLeft,
  Trophy,
} from 'lucide-react-native';
import { calculateEstimated1RM } from '../../src/utils/analyticsEngine';

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    if (userId) {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, routines(name), session_exercises(*, exercises(name, is_bodyweight_only), session_sets(*))')
        .eq('user_id', userId)
        .order('started_at', { ascending: false });

      if (!error && data) {
        setSessions(data);
      }
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchHistory();
    }, [fetchHistory])
  );

  // Generate days of month for Calendar View
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const workoutVolumeByDate: Record<string, number> = {};

  sessions.forEach((s) => {
    const dStr = new Date(s.started_at).toDateString();
    let vol = 0;
    (s.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          vol += (Number(st.weight) || 0) * (Number(st.reps) || 0);
        }
      });
    });
    workoutVolumeByDate[dStr] = (workoutVolumeByDate[dStr] || 0) + vol;
  });

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  // Compute monthly stats
  const currentMonthSessions = sessions.filter((s) => {
    const d = new Date(s.started_at);
    return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });

  let monthlyTonnage = 0;
  let monthlySets = 0;
  currentMonthSessions.forEach((s) => {
    (s.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          monthlySets++;
          monthlyTonnage += (Number(st.weight) || 0) * (Number(st.reps) || 0);
        }
      });
    });
  });

  const renderSessionItem = ({ item }: { item: any }) => {
    const dateStr = new Date(item.started_at).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    let totalVolume = 0;
    let completedSetsCount = 0;
    let maxE1RM = 0;
    const exerciseNames: string[] = [];

    (item.session_exercises || []).forEach((se: any) => {
      if (se.exercises?.name) exerciseNames.push(se.exercises.name);
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          completedSetsCount++;
          const w = Number(st.weight) || 0;
          const r = Number(st.reps) || 0;
          totalVolume += w * r;
          const curE1RM = calculateEstimated1RM(w, r);
          if (curE1RM > maxE1RM) maxE1RM = curE1RM;
        }
      });
    });

    const calculatedSecs =
      item.completed_at && item.started_at
        ? Math.max(
            Math.round(
              (new Date(item.completed_at).getTime() -
                new Date(item.started_at).getTime()) /
                1000
            ),
            0
          )
        : 1800;
    const durationSecs = item.duration_seconds || calculatedSecs;
    const mins = Math.max(Math.round(durationSecs / 60), 1);

    return (
      <TouchableOpacity
        onPress={() => router.push(`/history/${item.id}`)}
        className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 mb-4 shadow-sm"
      >
        <View className="flex-row justify-between items-start mb-2.5">
          <View className="flex-1 mr-2">
            <Text className="text-white font-extrabold text-base mb-0.5" numberOfLines={1}>
              {item.routines?.name || 'Workout Session'}
            </Text>
            <Text className="text-slate-400 text-xs">
              {dateStr} • Cycle {item.cycle_number}
            </Text>
          </View>
          <View className="bg-indigo-500/20 px-2.5 py-1 rounded-full border border-indigo-500/30 flex-row items-center">
            <Clock color="#a78bfa" size={12} className="mr-1" />
            <Text className="text-indigo-300 text-xs font-bold">{mins} min</Text>
          </View>
        </View>

        {/* Exercises Tag Summary */}
        <Text className="text-slate-300 text-xs font-medium mb-3" numberOfLines={1}>
          {exerciseNames.length > 0 ? exerciseNames.join(' • ') : 'Exercises Logged'}
        </Text>

        <View className="flex-row justify-between items-center pt-3 border-t border-slate-800/80">
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center">
              <Flame color="#f97316" size={14} className="mr-1" />
              <Text className="text-slate-200 text-xs font-black">
                {Math.round(totalVolume).toLocaleString()} lbs
              </Text>
            </View>
            <View className="flex-row items-center">
              <Dumbbell color="#3b82f6" size={14} className="mr-1" />
              <Text className="text-slate-300 text-xs font-bold">{completedSetsCount} sets</Text>
            </View>
            {maxE1RM > 0 && (
              <View className="bg-purple-500/20 px-2 py-0.5 rounded-md">
                <Text className="text-purple-300 text-[10px] font-bold">
                  Top 1RM: {Math.round(maxE1RM)} lbs
                </Text>
              </View>
            )}
          </View>

          <ChevronRight color="#64748b" size={18} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Header */}
      <View className="flex-row justify-between items-center mb-5 px-1">
        <View className="flex-1 mr-3 min-w-0">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-2xl font-black text-white">Workout History</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => router.push('/history/compare')}
            className="bg-indigo-600/30 border border-indigo-500/40 px-3 py-2 rounded-full flex-row items-center shrink-0"
          >
            <ArrowRightLeft color="#a78bfa" size={14} className="mr-1" />
            <Text className="text-indigo-300 font-bold text-xs">Compare</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/analytics')}
            className="bg-purple-600/30 border border-purple-500/40 px-3 py-2 rounded-full flex-row items-center shrink-0"
          >
            <BarChart2 color="#c084fc" size={14} className="mr-1" />
            <Text className="text-purple-300 font-bold text-xs">Analytics</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Monthly Consistency Calendar & Stats */}
      <View className="bg-slate-900/90 p-4 rounded-3xl border border-slate-800 mb-5 shadow-sm">
        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-row items-center">
            <Calendar color="#60a5fa" size={18} className="mr-2" />
            <Text className="text-white font-bold text-base">
              {monthNames[selectedMonth]} {selectedYear}
            </Text>
          </View>
          <Text className="text-slate-400 text-xs font-bold">
            {currentMonthSessions.length} Workouts ({Math.round(monthlyTonnage).toLocaleString()} lbs)
          </Text>
        </View>

        {/* Days Grid */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2 py-1">
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const dayNum = idx + 1;
            const dateObj = new Date(selectedYear, selectedMonth, dayNum);
            const dateStr = dateObj.toDateString();
            const vol = workoutVolumeByDate[dateStr] || 0;
            const hasWorkout = vol > 0;

            return (
              <View
                key={dayNum}
                className={`w-9 h-11 rounded-xl items-center justify-center border ${
                  hasWorkout
                    ? 'bg-emerald-500/20 border-emerald-500/50'
                    : 'bg-slate-800/40 border-slate-800'
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    hasWorkout ? 'text-emerald-300' : 'text-slate-500'
                  }`}
                >
                  {dayNum}
                </Text>
                {hasWorkout && <View className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1" />}
              </View>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : sessions.length === 0 ? (
        <View className="flex-1 justify-center items-center px-6">
          <Activity color="#64748b" size={40} className="mb-3" />
          <Text className="text-white font-bold text-lg mb-1">No Completed Sessions</Text>
          <Text className="text-slate-400 text-center text-sm leading-5">
            Complete your first workout session to unlock your history log and progress analytics!
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSessionItem}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
