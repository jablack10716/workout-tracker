import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Settings, Play, ChevronRight, Activity, Plus } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';

export default function DashboardScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [activeRoutine, setActiveRoutine] = useState<any>(null);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (user?.user_metadata?.display_name) {
      setDisplayName(user.user_metadata.display_name);
    } else if (user?.email) {
      setDisplayName(user.email.split('@')[0]);
    } else {
      setDisplayName('Lifter');
    }

    if (user) {
      // Query Active Routine
      const { data: routines } = await supabase
        .from('routines')
        .select('*, routine_days(*)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (routines && routines.length > 0) {
        setActiveRoutine(routines[0]);
      } else {
        setActiveRoutine(null);
      }

      // Query Recent Sessions
      const { data: sessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(3);

      setRecentSessions(sessions || []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  return (
    <ScrollView className="flex-1 bg-slate-950">
      <View className="px-6 pt-16 pb-8">
        <View className="flex-row justify-between items-center mb-8">
          <View>
            <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest mb-1">
              Best Damn Weight Lifting Tracker Ever
            </Text>
            <Text className="text-slate-400 text-lg">Welcome back,</Text>
            <Text className="text-white text-3xl font-bold">{displayName}</Text>
          </View>
          <TouchableOpacity 
            onPress={() => router.push('/settings')} 
            className="w-12 h-12 bg-slate-800/60 rounded-full items-center justify-center border border-slate-700/50"
          >
            <Settings color="#cbd5e1" size={24} />
          </TouchableOpacity>
        </View>

        {/* Current Routine Card */}
        {activeRoutine ? (
          <View className="bg-indigo-900/40 p-6 rounded-3xl border border-indigo-500/30 mb-8 shadow-lg shadow-indigo-900/20">
            <View className="flex-row justify-between items-start mb-6">
              <View>
                <Text className="text-indigo-200 font-semibold mb-1">CURRENT ROUTINE</Text>
                <Text className="text-white text-2xl font-bold">{activeRoutine.name}</Text>
              </View>
              <View className="bg-indigo-500/20 px-3 py-1 rounded-full border border-indigo-500/30">
                <Text className="text-indigo-300 text-sm font-medium">Day {activeRoutine.current_day}</Text>
              </View>
            </View>
            
            <View className="bg-slate-900/40 rounded-2xl p-4 mb-6">
              <Text className="text-white font-medium mb-1">
                Split Day {activeRoutine.current_day} of {activeRoutine.days_in_split}
              </Text>
              <Text className="text-slate-400 text-sm">Cycle {activeRoutine.current_cycle} of {activeRoutine.cycles_per_routine}</Text>
            </View>

            <TouchableOpacity 
              onPress={() => router.push('/workout/active')}
              className="bg-indigo-600 flex-row items-center justify-center p-4 rounded-2xl"
            >
              <Play color="white" fill="white" size={20} className="mr-2" />
              <Text className="text-white font-bold text-lg">Start Workout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Onboarding Card when no routine is active */
          <View className="bg-slate-900/60 p-6 rounded-3xl border border-slate-800 mb-8">
            <View className="flex-row items-center mb-3">
              <Activity color="#60a5fa" size={24} className="mr-3" />
              <Text className="text-white text-xl font-bold">No Active Routine</Text>
            </View>
            <Text className="text-slate-400 mb-6 leading-6">
              Create a custom routine to organize your workout split, assign exercises, and track target weights.
            </Text>
            <TouchableOpacity 
              onPress={() => router.push('/routine-builder/new')} 
              className="bg-blue-600 flex-row items-center justify-center p-4 rounded-2xl"
            >
              <Plus color="white" size={20} className="mr-2" />
              <Text className="text-white font-bold text-lg">Create Routine</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Volume Impact Progress */}
        <Text className="text-white text-xl font-bold mb-4">Volume Impact</Text>
        <View className="bg-slate-800/40 rounded-3xl border border-slate-700/50 p-6 mb-8 flex-row items-center">
          <View className="relative items-center justify-center mr-6">
            <Svg width="100" height="100">
              <Circle cx="50" cy="50" r="40" stroke="#334155" strokeWidth="12" fill="none" />
              <Circle 
                cx="50" cy="50" r="40" 
                stroke="#8b5cf6" 
                strokeWidth="12" 
                fill="none" 
                strokeDasharray="251.2" 
                strokeDashoffset={activeRoutine ? "75" : "251.2"} 
                strokeLinecap="round" 
              />
            </Svg>
            <View className="absolute items-center">
              <Text className="text-white font-bold text-xl">{activeRoutine ? '70%' : '0%'}</Text>
            </View>
          </View>
          <View className="flex-1">
            <Text className="text-white font-bold text-lg mb-1">Weekly Goal</Text>
            <Text className="text-slate-400 text-sm">
              {activeRoutine 
                ? "You've hit 70% of your targeted working sets this week." 
                : "Assign exercises to your routine to calculate target volume."}
            </Text>
          </View>
        </View>

        {/* Recent Workouts Header */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-white text-xl font-bold">Recent Logs</Text>
          <TouchableOpacity onPress={() => router.push('/history')}>
            <Text className="text-indigo-400 font-semibold">View All</Text>
          </TouchableOpacity>
        </View>
        
        {recentSessions.length > 0 ? (
          <View className="space-y-3 mb-10">
            {recentSessions.map((session, i) => (
              <TouchableOpacity key={session.id || i} className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50 flex-row items-center mt-3">
                <View className="w-12 h-12 bg-slate-700/50 rounded-xl items-center justify-center mr-4">
                  <Activity color="#a78bfa" size={24} />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-base mb-1">Session Day {session.cycle_number}</Text>
                  <Text className="text-slate-400 text-sm">{new Date(session.started_at).toLocaleDateString()}</Text>
                </View>
                <ChevronRight color="#64748b" size={20} />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View className="bg-slate-900/30 p-6 rounded-2xl border border-slate-800/60 items-center mb-10">
            <Text className="text-slate-500 text-center">No workouts completed yet.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
