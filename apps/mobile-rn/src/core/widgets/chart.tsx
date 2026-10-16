import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useTheme } from '../theme';
import { Txt } from './kit';

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

/** Arcs of a ring split in parts: each part's length and where it starts, along a circle of `circumference`. */
export function ringArcs(values: number[], circumference: number): { length: number; offset: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  let start = 0;
  return values.map((v) => {
    const length = total > 0 ? (v / total) * circumference : 0;
    const arc = { length, offset: start };
    start += length;
    return arc;
  });
}

/** Progress or split ring (Circle21 refs 04, 19): a grey track, one arc per part from the top, something in the middle. */
export function Ring({ parts, label, size = 112, thickness = 10, children, testID }: { parts: { value: number; color: string }[]; label: string; size?: number; thickness?: number; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arcs = ringArcs(
    parts.map((p) => p.value),
    c,
  );
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceHigh} strokeWidth={thickness} fill="none" />
          {arcs.map((a, i) =>
            a.length > 0 ? <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={parts[i].color} strokeWidth={thickness} fill="none" strokeDasharray={`${a.length} ${c - a.length}`} strokeDashoffset={-a.offset} /> : null,
          )}
        </G>
      </Svg>
      {children}
    </View>
  );
}

/** Every n-th label of an axis, so at most `most` labels are written. */
export const axisStep = (n: number, most = 8) => Math.max(1, Math.ceil(n / most));

/** Vertical bars with their axis under them (Circle21 ref 02); with many bars only every n-th label is written. */
export function BarChart({ data, label, height = 160 }: { data: { key: string; label: string; value: number }[]; label: string; height?: number }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const every = axisStep(data.length);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`} style={{ gap: 6 }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
        {data.map((d) => (
          <View
            key={d.key}
            testID={`bar-${d.key}`}
            accessibilityLabel={`${d.label}: ${d.value}`}
            style={{ flex: 1, maxWidth: 48, height: `${(d.value / max) * 100}%` as `${number}%`, minHeight: d.value > 0 ? 2 : 0, backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
        {data.map((d, i) => (
          <Txt key={d.key} numberOfLines={1} color={colors.outline} style={{ flex: 1, maxWidth: 48, fontSize: 11, textAlign: 'center' }}>
            {i % every === 0 ? d.label : ''}
          </Txt>
        ))}
      </View>
    </View>
  );
}
