import { useState, useEffect } from 'react';
import { getServerIP } from './src/api';
import Scanner from './components/Scanner.jsx';
import Inventory from './components/Inventory.jsx';
import Dashboard from './components/Dashboard.jsx';

const tabs = [
  {
    id: 'scanner',
    label: 'สแกน',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="4" height="18" rx="0.5"/>
        <rect x="9" y="3" width="2" height="18" rx="0.5"/>
        <rect x="13" y="3" width="4" height="18" rx="0.5"/>
        <rect x="19" y="3" width="2" height="12" rx="0.5"/>
      </svg>
    ),
  },
  {
    id: 'inventory',
    label: 'สินค้า',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="5" rx="1"/>
        <rect x="2" y="10" width="20" height="5" rx="1"/>
        <rect x="2" y="17" width="20" height="4" rx="1"/>
        <line x1="6" y1="5.5" x2="6" y2="5.5" strokeWidth="2" strokeLinecap="round"/>
        <line x1="6" y1="12.5" x2="6" y2="12.5" strokeWidth="2" strokeLinecap="round"/>
        <line x1="6" y1="19" x2="6" y2="19" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'แดชบอร์ด',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="13" width="4" height="8" rx="1"/>
        <rect x="10" y="8" width="4" height="13" rx="1"/>
        <rect x="17" y="3" width="4" height="18" rx="1"/>
      </svg>
    ),
  },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('scanner');
  const [cart, setCart] = useState([]);

  useEffect(() => {
    // Load saved IP before rendering anything
    getServerIP().then(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <div className="min-h-screen flex flex-col">

      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-green-700 rounded-lg flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="4" height="18" rx="0.5"/>
                <rect x="9" y="3" width="2" height="18" rx="0.5"/>
                <rect x="13" y="3" width="4" height="18" rx="0.5"/>
                <rect x="19" y="3" width="2" height="12" rx="0.5"/>
              </svg>
            </div>
            <span className="font-semibold text-gray-800">ระบบร้านค้า</span>
          </div>

          <div className="hidden sm:flex gap-1 bg-gray-50 rounded-xl p-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? 'bg-white text-green-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="flex-1 pb-20 sm:pb-4">
        <div style={{ display: tab === 'scanner' ? 'block' : 'none' }}>
          <Scanner cart={cart} setCart={setCart} />
        </div>
        <div style={{ display: tab === 'inventory' ? 'block' : 'none' }}>
          <Inventory />
        </div>
        <div style={{ display: tab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard />
        </div>
      </main>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50">
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                tab === t.id ? 'text-green-700' : 'text-gray-400'
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