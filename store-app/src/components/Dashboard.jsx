import { useState, useEffect, useCallback } from 'react';
import { getSummary, getTopProducts, getHourlySales, getTodaySales, formatBaht } from '../api.js';

export default function Dashboard() {
  const [summary, setSummary]   = useState(null);
  const [top, setTop]           = useState([]);
  const [hourly, setHourly]     = useState([]);
  const [sales, setSales]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, t, h, sl] = await Promise.all([
        getSummary(), getTopProducts(), getHourlySales(), getTodaySales()
      ]);
      setSummary(s);
      setTop(t);
      setHourly(h);
      setSales(sl);
      setLastRefresh(new Date());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const today = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Build 24-hour chart
  const hourMap = {};
  hourly.forEach(h => { hourMap[parseInt(h.hour)] = parseFloat(h.revenue); });
  const activeHours = Object.entries(hourMap);
  const maxRevenue  = Math.max(...Object.values(hourMap), 1);

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full spin" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">ยอดขายวันนี้</h1>
          <p className="text-sm text-gray-400">{today}</p>
        </div>
        <div className="text-right">
          <button
            onClick={load}
            className="text-xs text-green-700 hover:text-green-800 border border-green-200 hover:border-green-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            รีเฟรช
          </button>
          {lastRefresh && (
            <p className="text-xs text-gray-300 mt-1">
              อัปเดต {lastRefresh.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'รายได้รวม', value: formatBaht(summary?.total_revenue || 0), color: 'text-green-700' },
          { label: 'รายการขาย', value: `${summary?.total_transactions || 0} ครั้ง`, color: 'text-blue-700' },
          { label: 'จำนวนชิ้น', value: `${summary?.total_items || 0} ชิ้น`, color: 'text-purple-700' },
          { label: 'ประเภทสินค้า', value: `${summary?.unique_products || 0} รายการ`, color: 'text-orange-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Hourly chart */}
      {activeHours.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-medium text-gray-700 mb-4">ยอดขายรายชั่วโมง</p>
          <div className="flex items-end gap-1.5" style={{ height: 100 }}>
            {activeHours.map(([h, v]) => (
              <div key={h} className="flex flex-col items-center gap-1 flex-1">
                <div
                  className="w-full bg-green-600 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity"
                  style={{ height: `${Math.max((v / maxRevenue) * 80, 4)}px` }}
                  title={`${h}:00 — ${formatBaht(v)}`}
                />
                <span className="text-xs text-gray-400" style={{ fontSize: 10 }}>{h}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-2 text-right">ชั่วโมง (24h)</p>
        </div>
      )}

      {/* Two columns: top products + recent sales */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* Top products */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">สินค้าขายดีวันนี้</p>
          {top.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-6">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-2">
              {top.map((p, i) => (
                <div key={p.barcode} className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.total_qty} ชิ้น</p>
                  </div>
                  <p className="text-sm font-semibold text-green-700 shrink-0">{formatBaht(p.total_revenue)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">การขายล่าสุด</p>
          {sales.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-6">ยังไม่มีการขายวันนี้</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {[...sales].slice(0, 30).map((s, i) => (
                <div key={i} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-300 shrink-0 w-10">
                    {new Date(s.sold_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="flex-1 text-sm text-gray-700 truncate">{s.name}</p>
                  <p className="text-sm font-medium text-green-700 shrink-0">{formatBaht(s.price)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
