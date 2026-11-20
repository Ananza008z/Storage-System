import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  getCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
  isCloudConfigured,
  testCloudConnection,
} from '../lib/supabase.js';
import { setForcedLocalMode, getForcedLocalMode } from '../api.js';

export default function Login() {
  const { mode, login, register, refreshAuth } = useAuth();
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Cloud config modal state
  const [showCloudModal, setShowCloudModal] = useState(false);
  const currentCfg = getCloudConfig();
  const [cloudUrl, setCloudUrl] = useState(currentCfg.url);
  const [cloudKey, setCloudKey] = useState(currentCfg.anonKey);
  const [cloudMsg, setCloudMsg] = useState({ type: '', text: '' });
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        const res = await register(email, password, displayName);
        if (!res.loggedIn && res.message) {
          setInfo(res.message);
          setTab('login');
        }
      }
    } catch (err) {
      setError(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
  };

  const quickLocalLogin = async (presetEmail, presetPassword) => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await login(presetEmail, presetPassword);
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleTestCloud = async () => {
    setTesting(true);
    setCloudMsg({ type: '', text: '' });
    try {
      await testCloudConnection(cloudUrl, cloudKey);
      setCloudMsg({ type: 'ok', text: 'เชื่อมต่อ Supabase สำเร็จ! พร้อมบันทึกใช้งาน' });
    } catch (err) {
      setCloudMsg({ type: 'err', text: `เชื่อมต่อไม่สำเร็จ: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveCloud = async () => {
    if (!cloudUrl.trim() || !cloudKey.trim()) {
      setCloudMsg({ type: 'err', text: 'กรุณากรอก Supabase URL และ Anon Key' });
      return;
    }
    saveCloudConfig(cloudUrl, cloudKey);
    setForcedLocalMode(false);
    setShowCloudModal(false);
    await refreshAuth();
  };

  const handleSwitchLocal = async () => {
    setForcedLocalMode(true);
    setShowCloudModal(false);
    await refreshAuth();
  };

  const handleResetCloud = async () => {
    clearCloudConfig();
    setForcedLocalMode(false);
    setCloudUrl('');
    setCloudKey('');
    setShowCloudModal(false);
    await refreshAuth();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-gradient-to-b from-green-50 to-[#f0f4f0]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Brand Header */}
        <div className="bg-green-700 px-6 py-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="3" y="3" width="4" height="18" rx="0.5" />
                  <rect x="9" y="3" width="2" height="18" rx="0.5" />
                  <rect x="13" y="3" width="4" height="18" rx="0.5" />
                  <rect x="19" y="3" width="2" height="12" rx="0.5" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">ระบบร้านค้า POS</h1>
                <p className="text-xs text-green-100">สแกนขาย • คลังสินค้า • รายงานยอดขาย</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowCloudModal(true)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                mode === 'cloud'
                  ? 'bg-emerald-500/20 border-emerald-200/50 text-white hover:bg-emerald-500/30'
                  : 'bg-amber-400/20 border-amber-200/60 text-amber-50 hover:bg-amber-400/30'
              }`}
            >
              {mode === 'cloud' ? '● Supabase Cloud' : '● โหมดออฟไลน์ / สาธิต'}
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Tabs */}
          <div className="grid grid-cols-2 bg-gray-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError('');
              }}
              className={`py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'login' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
              }`}
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError('');
              }}
              className={`py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'register' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
              }`}
            >
              สมัครบัญชีใหม่
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-xl">
              {error}
            </div>
          )}

          {info && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2.5 rounded-xl">
              {info}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {tab === 'register' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">ชื่อที่แสดงในระบบ *</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="เช่น พี่แอน, พนักงานกะเช้า"
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                />
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500 block mb-1">อีเมล *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoComplete="email"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">รหัสผ่าน *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                required
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {busy
                ? 'กำลังดำเนินการ...'
                : tab === 'login'
                ? 'เข้าสู่ระบบร้านค้า'
                : 'สร้างบัญชีผู้ใช้'}
            </button>
          </form>

          {/* Local Mode Quick Demo Accounts */}
          {mode === 'local' && (
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">
                  เข้าสู่ระบบด่วน (โหมดสาธิตพร้อมสินค้า 68 รายการ)
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => quickLocalLogin('owner@store.local', 'owner1234')}
                  className="px-3 py-2.5 rounded-xl border border-green-200 bg-green-50/70 hover:bg-green-50 text-left transition-colors"
                >
                  <p className="text-xs font-semibold text-green-800">เจ้าของร้าน (Owner)</p>
                  <p className="text-[11px] text-green-700/80">owner@store.local</p>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => quickLocalLogin('staff@store.local', 'staff1234')}
                  className="px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
                >
                  <p className="text-xs font-semibold text-gray-800">พนักงานขาย (Staff)</p>
                  <p className="text-[11px] text-gray-500">staff@store.local</p>
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-xs text-gray-400">
            <span>
              {mode === 'cloud'
                ? 'เชื่อมต่อฐานข้อมูลออนไลน์แล้ว'
                : 'ทำงานในเบราว์เซอร์ (ไม่ต้องเปิดเครื่องแม่ข่าย)'}
            </span>
            <button
              type="button"
              onClick={() => setShowCloudModal(true)}
              className="text-green-700 hover:underline font-medium"
            >
              ตั้งค่า Cloud
            </button>
          </div>
        </div>
      </div>

      {/* Cloud Configuration Modal */}
      {showCloudModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl slide-up">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-800">เชื่อมต่อ Supabase Cloud</h2>
              <button
                type="button"
                onClick={() => setShowCloudModal(false)}
                className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
              ใส่ค่า Project URL และ Anon Key จากหน้า{' '}
              <span className="font-medium text-gray-700">Supabase Settings → API</span>{' '}
              เพื่อใช้งานแบบออนไลน์เต็มรูปแบบจากทุกเครื่อง (หรือตั้งค่าในไฟล์ <code>.env</code>)
            </p>

            {cloudMsg.text && (
              <div
                className={`text-xs px-3 py-2 rounded-lg border ${
                  cloudMsg.type === 'ok'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {cloudMsg.text}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Supabase URL</label>
                <input
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co"
                  disabled={currentCfg.source === 'env'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm disabled:bg-gray-50 focus:outline-none focus:border-green-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Supabase Anon Key</label>
                <input
                  value={cloudKey}
                  onChange={(e) => setCloudKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                  disabled={currentCfg.source === 'env'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono disabled:bg-gray-50 focus:outline-none focus:border-green-600"
                />
              </div>
              {currentCfg.source === 'env' && (
                <p className="text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg">
                  กำลังใช้ค่าจากตัวแปรสภาพแวดล้อม (.env)
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTestCloud}
                disabled={testing}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50"
              >
                {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
              </button>
              <button
                type="button"
                onClick={handleSaveCloud}
                className="flex-1 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-xs font-semibold"
              >
                ใช้ Supabase Cloud
              </button>
            </div>

            {(isCloudConfigured() || getForcedLocalMode()) && (
              <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={handleSwitchLocal}
                  className="text-amber-700 hover:underline font-medium"
                >
                  สลับเป็นโหมดสาธิต / ออฟไลน์
                </button>
                {currentCfg.source === 'storage' && (
                  <button
                    type="button"
                    onClick={handleResetCloud}
                    className="text-red-500 hover:underline"
                  >
                    ล้างค่าที่บันทึกไว้
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
