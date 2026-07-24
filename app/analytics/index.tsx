import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { Trophy, TrendingUp, Download, ChevronLeft, Award, Sparkles, Activity } from 'lucide-react-native';
import { calculateTargetLoad } from '../../src/utils/autoRegEngine';

type PREntry = {
  exercise_id: string;
  exercise_name: string;
  max_weight: number;
  max_reps: number;
};

export default function AnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [personalRecords, setPersonalRecords] = useState<PREntry[]>([]);
  const [totalWorkoutsCount, setTotalWorkoutsCount] = useState(0);
  const [totalLifetimeVolume, setTotalLifetimeVolume] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadAnalyticsData();
  }, []);

  const loadAnalyticsData = async () => {
    setLoading(true);
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    if (userId) {
      // Fetch all session sets for PR calculation
      const { data: sessions, error } = await supabase
        .from('sessions')
        .select('*, session_exercises(*, exercises(id, name), session_sets(*))')
        .eq('user_id', userId);

      if (!error && sessions) {
        setTotalWorkoutsCount(sessions.length);

        let lifetimeVolume = 0;
        const prMap: Record<string, PREntry> = {};

        sessions.forEach((sess) => {
          (sess.session_exercises || []).forEach((se: any) => {
            const exId = se.exercises?.id;
            const exName = se.exercises?.name || 'Exercise';

            if (exId) {
              if (!prMap[exId]) {
                prMap[exId] = { exercise_id: exId, exercise_name: exName, max_weight: 0, max_reps: 0 };
              }

              (se.session_sets || []).forEach((st: any) => {
                if (st.is_completed) {
                  const w = st.weight || 0;
                  const r = st.reps || 0;
                  lifetimeVolume += w * r;

                  if (w > prMap[exId].max_weight) {
                    prMap[exId].max_weight = w;
                    prMap[exId].max_reps = r;
                  }
                }
              });
            }
          });
        });

        setTotalLifetimeVolume(Math.round(lifetimeVolume));
        setPersonalRecords(Object.values(prMap).filter(pr => pr.max_weight > 0));
      }
    }
    setLoading(false);
  };

  // CSV Export Engine
  const handleExportCSV = async () => {
    setExporting(true);
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    if (!userId) return;

    const { data: sessions } = await supabase
      .from('sessions')
      .select('*, routines(name), session_exercises(*, exercises(name), session_sets(*))')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (!sessions || sessions.length === 0) {
      setExporting(false);
      return;
    }

    let csvContent = 'Date,Routine,Exercise,Set,Weight(lbs),Reps,Completed\n';
    sessions.forEach((s) => {
      const date = new Date(s.started_at).toISOString().split('T')[0];
      const routineName = s.routines?.name || 'Workout';

      (s.session_exercises || []).forEach((se: any) => {
        const exName = se.exercises?.name || 'Exercise';
        (se.session_sets || []).forEach((st: any) => {
          csvContent += `"${date}","${routineName}","${exName}",${st.set_number},${st.weight},${st.reps},${st.is_completed}\n`;
        });
      });
    });

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `weightlog_export_${new Date().toISOString().split('T')[0]}.csv`);
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
    <View className="flex-1 bg-slate-950 p-4 pt-12">
      {/* Header */}
      <View className="flex-row justify-between items-center mb-6">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="p-2 bg-slate-900 rounded-full mr-3 border border-slate-800">
            <ChevronLeft color="#94a3b8" size={20} />
          </TouchableOpacity>
          <View>
            <Text className="text-slate-400 text-xs font-semibold uppercase">Analytics & Intelligence</Text>
            <Text className="text-2xl font-bold text-white">Performance</Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleExportCSV}
          disabled={exporting}
          className="bg-slate-800 px-3.5 py-2 rounded-full flex-row items-center border border-slate-700"
        >
          <Download color="#60a5fa" size={16} className="mr-1.5" />
          <Text className="text-blue-400 font-bold text-xs">Export CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1">
        {/* Lifetime Stats */}
        <View className="bg-indigo-950/40 p-5 rounded-3xl border border-indigo-500/30 mb-6 flex-row justify-between items-center shadow-lg shadow-indigo-900/20">
          <View>
            <Text className="text-indigo-200 text-xs font-semibold uppercase mb-1">Lifetime Volume</Text>
            <Text className="text-white text-3xl font-bold">{totalLifetimeVolume.toLocaleString()} lbs</Text>
            <Text className="text-slate-400 text-xs mt-1">{totalWorkoutsCount} Total Completed Workouts</Text>
          </View>
          <View className="w-14 h-14 bg-indigo-600/30 rounded-2xl items-center justify-center border border-indigo-500/40">
            <TrendingUp color="#a78bfa" size={28} />
          </View>
        </View>

        {/* Auto-Regulation Engine Recommendation Box */}
        <View className="bg-purple-950/30 p-5 rounded-3xl border border-purple-500/30 mb-6">
          <View className="flex-row items-center mb-2">
            <Sparkles color="#c084fc" size={20} className="mr-2" />
            <Text className="text-white font-bold text-base">Auto-Regulation Intelligence</Text>
          </View>
          <Text className="text-purple-200 text-xs leading-5">
            Based on your progressive overload formula (Target Weight = Base Weight × Volume Delta), target weight increases 2.5–5% every 2 clean completed cycles.
          </Text>
        </View>

        {/* Personal Records List */}
        <Text className="text-white text-xl font-bold mb-4">Personal Records (PRs)</Text>
        {personalRecords.length === 0 ? (
          <View className="bg-slate-900 p-6 rounded-2xl border border-slate-800 items-center mb-8">
            <Trophy color="#64748b" size={32} className="mb-2" />
            <Text className="text-slate-400 text-center font-medium">Log workouts to record your all-time PRs!</Text>
          </View>
        ) : (
          <View className="space-y-3 mb-10">
            {personalRecords.map((pr) => (
              <View key={pr.exercise_id} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex-row justify-between items-center mb-3">
                <View className="flex-row items-center">
                  <View className="w-10 h-10 bg-amber-500/20 rounded-xl items-center justify-center mr-3 border border-amber-500/30">
                    <Award color="#f59e0b" size={20} />
                  </View>
                  <View>
                    <Text className="text-white font-bold text-base">{pr.exercise_name}</Text>
                    <Text className="text-slate-400 text-xs">All-time max weight</Text>
                  </View>
                </View>

                <View className="bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/30">
                  <Text className="text-amber-300 font-bold text-sm">{pr.max_weight} lbs × {pr.max_reps}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
