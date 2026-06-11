import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData, Time, ColorType } from 'lightweight-charts';
import { getHKKline, getHKIntraday } from '../api';

type Period = 'intraday' | 'day' | 'week' | 'month';

interface Props {
  code: string;
}

// Client-side SMA calculation
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

const PERIODS: { key: Period; label: string }[] = [
  { key: 'intraday', label: '分时' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
];

export default function HKChart({ code }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [period, setPeriod] = useState<Period>('intraday');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildChart = useCallback((period: Period, rawData: any[]) => {
    const container = containerRef.current;
    if (!container) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    if (container.firstChild) container.innerHTML = '';

    const isIntraday = period === 'intraday';
    const height = 400;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#666' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      crosshair: { mode: 1 },
      timeScale: {
        borderColor: '#e8e8e8',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: '#e8e8e8' },
    });
    chartRef.current = chart;

    // ---- Volume pane (not for intraday) ----
    if (!isIntraday) {
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      const volumes: HistogramData[] = [];
      for (const d of rawData) {
        const v = d.volume || 0;
        const isUp = d.close >= d.open;
        volumes.push({
          time: d.time as Time,
          value: v,
          color: isUp ? 'rgba(225,82,65,0.4)' : 'rgba(71,178,98,0.4)',
        });
      }
      volumeSeries.setData(volumes);
    }

    // ---- Main price pane ----
    if (isIntraday) {
      // Intraday: area line chart
      const lineSeries = chart.addAreaSeries({
        lineColor: '#e15241',
        topColor: 'rgba(225,82,65,0.3)',
        bottomColor: 'rgba(225,82,65,0.02)',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const lineData: LineData[] = [];
      const now = new Date();
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      for (const p of rawData) {
        if (!p.time || p.price <= 0) continue;
        // "0930" → unix timestamp so chart doesn't parse it as year 930
        const hh = parseInt((p.time as string).slice(0, 2), 10);
        const mm = parseInt((p.time as string).slice(2), 10);
        const ts = Math.floor((base.getTime() + (hh * 3600 + mm * 60) * 1000) / 1000) as Time;
        lineData.push({ time: ts, value: p.price });
      }
      lineSeries.setData(lineData);
    } else {
      // K-line: candlestick + MA overlays
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#e15241',
        downColor: '#47b262',
        borderUpColor: '#e15241',
        borderDownColor: '#47b262',
        wickUpColor: '#e15241',
        wickDownColor: '#47b262',
      });

      const candleData: CandlestickData[] = [];
      for (const d of rawData) {
        if (!d.time || d.open <= 0) continue;
        candleData.push({
          time: d.time as Time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        });
      }
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
        for (const ma of mas) {
          if (candleData.length < ma.period) continue;
          const sma = calcSMA(closes, ma.period);
          const maLine = chart.addLineSeries({
            color: ma.color,
            lineWidth: 1,
            priceLineVisible: false,
          });
          const maData: LineData[] = [];
          for (let i = 0; i < candleData.length; i++) {
            if (sma[i] !== null) {
              maData.push({ time: candleData[i].time, value: sma[i]! });
            }
          }
          maLine.setData(maData);
        }
      }
    }

    chart.timeScale().fitContent();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');

    if (period === 'intraday') {
      setLoading(true);
      getHKIntraday(code)
        .then(res => {
          if (cancelled) return;
          const data = res.data;
          if (data?.points?.length) {
            buildChart('intraday', data.points);
          } else {
            setError('暂无分时数据');
          }
        })
        .catch(() => { if (!cancelled) setError('分时数据加载失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setLoading(true);
      getHKKline(code, period)
        .then(res => {
          if (cancelled) return;
          if (res.data?.length > 0) {
            buildChart(period, res.data);
          } else {
            setError('暂无K线数据');
          }
        })
        .catch(() => { if (!cancelled) setError('K线数据加载失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [code, period, buildChart]);

  // Resize handling
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, []);

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

      {/* Chart area */}
      <div className="relative" style={{ height: 400 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <div className="text-gray-400 text-sm">加载中...</div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-gray-400 text-sm">{error}</div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
