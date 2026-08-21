import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';

export interface BarDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  sublabel?: string;
  isCurrent?: boolean;
}

interface BarChartProps {
  data: BarDataPoint[];
  title?: string;
  subtitle?: string;
  unit?: string;
  height?: number;
  barColor?: string;
  activeBarColor?: string;
  emptyMessage?: string;
  targetLineValue?: number;
  targetLineLabel?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  subtitle,
  unit = 'lbs',
  height = 170,
  barColor = '#818cf8', // indigo-400
  activeBarColor = '#10b981', // emerald-500
  emptyMessage = 'No volume data recorded yet.',
  targetLineValue,
  targetLineLabel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    data && data.length > 0 ? data.length - 1 : null
  );

  if (!data || data.length === 0) {
    return (
      <View className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800/80 items-center justify-center min-h-[160px]">
        {title && <Text className="text-white font-bold text-base mb-1">{title}</Text>}
        <Text className="text-slate-400 text-xs text-center">{emptyMessage}</Text>
      </View>
    );
  }

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - 48, 280);
  const paddingLeft = 32;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 26;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const values = data.map((d) => d.value);
  const maxValue = Math.max(...values, targetLineValue || 0, 10);
  const yMax = Math.ceil(maxValue * 1.15);

  const barCount = data.length;
  const totalSlotWidth = innerWidth / barCount;
  const barWidth = Math.max(Math.min(totalSlotWidth * 0.6, 28), 10);

  const activePoint = selectedIndex !== null && data[selectedIndex] ? data[selectedIndex] : null;

  return (
    <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 shadow-sm">
      {/* Header */}
      <View className="flex-row justify-between items-start mb-2 px-1">
        <View className="flex-1 mr-2">
          {title && <Text className="text-white font-bold text-base">{title}</Text>}
          {subtitle && <Text className="text-slate-400 text-xs mt-0.5">{subtitle}</Text>}
        </View>
        {activePoint && (
          <View className="items-end bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
            <Text className="text-white font-black text-sm">
              {activePoint.value >= 1000
                ? `${(activePoint.value / 1000).toFixed(1)}k`
                : activePoint.value.toLocaleString()}{' '}
              {unit}
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold">
              {activePoint.label}
              {activePoint.sublabel ? ` • ${activePoint.sublabel}` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* SVG Canvas */}
      <View className="items-center justify-center">
        <Svg width={chartWidth} height={height}>
          {/* Target Threshold Line */}
          {targetLineValue && targetLineValue > 0 && (
            <>
              {(() => {
                const targetY =
                  paddingTop + innerHeight - (targetLineValue / yMax) * innerHeight;
                return (
                  <>
                    <Line
                      x1={paddingLeft}
                      y1={targetY}
                      x2={chartWidth - paddingRight}
                      y2={targetY}
                      stroke="#f59e0b"
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                      strokeOpacity="0.8"
                    />
                    {targetLineLabel && (
                      <SvgText
                        x={chartWidth - paddingRight}
                        y={targetY - 4}
                        fill="#fbbf24"
                        fontSize="8"
                        fontWeight="bold"
                        textAnchor="end"
                      >
                        {targetLineLabel}
                      </SvgText>
                    )}
                  </>
                );
              })()}
            </>
          )}

          {/* Grid Baseline */}
          <Line
            x1={paddingLeft}
            y1={paddingTop + innerHeight}
            x2={chartWidth - paddingRight}
            y2={paddingTop + innerHeight}
            stroke="#334155"
            strokeWidth="1"
          />

          {/* Bars */}
          {data.map((d, i) => {
            const slotCenterX = paddingLeft + i * totalSlotWidth + totalSlotWidth / 2;
            const barX = slotCenterX - barWidth / 2;
            const barH = Math.max((d.value / yMax) * innerHeight, d.value > 0 ? 4 : 1);
            const barY = paddingTop + innerHeight - barH;
            const isSelected = selectedIndex === i;
            const fill = isSelected
              ? activeBarColor
              : d.isCurrent
              ? '#60a5fa'
              : barColor;

            return (
              <React.Fragment key={i}>
                {/* Background slot for touch highlight */}
                {isSelected && (
                  <Rect
                    x={slotCenterX - totalSlotWidth * 0.45}
                    y={paddingTop}
                    width={totalSlotWidth * 0.9}
                    height={innerHeight}
                    fill="#334155"
                    fillOpacity="0.25"
                    rx="6"
                  />
                )}

                {/* Main Bar */}
                <Rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barH}
                  fill={fill}
                  rx={Math.min(barWidth / 3, 5)}
                  opacity={isSelected ? 1 : 0.85}
                />

                {/* X-Axis Label */}
                <SvgText
                  x={slotCenterX}
                  y={height - 8}
                  fill={isSelected ? '#ffffff' : '#64748b'}
                  fontSize="9"
                  fontWeight={isSelected ? 'bold' : 'normal'}
                  textAnchor="middle"
                >
                  {d.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>

      {/* Interactive Selection Chips */}
      {data.length > 0 && (
        <View className="flex-row justify-center gap-1.5 mt-2 flex-wrap">
          {data.map((d, i) => {
            const isSelected = selectedIndex === i;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedIndex(i)}
                className={`px-2 py-1 rounded-lg border ${
                  isSelected
                    ? 'bg-emerald-600/30 border-emerald-500/60'
                    : 'bg-slate-800/40 border-slate-700/40'
                }`}
              >
                <Text
                  className={`text-[10px] font-bold ${
                    isSelected ? 'text-emerald-300' : 'text-slate-400'
                  }`}
                >
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};
