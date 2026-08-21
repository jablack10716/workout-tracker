import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Plus, ChevronRight, Search, X } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExercises, Exercise } from '../../src/hooks/useExercises';
import { useCallback, useState, useMemo } from 'react';

export default function ExercisesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { exercises, loading, refetch } = useExercises();
  const [searchQuery, setSearchQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [])
  );

  const filteredExercises = useMemo(() => {
    if (!searchQuery.trim()) return exercises;
    const query = searchQuery.toLowerCase().trim();
    return exercises.filter((ex) => {
      const matchName = ex.name.toLowerCase().includes(query);
      const matchMuscles = ex.exercise_muscle_groups?.some(m => 
        m.muscle_group.toLowerCase().includes(query)
      );
      return matchName || matchMuscles;
    });
  }, [exercises, searchQuery]);

  const renderItem = ({ item }: { item: Exercise }) => {
    const muscles = item.exercise_muscle_groups || [];
    const primary = muscles.find(m => Number(m.fraction) === 1.0);
    const secondaries = muscles.filter(m => Number(m.fraction) === 0.5);

    return (
      <TouchableOpacity 
        onPress={() => router.push(`/exercises/${item.id}`)}
        className="bg-slate-800 p-4 rounded-xl mb-3 flex-row justify-between items-center"
      >
        <View className="flex-1 mr-3">
          <Text className="text-white font-bold text-lg mb-1">{item.name}</Text>
          
          {/* Muscle Group Badges */}
          <View className="flex-row flex-wrap gap-1 mb-2">
            {primary ? (
              <View className="bg-blue-600/30 px-2 py-0.5 rounded-md border border-blue-500/40">
                <Text className="text-blue-300 text-xs font-semibold">{primary.muscle_group}</Text>
              </View>
            ) : null}
            {secondaries.map((sec) => (
              <View key={sec.muscle_group} className="bg-indigo-900/30 px-2 py-0.5 rounded-md border border-indigo-700/40">
                <Text className="text-indigo-300 text-xs">{sec.muscle_group} (0.5x)</Text>
              </View>
            ))}
          </View>

          <Text className="text-slate-400 text-xs">
            {item.is_bodyweight_only ? 'Bodyweight' : 'Weighted'} • {item.default_rest_timer_seconds}s Rest
          </Text>
        </View>
        <ChevronRight color="#94a3b8" size={20} />
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-slate-900 px-4 pb-4" style={{ paddingTop: Math.max(insets.top, 16) }}>
      {/* Screen Header */}
      <View className="flex-row justify-between items-center mb-4">
        <View className="flex-1 mr-3 min-w-0">
          <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
            Best Damn Workout Tracker Ever
          </Text>
          <Text className="text-2xl font-bold text-white">Exercise Library</Text>
        </View>
        <TouchableOpacity 
          onPress={() => router.push('/exercises/new')}
          className="bg-blue-600 p-2.5 rounded-full shrink-0 shadow-md"
        >
          <Plus color="white" size={22} />
        </TouchableOpacity>
      </View>
      
      {/* Search Input Bar */}
      <View className="bg-slate-800 flex-row items-center px-4 py-3 rounded-xl mb-4 border border-slate-700/60">
        <Search color="#94a3b8" size={20} className="mr-3" />
        <TextInput
          className="flex-1 text-white text-base"
          placeholder="Search by name or muscle group..."
          placeholderTextColor="#64748b"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
            <X color="#94a3b8" size={18} />
          </TouchableOpacity>
        ) : null}
      </View>
      
      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : filteredExercises.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-slate-400 text-center">
            {searchQuery ? `No exercises matching "${searchQuery}"` : 'No exercises found. Add your first one!'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredExercises}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}
