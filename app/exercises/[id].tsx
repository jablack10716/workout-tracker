import { View, Text, TextInput, Switch, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { Copy, Lock } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { usePreferencesStore } from '../../src/store/usePreferencesStore';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Core'] as const;
type MuscleGroup = typeof MUSCLE_GROUPS[number];
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export default function ExerciseEditor() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const isNew = id === 'new';

  const defaultRestSeconds = usePreferencesStore((s) => s.defaultRestSeconds);
  const prefsHydrated = usePreferencesStore((s) => s._hasHydrated);

  const [name, setName] = useState('');
  const [isBodyweightOnly, setIsBodyweightOnly] = useState(false);
  const [restTimer, setRestTimer] = useState(String(defaultRestSeconds || 90));
  const [restTimerTouched, setRestTimerTouched] = useState(false);
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | null>(null);
  const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleGroup[]>([]);
  const [exerciseUserId, setExerciseUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);

  const isSystemExercise = !isNew && exerciseUserId === SYSTEM_USER_ID;

  const showNotice = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  useEffect(() => {
    if (isNew && prefsHydrated && !restTimerTouched) {
      setRestTimer(String(defaultRestSeconds || 90));
    }
  }, [isNew, prefsHydrated, defaultRestSeconds, restTimerTouched]);

  useEffect(() => {
    if (!isNew && id) {
      loadExercise();
    }
  }, [id]);

  const loadExercise = async () => {
    const { data, error } = await supabase
      .from('exercises')
      .select('*, exercise_muscle_groups(*)')
      .eq('id', id)
      .single();

    if (error) {
      showNotice('Error', 'Failed to load exercise');
      router.back();
    } else if (data) {
      setExerciseUserId(data.user_id || null);
      setName(data.name);
      setIsBodyweightOnly(data.is_bodyweight_only);
      setRestTimer(data.default_rest_timer_seconds.toString());

      // Load muscle mappings
      const mappings: Array<{ muscle_group: MuscleGroup; fraction: number }> = data.exercise_muscle_groups || [];
      const primary = mappings.find(m => Number(m.fraction) === 1.0);
      const secondaries = mappings.filter(m => Number(m.fraction) === 0.5).map(m => m.muscle_group);

      if (primary) setPrimaryMuscle(primary.muscle_group);
      setSecondaryMuscles(secondaries);
    }
    setLoading(false);
  };

  const toggleSecondary = (muscle: MuscleGroup) => {
    if (isSystemExercise || muscle === primaryMuscle) return; // Read-only or cannot be secondary if primary
    if (secondaryMuscles.includes(muscle)) {
      setSecondaryMuscles(secondaryMuscles.filter(m => m !== muscle));
    } else {
      setSecondaryMuscles([...secondaryMuscles, muscle]);
    }
  };

  const handleSelectPrimary = (muscle: MuscleGroup) => {
    if (isSystemExercise) return;
    setPrimaryMuscle(muscle);
    // Remove from secondary if present
    setSecondaryMuscles(secondaryMuscles.filter(m => m !== muscle));
  };

  const handleDuplicateAsCustom = async () => {
    if (!name.trim() || !primaryMuscle) {
      showNotice('Error', 'Cannot duplicate incomplete system exercise.');
      return;
    }

    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      showNotice('Error', 'You must be logged in to duplicate an exercise.');
      setLoading(false);
      return;
    }

    const { data: cloned, error } = await supabase
      .from('exercises')
      .insert([{
        user_id: userId,
        name: `${name.trim()} (Custom)`,
        is_bodyweight_only: isBodyweightOnly,
        default_rest_timer_seconds: parseInt(restTimer, 10) || defaultRestSeconds || 90,
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error || !cloned) {
      showNotice('Duplicate Error', error?.message || 'Failed to duplicate exercise.');
      setLoading(false);
      return;
    }

    const muscleRows = [
      { exercise_id: cloned.id, muscle_group: primaryMuscle, fraction: 1.0 },
      ...secondaryMuscles.map(m => ({ exercise_id: cloned.id, muscle_group: m, fraction: 0.5 }))
    ];

    const { error: muscleError } = await supabase
      .from('exercise_muscle_groups')
      .insert(muscleRows);

    if (muscleError) {
      await supabase.from('exercises').delete().eq('id', cloned.id);
      showNotice('Muscle Mapping Error', muscleError.message || 'Failed to copy muscle group mappings.');
      setLoading(false);
      return;
    }

    setLoading(false);
    router.replace(`/exercises/${cloned.id}`);
  };

  const handleSave = async () => {
    if (isSystemExercise) return;

    if (!name.trim()) {
      showNotice('Validation', 'Please enter an exercise name.');
      return;
    }

    if (!primaryMuscle) {
      showNotice('Validation', 'Please select a primary muscle group.');
      return;
    }

    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      showNotice('Error', 'You must be logged in.');
      setLoading(false);
      return;
    }

    let exerciseId = id as string;
    const resolvedRest = parseInt(restTimer, 10) || defaultRestSeconds || 90;

    if (isNew) {
      const insertPayload = {
        user_id: userId,
        name: name.trim(),
        is_bodyweight_only: isBodyweightOnly,
        default_rest_timer_seconds: resolvedRest,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('exercises').insert([insertPayload]).select().single();
      if (error || !data) {
        showNotice('Error', error?.message || 'Failed to create exercise');
        setLoading(false);
        return;
      }
      exerciseId = data.id;
    } else {
      const updatePayload = {
        name: name.trim(),
        is_bodyweight_only: isBodyweightOnly,
        default_rest_timer_seconds: resolvedRest,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('exercises').update(updatePayload).eq('id', exerciseId);
      if (error) {
        showNotice('Error', error.message);
        setLoading(false);
        return;
      }
    }

    // Save muscle group mappings
    // 1. Delete existing mappings for this exercise
    const { error: deleteMuscleError } = await supabase
      .from('exercise_muscle_groups')
      .delete()
      .eq('exercise_id', exerciseId);

    if (deleteMuscleError) {
      showNotice('Error', deleteMuscleError.message || 'Failed to update muscle mappings.');
      setLoading(false);
      return;
    }

    // 2. Insert new mappings
    const muscleRows = [
      { exercise_id: exerciseId, muscle_group: primaryMuscle, fraction: 1.0 },
      ...secondaryMuscles.map(m => ({ exercise_id: exerciseId, muscle_group: m, fraction: 0.5 }))
    ];

    const { error: muscleError } = await supabase.from('exercise_muscle_groups').insert(muscleRows);
    if (muscleError) {
      showNotice('Error', muscleError.message || 'Failed to save muscle group mappings.');
      setLoading(false);
      return;
    }

    setLoading(false);
    router.back();
  };

  const executeDelete = async () => {
    if (isSystemExercise) return;
    setLoading(true);
    const { error } = await supabase.from('exercises').delete().eq('id', id);
    if (error) {
      showNotice('Delete Error', error.message);
      setLoading(false);
    } else {
      router.back();
    }
  };

  const handleDelete = () => {
    if (isSystemExercise) return;
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`);
      if (confirmed) {
        executeDelete();
      }
    } else {
      Alert.alert(
        'Delete Exercise',
        `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: executeDelete
          }
        ]
      );
    }
  };

  if (loading && !isNew) {
    return (
      <View className="flex-1 bg-slate-900 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-900 p-4">
      <Text className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
        Best Damn Workout Tracker Ever
      </Text>
      <Text className="text-2xl font-bold text-white mb-4">
        {isNew ? 'New Exercise' : isSystemExercise ? 'System Exercise' : 'Edit Exercise'}
      </Text>

      {isSystemExercise && (
        <View className="bg-indigo-950/60 border border-indigo-500/40 rounded-2xl p-4 mb-5 flex-row items-start">
          <Lock color="#a78bfa" size={18} className="mr-3 mt-0.5" />
          <View className="flex-1">
            <Text className="text-indigo-200 font-bold text-sm mb-1">
              Built-in System Exercise (Read-Only)
            </Text>
            <Text className="text-indigo-300/80 text-xs leading-4">
              System library movements cannot be edited or deleted directly. Duplicate this template to customize its name, target muscles, or rest timer.
            </Text>
          </View>
        </View>
      )}

      <View className="space-y-4">
        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Exercise Name</Text>
          <TextInput
            className={`p-4 rounded-xl ${isSystemExercise ? 'bg-slate-800/50 text-slate-300 border border-slate-700/50' : 'bg-slate-800 text-white'}`}
            placeholder="e.g. Bench Press"
            placeholderTextColor="#64748b"
            value={name}
            onChangeText={setName}
            editable={!isSystemExercise}
          />
        </View>

        {/* Primary Muscle Selector */}
        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Primary Muscle Group (1.0 Volume)</Text>
          <View className="flex-row flex-wrap gap-2">
            {MUSCLE_GROUPS.map((muscle) => (
              <TouchableOpacity
                key={muscle}
                disabled={isSystemExercise}
                onPress={() => handleSelectPrimary(muscle)}
                className={`px-4 py-2 rounded-xl border ${
                  primaryMuscle === muscle
                    ? 'bg-blue-600 border-blue-400'
                    : 'bg-slate-800 border-slate-700'
                } ${isSystemExercise && primaryMuscle !== muscle ? 'opacity-50' : ''}`}
              >
                <Text className={`font-semibold ${primaryMuscle === muscle ? 'text-white' : 'text-slate-300'}`}>
                  {muscle}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Secondary Muscle Selector */}
        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Secondary Muscles (0.5 Volume - Optional)</Text>
          <View className="flex-row flex-wrap gap-2">
            {MUSCLE_GROUPS.map((muscle) => {
              const isPrimary = primaryMuscle === muscle;
              const isSecondary = secondaryMuscles.includes(muscle);
              return (
                <TouchableOpacity
                  key={muscle}
                  disabled={isPrimary || isSystemExercise}
                  onPress={() => toggleSecondary(muscle)}
                  className={`px-4 py-2 rounded-xl border ${
                    isPrimary
                      ? 'bg-slate-800/40 border-slate-800 opacity-40'
                      : isSecondary
                      ? 'bg-indigo-600/40 border-indigo-400'
                      : 'bg-slate-800 border-slate-700'
                  } ${isSystemExercise && !isSecondary ? 'opacity-50' : ''}`}
                >
                  <Text className={`font-semibold ${isSecondary ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {muscle} {isSecondary ? '(0.5x)' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View className="flex-row justify-between items-center bg-slate-800 p-4 rounded-xl mt-2">
          <Text className="text-white">Bodyweight Only</Text>
          <Switch
            value={isBodyweightOnly}
            disabled={isSystemExercise}
            onValueChange={setIsBodyweightOnly}
            trackColor={{ false: '#334155', true: '#3b82f6' }}
          />
        </View>

        <View className="mt-4">
          <Text className="text-slate-400 mb-2">Default Rest Timer (seconds)</Text>
          <TextInput
            className={`p-4 rounded-xl ${isSystemExercise ? 'bg-slate-800/50 text-slate-300 border border-slate-700/50' : 'bg-slate-800 text-white'}`}
            keyboardType="number-pad"
            value={restTimer}
            onChangeText={(v) => {
              setRestTimerTouched(true);
              setRestTimer(v);
            }}
            editable={!isSystemExercise}
          />
        </View>

        {isSystemExercise ? (
          <TouchableOpacity
            className="bg-indigo-600 p-4 rounded-xl mt-8 items-center flex-row justify-center"
            onPress={handleDuplicateAsCustom}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Copy color="white" size={18} className="mr-2" />
                <Text className="text-white font-bold text-lg">Duplicate as Custom Exercise</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              className="bg-blue-600 p-4 rounded-xl mt-8 items-center"
              onPress={handleSave}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">Save Exercise</Text>
              )}
            </TouchableOpacity>

            {!isNew && (
              <TouchableOpacity
                className="bg-rose-900/30 border border-rose-700/50 p-4 rounded-xl mt-3 items-center"
                onPress={handleDelete}
                disabled={loading}
              >
                <Text className="text-rose-400 font-bold text-base">Delete Exercise</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <TouchableOpacity
          className="p-4 items-center mt-2 mb-10"
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text className="text-slate-400">{isSystemExercise ? 'Close' : 'Cancel'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
