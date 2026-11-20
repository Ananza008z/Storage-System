import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  lookupBarcode,
  getAllProducts,
  getCategories,
  saveProduct,
  updateProduct,
  createOrder,
  formatBaht,
  playBeep,
} from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import CategorySelect from './CategorySelect.jsx';

const QUICK_BARCODES = ['1', '2', '3', '4', '5'];

export default function Scanner({ cart, setCart, onOrderCompleted, isActiveTab = true }) {
  const { profile, currentStore, isOwner } = useAuth();

  const [scanning, setScanning] = useState(false);
  const [scanEngine, setScanEngine] = useState(''); // 'capacitor' | 'native' | 'zxing'
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
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
  const [hwFlash, setHwFlash] = useState('');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [gridCategory, setGridCategory] = useState('ALL');

  // Checkout state
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [lastReceipt, setLastReceipt] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const videoTrackRef = useRef(null);
  const rafRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const cooldown = useRef(false);
  const buffer = useRef([]);

  // PC Hardware Barcode Scanner (HID Keyboard Wedge) refs
  const manualInputRef = useRef(null);
  const hwBufferRef = useRef('');
  const hwLastKeyTimeRef = useRef(0);
  const hwResetTimerRef = useRef(null);

  const loadCatalog = useCallback(async () => {
    if (!currentStore?.id) return;
    try {
      const [prods, cats] = await Promise.all([getAllProducts(), getCategories()]);
      setProducts(prods);
      setCategories(cats);
    } catch {
      // Ignore silent preload errors
    }
  }, [currentStore?.id]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const stopScanner = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (zxingReaderRef.current) {
      try {
        zxingReaderRef.current.reset();
      } catch {}
      zxingReaderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    videoTrackRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchSupported(false);
    setTorchOn(false);
    setScanning(false);
    setScanEngine('');
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);

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

  // Instant barcode lookup (used by Hardware Gun, Native Detector, Manual, and Quick Chips)
  const processBarcode = useCallback(
    async (rawCode, source = 'manual') => {
      const code = String(rawCode || '')
        .trim()
        .replace(/[^\x20-\x7E]/g, '');
      if (!code) return;

      setCamError('');
      setLastReceipt(null);
      setLastScanned(code);
      setTimeout(() => setLastScanned(''), 1500);

      if (source === 'hardware') {
        setHwFlash(code);
        setTimeout(() => setHwFlash(''), 2200);
      }

      try {
        const data = await lookupBarcode(code);
        if (data.found) {
          playBeep('success');
          if (navigator.vibrate) navigator.vibrate(65);
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

  // Toggle mobile flashlight / torch
  const toggleTorch = async () => {
    const track = videoTrackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Some browsers expose torch capability but disallow changing mid-stream
    }
  };

  // Start Native Hardware BarcodeDetector (60FPS MLKit/Vision) or Capacitor Plugin or ZXing fallback
  const startScanner = useCallback(async () => {
    setCamError('');
    setPanel(null);

    // Engine 1: Capacitor Native Barcode Scanner plugin (if installed inside native APK/IPA)
    const capScanner = window.Capacitor?.Plugins?.BarcodeScanner;
    if (window.Capacitor?.isNativePlatform?.() && capScanner?.scan) {
      setScanEngine('capacitor');
      try {
        const result = await capScanner.scan();
        const code = result?.barcodes?.[0]?.rawValue || result?.content || '';
        if (code) await processBarcode(code, 'native');
        setScanEngine('');
        return;
      } catch {
        // Fall through to WebView hardware BarcodeDetector
      }
    }

    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      videoTrackRef.current = track;

      // Enable continuous autofocus and check torch support
      try {
        const caps = track?.getCapabilities?.() || {};
        setTorchSupported(Boolean(caps.torch));
        if (caps.focusMode?.includes?.('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
      } catch {}

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Engine 2: OS-Native Hardware-Accelerated BarcodeDetector (Android Chrome/WebView + iOS/macOS)
      if ('BarcodeDetector' in window) {
        let formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'];
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const filtered = formats.filter((f) => supported.includes(f));
          if (filtered.length > 0) formats = filtered;
        } catch {}

        const detector = new window.BarcodeDetector({ formats });
        setScanEngine('native');
        let busyFrame = false;

        const scanLoop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          if (!busyFrame && !cooldown.current && videoRef.current.readyState >= 2) {
            busyFrame = true;
            try {
              const detected = await detector.detect(videoRef.current);
              if (detected?.length > 0 && detected[0].rawValue) {
                cooldown.current = true;
                setTimeout(() => {
                  cooldown.current = false;
                }, 1400);
                await processBarcode(detected[0].rawValue, 'native');
              }
            } catch {}
            busyFrame = false;
          }
          rafRef.current = requestAnimationFrame(scanLoop);
        };

        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }

      // Engine 3: Fallback ZXing for older desktop browsers (fast 2-frame voting)
      setScanEngine('zxing');
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
      zxingReaderRef.current = reader;

      await reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (!result || cooldown.current) return;
        const code = result.getText().trim().replace(/[^\x20-\x7E]/g, '');
        if (!code) return;

        buffer.current = [...buffer.current.slice(-2), code];
        const votes = {};
        buffer.current.forEach((c) => {
          votes[c] = (votes[c] || 0) + 1;
        });
        const [winner, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        if (count < 2) return;

        cooldown.current = true;
        buffer.current = [];
        setTimeout(() => {
          cooldown.current = false;
        }, 1500);
        processBarcode(winner, 'zxing');
      });
    } catch (e) {
      setCamError('ไม่สามารถเปิดกล้องได้: ' + (e.message || ''));
      stopScanner();
    }
  }, [processBarcode, stopScanner]);

  const total = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0);
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const receivedNum = cashReceived === '' ? total : parseFloat(cashReceived) || 0;
  const changeDue = paymentMethod === 'cash' ? receivedNum - total : 0;
  const cashInsufficient =
    paymentMethod === 'cash' && cashReceived !== '' && receivedNum < total;

  const handleCheckout = useCallback(async () => {
    if (!cart.length || cashInsufficient || saving) return;
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
  }, [
    cart,
    cashInsufficient,
    saving,
    paymentMethod,
    receivedNum,
    total,
    profile,
    setCart,
    loadCatalog,
    onOrderCompleted,
  ]);

  // Global PC USB / Bluetooth Hardware Barcode Scanner Listener (HID Keyboard Wedge)
  useEffect(() => {
    if (!isActiveTab) return;

    const handleKeyDown = (e) => {
      // PC keyboard shortcuts
      if (e.key === 'F2') {
        e.preventDefault();
        manualInputRef.current?.focus();
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        handleCheckout();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const activeEl = document.activeElement;
      const isFormField =
        activeEl &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);

      // Don't intercept typing inside modal/add/cash inputs (manual search input handles its own Enter)
      if (isFormField) return;

      const now = Date.now();
      const gap = now - hwLastKeyTimeRef.current;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (hwBufferRef.current.length >= 2) {
          e.preventDefault();
          const scanned = hwBufferRef.current;
          hwBufferRef.current = '';
          if (hwResetTimerRef.current) clearTimeout(hwResetTimerRef.current);
          processBarcode(scanned, 'hardware');
        } else {
          hwBufferRef.current = '';
        }
        return;
      }

      if (e.key.length === 1) {
        // Hardware scanners fire keystrokes within ~5-50ms; reset if slow human typing
        if (gap > 90) {
          hwBufferRef.current = e.key;
        } else {
          hwBufferRef.current += e.key;
        }
        hwLastKeyTimeRef.current = now;

        if (hwResetTimerRef.current) clearTimeout(hwResetTimerRef.current);
        hwResetTimerRef.current = setTimeout(() => {
          hwBufferRef.current = '';
        }, 180);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (hwResetTimerRef.current) clearTimeout(hwResetTimerRef.current);
    };
  }, [isActiveTab, processBarcode, handleCheckout]);

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

  const pcGridProducts = useMemo(() => {
    const filtered =
      gridCategory === 'ALL'
        ? products
        : products.filter((p) => p.category === gridCategory);
    return filtered.slice(0, 24);
  }, [products, gridCategory]);

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
    processBarcode(val, 'manual');
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

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4">
      <div className="lg:grid lg:grid-cols-12 lg:gap-5 items-start space-y-3 lg:space-y-0">
        {/* LEFT COLUMN (Scanner, Search & Quick-Pick Grid) */}
        <div className="lg:col-span-7 space-y-3">
          {/* PC Hardware Barcode Scanner Status Bar */}
          <div className="hidden sm:flex bg-white rounded-xl border border-gray-100 shadow-sm px-3.5 py-2.5 items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <p className="text-xs text-gray-600 truncate">
                <span className="font-semibold text-gray-800">
                  เครื่องสแกน USB / Bluetooth:
                </span>{' '}
                ยิงบาร์โค้ดได้ทันทีโดยไม่ต้องคลิกช่องค้นหา
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-400">
              {hwFlash ? (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-mono font-semibold">
                  ⚡ ยิงแล้ว: {hwFlash}
                </span>
              ) : (
                <>
                  <kbd className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200">
                    F2
                  </kbd>
                  <span>ค้นหา</span>
                  <kbd className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200 ml-1">
                    F9
                  </kbd>
                  <span>ชำระเงิน</span>
                </>
              )}
            </div>
          </div>

          {/* Camera Box (Full on Mobile, Compact on PC when idle) */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
            <div
              className={`relative bg-gray-900 ${
                scanning ? 'block' : 'block lg:hidden'
              }`}
              style={{ aspectRatio: '4/3', maxHeight: '340px', width: '100%' }}
            >
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                style={{ display: scanning ? 'block' : 'none' }}
                playsInline
                muted
              />

              {!scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-16 h-16 border-2 border-green-700 rounded-xl flex items-center justify-center">
                    <svg
                      width="34"
                      height="34"
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
                  <p className="text-gray-400 text-sm">
                    {'BarcodeDetector' in window
                      ? '⚡ กล้องสแกนความเร็วสูง (Native Hardware)'
                      : 'กดปุ่มด้านล่างเพื่อเริ่มสแกน'}
                  </p>
                </div>
              )}

              {scanning && (
                <>
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="bg-black/60 text-white text-[11px] px-2.5 py-1 rounded-full backdrop-blur-sm">
                      {scanEngine === 'native'
                        ? '⚡ Native 60FPS'
                        : scanEngine === 'capacitor'
                        ? '⚡ Native App'
                        : 'Web Scanner'}
                    </span>
                  </div>

                  {torchSupported && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className={`absolute top-2.5 right-2.5 text-xs px-3 py-1 rounded-full font-medium backdrop-blur-sm transition-colors ${
                        torchOn
                          ? 'bg-amber-400 text-gray-900'
                          : 'bg-black/60 text-white hover:bg-black/80'
                      }`}
                    >
                      {torchOn ? '🔦 ปิดไฟฉาย' : '🔦 ไฟฉาย'}
                    </button>
                  )}

                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="relative" style={{ width: '68%', aspectRatio: '3/2' }}>
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
                </>
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
                className={`flex-1 py-2.5 sm:py-3 rounded-xl font-medium text-white text-sm transition-colors ${
                  scanning
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-700 hover:bg-green-800'
                }`}
              >
                {scanning ? 'หยุดสแกนกล้อง' : '📷 เปิดกล้องสแกนบาร์โค้ด'}
              </button>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setCashReceived('');
                  }}
                  className="px-4 py-2.5 sm:py-3 rounded-xl border border-red-100 text-red-500 text-sm hover:bg-red-50 transition-colors"
                >
                  ล้างตะกร้า
                </button>
              )}
            </div>
          </div>

          {camError && !scanning && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-xl flex justify-between">
              <span>{camError}</span>
              <button type="button" onClick={() => setCamError('')}>
                ✕
              </button>
            </div>
          )}

          {/* Manual Barcode & Smart Name Search */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-2.5">
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                ref={manualInputRef}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้า / รหัส..."
                className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium"
              >
                เพิ่ม
              </button>
            </form>

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
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {p.name}
                      </p>
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

            {/* Quick-Pick Short Code Chips (1-5 Ice, etc.) */}
            {quickPickItems.length > 0 && (
              <div className="pt-0.5">
                <p className="text-[11px] text-gray-400 mb-1.5">
                  ปุ่มด่วน (ไม่ต้องสแกน)
                </p>
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

          {/* New / Edit Product Panels */}
          {panel === 'new' && (
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4 slide-up">
              <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3">
                <p className="text-xs text-amber-700 font-mono mb-0.5">
                  {activeBarcode}
                </p>
                <p className="text-sm text-amber-800 font-medium">
                  ไม่พบสินค้านี้ในร้าน กรุณาเพิ่มข้อมูล
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

          {panel === 'edit' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 slide-up">
              <p className="text-sm font-medium text-gray-700 mb-3">
                แก้ไขสินค้า{' '}
                <span className="text-xs font-mono text-gray-400">
                  ({activeBarcode})
                </span>
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

          {/* PC Counter Quick Product Grid */}
          {pcGridProducts.length > 0 && (
            <div className="hidden lg:block bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-600">
                  กดเลือกสินค้าด่วน (สำหรับเคาน์เตอร์ PC)
                </p>
                <div className="flex gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setGridCategory('ALL')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                      gridCategory === 'ALL'
                        ? 'bg-green-700 text-white border-green-700'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  {categories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => setGridCategory(cat)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${
                        gridCategory === cat
                          ? 'bg-green-700 text-white border-green-700'
                          : 'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                {pcGridProducts.map((p) => (
                  <button
                    type="button"
                    key={p.barcode}
                    onClick={() => handlePickSuggestion(p)}
                    className="p-2.5 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-green-50 hover:border-green-300 text-left transition-colors"
                  >
                    <p className="text-xs font-semibold text-gray-800 truncate">
                      {p.name}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs font-bold text-green-700">
                        {formatBaht(p.price)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        เหลือ {p.stock_qty}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (Sticky Live Cart & Checkout) */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-3">
          {lastReceipt && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 slide-up flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-green-800">
                  ✓ บันทึกบิล #{lastReceipt.order_no} เรียบร้อย
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  ยอดสุทธิ {formatBaht(lastReceipt.total_amount)} (
                  {lastReceipt.payment_method === 'qr' ? 'โอน QR' : 'เงินสด'})
                  {lastReceipt.payment_method === 'cash' &&
                  lastReceipt.change_given > 0
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

          {cart.length === 0 ? (
            <div className="hidden lg:flex bg-white rounded-2xl border border-gray-100 shadow-sm p-8 flex-col items-center justify-center text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-green-50 text-green-700 flex items-center justify-center text-xl">
                🛒
              </div>
              <p className="text-sm font-semibold text-gray-700">ตะกร้ายังว่างอยู่</p>
              <p className="text-xs text-gray-400">
                ยิงบาร์โค้ดด้วยเครื่องสแกน, เปิดกล้อง หรือกดเลือกสินค้าทางซ้าย
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden slide-up">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-700">ตะกร้าสินค้า</p>
                <span className="text-xs text-gray-500">{totalQty} ชิ้น</span>
              </div>

              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {cart.map((item) => {
                  const overStock =
                    item.stock_qty > 0 && item.qty > item.stock_qty;
                  return (
                    <div
                      key={item.barcode}
                      className="px-4 py-3 flex items-center gap-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 font-medium truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatBaht(item.price)} / ชิ้น
                          {overStock && (
                            <span className="ml-1.5 text-amber-600 font-medium">
                              (สต็อกเหลือ {item.stock_qty})
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => changeQty(item.barcode, -1)}
                          className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm font-medium flex items-center justify-center"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">
                          {item.qty}
                        </span>
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
                  <span className="text-sm font-medium text-gray-600">
                    ยอดรวมทั้งหมด
                  </span>
                  <span className="text-2xl font-bold text-green-700">
                    {formatBaht(total)}
                  </span>
                </div>

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
                    📱 โอนเงิน / QR
                  </button>
                </div>

                {paymentMethod === 'cash' && (
                  <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-gray-500 shrink-0">
                        รับเงินมา (บาท)
                      </label>
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
      </div>
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
