import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, Platform } from 'react-native';
import { Plus, ChevronRight, CalendarRange, CheckCircle, Trash2 } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useState, useCallback } from 'react';

export default function RoutinesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [routines, setRoutines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [routineToDelete, setRoutineToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const confirmDeleteRoutine = async () => {
    if (!routineToDelete) return;
    try {
      setDeleting(true);
      const { error } = await supabase
        .from('routines')
        .delete()
        .eq('id', routineToDelete.id);

      if (error) {
        if (Platform.OS === 'web') {
          window.alert(error.message || 'Failed to delete routine');
        } else {
          Alert.alert('Error', error.message || 'Failed to delete routine');
        }
      }
      setRoutineToDelete(null);
      await fetchRoutines();
    } catch (err: any) {
      if (Platform.OS === 'web') {
        window.alert(err.message || 'Failed to delete routine');
      } else {
        Alert.alert('Error', err.message || 'Failed to delete routine');
      }
    } finally {
      setDeleting(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isActive = item.status === 'active';
    const dayCount = item.routine_days?.length || item.days_in_split;

    return (
      <View className={`p-5 rounded-2xl mb-4 border ${isActive ? 'bg-indigo-950/40 border-indigo-500/40' : 'bg-slate-900 border-slate-800'}`}>
        <View className="flex-row justify-between items-start mb-3">
          <View className="flex-1 mr-2 min-w-0">
            <Text className="text-white font-bold text-xl mb-1">{item.name}</Text>
            <Text className="text-slate-400 text-sm">
              {dayCount} Split Days • {item.cycles_per_routine} Cycles
            </Text>
          </View>
          {isActive ? (
            <View className="bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30 flex-row items-center shrink-0">
              <CheckCircle color="#34d399" size={14} className="mr-1" />
              <Text className="text-emerald-300 text-xs font-bold">Active</Text>
            </View>
          ) : (
            <TouchableOpacity 
              onPress={() => handleMakeActive(item.id)}
              className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 shrink-0"
            >
              <Text className="text-indigo-300 text-xs font-semibold">Make Active</Text>
            </TouchableOpacity>
          )}
        </View>

        <View className="flex-row justify-between items-center pt-2.5 border-t border-slate-800/80 mt-2">
          <Text className="text-slate-400 text-xs">
            Current Day: {item.current_day} of {item.days_in_split}
          </Text>
          <View className="flex-row items-center gap-3">
            <TouchableOpacity 
              onPress={() => router.push('/routine-builder/new')}
              className="flex-row items-center"
            >
              <Text className="text-indigo-400 text-xs font-semibold mr-1">Edit Split</Text>
              <ChevronRight color="#818cf8" size={14} />
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setRoutineToDelete({ id: item.id, name: item.name })}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
              className="flex-row items-center bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20"
            >
              <Trash2 color="#f87171" size={13} className="mr-1.5" />
              <Text className="text-rose-300 text-xs font-semibold">Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-950 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Screen Header */}
      <View className="flex-row justify-between items-center mb-6 px-1">
        <View className="flex-1 mr-3 min-w-0">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
            Best Damn Weight Lifting Tracker Ever
          </Text>
          <Text className="text-2xl font-bold text-white">Routines & Splits</Text>
        </View>
        <TouchableOpacity 
          onPress={() => router.push('/routine-builder/new')}
          className="bg-blue-600 px-3.5 py-2.5 rounded-full flex-row items-center shrink-0 shadow-md"
        >
          <Plus color="white" size={16} className="mr-1.5" />
          <Text className="text-white font-bold text-xs sm:text-sm">Create Routine</Text>
        </TouchableOpacity>
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
          <Text className="text-white font-bold text-xl mb-2">No Routines Created Yet</Text>
          <Text className="text-slate-400 text-center leading-6 mb-6">
            Create a custom routine to organize your split, assign exercises, and set target weights.
          </Text>
          <TouchableOpacity 
            onPress={() => router.push('/routine-builder/new')}
            className="bg-blue-600 px-6 py-3.5 rounded-2xl flex-row items-center shadow-lg"
          >
            <Plus color="white" size={20} className="mr-2" />
            <Text className="text-white font-bold text-base">Create Routine</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={routines}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={routineToDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) setRoutineToDelete(null);
        }}
      >
        <View className="flex-1 bg-black/75 justify-center items-center px-6">
          <View className="bg-slate-900 p-6 rounded-3xl border border-slate-800 w-full max-w-sm shadow-2xl">
            <View className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 items-center justify-center mb-4">
              <Trash2 color="#f87171" size={24} />
            </View>
            <Text className="text-white text-xl font-bold mb-2">Delete Routine?</Text>
            <Text className="text-slate-400 text-sm leading-5 mb-6">
              Are you sure you want to delete <Text className="text-white font-semibold">"{routineToDelete?.name}"</Text>? All split days and assigned exercises within this routine will also be removed.
            </Text>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setRoutineToDelete(null)}
                disabled={deleting}
                className="flex-1 bg-slate-800 py-3 rounded-xl items-center border border-slate-700"
              >
                <Text className="text-slate-300 font-semibold text-sm">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmDeleteRoutine}
                disabled={deleting}
                className="flex-1 bg-rose-600 active:bg-rose-500 py-3 rounded-xl items-center justify-center"
              >
                {deleting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="text-white font-bold text-sm">Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
