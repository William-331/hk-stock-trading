import { useId } from 'react';
import type { ValuationRangeResponse } from '../api';

interface ValuationRangeChartProps {
  data?: ValuationRangeResponse | null;
  loading?: boolean;
  error?: string | null;
}

type ChartPoint = {
  date: string;
  day: number;
  neutral: number;
  optimistic: number;
  conservative: number;
};

const WIDTH = 760;
const HEIGHT = 360;
const MARGIN = { top: 24, right: 66, bottom: 48, left: 58 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
  return Number.isFinite(day) ? day : null;
}

function numeric(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function formatDate(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function formatValue(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function StatePanel({ children }: { children: string }) {
  return (
    <div className="flex h-[360px] items-center justify-center bg-gray-50 px-6 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}

export default function ValuationRangeChart({
  data,
  loading = false,
  error = null,
}: ValuationRangeChartProps) {
  const titleId = useId();
  const descriptionId = useId();

  if (loading) {
    return (
      <section className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white" aria-busy="true">
        <StatePanel>估值区间加载中…</StatePanel>
      </section>
    );
  }

  if (error) {
    return (
      <section className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white" role="status">
        <StatePanel>{error || '估值区间加载失败'}</StatePanel>
      </section>
    );
  }

  const response = (data ?? {}) as unknown as Record<string, unknown>;
  const rawPoints = Array.isArray(response.points) ? response.points : [];
  const points: ChartPoint[] = rawPoints
    .map((raw): ChartPoint | null => {
      const point = raw as Record<string, unknown>;
      const date = typeof point.date === 'string' ? point.date : '';
      const day = dayNumber(date);
      const neutral = numeric(point, 'neutral');
      const optimistic = numeric(point, 'optimistic', 'upper');
      const conservative = numeric(point, 'conservative', 'lower');
      if (day === null || neutral === null || optimistic === null || conservative === null) return null;
      return { date, day, neutral, optimistic, conservative };
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.day - b.day);

  if (!data || points.length === 0) {
    return (
      <section className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
        <StatePanel>暂无估值区间数据</StatePanel>
      </section>
    );
  }

  const windowRecord = response.window && typeof response.window === 'object'
    ? response.window as Record<string, unknown>
    : {};
  const declaredEnd = dayNumber(windowRecord.endDate ?? response.endDate);
  const endDay = declaredEnd ?? points[points.length - 1].day;
  const declaredStart = dayNumber(windowRecord.startDate ?? response.startDate);
  const startDay = declaredStart !== null && declaredStart < endDay
    ? declaredStart
    : endDay - 29;
  const visiblePoints = points.filter(point => point.day >= startDay && point.day <= endDay);
  const sigmaSampleCount = numeric(response, 'sigmaSampleCount', 'sampleCount') ?? 0;
  const hasSigma = sigmaSampleCount >= 2;

  const plottedValues = visiblePoints.flatMap(point => hasSigma
    ? [point.neutral, point.optimistic, point.conservative]
    : [point.neutral]);
  const rawMin = Math.min(...plottedValues);
  const rawMax = Math.max(...plottedValues);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.015, 0.5);
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;

  const x = (day: number) => MARGIN.left + ((day - startDay) / Math.max(endDay - startDay, 1)) * PLOT_WIDTH;
  const y = (value: number) => MARGIN.top + ((yMax - value) / Math.max(yMax - yMin, 1)) * PLOT_HEIGHT;

  const segments: ChartPoint[][] = [];
  for (const point of visiblePoints) {
    const current = segments[segments.length - 1];
    if (!current || point.day - current[current.length - 1].day > 1) segments.push([point]);
    else current.push(point);
  }

  const linePath = (segment: ChartPoint[], key: 'neutral' | 'optimistic' | 'conservative') =>
    segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.day).toFixed(2)} ${y(point[key]).toFixed(2)}`).join(' ');
  const bandPath = (segment: ChartPoint[]) => {
    const upper = segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.day).toFixed(2)} ${y(point.optimistic).toFixed(2)}`);
    const lower = [...segment].reverse().map(point => `L ${x(point.day).toFixed(2)} ${y(point.conservative).toFixed(2)}`);
    return [...upper, ...lower, 'Z'].join(' ');
  };

  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTicks = Array.from({ length: 5 }, (_, index) => Math.round(startDay + ((endDay - startDay) * index) / 4));

  return (
    <section className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">近30个自然日估值区间</h3>
          <p className="mt-0.5 text-xs text-gray-400">按自然日间距展示，缺失日期不连线</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="图例">
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#52749b]" />中性估值</span>
          <span className="flex items-center gap-1.5"><i className="w-4 border-t border-dashed border-[#7891ad]" />乐观估值</span>
          <span className="flex items-center gap-1.5"><i className="w-4 border-t border-dashed border-[#9aa8b7]" />保守估值</span>
        </div>
      </div>

      <div className="w-full overflow-hidden px-2 pt-2">
        <svg
          className="block h-auto w-full"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={titleId}>近30个自然日中性估值及乐观、保守估值区间</title>
          <desc id={descriptionId}>横轴为自然日期，纵轴为参考估值；缺失自然日处的曲线与区间带断开。</desc>
          <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_WIDTH} height={PLOT_HEIGHT} fill="#fbfcfd" />

          {yTicks.map(value => (
            <g key={`y-${value}`}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(value)} y2={y(value)} stroke="#e9edf1" strokeWidth="1" />
              <text x={MARGIN.left - 9} y={y(value) + 4} textAnchor="end" fill="#7b8794" fontSize="11">
                {formatValue(value)}
              </text>
            </g>
          ))}
          {xTicks.map(day => (
            <g key={`x-${day}`}>
              <line x1={x(day)} x2={x(day)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="#f0f2f4" strokeWidth="1" />
              <text x={x(day)} y={HEIGHT - MARGIN.bottom + 24} textAnchor="middle" fill="#7b8794" fontSize="11">
                {formatDate(day)}
              </text>
            </g>
          ))}
          <text x="15" y={MARGIN.top + PLOT_HEIGHT / 2} textAnchor="middle" fill="#7b8794" fontSize="11" transform={`rotate(-90 15 ${MARGIN.top + PLOT_HEIGHT / 2})`}>
            参考估值
          </text>

          {hasSigma && segments.map((segment, index) => (
            <path key={`band-${index}`} d={bandPath(segment)} fill="#7891ad" fillOpacity="0.14" />
          ))}
          {hasSigma && segments.map((segment, index) => (
            <g key={`bounds-${index}`}>
              <path d={linePath(segment, 'optimistic')} fill="none" stroke="#7891ad" strokeWidth="1.5" strokeDasharray="6 5" />
              <path d={linePath(segment, 'conservative')} fill="none" stroke="#9aa8b7" strokeWidth="1.5" strokeDasharray="6 5" />
            </g>
          ))}
          {segments.map((segment, index) => (
            <path key={`neutral-${index}`} d={linePath(segment, 'neutral')} fill="none" stroke="#52749b" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {visiblePoints.map(point => (
            <circle key={point.date} cx={x(point.day)} cy={y(point.neutral)} r="3" fill="#ffffff" stroke="#52749b" strokeWidth="2" />
          ))}
        </svg>
      </div>

      {!hasSigma && (
        <p className="mx-4 mb-3 rounded bg-gray-50 px-3 py-2 text-xs text-gray-500" role="status">
          历史样本不足，暂不展示乐观估值与保守估值区间。
        </p>
      )}
      <p className="border-t border-gray-100 px-4 py-3 text-xs leading-5 text-gray-500">
        方法说明：区间反映历史参考估值收益率的 Sigma 离散程度；模型估值误差约为 ±5%，两者含义不同。
      </p>
    </section>
  );
}
