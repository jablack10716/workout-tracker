import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { Plus, ChevronRight, Search, X } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExercises, Exercise } from '../../src/hooks/useExercises';
import { useCallback, useState, useMemo, useEffect } from 'react';
import { EQUIPMENT_LABELS, usePreferencesStore } from '../../src/store/usePreferencesStore';
import {
  EquipmentFilterMode,
  matchesEquipmentFilter,
  normalizeMuscleGroup,
  resolveExerciseEquipment,
} from '../../src/utils/analyticsEngine';

export default function ExercisesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { exercises, loading, refetch } = useExercises();
  const filterByMyGym = usePreferencesStore((s) => s.filterByMyGym);
  const allowedEquipment = usePreferencesStore((s) => s.allowedEquipment);
  const lockRestTimerToDefault = usePreferencesStore((s) => s.lockRestTimerToDefault);
  const defaultRestSeconds = usePreferencesStore((s) => s.defaultRestSeconds);
  const [searchQuery, setSearchQuery] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilterMode>(
    filterByMyGym ? 'my_gym' : 'all'
  );

  useEffect(() => {
    setEquipmentFilter(filterByMyGym ? 'my_gym' : 'all');
  }, [filterByMyGym]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [])
  );

  const myGymChipLabel =
    allowedEquipment.length === 2 &&
    allowedEquipment.includes('dumbbell') &&
    allowedEquipment.includes('bodyweight')
      ? 'My Gym (DB + BW)'
      : 'My Gym';

  const filteredExercises = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return exercises.filter((ex) => {
      if (!matchesEquipmentFilter(ex, equipmentFilter, allowedEquipment)) {
        return false;
      }
      if (!query) return true;
      const eqLabel = EQUIPMENT_LABELS[resolveExerciseEquipment(ex)].toLowerCase();
      const matchName = ex.name.toLowerCase().includes(query) || eqLabel.includes(query);
      const matchMuscles = ex.exercise_muscle_groups?.some((m) => {
        const raw = m.muscle_group.toLowerCase();
        const norm = String(normalizeMuscleGroup(m.muscle_group)).toLowerCase();
        return raw.includes(query) || norm.includes(query);
      });
      return matchName || matchMuscles;
    });
  }, [exercises, searchQuery, equipmentFilter, allowedEquipment]);

  const renderItem = ({ item }: { item: Exercise }) => {
    const muscles = (item.exercise_muscle_groups || []).map((m) => ({
      ...m,
      muscle_group: String(normalizeMuscleGroup(m.muscle_group)),
    }));
    const primary = muscles.find((m) => Number(m.fraction) === 1.0);
    const seen = new Set<string>(primary ? [primary.muscle_group] : []);
    const secondaries = muscles.filter((m) => {
      if (Number(m.fraction) !== 0.5 || seen.has(m.muscle_group)) return false;
      seen.add(m.muscle_group);
      return true;
    });
    const eq = resolveExerciseEquipment(item);
    const eqLabel = EQUIPMENT_LABELS[eq];
    const effectiveRest = lockRestTimerToDefault
      ? `${defaultRestSeconds}s Default Rest`
      : `${item.default_rest_timer_seconds}s Rest`;

    return (
      <TouchableOpacity 
        onPress={() => router.push(`/exercises/${item.id}`)}
        className="bg-slate-800 p-4 rounded-xl mb-3 flex-row justify-between items-center"
      >
        <View className="flex-1 mr-3">
          <View className="flex-row items-center flex-wrap gap-2 mb-1">
            <Text className="text-white font-bold text-lg">{item.name}</Text>
            {item.is_unilateral ? (
              <View className="bg-cyan-500/20 px-2 py-0.5 rounded-md border border-cyan-500/40">
                <Text className="text-cyan-300 text-[10px] font-extrabold tracking-wider">PER SIDE</Text>
              </View>
            ) : null}
          </View>
          
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
            {eqLabel} • {effectiveRest}
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
      <View className="bg-slate-800 flex-row items-center px-4 py-3 rounded-xl mb-3 border border-slate-700/60">
        <Search color="#94a3b8" size={20} className="mr-3" />
        <TextInput
          className="flex-1 text-white text-base"
          placeholder="Search by name, equipment, or muscle..."
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

      {/* Equipment Filter Chips */}
      <View className="mb-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(
            [
              { key: 'my_gym', label: myGymChipLabel },
              { key: 'dumbbell', label: 'Dumbbell' },
              { key: 'bodyweight', label: 'Bodyweight' },
              { key: 'all', label: 'All' },
            ] as const
          ).map((chip) => {
            const active = equipmentFilter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                onPress={() => setEquipmentFilter(chip.key)}
                className={`px-3.5 py-1.5 rounded-full border ${
                  active
                    ? 'bg-emerald-600/25 border-emerald-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <Text className={`text-xs font-bold ${active ? 'text-emerald-300' : 'text-slate-300'}`}>
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
