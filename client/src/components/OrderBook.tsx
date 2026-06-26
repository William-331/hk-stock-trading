// ---------- helpers ----------
function fmtVol(v: number): string {
  if (!v || v <= 0) return '-';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return v.toLocaleString();
}

function fmtPrc(v: number): string {
  if (!v || v <= 0) return '--';
  return v >= 500 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3);
}

// ================================================================
interface LevelData {
  price: number;
  volume: number;
}

interface Props {
  buyLevels: LevelData[];
  sellLevels: LevelData[];
  prevClose: number;
}

export default function OrderBook({ buyLevels, sellLevels, prevClose }: Props) {
  const hasData = buyLevels.length > 0 || sellLevels.length > 0;
  if (!hasData) {
    return (
      <div className="py-8 text-center text-xs text-gray-400">暂无盘口数据</div>
    );
  }

  const maxVol = Math.max(
    ...sellLevels.map(l => l.volume),
    ...buyLevels.map(l => l.volume),
    1,
  );

  return (
    <div className="text-[11px]">
      {/* ---- Sell levels (高 → 低, 卖N 在最上, 卖1 在最下) ---- */}
      {sellLevels.slice().reverse().map((lvl, i) => {
        const idx = sellLevels.length - i;
        const isUp = lvl.price >= prevClose;
        const priceCls = isUp ? 'text-[#e15241]' : 'text-[#47b262]';
        const barW = Math.max(4, Math.round((lvl.volume / maxVol) * 80));

        return (
          <div key={`s${idx}`} className="flex items-center px-3 py-1 gap-2 border-b border-gray-50">
            <span className="w-7 text-gray-400 text-[10px] shrink-0">卖{idx}</span>
            <span className={`flex-1 text-right font-medium tabular-nums ${priceCls}`}>
              {fmtPrc(lvl.price)}
            </span>
            <span className="w-16 text-right text-gray-500 tabular-nums shrink-0">
              {fmtVol(lvl.volume)}
            </span>
            <span className="w-20 shrink-0">
              <span
                className="block h-3 rounded-sm opacity-25"
                style={{
                  width: `${barW}%`,
                  backgroundColor: isUp ? '#e15241' : '#47b262',
                }}
              />
            </span>
          </div>
        );
      })}

      {/* ---- Separator ---- */}
      <div className="border-b-2 border-gray-200" />

      {/* ---- Buy levels (1 → 5) ---- */}
      {buyLevels.map((lvl, i) => {
        const idx = i + 1;
        const isUp = lvl.price >= prevClose;
        const priceCls = isUp ? 'text-[#e15241]' : 'text-[#47b262]';
        const barW = Math.max(4, Math.round((lvl.volume / maxVol) * 80));

        return (
          <div key={`b${idx}`} className="flex items-center px-3 py-1 gap-2 border-b border-gray-50">
            <span className="w-7 text-gray-400 text-[10px] shrink-0">买{idx}</span>
            <span className={`flex-1 text-right font-medium tabular-nums ${priceCls}`}>
              {fmtPrc(lvl.price)}
            </span>
            <span className="w-16 text-right text-gray-500 tabular-nums shrink-0">
              {fmtVol(lvl.volume)}
            </span>
            <span className="w-20 shrink-0">
              <span
                className="block h-3 rounded-sm opacity-25"
                style={{
                  width: `${barW}%`,
                  backgroundColor: isUp ? '#e15241' : '#47b262',
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
