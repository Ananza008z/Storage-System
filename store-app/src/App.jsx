import { useState, useMemo, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login from './components/Login.jsx';
import StoreSelect from './components/StoreSelect.jsx';
import Scanner from './components/Scanner.jsx';
import Inventory from './components/Inventory.jsx';
import Dashboard from './components/Dashboard.jsx';
import TeamSettings from './components/TeamSettings.jsx';

const BASE_TABS = [
  {
    id: 'scanner',
    label: 'สแกนขาย',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="4" height="18" rx="0.5" />
        <rect x="9" y="3" width="2" height="18" rx="0.5" />
        <rect x="13" y="3" width="4" height="18" rx="0.5" />
        <rect x="19" y="3" width="2" height="12" rx="0.5" />
      </svg>
    ),
  },
  {
    id: 'inventory',
    label: 'สินค้า',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="5" rx="1" />
        <rect x="2" y="10" width="20" height="5" rx="1" />
        <rect x="2" y="17" width="20" height="4" rx="1" />
        <line x1="6" y1="5.5" x2="6" y2="5.5" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="12.5" x2="6" y2="12.5" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="19" x2="6" y2="19" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'แดชบอร์ด',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="13" width="4" height="8" rx="1" />
        <rect x="10" y="8" width="4" height="13" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'ตั้งค่า',
    ownerOnly: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" strokeLinecap="round" />
      </svg>
    ),
  },
];

function StoreShell() {
  const {
    user,
    profile,
    currentStore,
    choosingStore,
    setChoosingStore,
    isOwner,
    isActive,
    mode,
    loading,
    logout,
  } = useAuth();

  const [tab, setTab] = useState('scanner');
  const [cart, setCart] = useState([]);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Clear cart whenever switching active store
  useEffect(() => {
    setCart([]);
  }, [currentStore?.id]);

  const visibleTabs = useMemo(
    () => BASE_TABS.filter((t) => !t.ownerOnly || isOwner),
    [isOwner]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full spin" />
      </div>
    );
  }

  if (!user || !profile) {
    return <Login />;
  }

  if (!currentStore || choosingStore) {
    return <StoreSelect />;
  }

  if (!isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-red-100 shadow-sm p-6 text-center space-y-3">
          <p className="text-lg font-bold text-red-600">บัญชีถูกระงับสิทธิ์ในร้านนี้</p>
          <p className="text-sm text-gray-500">
            สิทธิ์ของคุณในร้าน "{currentStore.name}" ถูกระงับชั่วคราว กรุณาติดต่อเจ้าของร้านหรือสลับไปร้านอื่น
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChoosingStore(true)}
              className="flex-1 py-2.5 rounded-xl bg-green-700 text-white text-sm font-medium"
            >
              สลับร้านค้า
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : 'scanner';

  const switchTab = (nextTab) => {
    setTab(nextTab);
    if (nextTab === 'inventory' || nextTab === 'dashboard') {
      setRefreshSignal((s) => s + 1);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-green-700 rounded-lg flex items-center justify-center shrink-0">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="4" height="18" rx="0.5" />
                <rect x="9" y="3" width="2" height="18" rx="0.5" />
                <rect x="13" y="3" width="4" height="18" rx="0.5" />
                <rect x="19" y="3" width="2" height="12" rx="0.5" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setChoosingStore(true)}
                  className="flex items-center gap-1 font-bold text-gray-800 text-sm hover:text-green-700 truncate max-w-[140px] sm:max-w-[200px]"
                  title="คลิกเพื่อสลับร้านค้า"
                >
                  <span className="truncate">{currentStore.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium shrink-0">
                    สลับร้าน
                  </span>
                </button>
                <span
                  className={`hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                    mode === 'cloud'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {mode === 'cloud' ? 'Cloud' : 'Local'}
                </span>
              </div>
            </div>
          </div>

          <div className="hidden sm:flex gap-1 bg-gray-50 rounded-xl p-1">
            {visibleTabs.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === t.id
                    ? 'bg-white text-green-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-700 leading-tight max-w-[90px] truncate">
                {profile.display_name}
              </p>
              <p className="text-[10px] text-green-700 font-medium leading-tight">
                {isOwner ? 'เจ้าของร้าน' : 'พนักงาน'}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
            >
              ออก
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 pb-20 sm:pb-6" key={currentStore.id}>
        <div style={{ display: activeTab === 'scanner' ? 'block' : 'none' }}>
          <Scanner
            cart={cart}
            setCart={setCart}
            isActiveTab={activeTab === 'scanner'}
            onOrderCompleted={() => setRefreshSignal((s) => s + 1)}
          />
        </div>
        <div style={{ display: activeTab === 'inventory' ? 'block' : 'none' }}>
          <Inventory refreshSignal={refreshSignal} />
        </div>
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard refreshSignal={refreshSignal} />
        </div>
        {isOwner && (
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <TeamSettings />
          </div>
        )}
      </main>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-40">
        <div className="flex">
          {visibleTabs.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === t.id ? 'text-green-700' : 'text-gray-400'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StoreShell />
    </AuthProvider>
  );
}
