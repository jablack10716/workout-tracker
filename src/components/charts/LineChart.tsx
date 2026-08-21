import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Line,
  Circle,
  Text as SvgText,
} from 'react-native-svg';

export interface ChartDataPoint {
  label: string;
  value: number;
  sublabel?: string;
  isPR?: boolean;
}

interface LineChartProps {
  data: ChartDataPoint[];
  title?: string;
  subtitle?: string;
  unit?: string;
  height?: number;
  lineColor?: string;
  areaColor?: string;
  showGrid?: boolean;
  emptyMessage?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  title,
  subtitle,
  unit = 'lbs',
  height = 180,
  lineColor = '#60a5fa', // blue-400
  showGrid = true,
  emptyMessage = 'Not enough data to display progression chart yet.',
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
  const paddingLeft = 36;
  const paddingRight = 18;
  const paddingTop = 20;
  const paddingBottom = 28;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const values = data.map((d) => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // Expand bounds slightly for visual headroom
  const valMargin = Math.max((rawMax - rawMin) * 0.15, 5);
  const yMin = Math.max(0, Math.floor((rawMin - valMargin) / 5) * 5);
  const yMax = Math.ceil((rawMax + valMargin) / 5) * 5;
  const yRange = yMax - yMin === 0 ? 1 : yMax - yMin;

  const points = data.map((d, i) => {
    const x =
      data.length === 1
        ? paddingLeft + innerWidth / 2
        : paddingLeft + (i / (data.length - 1)) * innerWidth;
    const y = paddingTop + innerHeight - ((d.value - yMin) / yRange) * innerHeight;
    return { x, y, data: d, index: i };
  });

  const pathD = points.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
  }, '');

  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const areaD = `${pathD} L ${lastPt.x},${paddingTop + innerHeight} L ${firstPt.x},${paddingTop + innerHeight} Z`;

  const gradId = `line-chart-grad-${Math.random().toString(36).substr(2, 9)}`;

  // 3 horizontal grid lines
  const gridSteps = [0, 0.5, 1];
  const gridLines = gridSteps.map((step) => {
    const val = Math.round(yMin + step * yRange);
    const y = paddingTop + innerHeight - step * innerHeight;
    return { val, y };
  });

  const activePoint = selectedIndex !== null && points[selectedIndex] ? points[selectedIndex] : null;

  return (
    <View className="bg-slate-900/80 p-4 rounded-3xl border border-slate-800/90 shadow-sm">
      {/* Header with Title & Active Value */}
      <View className="flex-row justify-between items-start mb-2 px-1">
        <View className="flex-1 mr-2">
          {title && <Text className="text-white font-bold text-base">{title}</Text>}
          {subtitle && <Text className="text-slate-400 text-xs mt-0.5">{subtitle}</Text>}
        </View>
        {activePoint && (
          <View className="items-end bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
            <Text className="text-white font-black text-sm">
              {activePoint.data.value} {unit}
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold">
              {activePoint.data.label}
              {activePoint.data.sublabel ? ` • ${activePoint.data.sublabel}` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* SVG Canvas */}
      <View className="items-center justify-center">
        <Svg width={chartWidth} height={height}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
              <Stop offset="100%" stopColor={lineColor} stopOpacity={0.0} />
            </LinearGradient>
          </Defs>

          {/* Grid Lines & Y-Axis Labels */}
          {showGrid &&
            gridLines.map((gl, i) => (
              <React.Fragment key={i}>
                <Line
                  x1={paddingLeft}
                  y1={gl.y}
                  x2={chartWidth - paddingRight}
                  y2={gl.y}
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                  strokeOpacity="0.6"
                />
                <SvgText
                  x={paddingLeft - 6}
                  y={gl.y + 3}
                  fill="#64748b"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {gl.val}
                </SvgText>
              </React.Fragment>
            ))}

          {/* Area Fill */}
          <Path d={areaD} fill={`url(#${gradId})`} />

          {/* Line Stroke */}
          <Path
            d={pathD}
            fill="none"
            stroke={lineColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active Vertical Guideline */}
          {activePoint && (
            <Line
              x1={activePoint.x}
              y1={paddingTop}
              x2={activePoint.x}
              y2={paddingTop + innerHeight}
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="3,3"
              strokeOpacity="0.8"
            />
          )}

          {/* Data Points */}
          {points.map((pt, i) => {
            const isSelected = selectedIndex === i;
            return (
              <React.Fragment key={i}>
                {isSelected && (
                  <Circle
                    cx={pt.x}
                    cy={pt.y}
                    r="8"
                    fill={lineColor}
                    fillOpacity="0.25"
                  />
                )}
                <Circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? '5' : '3.5'}
                  fill={pt.data.isPR ? '#f59e0b' : isSelected ? '#ffffff' : lineColor}
                  stroke={isSelected ? lineColor : '#0f172a'}
                  strokeWidth="2"
                />
              </React.Fragment>
            );
          })}

          {/* X-Axis Date Labels */}
          {points.map((pt, i) => {
            // Show first, last, and every few labels depending on point density
            const showLabel =
              points.length <= 6 ||
              i === 0 ||
              i === points.length - 1 ||
              (points.length > 6 && i % Math.ceil(points.length / 4) === 0);

            if (!showLabel) return null;

            return (
              <SvgText
                key={`label-${i}`}
                x={pt.x}
                y={height - 8}
                fill={selectedIndex === i ? '#ffffff' : '#64748b'}
                fontSize="9"
                fontWeight={selectedIndex === i ? 'bold' : 'normal'}
                textAnchor="middle"
              >
                {pt.data.label}
              </SvgText>
            );
          })}
        </Svg>
      </View>

      {/* Interactive Selection Pills */}
      {data.length > 1 && (
        <View className="flex-row justify-center gap-1.5 mt-2 flex-wrap">
          {data.slice(-5).map((d, i) => {
            const originalIndex = data.length - 5 + i >= 0 ? data.length - 5 + i : i;
            const isSelected = selectedIndex === originalIndex;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedIndex(originalIndex)}
                className={`px-2 py-1 rounded-lg border ${
                  isSelected
                    ? 'bg-blue-600/30 border-blue-500/60'
                    : 'bg-slate-800/40 border-slate-700/40'
                }`}
              >
                <Text
                  className={`text-[10px] font-bold ${
                    isSelected ? 'text-blue-300' : 'text-slate-400'
                  }`}
                >
                  {d.label}: {d.value}{unit}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};
