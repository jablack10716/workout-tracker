import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';

export interface RadarDataPoint {
  label: string;
  value: number; // Completed sets
  target?: number; // Target sets
  maxScale?: number;
}

interface RadarChartProps {
  data: RadarDataPoint[];
  title?: string;
  subtitle?: string;
  size?: number;
  completedColor?: string;
  targetColor?: string;
  targetLegendLabel?: string;
}

const RADAR_SHORT_LABELS: Record<string, string> = {
  'Upper Back': 'U.Back',
  Shoulders: 'Shldrs',
  Hamstrings: 'Hams',
};

function formatAxisLabel(label: string, totalAxes: number): string {
  if (totalAxes <= 8) return label;
  return RADAR_SHORT_LABELS[label] || label;
}

export const RadarChart: React.FC<RadarChartProps> = ({
  data,
  title = 'Muscle Group Volume Balance',
  subtitle = 'Fractional sets distribution across major muscle groups',
  size = 260,
  completedColor = '#818cf8', // indigo-400
  targetColor = '#10b981', // emerald-500
  targetLegendLabel = 'Target Goal',
}) => {
  if (!data || data.length < 3) {
    return null;
  }

  const numAxes = data.length;
  const screenWidth = Dimensions.get('window').width;
  const preferredSize = numAxes > 8 ? Math.max(size, 290) : size;
  const chartSize = Math.min(preferredSize, screenWidth - 40);
  const center = chartSize / 2;
  const radius = chartSize * (numAxes > 8 ? 0.29 : 0.35); // Leave margin for labels

  const angleStep = (2 * Math.PI) / numAxes;

  // Determine max scale (default at least 20 sets for hypertrophy ceiling)
  const allValues = data.flatMap((d) => [d.value, d.target || 0]);
  const maxValue = Math.max(...allValues, 15);
  const maxScale = Math.ceil(maxValue / 5) * 5;

  // Concentric levels (e.g. 33%, 66%, 100%)
  const levels = [0.33, 0.66, 1.0];

  const getCoordinates = (index: number, val: number) => {
    const ratio = Math.min(val / maxScale, 1.1);
    const r = radius * ratio;
    // Start from top (- PI / 2)
    const angle = index * angleStep - Math.PI / 2;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { x, y };
  };

  // Completed sets polygon
  const completedPoints = data.map((d, i) => getCoordinates(i, d.value));
  const completedPointsStr = completedPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // Target sets polygon (if targets exist)
  const hasTargets = data.some((d) => (d.target || 0) > 0);
  const targetPoints = data.map((d, i) => getCoordinates(i, d.target || 0));
  const targetPointsStr = targetPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 shadow-sm items-center">
      {/* Header */}
      <View className="w-full mb-2">
        <Text className="text-white font-bold text-base">{title}</Text>
        {subtitle && <Text className="text-slate-400 text-xs mt-0.5">{subtitle}</Text>}
      </View>

      {/* Radar SVG */}
      <Svg width={chartSize} height={chartSize}>
        {/* Background Concentric Polygon Rings */}
        {levels.map((lvl, lvlIdx) => {
          const ringPts = data
            .map((_, i) => {
              const r = radius * lvl;
              const angle = i * angleStep - Math.PI / 2;
              return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            })
            .join(' ');

          return (
            <Polygon
              key={lvlIdx}
              points={ringPts}
              fill="none"
              stroke="#334155"
              strokeWidth="1"
              strokeDasharray={lvlIdx < 2 ? '3,3' : undefined}
              strokeOpacity="0.7"
            />
          );
        })}

        {/* Radial Axes Lines */}
        {data.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x2 = center + radius * Math.cos(angle);
          const y2 = center + radius * Math.sin(angle);
          return (
            <Line
              key={i}
              x1={center}
              y1={center}
              x2={x2}
              y2={y2}
              stroke="#334155"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
          );
        })}

        {/* Target Polygon Overlay */}
        {hasTargets && (
          <Polygon
            points={targetPointsStr}
            fill={targetColor}
            fillOpacity="0.12"
            stroke={targetColor}
            strokeWidth="1.5"
            strokeDasharray="4,4"
          />
        )}

        {/* Completed Polygon */}
        <Polygon
          points={completedPointsStr}
          fill={completedColor}
          fillOpacity="0.3"
          stroke={completedColor}
          strokeWidth="2.5"
        />

        {/* Vertices & Data Points */}
        {completedPoints.map((pt, i) => (
          <Circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r="4"
            fill={completedColor}
            stroke="#0f172a"
            strokeWidth="1.5"
          />
        ))}

        {/* Muscle Group Labels */}
        {data.map((d, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const labelRadius = radius + (numAxes > 8 ? 12 : 22);
          const lx = center + labelRadius * cos;
          const ly = center + labelRadius * sin;
          const textAnchor =
            numAxes > 8
              ? cos > 0.2
                ? 'start'
                : cos < -0.2
                ? 'end'
                : 'middle'
              : 'middle';
          const dy = numAxes > 8 ? (sin > 0.65 ? 8 : sin < -0.65 ? -1 : 3) : 4;

          return (
            <SvgText
              key={`label-${i}`}
              x={lx}
              y={ly + dy}
              fill="#cbd5e1"
              fontSize={numAxes > 8 ? '9' : '10'}
              fontWeight="bold"
              textAnchor={textAnchor}
            >
              {formatAxisLabel(d.label, numAxes)}
            </SvgText>
          );
        })}
      </Svg>

      {/* Legend */}
      <View className="flex-row items-center justify-center gap-4 mt-2 pt-2 border-t border-slate-800/80 w-full">
        <View className="flex-row items-center">
          <View className="w-3 h-3 rounded-full bg-indigo-400 mr-1.5" />
          <Text className="text-slate-300 text-xs font-semibold">Completed Volume</Text>
        </View>
        {hasTargets && (
          <View className="flex-row items-center">
            <View className="w-3 h-3 rounded-full bg-emerald-400 mr-1.5" />
            <Text className="text-slate-300 text-xs font-semibold">{targetLegendLabel}</Text>
          </View>
        )}
      </View>
    </View>
  );
};
