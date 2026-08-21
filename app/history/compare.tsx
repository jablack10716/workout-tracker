import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import {
  ChevronLeft,
  ArrowRightLeft,
  Sparkles,
  Calendar,
  Layers,
  Activity,
} from 'lucide-react-native';
import { analyzeCycleProgression, CycleComparison } from '../../src/utils/analyticsEngine';
import { CycleComparisonView } from '../../src/components/charts/CycleComparisonView';

export default function CycleCompareScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const routineId = params.routine_id as string;
  const dayNumber = parseInt(params.day_number as string, 10) || 1;

  const [loading, setLoading] = useState(true);
  const [routines, setRoutines] = useState<any[]>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string>(routineId || '');
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(dayNumber);
  const [comparison, setComparison] = useState<CycleComparison | null>(null);

  const loadRoutinesAndComparison = useCallback(async () => {
    setLoading(true);
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    if (userId) {
      // 1. Fetch all routines
      const { data: routineData } = await supabase
        .from('routines')
        .select('*, routine_days(*)')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (routineData && routineData.length > 0) {
        setRoutines(routineData);
        const activeRId = selectedRoutineId || routineData[0].id;
        setSelectedRoutineId(activeRId);

        // 2. Fetch all completed sessions for this routine
        const { data: sessionData } = await supabase
          .from('sessions')
          .select(
            '*, routines(name), session_exercises(*, exercises(id, name), session_sets(*))'
          )
          .eq('user_id', userId)
          .eq('routine_id', activeRId)
          .eq('status', 'completed')
          .order('started_at', { ascending: true });

        if (sessionData && sessionData.length > 0) {
          const compResult = analyzeCycleProgression(
            sessionData,
            activeRId,
            selectedDayNumber
          );
          setComparison(compResult);
        }
      }
    }
    setLoading(false);
  }, [selectedRoutineId, selectedDayNumber]);

  useEffect(() => {
    loadRoutinesAndComparison();
  }, [loadRoutinesAndComparison]);

  const activeRoutine = routines.find((r) => r.id === selectedRoutineId);
  const splitDaysCount = activeRoutine?.days_in_split || 4;

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Header */}
      <View className="flex-row items-center mb-5">
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
            Cycle-over-Cycle Comparison
          </Text>
        </View>
      </View>

      {/* Routine & Split Day Selectors */}
      <View className="mb-5 space-y-3">
        {/* Split Day Picker */}
        <View>
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
            Select Split Day to Compare:
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            <View className="flex-row gap-2 py-1">
              {Array.from({ length: splitDaysCount }).map((_, idx) => {
                const dayNum = idx + 1;
                const isSelected = selectedDayNumber === dayNum;
                return (
                  <TouchableOpacity
                    key={dayNum}
                    onPress={() => setSelectedDayNumber(dayNum)}
                    className={`px-4 py-2 rounded-xl border flex-row items-center ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-500 shadow-md shadow-indigo-950/40'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <Text
                      className={`font-black text-xs ${
                        isSelected ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      Day {dayNum}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : !comparison || comparison.cycles.length < 2 ? (
        <View className="flex-1 bg-slate-900/60 p-6 rounded-3xl border border-slate-800 items-center justify-center">
          <Activity color="#64748b" size={40} className="mb-3" />
          <Text className="text-white font-bold text-lg mb-1 text-center">
            Insufficient Cycle History
          </Text>
          <Text className="text-slate-400 text-xs text-center leading-5 max-w-[280px]">
            Complete Day {selectedDayNumber} across at least 2 cycles to generate automated progressive overload comparison reports.
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <CycleComparisonView comparison={comparison} />
        </ScrollView>
      )}
    </View>
  );
}
