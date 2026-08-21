import React from 'react';
import { View, Text } from 'react-native';
import { CycleComparison } from '../../utils/analyticsEngine';
import { TrendingUp, TrendingDown, Minus, Trophy, Sparkles, Layers } from 'lucide-react-native';

interface CycleComparisonViewProps {
  comparison: CycleComparison;
}

export const CycleComparisonView: React.FC<CycleComparisonViewProps> = ({ comparison }) => {
  if (!comparison || comparison.cycles.length < 2) {
    return (
      <View className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800/80 items-center justify-center">
        <Text className="text-slate-400 text-xs text-center">
          Complete this workout day in at least 2 cycles to unlock automated progressive overload comparison reports.
        </Text>
      </View>
    );
  }

  const latestCycle = comparison.cycles[comparison.cycles.length - 1];
  const previousCycle = comparison.cycles[comparison.cycles.length - 2];

  const volumeDiff = latestCycle.totalVolume - previousCycle.totalVolume;
  const volumePct =
    previousCycle.totalVolume > 0
      ? Math.round((volumeDiff / previousCycle.totalVolume) * 100)
      : 0;

  return (
    <View className="space-y-4">
      {/* Macro Delta Summary Banner */}
      <View className="bg-gradient-to-r from-indigo-950/60 to-purple-950/40 p-4 rounded-3xl border border-indigo-500/30">
        <View className="flex-row justify-between items-center mb-2">
          <View className="flex-row items-center">
            <Sparkles color="#c084fc" size={16} className="mr-1.5" />
            <Text className="text-white font-bold text-sm">
              Cycle {previousCycle.cycleNumber} → Cycle {latestCycle.cycleNumber} Overload Report
            </Text>
          </View>
          <View
            className={`px-2.5 py-1 rounded-full flex-row items-center ${
              volumeDiff >= 0 ? 'bg-emerald-500/20' : 'bg-rose-500/20'
            }`}
          >
            {volumeDiff >= 0 ? (
              <TrendingUp color="#10b981" size={12} className="mr-1" />
            ) : (
              <TrendingDown color="#f43f5e" size={12} className="mr-1" />
            )}
            <Text
              className={`text-xs font-extrabold ${
                volumeDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {volumePct >= 0 ? `+${volumePct}%` : `${volumePct}%`} Volume
            </Text>
          </View>
        </View>

        <View className="flex-row justify-between items-center pt-2 border-t border-indigo-500/20">
          <View>
            <Text className="text-slate-400 text-[10px] uppercase font-bold">
              Cycle {previousCycle.cycleNumber} Tonnage
            </Text>
            <Text className="text-slate-300 font-bold text-sm">
              {previousCycle.totalVolume.toLocaleString()} lbs ({previousCycle.completedSets} sets)
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-slate-400 text-[10px] uppercase font-bold">
              Cycle {latestCycle.cycleNumber} Tonnage
            </Text>
            <Text className="text-white font-black text-sm">
              {latestCycle.totalVolume.toLocaleString()} lbs ({latestCycle.completedSets} sets)
            </Text>
          </View>
        </View>
      </View>

      {/* Exercise by Exercise Micro Breakdown */}
      <View className="space-y-3">
        {latestCycle.exercises.map((latestEx) => {
          const prevEx = previousCycle.exercises.find(
            (e) => e.exerciseId === latestEx.exerciseId
          );

          const weightDelta = prevEx ? latestEx.topWeight - prevEx.topWeight : 0;
          const e1rmDelta = prevEx ? latestEx.topE1RM - prevEx.topE1RM : 0;
          const exVolDelta = prevEx ? latestEx.totalVolume - prevEx.totalVolume : 0;

          return (
            <View
              key={latestEx.exerciseId}
              className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800/90"
            >
              {/* Exercise Title & Delta Badges */}
              <View className="flex-row justify-between items-center mb-2.5">
                <Text className="text-white font-bold text-base flex-1 mr-2" numberOfLines={1}>
                  {latestEx.exerciseName}
                </Text>
                {prevEx && (
                  <View className="flex-row items-center gap-1.5">
                    {weightDelta !== 0 && (
                      <View
                        className={`px-2 py-0.5 rounded-md ${
                          weightDelta > 0 ? 'bg-emerald-500/20' : 'bg-rose-500/20'
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-bold ${
                            weightDelta > 0 ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {weightDelta > 0 ? `+${weightDelta}` : weightDelta} lbs
                        </Text>
                      </View>
                    )}
                    {e1rmDelta !== 0 && (
                      <View className="bg-purple-500/20 px-2 py-0.5 rounded-md">
                        <Text className="text-purple-300 text-[11px] font-bold">
                          1RM: {Math.round(latestEx.topE1RM)} lbs
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Side-by-Side Sets Comparison Grid */}
              <View className="bg-slate-800/40 rounded-xl p-2.5">
                <View className="flex-row justify-between pb-1.5 mb-1.5 border-b border-slate-700/50">
                  <Text className="text-slate-500 text-[10px] font-bold uppercase w-12">Set</Text>
                  <Text className="text-slate-400 text-[10px] font-bold uppercase flex-1 text-center">
                    Cycle {previousCycle.cycleNumber} ({prevEx?.date || '—'})
                  </Text>
                  <Text className="text-slate-200 text-[10px] font-bold uppercase flex-1 text-center">
                    Cycle {latestCycle.cycleNumber} ({latestCycle.date})
                  </Text>
                </View>

                {latestEx.sets.map((curSet, sIdx) => {
                  const pSet = prevEx?.sets?.[sIdx];
                  const improved = pSet
                    ? curSet.weight > pSet.weight ||
                      (curSet.weight === pSet.weight && curSet.reps > pSet.reps)
                    : true;

                  return (
                    <View key={sIdx} className="flex-row justify-between items-center py-1">
                      <Text className="text-slate-400 font-bold text-xs w-12">
                        Set {curSet.set_number}
                      </Text>
                      <Text className="text-slate-400 text-xs flex-1 text-center">
                        {pSet ? `${pSet.weight} × ${pSet.reps}` : '—'}
                      </Text>
                      <View className="flex-1 items-center flex-row justify-center">
                        <Text
                          className={`font-black text-xs ${
                            improved ? 'text-emerald-400' : 'text-white'
                          }`}
                        >
                          {curSet.weight} × {curSet.reps}
                        </Text>
                        {improved && <Text className="text-emerald-400 text-[10px] ml-1">✓</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};
