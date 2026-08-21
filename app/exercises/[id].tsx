import { View, Text, TextInput, Switch, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { supabase } from '../../src/lib/supabase';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Core'] as const;
type MuscleGroup = typeof MUSCLE_GROUPS[number];

export default function ExerciseEditor() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const isNew = id === 'new';
  
  const [name, setName] = useState('');
  const [isBodyweightOnly, setIsBodyweightOnly] = useState(false);
  const [restTimer, setRestTimer] = useState('90');
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | null>(null);
  const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleGroup[]>([]);
  const [loading, setLoading] = useState(!isNew);

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
      Alert.alert('Error', 'Failed to load exercise');
      router.back();
    } else if (data) {
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
    if (muscle === primaryMuscle) return; // Cannot be secondary if primary
    if (secondaryMuscles.includes(muscle)) {
      setSecondaryMuscles(secondaryMuscles.filter(m => m !== muscle));
    } else {
      setSecondaryMuscles([...secondaryMuscles, muscle]);
    }
  };

  const handleSelectPrimary = (muscle: MuscleGroup) => {
    setPrimaryMuscle(muscle);
    // Remove from secondary if present
    setSecondaryMuscles(secondaryMuscles.filter(m => m !== muscle));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Please enter an exercise name.');
      return;
    }

    if (!primaryMuscle) {
      Alert.alert('Validation', 'Please select a primary muscle group.');
      return;
    }

    setLoading(true);
    
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    
    if (!userId) {
      Alert.alert('Error', 'You must be logged in.');
      setLoading(false);
      return;
    }

    let exerciseId = id as string;

    if (isNew) {
      const insertPayload = {
        user_id: userId,
        name: name.trim(),
        is_bodyweight_only: isBodyweightOnly,
        default_rest_timer_seconds: parseInt(restTimer, 10) || 90,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('exercises').insert([insertPayload]).select().single();
      if (error || !data) {
        Alert.alert('Error', error?.message || 'Failed to create exercise');
        setLoading(false);
        return;
      }
      exerciseId = data.id;
    } else {
      const updatePayload = {
        name: name.trim(),
        is_bodyweight_only: isBodyweightOnly,
        default_rest_timer_seconds: parseInt(restTimer, 10) || 90,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('exercises').update(updatePayload).eq('id', exerciseId);
      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }
    }

    // Save muscle group mappings
    // 1. Delete existing mappings for this exercise
    await supabase.from('exercise_muscle_groups').delete().eq('exercise_id', exerciseId);

    // 2. Insert new mappings
    const muscleRows = [
      { exercise_id: exerciseId, muscle_group: primaryMuscle, fraction: 1.0 },
      ...secondaryMuscles.map(m => ({ exercise_id: exerciseId, muscle_group: m, fraction: 0.5 }))
    ];

    const { error: muscleError } = await supabase.from('exercise_muscle_groups').insert(muscleRows);
    setLoading(false);
    router.back();
  };

  const executeDelete = async () => {
    setLoading(true);
    const { error } = await supabase.from('exercises').delete().eq('id', id);
    if (error) {
      if (Platform.OS === 'web') {
        window.alert(`Delete Error: ${error.message}`);
      } else {
        Alert.alert('Error', error.message);
      }
      setLoading(false);
    } else {
      router.back();
    }
  };

  const handleDelete = () => {
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
      <Text className="text-blue-500 text-xs font-bold uppercase tracking-widest mt-10 mb-0.5">
        Best Damn Weight Lifting Tracker Ever
      </Text>
      <Text className="text-2xl font-bold text-white mb-6">
        {isNew ? 'New Exercise' : 'Edit Exercise'}
      </Text>

      <View className="space-y-4">
        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Exercise Name</Text>
          <TextInput 
            className="bg-slate-800 text-white p-4 rounded-xl"
            placeholder="e.g. Bench Press"
            placeholderTextColor="#64748b"
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Primary Muscle Selector */}
        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Primary Muscle Group (1.0 Volume)</Text>
          <View className="flex-row flex-wrap gap-2">
            {MUSCLE_GROUPS.map((muscle) => (
              <TouchableOpacity
                key={muscle}
                onPress={() => handleSelectPrimary(muscle)}
                className={`px-4 py-2 rounded-xl border ${
                  primaryMuscle === muscle
                    ? 'bg-blue-600 border-blue-400'
                    : 'bg-slate-800 border-slate-700'
                }`}
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
                  disabled={isPrimary}
                  onPress={() => toggleSecondary(muscle)}
                  className={`px-4 py-2 rounded-xl border ${
                    isPrimary
                      ? 'bg-slate-800/40 border-slate-800 opacity-40'
                      : isSecondary
                      ? 'bg-indigo-600/40 border-indigo-400'
                      : 'bg-slate-800 border-slate-700'
                  }`}
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
            onValueChange={setIsBodyweightOnly}
            trackColor={{ false: '#334155', true: '#3b82f6' }}
          />
        </View>

        <View className="mt-4">
          <Text className="text-slate-400 mb-2">Default Rest Timer (seconds)</Text>
          <TextInput 
            className="bg-slate-800 text-white p-4 rounded-xl"
            keyboardType="number-pad"
            value={restTimer}
            onChangeText={setRestTimer}
          />
        </View>

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
        
        <TouchableOpacity 
          className="p-4 items-center mt-2 mb-10"
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text className="text-slate-400">Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
