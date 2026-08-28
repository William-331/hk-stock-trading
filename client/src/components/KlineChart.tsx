import { useEffect, useRef, useState } from 'react';
import {
  createChart, IChartApi, ColorType, UTCTimestamp,
  CandlestickData, HistogramData, LineData, Time, LineStyle,
} from 'lightweight-charts';

interface KlineData {
  time_slot: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

type Period = 'intraday' | 'day';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'intraday', label: '分时' },
  { key: 'day', label: '日K' },
];

const pad2 = (x: number) => String(x).padStart(2, '0');

// 生成某日全部交易时间点（HH:MM），与后端 tradingSlots 一致：
// 早盘 9:00-12:00（含12:00），午休 12:00-13:00 休市，午盘 13:00-16:10（含16:10）
function buildDaySlotTimes(): string[] {
  const out: string[] = [];
  for (let h = 9; h < 12; h++) for (let m = 0; m < 60; m += 5) out.push(`${pad2(h)}:${pad2(m)}`);
  out.push('12:00');
  for (let h = 13; h <= 16; h++) {
    const endM = h === 16 ? 15 : 60;
    for (let m = 0; m < endM; m += 5) out.push(`${pad2(h)}:${pad2(m)}`);
  }
  return out;
}

// Client-side SMA
function calcSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(Math.round(sum / period * 100) / 100);
  }
  return result;
}

interface Props {
  data: KlineData[];
  /** 未来计划走势（仅控价图传入做预览，浅色虚线叠加；用户端不传） */
  planData?: KlineData[];
  /** 用户端仅展示日 K；管理员端保留分时切换 */
  showIntraday?: boolean;
}

