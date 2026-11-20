import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAllProducts,
  getCategories,
  saveProduct,
  updateProduct,
  adjustStock,
  deleteProduct,
  formatBaht,
} from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import CategorySelect from './CategorySelect.jsx';

export default function Inventory({ refreshSignal }) {
  const { isOwner } = useAuth();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    barcode: '',
    name: '',
    price: '',
    cost_price: '',
    stock_qty: '24',
    low_stock_threshold: '5',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([getAllProducts(), getCategories()]);
      setProducts(prods);
      setCategories(cats);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลสินค้าได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedCategory, lowStockOnly]);

  const lowStockCount = useMemo(
    () =>
      products.filter(
        (p) => Number(p.stock_qty) <= Number(p.low_stock_threshold ?? 5)
      ).length,
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory === 'UNCATEGORIZED' && p.category) return false;
      if (
        selectedCategory !== 'ALL' &&
        selectedCategory !== 'UNCATEGORIZED' &&
        p.category !== selectedCategory
      ) {
        return false;
      }
      if (
        lowStockOnly &&
        Number(p.stock_qty) > Number(p.low_stock_threshold ?? 5)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, selectedCategory, lowStockOnly]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleEdit = (p) => {
    setEditing(p.barcode);
    setEditForm({
      name: p.name,
      price: String(p.price),
      cost_price: String(p.cost_price ?? 0),
      stock_qty: String(p.stock_qty ?? 0),
      low_stock_threshold: String(p.low_stock_threshold ?? 5),
      category: p.category || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm.name?.trim() || editForm.price === '') return;
    setSaving(true);
    try {
      await updateProduct(editing, {
        name: editForm.name.trim(),
        price: parseFloat(editForm.price),
        cost_price: parseFloat(editForm.cost_price || '0'),
        stock_qty: parseInt(editForm.stock_qty || '0', 10),
        low_stock_threshold: parseInt(editForm.low_stock_threshold || '5', 10),
        category: editForm.category,
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message || 'บันทึกการแก้ไขไม่สำเร็จ');
    }
    setSaving(false);
  };

  const handleQuickStock = async (barcode, delta) => {
    try {
      const updated = await adjustStock(barcode, delta);
      setProducts((prev) =>
        prev.map((p) => (p.barcode === barcode ? updated : p))
      );
    } catch (err) {
      setError(err.message || 'ปรับสต็อกไม่สำเร็จ');
    }
  };

  const handleDelete = async (barcode, name) => {
    if (!isOwner) return;
    if (!window.confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
    try {
      await deleteProduct(barcode);
      load();
    } catch (err) {
      setError(err.message || 'ลบสินค้าไม่สำเร็จ');
    }
  };

  const handleAdd = async () => {
    if (!addForm.barcode.trim() || !addForm.name.trim() || addForm.price === '') return;
    setSaving(true);
    try {
      const priceNum = parseFloat(addForm.price);
      const costNum =
        addForm.cost_price !== ''
          ? parseFloat(addForm.cost_price)
          : Math.round(priceNum * 0.75 * 100) / 100;
      await saveProduct({
        barcode: addForm.barcode.trim(),
        name: addForm.name.trim(),
        price: priceNum,
        cost_price: costNum,
        stock_qty: parseInt(addForm.stock_qty || '0', 10),
        low_stock_threshold: parseInt(addForm.low_stock_threshold || '5', 10),
        category: addForm.category,
      });
      setAdding(false);
      setAddForm({
        barcode: '',
        name: '',
        price: '',
        cost_price: '',
        stock_qty: '24',
        low_stock_threshold: '5',
        category: '',
      });
      load();
    } catch (err) {
      setError(err.message || 'เพิ่มสินค้าไม่สำเร็จ');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg flex justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="ml-2 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search & Action Header */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อสินค้า บาร์โค้ด หมวดหมู่..."
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:border-green-600"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
          >
            รีเฟรช
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium whitespace-nowrap transition-colors"
          >
            + เพิ่มสินค้า
          </button>
        </div>
      </div>

      {/* Category & Low Stock Filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSelectedCategory('ALL')}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
            selectedCategory === 'ALL'
              ? 'bg-green-700 text-white border-green-700'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          ทั้งหมด ({products.length})
        </button>

        <button
          type="button"
          onClick={() => setLowStockOnly((v) => !v)}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
            lowStockOnly
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
          }`}
        >
          ⚠ สินค้าใกล้หมด ({lowStockCount})
        </button>

        {categories.map((cat) => (
          <button
            type="button"
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              selectedCategory === cat
                ? 'bg-green-700 text-white border-green-700'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {cat}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setSelectedCategory('UNCATEGORIZED')}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
            selectedCategory === 'UNCATEGORIZED'
              ? 'bg-green-700 text-white border-green-700'
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
          }`}
        >
          ไม่ระบุหมวด
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 slide-up space-y-3">
          <p className="text-sm font-semibold text-gray-700">เพิ่มสินค้าใหม่</p>
          <div className="space-y-2">
            <input
              value={addForm.barcode}
              onChange={(e) => setAddForm((f) => ({ ...f, barcode: e.target.value }))}
              placeholder="บาร์โค้ด *"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
            />
            <input
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ชื่อสินค้า *"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[11px] text-gray-400">ราคาขาย *</label>
                <input
                  type="number"
                  value={addForm.price}
                  onChange={(e) => setAddForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="0.00"
                  step="0.01"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                />
              </div>
              {isOwner && (
                <div>
                  <label className="text-[11px] text-gray-400">ราคาทุน</label>
                  <input
                    type="number"
                    value={addForm.cost_price}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, cost_price: e.target.value }))
                    }
                    placeholder="อัตโนมัติ"
                    step="0.01"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                  />
                </div>
              )}
              <div>
                <label className="text-[11px] text-gray-400">สต็อกเริ่มต้น</label>
                <input
                  type="number"
                  value={addForm.stock_qty}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, stock_qty: e.target.value }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                />
              </div>
              {isOwner && (
                <div>
                  <label className="text-[11px] text-gray-400">เตือนสต็อกต่ำ ≤</label>
                  <input
                    type="number"
                    value={addForm.low_stock_threshold}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        low_stock_threshold: e.target.value,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                  />
                </div>
              )}
            </div>
            <div>
              <CategorySelect
                value={addForm.category}
                onChange={(val) => setAddForm((f) => ({ ...f, category: val }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={
                !addForm.barcode.trim() ||
                !addForm.name.trim() ||
                addForm.price === '' ||
                saving
              }
              className="flex-[2] py-2 rounded-lg bg-green-700 text-white text-sm font-medium disabled:opacity-40 hover:bg-green-800"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
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
            {paginated.map((p) => {
              const isLow =
                Number(p.stock_qty) <= Number(p.low_stock_threshold ?? 5);
              const profit = Number(p.price) - Number(p.cost_price || 0);
              const marginPct =
                Number(p.price) > 0
                  ? Math.round((profit / Number(p.price)) * 100)
                  : 0;

              return (
                <div
                  key={p.barcode}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
                >
                  {editing === p.barcode ? (
                    <div className="space-y-2">
                      <input
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, name: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="text-[11px] text-gray-400">ราคาขาย</label>
                          <input
                            type="number"
                            value={editForm.price}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, price: e.target.value }))
                            }
                            step="0.01"
                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                          />
                        </div>
                        {isOwner && (
                          <div>
                            <label className="text-[11px] text-gray-400">ราคาทุน</label>
                            <input
                              type="number"
                              value={editForm.cost_price}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  cost_price: e.target.value,
                                }))
                              }
                              step="0.01"
                              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                            />
                          </div>
                        )}
                        <div>
                          <label className="text-[11px] text-gray-400">จำนวนสต็อก</label>
                          <input
                            type="number"
                            value={editForm.stock_qty}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                stock_qty: e.target.value,
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                          />
                        </div>
                        {isOwner && (
                          <div>
                            <label className="text-[11px] text-gray-400">
                              เตือนสต็อกต่ำ ≤
                            </label>
                            <input
                              type="number"
                              value={editForm.low_stock_threshold}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  low_stock_threshold: e.target.value,
                                }))
                              }
                              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
                            />
                          </div>
                        )}
                      </div>
                      <CategorySelect
                        value={editForm.category}
                        onChange={(val) =>
                          setEditForm((f) => ({ ...f, category: val }))
                        }
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="flex-1 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={saving}
                          className="flex-[2] py-1.5 rounded-lg bg-green-700 text-white text-xs font-medium hover:bg-green-800 disabled:opacity-40"
                        >
                          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 truncate">{p.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-xs text-gray-400 font-mono">
                              {p.barcode}
                            </span>
                            {p.category && (
                              <span className="text-[11px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                                {p.category}
                              </span>
                            )}
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                isLow
                                  ? 'bg-red-50 text-red-700 border border-red-200'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {isLow ? '⚠ ' : ''}คงเหลือ {p.stock_qty} ชิ้น
                            </span>
                          </div>
                          {isOwner && (
                            <p className="text-[11px] text-gray-400 mt-1">
                              ทุน {formatBaht(p.cost_price)} • กำไร {formatBaht(profit)} (
                              {marginPct}%)
                            </p>
                          )}
                        </div>
                        <p className="text-lg font-bold text-green-700 shrink-0">
                          {formatBaht(p.price)}
                        </p>
                      </div>

                      {/* Quick Stock & Action Row */}
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-50 gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-gray-400 mr-1">สต็อก:</span>
                          <button
                            type="button"
                            onClick={() => handleQuickStock(p.barcode, -1)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickStock(p.barcode, 1)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickStock(p.barcode, 10)}
                            className="text-xs px-2 py-1 rounded border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 font-medium"
                          >
                            +10
                          </button>
                        </div>

                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEdit(p)}
                            className="text-xs px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                          >
                            แก้ไข
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => handleDelete(p.barcode, p.name)}
                              className="text-xs px-3 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                            >
                              ลบ
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-30 hover:bg-gray-50 bg-white"
              >
                ←
              </button>
              <span className="text-sm text-gray-500">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-30 hover:bg-gray-50 bg-white"
              >
                →
              </button>
            </div>
          )}

          <p className="text-center text-xs text-gray-400 pt-2">
            แสดง {filtered.length} รายการ (ทั้งหมด {products.length} รายการ)
          </p>
        </>
      )}
    </div>
  );
}
