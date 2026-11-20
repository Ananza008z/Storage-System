import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  lookupBarcode,
  getAllProducts,
  saveProduct,
  updateProduct,
  createOrder,
  formatBaht,
  playBeep,
} from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import CategorySelect from './CategorySelect.jsx';

const QUICK_BARCODES = ['1', '2', '3', '4', '5'];

export default function Scanner({ cart, setCart, onOrderCompleted }) {
  const { profile, isOwner } = useAuth();

  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState('');
  const [activeBarcode, setActiveBarcode] = useState('');
  const [panel, setPanel] = useState(null); // 'new' | 'edit' | null
  const [form, setForm] = useState({
    name: '',
    price: '',
    cost_price: '',
    stock_qty: '24',
    low_stock_threshold: '5',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [products, setProducts] = useState([]);

  // Checkout state
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [lastReceipt, setLastReceipt] = useState(null);

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const cooldown = useRef(false);
  const buffer = useRef([]);

  const loadCatalog = useCallback(async () => {
    try {
      const list = await getAllProducts();
      setProducts(list);
    } catch {
      // Ignore silent preload failures
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {}
      readerRef.current = null;
    }
    setScanning(false);
  }, []);

  const addToCart = useCallback(
    (barcode, product) => {
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.barcode === barcode);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            name: product.name,
            price: Number(product.price),
            cost_price: Number(product.cost_price ?? 0),
            stock_qty: Number(product.stock_qty ?? 0),
            qty: updated[idx].qty + 1,
          };
          return updated;
        }
        return [
          ...prev,
          {
            barcode,
            name: product.name,
            price: Number(product.price),
            cost_price: Number(product.cost_price ?? 0),
            stock_qty: Number(product.stock_qty ?? 0),
            qty: 1,
          },
        ];
      });
    },
    [setCart]
  );

  // Direct lookup (used by manual input, quick chips, and confirmed camera scan)
  const processBarcode = useCallback(
    async (rawCode) => {
      const code = String(rawCode || '')
        .trim()
        .replace(/[^\x20-\x7E]/g, '');
      if (!code) return;

      setCamError('');
      setLastReceipt(null);
      setLastScanned(code);
      setTimeout(() => setLastScanned(''), 1500);

      try {
        const data = await lookupBarcode(code);
        if (data.found) {
          playBeep('success');
          if (navigator.vibrate) navigator.vibrate(70);
          addToCart(code, data.product);
        } else {
          playBeep('error');
          stopScanner();
          setActiveBarcode(code);
          setForm({
            name: '',
            price: '',
            cost_price: '',
            stock_qty: '24',
            low_stock_threshold: '5',
            category: '',
          });
          setPanel('new');
        }
      } catch (err) {
        setCamError(err.message || 'ไม่สามารถค้นหาสินค้าได้');
      }
    },
    [addToCart, stopScanner]
  );

  // Camera voting buffer: 3 matching reads out of last 5 frames
  const handleCameraFrame = useCallback(
    (rawCode) => {
      const code = String(rawCode || '')
        .trim()
        .replace(/[^\x20-\x7E]/g, '');
      if (!code || cooldown.current) return;

      buffer.current = [...buffer.current.slice(-4), code];
      const votes = {};
      buffer.current.forEach((c) => {
        votes[c] = (votes[c] || 0) + 1;
      });
      const [winner, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      if (count < 3) return;

      cooldown.current = true;
      buffer.current = [];
      setTimeout(() => {
        cooldown.current = false;
      }, 1800);

      processBarcode(winner);
    },
    [processBarcode]
  );

  const startScanner = useCallback(async () => {
    setCamError('');
    setPanel(null);
    setScanning(true);
    try {
      const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import(
        '@zxing/library'
      );

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);

      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      stream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      if (!videoDevices.length) {
        setCamError('ไม่พบกล้องบนอุปกรณ์นี้');
        stopScanner();
        return;
      }

      const back = videoDevices.find((d) => /back|rear|environment/i.test(d.label));
      const deviceId = back?.deviceId || videoDevices[0]?.deviceId;

      await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
        if (result) handleCameraFrame(result.getText());
      });
    } catch (e) {
      setCamError('ไม่สามารถเปิดกล้องได้: ' + (e.message || ''));
      setScanning(false);
    }
  }, [handleCameraFrame, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const suggestions = useMemo(() => {
    const q = manualInput.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [manualInput, products]);

  const quickPickItems = useMemo(
    () =>
      QUICK_BARCODES.map((code) => products.find((p) => p.barcode === code)).filter(
        Boolean
      ),
    [products]
  );

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const val = manualInput.trim();
    if (!val) return;
    setManualInput('');

    const exact = products.find((p) => p.barcode === val);
    if (exact) {
      playBeep('success');
      addToCart(exact.barcode, exact);
      return;
    }
    if (suggestions.length === 1 && !/^\d+$/.test(val)) {
      playBeep('success');
      addToCart(suggestions[0].barcode, suggestions[0]);
      return;
    }
    processBarcode(val);
  };

  const handlePickSuggestion = (product) => {
    playBeep('success');
    setManualInput('');
    setLastReceipt(null);
    addToCart(product.barcode, product);
  };

  const handleSaveNew = async () => {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    try {
      const priceNum = parseFloat(form.price);
      const costNum =
        form.cost_price !== ''
          ? parseFloat(form.cost_price)
          : Math.round(priceNum * 0.75 * 100) / 100;
      const saved = await saveProduct({
        barcode: activeBarcode,
        name: form.name.trim(),
        price: priceNum,
        cost_price: costNum,
        stock_qty: parseInt(form.stock_qty || '0', 10),
        low_stock_threshold: parseInt(form.low_stock_threshold || '5', 10),
        category: form.category,
      });
      addToCart(activeBarcode, saved);
      setPanel(null);
      setActiveBarcode('');
      loadCatalog();
    } catch (err) {
      setCamError(err.message || 'บันทึกสินค้าไม่สำเร็จ');
    }
    setSaving(false);
  };

  const openEdit = async (item) => {
    stopScanner();
    setActiveBarcode(item.barcode);
    // Load full product record so category, cost_price, stock_qty are preserved
    let full = products.find((p) => p.barcode === item.barcode);
    if (!full) {
      try {
        const res = await lookupBarcode(item.barcode);
        if (res.found) full = res.product;
      } catch {}
    }
    setForm({
      name: full?.name ?? item.name,
      price: String(full?.price ?? item.price),
      cost_price: String(full?.cost_price ?? item.cost_price ?? 0),
      stock_qty: String(full?.stock_qty ?? item.stock_qty ?? 0),
      low_stock_threshold: String(full?.low_stock_threshold ?? 5),
      category: full?.category ?? '',
    });
    setPanel('edit');
  };

  const handleSaveEdit = async () => {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    try {
      const updated = await updateProduct(activeBarcode, {
        name: form.name.trim(),
        price: parseFloat(form.price),
        cost_price: parseFloat(form.cost_price || '0'),
        stock_qty: parseInt(form.stock_qty || '0', 10),
        low_stock_threshold: parseInt(form.low_stock_threshold || '5', 10),
        category: form.category,
      });
      setCart((prev) =>
        prev.map((i) =>
          i.barcode === activeBarcode
            ? {
                ...i,
                name: updated.name,
                price: updated.price,
                cost_price: updated.cost_price,
                stock_qty: updated.stock_qty,
              }
            : i
        )
      );
      setPanel(null);
      loadCatalog();
    } catch (err) {
      setCamError(err.message || 'แก้ไขสินค้าไม่สำเร็จ');
    }
    setSaving(false);
  };

  const changeQty = (barcode, delta) => {
    setCart((prev) =>
      prev
        .map((i) => (i.barcode === barcode ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const removeItem = (barcode) =>
    setCart((prev) => prev.filter((i) => i.barcode !== barcode));

  const total = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0);
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const receivedNum = cashReceived === '' ? total : parseFloat(cashReceived) || 0;
  const changeDue = paymentMethod === 'cash' ? receivedNum - total : 0;
  const cashInsufficient =
    paymentMethod === 'cash' && cashReceived !== '' && receivedNum < total;

  const handleCheckout = async () => {
    if (!cart.length || cashInsufficient) return;
    setSaving(true);
    setCamError('');
    try {
      const order = await createOrder({
        items: cart,
        paymentMethod,
        cashReceived: paymentMethod === 'cash' ? receivedNum : total,
        cashier: profile,
      });
      playBeep('success');
      setCart([]);
      setCashReceived('');
      setLastReceipt(order);
      loadCatalog();
      if (onOrderCompleted) onOrderCompleted();
      setTimeout(() => setLastReceipt(null), 6000);
    } catch (err) {
      setCamError(err.message || 'บันทึกการขายไม่สำเร็จ');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-md mx-auto px-4 py-4 space-y-3">
      {/* Camera Box */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
        <div className="relative bg-gray-900" style={{ aspectRatio: '4/3' }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={{ display: scanning ? 'block' : 'none' }}
            playsInline
            muted
          />

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-20 h-20 border-2 border-green-700 rounded-xl flex items-center justify-center">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#15803d"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="3" width="4" height="18" rx="0.5" />
                  <rect x="9" y="3" width="2" height="18" rx="0.5" />
                  <rect x="13" y="3" width="4" height="18" rx="0.5" />
                  <rect x="19" y="3" width="2" height="12" rx="0.5" />
                </svg>
              </div>
              <p className="text-gray-400 text-sm">กดปุ่มด้านล่างเพื่อเริ่มสแกน</p>
            </div>
          )}

          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative" style={{ width: '66%', aspectRatio: '3/2' }}>
                <div className="absolute inset-0 border-2 border-green-500 rounded-lg opacity-70" />
                <div className="scan-line absolute left-0 right-0 h-0.5 bg-green-400" />
                {[
                  ['top-0 left-0', 'border-t-2 border-l-2'],
                  ['top-0 right-0', 'border-t-2 border-r-2'],
                  ['bottom-0 left-0', 'border-b-2 border-l-2'],
                  ['bottom-0 right-0', 'border-b-2 border-r-2'],
                ].map(([pos, cls]) => (
                  <div
                    key={pos}
                    className={`absolute ${pos} w-4 h-4 border-green-300 ${cls}`}
                  />
                ))}
              </div>
            </div>
          )}

          {lastScanned && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="bg-green-700 text-white text-xs px-3 py-1 rounded-full font-mono shadow">
                ✓ {lastScanned}
              </span>
            </div>
          )}

          {camError && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="text-red-300 text-sm text-center bg-gray-900/90 px-4 py-2.5 rounded-xl border border-red-500/40">
                {camError}
              </p>
            </div>
          )}
        </div>

        <div className="p-3 flex gap-2">
          <button
            type="button"
            onClick={scanning ? stopScanner : startScanner}
            className={`flex-1 py-3 rounded-xl font-medium text-white text-sm transition-colors ${
              scanning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-700 hover:bg-green-800'
            }`}
          >
            {scanning ? 'หยุดสแกน' : 'เปิดกล้องสแกน'}
          </button>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCart([]);
                setCashReceived('');
              }}
              className="px-4 py-3 rounded-xl border border-red-100 text-red-500 text-sm hover:bg-red-50 transition-colors"
            >
              ล้างตะกร้า
            </button>
          )}
        </div>
      </div>

      {/* Receipt Confirmation Banner */}
      {lastReceipt && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 slide-up flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-green-800">
              ✓ บันทึกบิล #{lastReceipt.order_no} เรียบร้อย
            </p>
            <p className="text-xs text-green-700 mt-0.5">
              ยอดสุทธิ {formatBaht(lastReceipt.total_amount)} (
              {lastReceipt.payment_method === 'qr' ? 'โอน QR' : 'เงินสด'})
              {lastReceipt.payment_method === 'cash' && lastReceipt.change_given > 0
                ? ` • เงินทอน ${formatBaht(lastReceipt.change_given)}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLastReceipt(null)}
            className="text-xs text-green-700 px-2 py-1"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Manual Barcode & Smart Name Search */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-2.5">
        <p className="text-xs text-gray-400">พิมพ์บาร์โค้ด หรือค้นหาชื่อสินค้า</p>
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="สแกน/พิมพ์บาร์โค้ด หรือชื่อสินค้า..."
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium"
          >
            เพิ่ม
          </button>
        </form>

        {/* Live Search Suggestions */}
        {suggestions.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 bg-gray-50/70">
            {suggestions.map((p) => (
              <button
                type="button"
                key={p.barcode}
                onClick={() => handlePickSuggestion(p)}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-green-50 transition-colors"
              >
                <div className="min-w-0 pr-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-400 font-mono">
                    {p.barcode} • คงเหลือ {p.stock_qty} ชิ้น
                  </p>
                </div>
                <span className="text-sm font-bold text-green-700 shrink-0">
                  {formatBaht(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Quick-Pick Short Code Buttons (Ice, etc.) */}
        {quickPickItems.length > 0 && (
          <div className="pt-1">
            <p className="text-[11px] text-gray-400 mb-1.5">ปุ่มด่วน (ไม่ต้องสแกน)</p>
            <div className="flex flex-wrap gap-1.5">
              {quickPickItems.map((item) => (
                <button
                  type="button"
                  key={item.barcode}
                  onClick={() => handlePickSuggestion(item)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-800 border border-green-200/60 font-medium transition-colors"
                >
                  + {item.name} ({formatBaht(item.price)})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New product form */}
      {panel === 'new' && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4 slide-up">
          <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-amber-700 font-mono mb-0.5">{activeBarcode}</p>
            <p className="text-sm text-amber-800 font-medium">
              ไม่พบสินค้านี้ในระบบ กรุณาเพิ่มข้อมูล
            </p>
          </div>
          <ProductForm
            form={form}
            setForm={setForm}
            onSave={handleSaveNew}
            onCancel={() => setPanel(null)}
            saving={saving}
            isOwner={isOwner}
            isNew
          />
        </div>
      )}

      {/* Edit product form */}
      {panel === 'edit' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 slide-up">
          <p className="text-sm font-medium text-gray-700 mb-3">
            แก้ไขสินค้า <span className="text-xs font-mono text-gray-400">({activeBarcode})</span>
          </p>
          <ProductForm
            form={form}
            setForm={setForm}
            onSave={handleSaveEdit}
            onCancel={() => setPanel(null)}
            saving={saving}
            isOwner={isOwner}
          />
        </div>
      )}

      {/* Cart */}
      {cart.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden slide-up">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">ตะกร้าสินค้า</p>
            <span className="text-xs text-gray-500">{totalQty} ชิ้น</span>
          </div>

          <div className="divide-y divide-gray-50">
            {cart.map((item) => {
              const overStock = item.stock_qty > 0 && item.qty > item.stock_qty;
              return (
                <div key={item.barcode} className="px-4 py-3 flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">
                      {formatBaht(item.price)} / ชิ้น
                      {overStock && (
                        <span className="ml-1.5 text-amber-600 font-medium">
                          (สต็อกเหลือ {item.stock_qty})
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => changeQty(item.barcode, -1)}
                      className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm font-medium flex items-center justify-center"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
                    <button
                      type="button"
                      onClick={() => changeQty(item.barcode, 1)}
                      className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm font-medium flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>

                  <p className="text-sm font-semibold text-green-700 w-16 text-right shrink-0">
                    {formatBaht(item.price * item.qty)}
                  </p>

                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                      title="แก้ไขสินค้า"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.barcode)}
                      className="text-xs px-2 py-1 rounded border border-red-100 text-red-300 hover:text-red-500 hover:bg-red-50"
                      title="นำออก"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Payment & Change Calculator */}
          <div className="px-4 py-3.5 bg-gray-50 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">ยอดรวมทั้งหมด</span>
              <span className="text-2xl font-bold text-green-700">{formatBaht(total)}</span>
            </div>

            {/* Payment Method Toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  paymentMethod === 'cash'
                    ? 'bg-green-700 text-white border-green-700'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                💵 เงินสด
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('qr')}
                className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  paymentMethod === 'qr'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                📱 โอนเงิน / QR PromptPay
              </button>
            </div>

            {paymentMethod === 'cash' && (
              <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500 shrink-0">รับเงินมา (บาท)</label>
                  <input
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    placeholder={String(total)}
                    className="w-32 px-2.5 py-1.5 rounded-lg border border-gray-200 text-right text-sm font-semibold focus:outline-none focus:border-green-600"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCashReceived(String(total))}
                    className="text-xs px-2.5 py-1 rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium"
                  >
                    พอดี
                  </button>
                  {[20, 50, 100, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashReceived(String(amt))}
                      className="text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium"
                    >
                      ฿{amt.toLocaleString()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <span className="text-xs text-gray-500">เงินทอน</span>
                  {cashInsufficient ? (
                    <span className="text-sm font-bold text-red-600">
                      ขาดอีก {formatBaht(total - receivedNum)}
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-green-700">
                      {formatBaht(Math.max(0, changeDue))}
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={saving || cashInsufficient}
              className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {saving
                ? 'กำลังบันทึกบิล...'
                : `ยืนยันชำระเงิน ${formatBaht(total)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductForm({ form, setForm, onSave, onCancel, saving, isOwner, isNew }) {
  const valid = form.name.trim() && form.price !== '';
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">ชื่อสินค้า *</label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="ชื่อสินค้า..."
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
        />
      </div>

      <div className={`grid gap-2 ${isOwner ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div>
          <label className="text-xs text-gray-500 block mb-1">ราคาขาย (บาท) *</label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="0.00"
            step="0.01"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
          />
        </div>
        {isOwner && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">ราคาทุน (บาท)</label>
            <input
              type="number"
              value={form.cost_price}
              onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
              placeholder="0.00"
              step="0.01"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">จำนวนสต็อก (ชิ้น)</label>
          <input
            type="number"
            value={form.stock_qty}
            onChange={(e) => setForm((f) => ({ ...f, stock_qty: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
          />
        </div>
        {isOwner ? (
          <div>
            <label className="text-xs text-gray-500 block mb-1">เตือนเมื่อเหลือ ≤</label>
            <input
              type="number"
              value={form.low_stock_threshold}
              onChange={(e) =>
                setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
            />
          </div>
        ) : (
          <div>
            <label className="text-xs text-gray-500 block mb-1">หมวดหมู่</label>
            <CategorySelect
              value={form.category}
              onChange={(val) => setForm((f) => ({ ...f, category: val }))}
            />
          </div>
        )}
      </div>

      {isOwner && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">หมวดหมู่</label>
          <CategorySelect
            value={form.category}
            onChange={(val) => setForm((f) => ({ ...f, category: val }))}
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!valid || saving}
          className="flex-[2] py-2.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-40"
        >
          {saving ? 'กำลังบันทึก...' : isNew ? 'เพิ่มและใส่ตะกร้า' : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </div>
  );
}
