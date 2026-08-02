import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CalendarRange, CheckCircle } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useState, useCallback } from 'react';

export default function RoutinesScreen() {
  const [routines, setRoutines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoutines = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (userId) {
      const { data } = await supabase
        .from('routines')
        .select('*, routine_days(*)')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      setRoutines(data || []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchRoutines();
    }, [fetchRoutines])
  );

  const handleMakeActive = async (routineId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    // Deactivate all
    await supabase.from('routines').update({ status: 'draft' }).eq('user_id', userId);
    // Activate target
    await supabase.from('routines').update({ status: 'active' }).eq('id', routineId);

    fetchRoutines();
  };

  const renderItem = ({ item }: { item: any }) => {
    const isActive = item.status === 'active';
    const dayCount = item.routine_days?.length || item.days_in_split;

    return (
      <View className={`p-5 rounded-2xl mb-4 border ${isActive ? 'bg-indigo-950/40 border-indigo-500/40' : 'bg-slate-900 border-slate-800'}`}>
        <View className="flex-row justify-between items-start mb-3">
          <View>
            <Text className="text-white font-bold text-xl mb-1">{item.name}</Text>
            <Text className="text-slate-400 text-sm">
              {dayCount} Split Days • {item.cycles_per_routine} Cycles
            </Text>
          </View>
          {isActive ? (
            <View className="bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30 flex-row items-center">
              <CheckCircle color="#34d399" size={14} className="mr-1" />
              <Text className="text-emerald-300 text-xs font-bold">Active</Text>
            </View>
          ) : (
            <TouchableOpacity 
              onPress={() => handleMakeActive(item.id)}
              className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700"
            >
              <Text className="text-indigo-300 text-xs font-semibold">Make Active</Text>
            </TouchableOpacity>
          )}
        </View>

        <View className="pt-2 border-t border-slate-800/80 mt-2">
          <Text className="text-slate-400 text-xs">
            Current Day: {item.current_day} of {item.days_in_split}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-950 p-4">
      {/* Screen Header */}
      <View className="flex-row justify-between items-center mb-6 mt-10 px-2">
        <Text className="text-2xl font-bold text-white">Routines & Splits</Text>
      </View>

      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : routines.length === 0 ? (
        <View className="flex-1 justify-center items-center px-6">
          <View className="w-16 h-16 bg-slate-900 rounded-full items-center justify-center mb-4 border border-slate-800">
            <CalendarRange color="#60a5fa" size={32} />
          </View>
          <Text className="text-white font-bold text-xl mb-2">No Active Routines</Text>
          <Text className="text-slate-400 text-center leading-6 mb-6">
            Routine management and split builder will be available in a future enhancement.
          </Text>
        </View>
      ) : (
        <FlatList
          data={routines}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}
