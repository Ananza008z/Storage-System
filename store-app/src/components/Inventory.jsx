import { useState, useEffect } from 'react';
import { getAllProducts, saveProduct, updateProduct, deleteProduct, formatBaht } from '../api.js';
import CategorySelect from './CategorySelect.jsx';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(null);
  const [editForm, setEditForm] = useState({});
  const [adding, setAdding]     = useState(false);
  const [addForm, setAddForm]   = useState({ barcode: '', name: '', price: '', category: '' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [page, setPage]         = useState(1);
  const PER_PAGE = 20;

  const load = async () => {
    setLoading(true);
    try { setProducts(await getAllProducts()); }
    catch { setError('ไม่สามารถโหลดข้อมูลได้'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => setPage(1), [search]);

  const filtered = products.filter(p =>
    p.name.includes(search) || p.barcode.includes(search) || (p.category || '').includes(search)
  );
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleEdit = (p) => {
    setEditing(p.barcode);
    setEditForm({ name: p.name, price: String(p.price), category: p.category || '' });
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await updateProduct(editing, editForm.name, parseFloat(editForm.price), editForm.category);
      setEditing(null);
      load();
    } catch { setError('บันทึกไม่สำเร็จ'); }
    setSaving(false);
  };

  const handleDelete = async (barcode, name) => {
    if (!window.confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
    try { await deleteProduct(barcode); load(); }
    catch { setError('ลบไม่สำเร็จ'); }
  };

  const handleAdd = async () => {
    if (!addForm.barcode || !addForm.name || !addForm.price) return;
    setSaving(true);
    try {
      await saveProduct(addForm.barcode, addForm.name, parseFloat(addForm.price), addForm.category);
      setAdding(false);
      setAddForm({ barcode: '', name: '', price: '', category: '' });
      load();
    } catch { setError('เพิ่มไม่สำเร็จ'); }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg mb-3 flex justify-between">
          {error}
          <button onClick={() => setError('')} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อสินค้า บาร์โค้ด หมวดหมู่..."
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:border-green-500"
        />
        <div className="flex gap-2">
          <button onClick={load}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 whitespace-nowrap">
            รีเฟรช
          </button>
          <button onClick={() => setAdding(true)}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium whitespace-nowrap transition-colors">
            + เพิ่มสินค้า
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3 slide-up">
          <p className="text-sm font-medium text-gray-700 mb-3">เพิ่มสินค้าใหม่</p>
          <div className="space-y-2 mb-3">
            <input value={addForm.barcode} onChange={e => setAddForm(f => ({ ...f, barcode: e.target.value }))}
              placeholder="บาร์โค้ด *"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
            <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              placeholder="ชื่อสินค้า *"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={addForm.price} onChange={e => setAddForm(f => ({ ...f, price: e.target.value }))}
                placeholder="ราคา (บาท) *" step="0.01"
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
              <CategorySelect value={addForm.category} onChange={val => setAddForm(f => ({ ...f, category: val }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAdding(false)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">ยกเลิก</button>
            <button onClick={handleAdd} disabled={!addForm.barcode || !addForm.name || !addForm.price || saving}
              className="flex-[2] py-2 rounded-lg bg-green-700 text-white text-sm font-medium disabled:opacity-40 hover:bg-green-800">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      {/* Product list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-green-700 border-t-transparent rounded-full spin" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paginated.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">ไม่พบสินค้า</p>
            )}
            {paginated.map(p => (
              <div key={p.barcode} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                {editing === p.barcode ? (
                  <div className="space-y-2">
                    <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                        step="0.01" className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-500" />
                      <CategorySelect value={editForm.category} onChange={val => setEditForm(f => ({ ...f, category: val }))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(null)} className="flex-1 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50">ยกเลิก</button>
                      <button onClick={handleSaveEdit} disabled={saving} className="flex-[2] py-1.5 rounded-lg bg-green-700 text-white text-xs font-medium hover:bg-green-800 disabled:opacity-40">
                        {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-400 font-mono">{p.barcode}</span>
                        {p.category && (
                          <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">{p.category}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-lg font-bold text-green-700 shrink-0">{formatBaht(p.price)}</p>
                    <button onClick={() => handleEdit(p)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors shrink-0">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(p.barcode, p.name)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors shrink-0">
                      ลบ
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-30 hover:bg-gray-50">←</button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-30 hover:bg-gray-50">→</button>
            </div>
          )}

          <p className="text-center text-xs text-gray-300 mt-4">สินค้าในระบบ {products.length} รายการ</p>
        </>
      )}
    </div>
  );
}
