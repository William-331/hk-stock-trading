import { useEffect, useRef, useState } from 'react';
import {
  createChart, IChartApi, ColorType, UTCTimestamp,
  CandlestickData, HistogramData, LineData, Time,
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
}

export default function KlineChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [period, setPeriod] = useState<Period>('intraday');
  const [maValues, setMaValues] = useState<{ period: number; value: number; color: string }[]>([]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Destroy previous
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    if (containerRef.current.firstChild) containerRef.current.innerHTML = '';

    const isIntraday = period === 'intraday';

    // Sort & filter — build valid timestamps first
    const sorted = data
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

    const toTimestamp = (ts: number): UTCTimestamp => {
      const v = Math.trunc(ts / 1000);
      return v as UTCTimestamp;
    };

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#666' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      crosshair: { mode: 1 },
      timeScale: { borderColor: '#e8e8e8', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#e8e8e8' },
    });
    chartRef.current = chart;

    // ---- Volume pane (day only) ----
    if (!isIntraday) {
      const volSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const volumes: HistogramData[] = sorted.map(d => ({
        time: toTimestamp(d._ts),
        value: d.volume || 0,
        color: d.close >= d.open ? 'rgba(225,82,65,0.4)' : 'rgba(71,178,98,0.4)',
      }));
      volSeries.setData(volumes);
    }

    // ---- Main price pane ----
    if (isIntraday) {
      const areaSeries = chart.addAreaSeries({
        lineColor: '#e15241',
        topColor: 'rgba(225,82,65,0.3)',
        bottomColor: 'rgba(225,82,65,0.02)',
        lineWidth: 1,
        priceLineVisible: false,
      });
      areaSeries.setData(sorted.map(d => ({
        time: toTimestamp(d._ts),
        value: d.close,
      })));
      setMaValues([]);
    } else {
      // Candlestick
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#e15241',
        downColor: '#47b262',
        borderUpColor: '#e15241',
        borderDownColor: '#47b262',
        wickUpColor: '#e15241',
        wickDownColor: '#47b262',
      });
      const candleData: CandlestickData[] = sorted.map(d => ({
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

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, period]);

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

      {/* Chart */}
      <div ref={containerRef} />
    </div>
  );
}
