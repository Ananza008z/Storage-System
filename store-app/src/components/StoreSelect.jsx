import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function StoreSelect() {
  const {
    profile,
    stores,
    currentStore,
    mode,
    selectStore,
    createNewStore,
    joinExistingStore,
    setChoosingStore,
    logout,
  } = useAuth();

  const [tab, setTab] = useState(stores.length > 0 ? 'join' : 'create');
  const [joinName, setJoinName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [seedDefaultData, setSeedDefaultData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await joinExistingStore({ name: joinName, password: joinPassword });
    } catch (err) {
      setError(err.message || 'ไม่สามารถเข้าร่วมร้านค้าได้');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await createNewStore({
        name: createName,
        password: createPassword,
        seedDefaultData,
      });
    } catch (err) {
      setError(err.message || 'ไม่สามารถสร้างร้านค้าได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4f0] px-4 py-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl space-y-4">
        {/* Top User Bar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-gray-800 truncate">
                สวัสดี, {profile?.display_name || profile?.email}
              </h1>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  mode === 'cloud'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {mode === 'cloud' ? 'Supabase Cloud' : 'โหมดออฟไลน์ / สาธิต'}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">{profile?.email}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {currentStore && (
              <button
                type="button"
                onClick={() => setChoosingStore(false)}
                className="text-xs px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 font-medium text-gray-700"
              >
                กลับไปหน้าร้าน
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              className="text-xs px-3 py-2 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 font-medium"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl flex justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')}>
              ✕
            </button>
          </div>
        )}

        {/* My Stores List */}
        {stores.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800">ร้านค้าของคุณ ({stores.length})</h2>
              <span className="text-xs text-gray-400">แตะเพื่อเข้าสู่ร้านค้า</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {stores.map((s) => {
                const isSelected = currentStore?.id === s.id;
                const isStoreOwner = s.role === 'owner';
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => selectStore(s.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'border-green-600 bg-green-50/70 shadow-sm'
                        : 'border-gray-200 hover:border-green-400 hover:bg-green-50/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 text-sm truncate">{s.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            isStoreOwner
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {isStoreOwner ? 'เจ้าของร้าน (Owner)' : 'พนักงาน (Employee)'}
                        </span>
                        {s.active === false && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            ถูกระงับสิทธิ์
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-green-700 shrink-0">
                      เข้าร้าน →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Join or Create Store Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-2 bg-gray-50 p-1.5 border-b border-gray-100">
            <button
              type="button"
              onClick={() => {
                setTab('create');
                setError('');
              }}
              className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === 'create'
                  ? 'bg-white text-green-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              + สร้างร้านค้าใหม่ (เจ้าของร้าน)
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('join');
                setError('');
              }}
              className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === 'join'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              🔑 เข้าร่วมร้านค้า (พนักงาน)
            </button>
          </div>

          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="p-5 space-y-3.5">
              <div>
                <h3 className="text-sm font-bold text-gray-800">สร้างร้านค้าใหม่</h3>
                <p className="text-xs text-gray-400">
                  คุณจะได้รับสิทธิ์เจ้าของร้าน (Owner) และใช้ชื่อร้าน + รหัสผ่านนี้ให้พนักงานเข้าร่วม
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">ชื่อร้านค้า *</label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="เช่น ร้านชำป้าแดง, MiniMart สาขา 1"
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  ตั้งรหัสผ่านร้านค้า (สำหรับให้พนักงานกรอกเข้าร่วมร้าน) *
                </label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="ตั้งรหัสผ่านร้าน..."
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                />
              </div>

              <label className="flex items-center gap-2.5 bg-green-50/70 border border-green-100 rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seedDefaultData}
                  onChange={(e) => setSeedDefaultData(e.target.checked)}
                  className="w-4 h-4 accent-green-700"
                />
                <div>
                  <p className="text-xs font-semibold text-green-900">
                    นำเข้าสินค้าตัวอย่างร้านชำ 68 รายการ และ 5 หมวดหมู่
                  </p>
                  <p className="text-[11px] text-green-700">
                    พร้อมใช้งานทันที (สามารถแก้ไขหรือลบออกภายหลังได้)
                  </p>
                </div>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {busy ? 'กำลังสร้างร้านค้า...' : 'สร้างร้านค้าและเริ่มใช้งาน'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="p-5 space-y-3.5">
              <div>
                <h3 className="text-sm font-bold text-gray-800">เข้าร่วมร้านค้าที่มีอยู่</h3>
                <p className="text-xs text-gray-400">
                  กรอกชื่อร้านค้าและรหัสผ่านร้านจากเจ้าของร้าน เพื่อรับสิทธิ์พนักงานขาย (Staff)
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">ชื่อร้านค้า *</label>
                <input
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  placeholder="กรอกชื่อร้านค้าให้ตรงกับเจ้าของร้าน..."
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">รหัสผ่านร้านค้า *</label>
                <input
                  type="password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่านร้านค้า..."
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {busy ? 'กำลังตรวจสอบ...' : 'เข้าร่วมร้านค้าเป็นพนักงาน'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
