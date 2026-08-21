import React from 'react';
import { View, Text, ScrollView } from 'react-native';

interface HeatmapDay {
  dateStr: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  volume: number;
  workoutCount: number;
}

interface ConsistencyHeatmapProps {
  sessions: any[];
  weeksCount?: number;
  title?: string;
  subtitle?: string;
}

export const ConsistencyHeatmap: React.FC<ConsistencyHeatmapProps> = ({
  sessions = [],
  weeksCount = 12,
  title = 'Training Consistency Heatmap',
  subtitle = 'Weekly frequency & session intensity over the past 12 weeks',
}) => {
  // Map session dates to volume
  const sessionVolumeByDate: Record<string, { volume: number; count: number }> = {};

  sessions.forEach((s) => {
    if (!s.started_at) return;
    const dateKey = new Date(s.started_at).toISOString().split('T')[0];

    let sessionVol = 0;
    (s.session_exercises || []).forEach((se: any) => {
      (se.session_sets || []).forEach((st: any) => {
        if (st.is_completed) {
          sessionVol += (Number(st.weight) || 0) * (Number(st.reps) || 0);
        }
      });
    });

    if (!sessionVolumeByDate[dateKey]) {
      sessionVolumeByDate[dateKey] = { volume: 0, count: 0 };
    }
    sessionVolumeByDate[dateKey].volume += sessionVol;
    sessionVolumeByDate[dateKey].count += 1;
  });

  // Generate 12-week grid (Mon to Sun rows)
  const now = new Date();
  const gridWeeks: HeatmapDay[][] = [];

  // Find most recent Sunday or today to anchor the grid
  for (let w = weeksCount - 1; w >= 0; w--) {
    const weekDays: HeatmapDay[] = [];
    const refMonday = new Date(now);
    refMonday.setDate(refMonday.getDate() - w * 7);
    const day = refMonday.getDay();
    const diff = refMonday.getDate() - (day === 0 ? 6 : day - 1);
    refMonday.setDate(diff);

    for (let d = 0; d < 7; d++) {
      const curDate = new Date(refMonday);
      curDate.setDate(refMonday.getDate() + d);
      const dateKey = curDate.toISOString().split('T')[0];

      const entry = sessionVolumeByDate[dateKey];
      weekDays.push({
        dateStr: dateKey,
        dayOfWeek: d, // 0 = Mon, ..., 6 = Sun
        volume: entry?.volume || 0,
        workoutCount: entry?.count || 0,
      });
    }
    gridWeeks.push(weekDays);
  }

  const getCellColor = (volume: number, count: number) => {
    if (count === 0) return 'bg-slate-800/40 border-slate-800';
    if (volume < 5000) return 'bg-emerald-900/60 border-emerald-700/60';
    if (volume < 15000) return 'bg-emerald-600 border-emerald-500';
    return 'bg-emerald-400 border-emerald-300';
  };

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 shadow-sm">
      {/* Header */}
      <View className="mb-3">
        <Text className="text-white font-bold text-base">{title}</Text>
        {subtitle && <Text className="text-slate-400 text-xs mt-0.5">{subtitle}</Text>}
      </View>

      {/* Grid Container */}
      <View className="flex-row items-center">
        {/* Day of Week Labels */}
        <View className="mr-2 space-y-1">
          {dayLabels.map((l, i) => (
            <View key={i} className="h-4 justify-center items-center">
              <Text className="text-slate-500 text-[9px] font-bold">{l}</Text>
            </View>
          ))}
        </View>

        {/* Scrollable Heatmap Columns */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
          <View className="flex-row gap-1.5 py-1">
            {gridWeeks.map((week, wIdx) => (
              <View key={wIdx} className="space-y-1">
                {week.map((day, dIdx) => (
                  <View
                    key={dIdx}
                    className={`w-4 h-4 rounded-sm border ${getCellColor(
                      day.volume,
                      day.workoutCount
                    )}`}
                  />
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Footer Legend */}
      <View className="flex-row justify-between items-center mt-3 pt-2.5 border-t border-slate-800/80">
        <Text className="text-slate-400 text-[10px]">
          {sessions.length} total sessions recorded
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-slate-500 text-[9px]">Less</Text>
          <View className="w-2.5 h-2.5 rounded-sm bg-slate-800/60 border border-slate-700" />
          <View className="w-2.5 h-2.5 rounded-sm bg-emerald-900/60 border border-emerald-700" />
          <View className="w-2.5 h-2.5 rounded-sm bg-emerald-600 border border-emerald-500" />
          <View className="w-2.5 h-2.5 rounded-sm bg-emerald-400 border border-emerald-300" />
          <Text className="text-slate-500 text-[9px]">More</Text>
        </View>
      </View>
    </View>
  );
};
