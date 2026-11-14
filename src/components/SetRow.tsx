import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { usePreferencesStore } from '../store/usePreferencesStore';
import type { SetType } from '../utils/analyticsEngine';

export interface SetRowProps {
  setIndex: number;
  setType?: SetType;
  setStyle?: SetType;
  rir?: number | null;
  isBodyweightOnly?: boolean;
  weight: string;
  reps: string;
  prevPerformance?: string; // e.g. "135 lbs × 10"
  isCompleted: boolean;
  onToggleComplete: () => void;
  onChangeWeight: (weight: string) => void;
  onChangeReps: (reps: string) => void;
  onCycleSetType?: () => void;
  onCycleRir?: () => void;
}

export function formatRirLabel(rir: number | null | undefined): string {
  if (rir === null || rir === undefined) return '—';
  if (rir >= 4) return '4+';
  return String(rir);
}

export function getSetTypeBadgeMeta(setType: SetType, setNumber: number | string) {
  switch (setType) {
    case 'warmup':
      return {
        label: 'W',
        containerClass: 'bg-amber-500/20 border border-amber-500/50',
        textClass: 'text-amber-300',
      };
    case 'drop':
      return {
        label: 'D',
        containerClass: 'bg-sky-500/20 border border-sky-500/50',
        textClass: 'text-sky-300',
      };
    case 'failure':
      return {
        label: 'F',
        containerClass: 'bg-rose-500/20 border border-rose-500/50',
        textClass: 'text-rose-300',
      };
    default:
      return {
        label: String(setNumber),
        containerClass: '',
        textClass: '',
      };
  }
}

export const SetRow: React.FC<SetRowProps> = ({
  setIndex,
  setType,
  setStyle = 'normal',
  rir = null,
  isBodyweightOnly = false,
  weight,
  reps,
  prevPerformance,
  isCompleted,
  onToggleComplete,
  onChangeWeight,
  onChangeReps,
  onCycleSetType,
  onCycleRir,
}) => {
  const hapticsEnabled = usePreferencesStore((s) => s.hapticsEnabled);
  const activeSetType: SetType = setType ?? setStyle ?? 'normal';
  const badgeMeta = getSetTypeBadgeMeta(activeSetType, setIndex);

  const handleToggle = () => {
    try {
      if (!isCompleted && hapticsEnabled) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch {
      // Haptics fallback for web browser
    }
    onToggleComplete();
  };

  const rowContainerStyle = isCompleted
    ? activeSetType === 'warmup'
      ? 'bg-amber-950/20 border-amber-500/40'
      : 'bg-emerald-950/30 border-emerald-500/40'
    : activeSetType === 'warmup'
    ? 'bg-slate-900 border-amber-500/25'
    : 'bg-slate-900 border-slate-800';

  const defaultBadgeBg = isCompleted ? 'bg-emerald-500/20' : 'bg-slate-800';
  const defaultBadgeText = isCompleted ? 'text-emerald-400' : 'text-slate-300';

  return (
    <View className={`flex-row items-center py-2 px-2.5 rounded-xl mb-2 border ${rowContainerStyle}`}>
      {/* Set Number / Tap-to-Cycle Set Type Badge */}
      <View className="w-8 items-center justify-center">
        <TouchableOpacity
          onPress={onCycleSetType}
          disabled={!onCycleSetType}
          activeOpacity={0.7}
          className={`w-7 h-7 rounded-full items-center justify-center ${
            activeSetType === 'normal' ? defaultBadgeBg : badgeMeta.containerClass
          }`}
        >
          <Text
            className={`font-bold text-xs ${
              activeSetType === 'normal' ? defaultBadgeText : badgeMeta.textClass
            }`}
          >
            {badgeMeta.label}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Previous Performance Ghost Text */}
      <View className="w-16 px-1 justify-center">
        <Text className="text-slate-500 text-[11px] font-medium" numberOfLines={1}>
          {prevPerformance || '—'}
        </Text>
      </View>

      {/* Weight Input or BW Badge */}
      <View className="flex-1 px-1 justify-center">
        {isBodyweightOnly ? (
          <View className="h-10 rounded-xl bg-slate-800/70 border border-slate-700/60 items-center justify-center">
            <Text className="text-slate-300 font-bold text-xs">BW</Text>
          </View>
        ) : (
          <TextInput
            className={`h-10 rounded-xl px-1.5 py-0 text-center font-bold text-sm border ${
              isCompleted
                ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
                : 'bg-slate-800 text-white border-slate-700'
            }`}
            style={{ textAlignVertical: 'center', includeFontPadding: false }}
            keyboardType="numeric"
            placeholder="lbs"
            placeholderTextColor="#475569"
            value={weight}
            onChangeText={onChangeWeight}
            editable={!isCompleted}
            selectTextOnFocus
          />
        )}
      </View>

      {/* Reps Input */}
      <View className="flex-1 px-1 justify-center">
        <TextInput
          className={`h-10 rounded-xl px-1.5 py-0 text-center font-bold text-sm border ${
            isCompleted
              ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
              : 'bg-slate-800 text-white border-slate-700'
          }`}
          style={{ textAlignVertical: 'center', includeFontPadding: false }}
          keyboardType="numeric"
          placeholder="reps"
          placeholderTextColor="#475569"
          value={reps}
          onChangeText={onChangeReps}
          editable={!isCompleted}
          selectTextOnFocus
        />
      </View>

      {/* Tap-to-Cycle RIR Pill */}
      <View className="w-11 px-0.5 justify-center items-center">
        <TouchableOpacity
          onPress={onCycleRir}
          disabled={!onCycleRir}
          activeOpacity={0.7}
          className={`h-10 w-full rounded-xl items-center justify-center border ${
            rir !== null && rir !== undefined
              ? 'bg-indigo-500/20 border-indigo-500/40'
              : 'bg-slate-800/80 border-slate-700/70'
          }`}
        >
          <Text
            className={`font-bold text-xs ${
              rir !== null && rir !== undefined ? 'text-indigo-200' : 'text-slate-500'
            }`}
          >
            {formatRirLabel(rir)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Complete Checkbox Button */}
      <View className="w-10 items-end justify-center pl-1">
        <TouchableOpacity
          onPress={handleToggle}
          className={`w-9 h-9 rounded-xl items-center justify-center border ${
            isCompleted ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-800 border-slate-700'
          }`}
        >
          {isCompleted ? (
            <Check color="white" size={18} strokeWidth={3} />
          ) : (
            <View className="w-3 h-3 rounded-sm bg-slate-600" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};
