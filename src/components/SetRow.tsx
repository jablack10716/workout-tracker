import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';

export interface SetRowProps {
  setIndex: number;
  setStyle?: 'normal' | 'warmup' | 'drop' | 'failure';
  weight: string;
  reps: string;
  prevPerformance?: string; // e.g. "135 lbs × 10"
  isCompleted: boolean;
  onToggleComplete: () => void;
  onChangeWeight: (weight: string) => void;
  onChangeReps: (reps: string) => void;
}

export const SetRow: React.FC<SetRowProps> = ({
  setIndex,
  setStyle = 'normal',
  weight,
  reps,
  prevPerformance,
  isCompleted,
  onToggleComplete,
  onChangeWeight,
  onChangeReps,
}) => {
  const handleToggle = () => {
    try {
      if (!isCompleted) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (e) {
      // Haptics fallback for web browser
    }
    onToggleComplete();
  };

  return (
    <View className={`flex-row items-center py-2.5 px-3 rounded-xl mb-2 border ${
      isCompleted 
        ? 'bg-emerald-950/30 border-emerald-500/40' 
        : 'bg-slate-900 border-slate-800'
    }`}>
      {/* Set Number */}
      <View className="w-10 items-center justify-center">
        <View className={`w-7 h-7 rounded-full items-center justify-center ${isCompleted ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
          <Text className={`font-bold text-sm ${isCompleted ? 'text-emerald-400' : 'text-slate-300'}`}>
            {setIndex}
          </Text>
        </View>
      </View>

      {/* Previous Performance Ghost Text */}
      <View className="w-24 px-1">
        <Text className="text-slate-500 text-xs font-medium" numberOfLines={1}>
          {prevPerformance || '—'}
        </Text>
      </View>

      {/* Weight Input */}
      <View className="flex-1 px-1">
        <TextInput
          className={`rounded-xl p-2.5 text-center font-bold text-base border ${
            isCompleted 
              ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50' 
              : 'bg-slate-800 text-white border-slate-700'
          }`}
          keyboardType="numeric"
          placeholder="lbs"
          placeholderTextColor="#475569"
          value={weight}
          onChangeText={onChangeWeight}
          editable={!isCompleted}
        />
      </View>

      {/* Reps Input */}
      <View className="flex-1 px-1">
        <TextInput
          className={`rounded-xl p-2.5 text-center font-bold text-base border ${
            isCompleted 
              ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50' 
              : 'bg-slate-800 text-white border-slate-700'
          }`}
          keyboardType="numeric"
          placeholder="reps"
          placeholderTextColor="#475569"
          value={reps}
          onChangeText={onChangeReps}
          editable={!isCompleted}
        />
      </View>

      {/* Complete Checkbox Button */}
      <View className="w-12 items-end pl-1">
        <TouchableOpacity
          onPress={handleToggle}
          className={`w-9 h-9 rounded-xl items-center justify-center border ${
            isCompleted 
              ? 'bg-emerald-500 border-emerald-400' 
              : 'bg-slate-800 border-slate-700'
          }`}
        >
          {isCompleted ? (
            <Check color="white" size={20} strokeWidth={3} />
          ) : (
            <View className="w-3 h-3 rounded-sm bg-slate-600" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};
