import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '../theme';

/** Minimal line chart (Flutter fl_chart LineChart): smooth line, optional dots and area. No axes. */
export function LineChart({ values, height = 120, dots = false, area = false, label }: { values: number[]; height?: number; dots?: boolean; area?: boolean; label?: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  if (values.length < 2) return null;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - 2 * pad), pad + (1 - (v - min) / span) * (height - 2 * pad)] as const);
  // Catmull-Rom → cubic Bézier for a gentle curve through every point.
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return (
    <View accessibilityLabel={label} style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {area && <Path d={`${d} L ${pts[pts.length - 1][0]} ${height} L ${pts[0][0]} ${height} Z`} fill={colors.primary} fillOpacity={0.12} />}
          <Path d={d} stroke={colors.primary} strokeWidth={3} fill="none" />
          {dots && pts.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3.5} fill={colors.primary} />)}
        </Svg>
      )}
    </View>
  );
}
