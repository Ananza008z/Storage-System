import { useState, useEffect, useCallback } from 'react';
import {
  getDashboardData,
  getBangkokDateString,
  voidOrder,
  formatBaht,
  formatDateTime,
} from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

function shiftBangkokDate(days) {
  const d = new Date(Date.now() + days * 86400000);
  return getBangkokDateString(d);
}

function getBangkokMonthStart() {
  const today = getBangkokDateString();
  return `${today.slice(0, 7)}-01`;
}

export default function Dashboard({ refreshSignal }) {
  const { isOwner } = useAuth();

  const [preset, setPreset] = useState('today');
  const [dateFrom, setDateFrom] = useState(() => getBangkokDateString());
  const [dateTo, setDateTo] = useState(() => getBangkokDateString());
  const [data, setData] = useState({
    summary: null,
    hourly: [],
    topProducts: [],
    orders: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await getDashboardData({ dateFrom, dateTo });
      setData(res);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลยอดขายได้');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load, refreshSignal]);

  const applyPreset = (key) => {
    setPreset(key);
    const today = getBangkokDateString();
    if (key === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (key === 'yesterday') {
      const y = shiftBangkokDate(-1);
      setDateFrom(y);
      setDateTo(y);
    } else if (key === '7d') {
      setDateFrom(shiftBangkokDate(-6));
      setDateTo(today);
    } else if (key === 'month') {
      setDateFrom(getBangkokMonthStart());
      setDateTo(today);
    }
  };

  const handleVoid = async (order) => {
    if (!isOwner || order.status === 'voided') return;
    if (
      !window.confirm(
        `ยืนยันยกเลิกบิล #${order.order_no} (${formatBaht(
          order.total_amount
        )}) และคืนสต็อกสินค้า?`
      )
    ) {
      return;
    }
    setVoiding(true);
    try {
      const updated = await voidOrder(order.id);
      setSelectedOrder(updated);
      load();
    } catch (err) {
      setError(err.message || 'ยกเลิกบิลไม่สำเร็จ');
    } finally {
      setVoiding(false);
    }
  };

  const { summary, hourly, topProducts, orders } = data;
  const maxRevenue = Math.max(...hourly.map((h) => Number(h.revenue || 0)), 1);
  const marginPct =
    summary?.total_revenue > 0
      ? Math.round((summary.total_profit / summary.total_revenue) * 100)
      : 0;

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg flex justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}

      {/* Header + Date Controls */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-800">สรุปยอดขาย & ประวัติบิล</h1>
            {lastRefresh && (
              <p className="text-xs text-gray-400">
                อัปเดตล่าสุด{' '}
                {lastRefresh.toLocaleTimeString('th-TH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs text-green-700 hover:text-green-800 border border-green-200 hover:border-green-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            รีเฟรช
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            ['today', 'วันนี้'],
            ['yesterday', 'เมื่อวาน'],
            ['7d', '7 วันล่าสุด'],
            ['month', 'เดือนนี้'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => applyPreset(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                preset === key
                  ? 'bg-green-700 text-white border-green-700'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPreset('custom');
              setDateFrom(e.target.value);
            }}
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:border-green-600"
          />
          <span className="text-gray-400">ถึง</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPreset('custom');
              setDateTo(e.target.value);
            }}
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:border-green-600"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">รายได้สุทธิ</p>
          <p className="text-xl font-bold text-green-700">
            {formatBaht(summary?.total_revenue || 0)}
          </p>
        </div>

        {isOwner ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">กำไรขั้นต้น</p>
            <p className="text-xl font-bold text-emerald-600">
              {formatBaht(summary?.total_profit || 0)}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">อัตรากำไร {marginPct}%</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">สินค้าที่ขาย</p>
            <p className="text-xl font-bold text-orange-600">
              {summary?.unique_products || 0} รายการ
            </p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">จำนวนบิลขาย</p>
          <p className="text-xl font-bold text-blue-700">
            {summary?.total_orders || 0} บิล
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">จำนวนชิ้นที่ขาย</p>
          <p className="text-xl font-bold text-purple-700">
            {summary?.total_items || 0} ชิ้น
          </p>
          {summary?.low_stock_count > 0 && (
            <p className="text-[11px] text-red-500 mt-0.5">
              สต็อกต่ำ {summary.low_stock_count} รายการ
            </p>
          )}
        </div>
      </div>

      {/* Hourly chart */}
      {hourly.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-medium text-gray-700 mb-4">ยอดขายรายชั่วโมง</p>
          <div className="flex items-end gap-1.5" style={{ height: 100 }}>
            {hourly.map((h) => (
              <div key={h.hour} className="flex flex-col items-center gap-1 flex-1">
                <div
                  className="w-full bg-green-600 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity"
                  style={{
                    height: `${Math.max((h.revenue / maxRevenue) * 80, 4)}px`,
                  }}
                  title={`${h.hour}:00 — ${formatBaht(h.revenue)}`}
                />
                <span className="text-gray-400" style={{ fontSize: 10 }}>
                  {h.hour}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-2 text-right">ชั่วโมง (24h)</p>
        </div>
      )}

      {/* Two columns: Top Products + Receipt History */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Top products */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">สินค้าขายดี (Top 10)</p>
          {topProducts.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">ยังไม่มีข้อมูลในช่วงนี้</p>
          ) : (
            <div className="space-y-2.5">
              {topProducts.map((p, i) => (
                <div key={p.barcode} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 text-right font-medium">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.total_qty} ชิ้น</p>
                  </div>
                  <p className="text-sm font-semibold text-green-700 shrink-0">
                    {formatBaht(p.total_revenue)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Receipt / Order history */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">
            รายการบิลขาย ({orders.length})
          </p>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">
              ยังไม่มีการขายในช่วงนี้
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {orders.map((o) => {
                const isVoid = o.status === 'voided';
                return (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => setSelectedOrder(o)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                      isVoid
                        ? 'bg-red-50/40 border-red-100 opacity-75'
                        : 'bg-gray-50/60 border-gray-100 hover:bg-green-50/50 hover:border-green-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-gray-700">
                          #{o.order_no}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            o.payment_method === 'qr'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {o.payment_method === 'qr' ? 'โอน QR' : 'เงินสด'}
                        </span>
                        {isVoid && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                            ยกเลิกแล้ว
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-sm font-bold shrink-0 ${
                          isVoid ? 'line-through text-red-400' : 'text-green-700'
                        }`}
                      >
                        {formatBaht(o.total_amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
                      <span className="truncate">
                        {o.total_items} ชิ้น • โดย {o.cashier_name || 'พนักงาน'}
                      </span>
                      <span className="shrink-0">{formatDateTime(o.sold_at)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Receipt Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl slide-up max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-800">
                    บิลขาย #{selectedOrder.order_no}
                  </h2>
                  {selectedOrder.status === 'voided' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                      ยกเลิกแล้ว
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDateTime(selectedOrder.sold_at)} • ผู้ขาย:{' '}
                  {selectedOrder.cashier_name || 'พนักงาน'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600 px-2 py-1 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="border-t border-b border-gray-100 py-3 space-y-2 overflow-y-auto flex-1">
              {(selectedOrder.items || []).map((item, idx) => (
                <div
                  key={item.id || `${item.barcode}-${idx}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">
                      {item.qty} x {formatBaht(item.price)}
                    </p>
                  </div>
                  <span className="font-semibold text-gray-800 shrink-0">
                    {formatBaht(Number(item.price) * Number(item.qty))}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-bold text-base">
                <span>ยอดรวม ({selectedOrder.total_items} ชิ้น)</span>
                <span className="text-green-700">
                  {formatBaht(selectedOrder.total_amount)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>วิธีชำระ</span>
                <span>
                  {selectedOrder.payment_method === 'qr' ? 'โอนเงิน / QR' : 'เงินสด'}
                </span>
              </div>
              {selectedOrder.payment_method === 'cash' && (
                <>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>รับเงินมา</span>
                    <span>{formatBaht(selectedOrder.cash_received)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>เงินทอน</span>
                    <span>{formatBaht(selectedOrder.change_given)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              {isOwner && selectedOrder.status !== 'voided' && (
                <button
                  type="button"
                  disabled={voiding}
                  onClick={() => handleVoid(selectedOrder)}
                  className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold disabled:opacity-50"
                >
                  {voiding ? 'กำลังยกเลิก...' : 'ยกเลิกบิลและคืนสต็อก'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
