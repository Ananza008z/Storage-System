import { useState, useRef, useCallback, useEffect } from 'react';
import { lookupBarcode, saveProduct, updateProduct, recordSale, formatBaht } from '../api.js';
import CategorySelect from './CategorySelect.jsx';

export default function Scanner({ cart, setCart }) {
  const [scanning, setScanning]     = useState(false);
  const [camError, setCamError]     = useState('');
  const [activeBarcode, setActiveBarcode] = useState('');
  const [panel, setPanel]           = useState(null);
  const [form, setForm]             = useState({ name: '', price: '', category: '' });
  const [saving, setSaving]         = useState(false);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [manualInput, setManualInput]   = useState('');
  const [lastScanned, setLastScanned]   = useState('');

  const videoRef  = useRef(null);
  const readerRef = useRef(null);
  const cooldown  = useRef(false);
  const buffer    = useRef([]);   // ADD THIS - rolling read buffer

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch {}
      readerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Add or increment item in cart
  const addToCart = useCallback((barcode, product) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.barcode === barcode);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], qty: updated[idx].qty + 1 };
        return updated;
      }
      return [...prev, { barcode, name: product.name, price: product.price, qty: 1 }];
    });
  }, []);

  const handleBarcode = useCallback(async (rawCode) => {
    const code = rawCode.trim().replace(/[^\x20-\x7E]/g, '');
    if (!code || cooldown.current) return;

    // Keep last 5 reads in buffer
    buffer.current = [...buffer.current.slice(-4), code];

    // Count votes
    const votes = {};
    buffer.current.forEach(c => { votes[c] = (votes[c] || 0) + 1; });
    const [winner, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

    // Need 3 matching reads out of last 5 to confirm
    if (count < 3) return;

    // Confirmed — lock and process
    cooldown.current = true;
    buffer.current = [];
    setTimeout(() => { cooldown.current = false; }, 2000);

    setLastScanned(winner);
    setTimeout(() => setLastScanned(''), 1500);

    try {
      const data = await lookupBarcode(winner);
      if (data.found) {
        addToCart(winner, data.product);
      } else {
        stopScanner();
        setActiveBarcode(winner);
        setForm({ name: '', price: '', category: '' });
        setPanel('new');
      }
    } catch (e) {
      setCamError('ไม่สามารถเชื่อมต่อ server ได้');
    }
  }, [addToCart, stopScanner]);

  const startScanner = useCallback(async () => {
    setCamError('');
    setPanel(null);
    setScanning(true);
    try {
      const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import('@zxing/library');

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);

      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (!videoDevices.length) { setCamError('ไม่พบกล้อง'); stopScanner(); return; }

      const back = videoDevices.find(d => /back|rear|environment/i.test(d.label));
      const deviceId = back?.deviceId || videoDevices[0]?.deviceId;

      await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
        if (result) handleBarcode(result.getText());
      });
    } catch (e) {
      setCamError('ไม่สามารถเปิดกล้องได้: ' + (e.message || ''));
      setScanning(false);
    }
  }, [handleBarcode, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const handleManual = (e) => {
    e.preventDefault();
    const val = manualInput.trim();
    if (!val) return;
    setManualInput('');
    handleBarcode(val);
  };

  // Save new product then add to cart
  const handleSaveNew = async () => {
    if (!form.name || !form.price) return;
    setSaving(true);
    try {
      const saved = await saveProduct(activeBarcode, form.name, parseFloat(form.price), form.category);
      addToCart(activeBarcode, saved);
      setPanel(null);
      setActiveBarcode('');
    } catch { setCamError('บันทึกไม่สำเร็จ'); }
    setSaving(false);
  };

  // Edit existing item already in cart
  const handleSaveEdit = async () => {
    if (!form.name || !form.price) return;
    setSaving(true);
    try {
      await updateProduct(activeBarcode, form.name, parseFloat(form.price), form.category);
      setCart(prev => prev.map(i =>
        i.barcode === activeBarcode ? { ...i, name: form.name, price: parseFloat(form.price) } : i
      ));
      setPanel(null);
    } catch { setCamError('แก้ไขไม่สำเร็จ'); }
    setSaving(false);
  };

  const changeQty = (barcode, delta) => {
    setCart(prev => prev
      .map(i => i.barcode === barcode ? { ...i, qty: i.qty + delta } : i)
      .filter(i => i.qty > 0)
    );
  };

  const removeItem = (barcode) => setCart(prev => prev.filter(i => i.barcode !== barcode));

  const openEdit = (item) => {
    stopScanner();
    setActiveBarcode(item.barcode);
    setForm({ name: item.name, price: String(item.price), category: '' });
    setPanel('edit');
  };

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);

  const handleCheckout = async () => {
    if (!cart.length) return;
    setSaving(true);
    try {
      await Promise.all(cart.map(i => recordSale(i.barcode, i.name, i.price, i.qty)));
      setCart([]);
      setCheckoutDone(true);
      setTimeout(() => setCheckoutDone(false), 2500);
    } catch { setCamError('บันทึกการขายไม่สำเร็จ'); }
    setSaving(false);
  };

  return (
    <div className="max-w-md mx-auto px-4 py-4 space-y-3">

      {/* Camera */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
        <div className="relative bg-gray-900" style={{ aspectRatio: '4/3' }}>
          <video ref={videoRef} className="w-full h-full object-cover"
            style={{ display: scanning ? 'block' : 'none' }} playsInline muted />

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-20 h-20 border-2 border-green-700 rounded-xl flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="1.5">
                  <rect x="3" y="3" width="4" height="18" rx="0.5"/><rect x="9" y="3" width="2" height="18" rx="0.5"/>
                  <rect x="13" y="3" width="4" height="18" rx="0.5"/><rect x="19" y="3" width="2" height="12" rx="0.5"/>
                </svg>
              </div>
              <p className="text-gray-400 text-sm">กดปุ่มด้านล่างเพื่อเริ่มสแกน</p>
            </div>
          )}

          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative" style={{ width: '62%', aspectRatio: '3/2' }}>
                <div className="absolute inset-0 border-2 border-green-500 rounded-lg opacity-70" />
                <div className="scan-line absolute left-0 right-0 h-0.5 bg-green-400" />
                {[['top-0 left-0','border-t-2 border-l-2'],['top-0 right-0','border-t-2 border-r-2'],
                  ['bottom-0 left-0','border-b-2 border-l-2'],['bottom-0 right-0','border-b-2 border-r-2']
                ].map(([pos,cls]) => (
                  <div key={pos} className={`absolute ${pos} w-4 h-4 border-green-300 ${cls}`} />
                ))}
              </div>
            </div>
          )}

          {/* Last scanned flash */}
          {lastScanned && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="bg-green-700 text-white text-xs px-3 py-1 rounded-full font-mono">
                ✓ {lastScanned}
              </span>
            </div>
          )}

          {camError && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="text-red-400 text-sm text-center bg-gray-900/80 px-4 py-2 rounded-lg">{camError}</p>
            </div>
          )}
        </div>

        <div className="p-3 flex gap-2">
          <button onClick={scanning ? stopScanner : startScanner}
            className={`flex-1 py-3 rounded-xl font-medium text-white text-sm transition-colors ${
              scanning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-700 hover:bg-green-800'
            }`}>
            {scanning ? 'หยุดสแกน' : 'เปิดกล้องสแกน'}
          </button>
          {cart.length > 0 && (
            <button onClick={() => setCart([])}
              className="px-4 py-3 rounded-xl border border-red-100 text-red-500 text-sm hover:bg-red-50 transition-colors">
              ล้างตะกร้า
            </button>
          )}
        </div>
      </div>

      {/* Manual input */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <p className="text-xs text-gray-400 mb-2">พิมพ์บาร์โค้ดเอง</p>
        <form onSubmit={handleManual} className="flex gap-2">
          <input value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder="กรอกบาร์โค้ด..."
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
          <button type="submit" className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium">ค้นหา</button>
        </form>
      </div>

      {/* New product form */}
      {panel === 'new' && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4 slide-up">
          <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-amber-700 font-mono mb-0.5">{activeBarcode}</p>
            <p className="text-sm text-amber-800">ไม่พบสินค้านี้ กรุณาเพิ่มข้อมูล</p>
          </div>
          <ProductForm form={form} setForm={setForm} onSave={handleSaveNew}
            onCancel={() => { setPanel(null); }} saving={saving} isNew />
        </div>
      )}

      {/* Edit product form */}
      {panel === 'edit' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 slide-up">
          <p className="text-sm font-medium text-gray-700 mb-3">แก้ไขสินค้า</p>
          <ProductForm form={form} setForm={setForm} onSave={handleSaveEdit}
            onCancel={() => setPanel(null)} saving={saving} />
        </div>
      )}

      {/* Cart */}
      {cart.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden slide-up">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">ตะกร้า</p>
            <span className="text-xs text-gray-400">{totalQty} ชิ้น</span>
          </div>

          <div className="divide-y divide-gray-50">
            {cart.map(item => (
              <div key={item.barcode} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">{formatBaht(item.price)} / ชิ้น</p>
                </div>

                {/* Qty controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => changeQty(item.barcode, -1)}
                    className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm font-medium flex items-center justify-center">
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{item.qty}</span>
                  <button onClick={() => changeQty(item.barcode, 1)}
                    className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm font-medium flex items-center justify-center">
                    +
                  </button>
                </div>

                <p className="text-sm font-semibold text-green-700 w-16 text-right shrink-0">
                  {formatBaht(item.price * item.qty)}
                </p>

                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(item)}
                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
                    ✎
                  </button>
                  <button onClick={() => removeItem(item.barcode)}
                    className="text-xs px-2 py-1 rounded border border-red-100 text-red-300 hover:text-red-500 hover:bg-red-50">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Total + checkout */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-600">ยอดรวม</span>
              <span className="text-2xl font-bold text-green-700">{formatBaht(total)}</span>
            </div>
            {checkoutDone ? (
              <div className="w-full py-3 rounded-xl bg-green-50 text-green-700 text-sm font-medium text-center">
                ✓ บันทึกการขายแล้ว
              </div>
            ) : (
              <button onClick={handleCheckout} disabled={saving}
                className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-60 transition-colors">
                {saving ? 'กำลังบันทึก...' : `ชำระเงิน ${formatBaht(total)}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductForm({ form, setForm, onSave, onCancel, saving, isNew }) {
  const valid = form.name.trim() && form.price;
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">ชื่อสินค้า *</label>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="ชื่อสินค้าภาษาไทย..."
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">ราคา (บาท) *</label>
        <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
          placeholder="0.00" step="0.01"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">หมวดหมู่</label>
        <CategorySelect value={form.category} onChange={val => setForm(f => ({ ...f, category: val }))} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">ยกเลิก</button>
        <button onClick={onSave} disabled={!valid || saving}
          className="flex-[2] py-2.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-40">
          {saving ? 'กำลังบันทึก...' : isNew ? 'เพิ่มและใส่ตะกร้า' : 'บันทึก'}
        </button>
      </div>
    </div>
  );
}