export default function KlineChart({ data, planData, showIntraday = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [maValues, setMaValues] = useState<{ period: number; value: number; color: string }[]>([]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Destroy previous
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    if (containerRef.current.firstChild) containerRef.current.innerHTML = '';

    const isIntraday = period === 'intraday';

    // Sort & filter — build valid timestamps first
    const parseSeries = (rows: KlineData[]) => rows
      .filter(d => d.open > 0 && d.close > 0 && d.time_slot)
      .map(d => {
        const parts = d.time_slot.split(' ');
        if (parts.length < 2) return { ...d, _ts: NaN };
        const [dp, tp] = parts;
        const [y, m, day] = dp.split('-').map(Number);
        const [h, min] = tp.split(':').map(Number);
        // time_slot is Beijing time; lightweight-charts displays timestamps as-is
        // so we use Date.UTC without TZ offset so the chart shows the correct time
        const ts = Date.UTC(y, m - 1, day, h, min);
        return { ...d, _ts: ts };
      })
      .filter(d => !isNaN(d._ts) && d._ts > 0)
      .sort((a, b) => a._ts - b._ts);

    const sorted = parseSeries(data);

    const toTimestamp = (ts: number): UTCTimestamp => {
      const v = Math.trunc(ts / 1000);
      return v as UTCTimestamp;
    };

    // 分时：只取最近一个交易日的点（固定单日 9:00-16:10 时间轴，午休区间无数据自动断开）
    const lastDate = sorted.length > 0 ? sorted[sorted.length - 1].time_slot.slice(0, 10) : '';
    const intradaySeries = sorted.filter(d => d.time_slot.slice(0, 10) === lastDate);

    // 日K：按日期聚合成每天一根蜡烛（开=当日首点开盘，收=当日末点收盘，高/低=当日极值，量=累加）
    const dayMap = new Map<string, { _ts: number; open: number; high: number; low: number; close: number; volume: number }>();
    for (const d of sorted) {
      const date = d.time_slot.slice(0, 10);
      const cur = dayMap.get(date);
      if (!cur) {
        const [y, m, day] = date.split('-').map(Number);
        dayMap.set(date, {
          _ts: Date.UTC(y, m - 1, day),   // 该日 00:00，作为日K的时间戳
          open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume || 0,
        });
      } else {
        cur.high = Math.max(cur.high, d.high);
        cur.low = Math.min(cur.low, d.low);
        cur.close = d.close;              // sorted 已按时间升序，最后覆盖即当日收盘
        cur.volume += d.volume || 0;
      }
    }
    const daySeries = Array.from(dayMap.values()).sort((a, b) => a._ts - b._ts);

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#666',
        attributionLogo: false, // 关闭右下角 TradingView 水印 logo
      },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      crosshair: { mode: 1 },
      timeScale: {
        borderColor: '#e8e8e8',
        timeVisible: isIntraday,        // 分时显示到分钟，日K只到日期
        secondsVisible: false,
        // 分时：固定左右边界，左端钉死开盘、右端钉死收盘，无法再向左/右滑出
        fixLeftEdge: isIntraday,
        fixRightEdge: isIntraday,
        lockVisibleTimeRangeOnResize: true,
        // 分时：刻度显示「时:分」；日K：显示「年/月/日」（时间戳用 Date.UTC 构造，故用 UTC 取值）
        tickMarkFormatter: (time: UTCTimestamp) => {
          const d = new Date((time as number) * 1000);
          if (isIntraday) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
          return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
        },
      },
      rightPriceScale: { borderColor: '#e8e8e8' },
      // 十字光标浮层的时间
      localization: {
        timeFormatter: (time: UTCTimestamp) => {
          const d = new Date((time as number) * 1000);
          const y = d.getUTCFullYear();
          const m = pad2(d.getUTCMonth() + 1);
          const day = pad2(d.getUTCDate());
          if (isIntraday) return `${y}年${m}月${day}日 ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
          return `${y}年${m}月${day}日`;
        },
      },
    });
    chartRef.current = chart;

    // ---- Volume pane (day only) ----
    if (!isIntraday) {
      const volSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const volumes: HistogramData[] = daySeries.map(d => ({
        time: toTimestamp(d._ts),
        value: d.volume || 0,
        color: d.close >= d.open ? 'rgba(225,82,65,0.4)' : 'rgba(71,178,98,0.4)',
      }));
      volSeries.setData(volumes);
    }

    // ---- Main price pane ----
    if (isIntraday) {
      // 午休断开：上午(≤12:00)和下午(≥13:00)拆成两个独立 area series，
      // 两段之间没有共享数据点，图上自然断开，无需文字标注。
      const areaOpts = {
        lineColor: '#e15241',
        topColor: 'rgba(225,82,65,0.3)',
        bottomColor: 'rgba(225,82,65,0.02)',
        lineWidth: 1 as const,
        priceLineVisible: false,
      };
      const toHM = (d: typeof intradaySeries[number]) => d.time_slot.slice(11);
      const morning = intradaySeries
        .filter(d => toHM(d) <= '12:00')
        .map(d => ({ time: toTimestamp(d._ts), value: d.close }));
      const afternoon = intradaySeries
        .filter(d => toHM(d) >= '13:00')
        .map(d => ({ time: toTimestamp(d._ts), value: d.close }));
      if (morning.length > 0) chart.addAreaSeries(areaOpts).setData(morning);
      if (afternoon.length > 0) chart.addAreaSeries(areaOpts).setData(afternoon);
      setMaValues([]);
    } else {
      // Candlestick — 每日一根
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#e15241',
        downColor: '#47b262',
        borderUpColor: '#e15241',
        borderDownColor: '#47b262',
        wickUpColor: '#e15241',
        wickDownColor: '#47b262',
      });
      const candleData: CandlestickData[] = daySeries.map(d => ({
        time: toTimestamp(d._ts),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      candleSeries.setData(candleData);

      // MA overlays
      if (candleData.length > 0) {
        const closes = candleData.map(c => c.close);
        const mas = [
          { period: 5, color: '#f5a623' },
          { period: 10, color: '#4a90d9' },
          { period: 20, color: '#7b4fbf' },
          { period: 60, color: '#50c878' },
        ];

        const latest: { period: number; value: number; color: string }[] = [];
        for (const ma of mas) {
          if (candleData.length < ma.period) continue;
          const sma = calcSMA(closes, ma.period);
          const maLine = chart.addLineSeries({
            color: ma.color, lineWidth: 1, priceLineVisible: false,
          });
          const maData: LineData[] = [];
          for (let i = 0; i < candleData.length; i++) {
            if (sma[i] !== null) {
              maData.push({ time: candleData[i].time, value: sma[i]! });
            }
          }
          maLine.setData(maData);
          const lastVal = sma[sma.length - 1];
          if (lastVal !== null && lastVal !== undefined) {
            latest.push({ period: ma.period, value: lastVal, color: ma.color });
          }
        }
        setMaValues(latest);
      }
    }

    chart.timeScale().fitContent();

    // ---- 未来计划预览线（仅控价图分时视图）：浅紫虚线，叠加在已发生K线之后 ----
    // 分时固定单日，只预览「最近交易日」尚未到点的计划点；日K为每日聚合，不做分时级预览。
    if (isIntraday && planData && planData.length > 0) {
      const planSorted = parseSeries(planData).filter(d => d.time_slot.slice(0, 10) === lastDate);
      // 只画「尚未进入真实K线」的计划点（已发生的点已由上方主图呈现）
      const existingTs = new Set(intradaySeries.map(d => d._ts));
      const futurePoints = planSorted.filter(d => !existingTs.has(d._ts));
      if (futurePoints.length > 0) {
        // 衔接：把最后一根真实K线的收盘点接到预览线起点，避免断开
        const planLine = chart.addLineSeries({
          color: '#a78bda',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
        });
        const linePoints: LineData[] = [];
        const lastReal = intradaySeries[intradaySeries.length - 1];
        if (lastReal) {
          linePoints.push({ time: toTimestamp(lastReal._ts), value: lastReal.close });
        }
        for (const d of futurePoints) {
          linePoints.push({ time: toTimestamp(d._ts), value: d.close });
        }
        planLine.setData(linePoints);
        chart.timeScale().fitContent();
      }
    }

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, planData, period]);

  if (data.length === 0) {
    return (
      <div className="w-full border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="flex items-center justify-center bg-gray-50 text-gray-400 text-sm" style={{ height: 400 }}>
          暂无 K 线数据，请在后台添加价格
        </div>
      </div>
    );
  }

  return (
    <div className="w-full border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Period tabs */}
      {showIntraday && (
        <div className="flex border-b border-gray-100 bg-gray-50">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                period === p.key
                  ? 'text-red-500 border-b-2 border-red-500 bg-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* MA value banner */}
      {maValues.length > 0 && (
        <div className="flex gap-3 px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 text-[10px]">
          {maValues.map(ma => (
            <span key={ma.period} className="tabular-nums">
              <span className="text-gray-400">MA{ma.period}</span>{' '}
              <span style={{ color: ma.color }} className="font-medium">{ma.value.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}

      {/* 未来计划预览图例（仅控价图分时视图传入 planData 时显示） */}
      {period === 'intraday' && planData && planData.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-50/50 border-b border-purple-100 text-[10px] text-purple-500">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#a78bda]" />
          <span>紫色虚线为未来计划走势预览（尚未到点，到点后自动生效）</span>
        </div>
      )}

      {/* Chart */}
      <div ref={containerRef} />
    </div>
  );
}
