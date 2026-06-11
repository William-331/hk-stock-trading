import { useEffect, useRef } from 'react';
import { createChart, ColorType, UTCTimestamp } from 'lightweight-charts';

interface KlineData {
  time_slot: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export default function KlineChart({ data }: { data: KlineData[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    if (containerRef.current.firstChild) containerRef.current.innerHTML = '';

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#666666',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: '#e8e8e8',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#e8e8e8',
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#e15241',
      downColor: '#47b262',
      borderUpColor: '#e15241',
      borderDownColor: '#47b262',
      wickUpColor: '#e15241',
      wickDownColor: '#47b262',
    });

    const chartData = data
      .filter(d => d.open && d.close)
      .map(d => ({
        time: Math.floor(new Date(d.time_slot.replace(' ', 'T') + ':00').getTime() / 1000) as UTCTimestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
      .sort((a, b) => a.time - b.time);

    candleSeries.setData(chartData);

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data]);

  return (
    <div className="w-full border border-gray-200 rounded-lg overflow-hidden">
      {data.length === 0 ? (
        <div className="flex items-center justify-center bg-gray-50 text-gray-400 text-sm" style={{ height: 360 }}>
          暂无 K 线数据，请在后台添加价格
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </div>
  );
}
