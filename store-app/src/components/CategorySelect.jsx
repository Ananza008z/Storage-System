import { useState, useEffect } from 'react';
import { getCategories, addCategory } from '../api.js';

export default function CategorySelect({ value, onChange }) {
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
  }, []);

  const select = (cat) => {
    onChange(cat);
    setOpen(false);
  };

  const addNew = async () => {
    const trimmed = newCat.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await addCategory(trimmed);
      if (!categories.includes(trimmed)) {
        setCategories((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b, 'th')));
      }
      onChange(trimmed);
      setNewCat('');
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-left flex items-center justify-between focus:outline-none focus:border-green-500 bg-white"
      >
        <span className={value ? 'text-gray-800 truncate' : 'text-gray-400 truncate'}>
          {value || 'เลือกหมวดหมู่...'}
        </span>
        <span className="text-gray-400 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-md overflow-hidden z-20 relative">
          <div className="max-h-40 overflow-y-auto">
            {categories.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">ยังไม่มีหมวดหมู่ เพิ่มด้านล่าง</p>
            )}
            {value && (
              <button
                type="button"
                onClick={() => select('')}
                className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50"
              >
                — ไม่มีหมวดหมู่
              </button>
            )}
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => select(cat)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-green-50 hover:text-green-700 ${
                  value === cat ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 p-2 flex gap-2 bg-gray-50">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addNew();
                }
              }}
              placeholder="เพิ่มหมวดหมู่ใหม่..."
              className="flex-1 min-w-0 px-2 py-1.5 rounded border border-gray-200 text-sm bg-white focus:outline-none focus:border-green-500"
            />
            <button
              type="button"
              onClick={addNew}
              disabled={!newCat.trim() || adding}
              className="px-3 py-1.5 rounded bg-green-700 text-white text-xs font-medium hover:bg-green-800 disabled:opacity-40 whitespace-nowrap"
            >
              เพิ่ม
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
