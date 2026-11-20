import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_USERS,
  buildSeedOrders,
} from './data/seedData.js';
import {
  isCloudConfigured,
  cloudAdminInviteSignUp,
  restGet,
  restPost,
  restPatch,
  restDelete,
} from './lib/supabase.js';

const KEYS = {
  PRODUCTS: 'store_local_products',
  CATEGORIES: 'store_local_categories',
  ORDERS: 'store_local_orders',
  USERS: 'store_local_users',
  LOCAL_SESSION: 'store_local_session',
  PRODUCTS_CACHE: 'store_products_cache',
  FORCE_LOCAL: 'store_force_local_mode',
};

export function getForcedLocalMode() {
  return localStorage.getItem(KEYS.FORCE_LOCAL) === '1';
}

export function setForcedLocalMode(enabled) {
  if (enabled) {
    localStorage.setItem(KEYS.FORCE_LOCAL, '1');
  } else {
    localStorage.removeItem(KEYS.FORCE_LOCAL);
  }
}

export function isCloudActive() {
  return isCloudConfigured() && !getForcedLocalMode();
}

function readJson(key, fallbackFactory) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fall through to seed initialization
  }
  const initial = fallbackFactory();
  localStorage.setItem(key, JSON.stringify(initial));
  return initial;
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

export function getLocalProductsStore() {
  return readJson(KEYS.PRODUCTS, () => SEED_PRODUCTS);
}

export function getLocalCategoriesStore() {
  return readJson(KEYS.CATEGORIES, () => SEED_CATEGORIES);
}

export function getLocalOrdersStore() {
  return readJson(KEYS.ORDERS, () => buildSeedOrders());
}

export function getLocalUsersStore() {
  return readJson(KEYS.USERS, () => SEED_USERS);
}

export function getLocalSessionUserId() {
  return localStorage.getItem(KEYS.LOCAL_SESSION) || '';
}

export function setLocalSessionUserId(userId) {
  if (userId) localStorage.setItem(KEYS.LOCAL_SESSION, userId);
  else localStorage.removeItem(KEYS.LOCAL_SESSION);
}

function updateProductsCache(products) {
  try {
    if (Array.isArray(products)) {
      localStorage.setItem(KEYS.PRODUCTS_CACHE, JSON.stringify(products));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function getProductsCache() {
  try {
    const raw = localStorage.getItem(KEYS.PRODUCTS_CACHE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function normalizeProduct(raw) {
  return {
    barcode: String(raw.barcode || '').trim(),
    name: String(raw.name || '').trim(),
    price: Number(raw.price || 0),
    cost_price: Number(raw.cost_price ?? 0),
    stock_qty: Number.isFinite(Number(raw.stock_qty)) ? parseInt(raw.stock_qty, 10) : 0,
    low_stock_threshold: Number.isFinite(Number(raw.low_stock_threshold))
      ? parseInt(raw.low_stock_threshold, 10)
      : 5,
    category: String(raw.category || '').trim(),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

// ─── Products ───────────────────────────────────────────────────────────────

export async function lookupBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return { found: false };

  if (isCloudActive()) {
    try {
      const rows = await restGet('products', {
        barcode: `eq.${code}`,
        select: '*',
      });
      if (rows?.length > 0) {
        return { found: true, product: normalizeProduct(rows[0]) };
      }
      return { found: false };
    } catch (err) {
      const cached = getProductsCache().find((p) => p.barcode === code);
      if (cached) return { found: true, product: normalizeProduct(cached), offlineCache: true };
      throw err;
    }
  }

  const products = getLocalProductsStore();
  const hit = products.find((p) => p.barcode === code);
  if (!hit) return { found: false };
  return { found: true, product: normalizeProduct(hit) };
}

export async function getAllProducts() {
  if (isCloudActive()) {
    const rows = await restGet('products', { select: '*', order: 'name.asc' });
    const normalized = (rows || []).map(normalizeProduct);
    updateProductsCache(normalized);
    return normalized;
  }

  const products = getLocalProductsStore()
    .map(normalizeProduct)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  updateProductsCache(products);
  return products;
}

export async function saveProduct(productData) {
  const now = new Date().toISOString();
  const payload = {
    barcode: String(productData.barcode || '').trim(),
    name: String(productData.name || '').trim(),
    price: Number(productData.price || 0),
    cost_price: Number(productData.cost_price ?? 0),
    stock_qty: Number.isFinite(Number(productData.stock_qty))
      ? Math.max(0, parseInt(productData.stock_qty, 10))
      : 0,
    low_stock_threshold: Number.isFinite(Number(productData.low_stock_threshold))
      ? Math.max(0, parseInt(productData.low_stock_threshold, 10))
      : 5,
    category: String(productData.category || '').trim(),
    updated_at: now,
  };

  if (!payload.barcode || !payload.name || Number.isNaN(payload.price)) {
    throw new Error('กรุณากรอกบาร์โค้ด ชื่อสินค้า และราคาให้ครบ');
  }

  if (isCloudActive()) {
    const rows = await restPost(
      'products',
      payload,
      { Prefer: 'resolution=merge-duplicates,return=representation' }
    );
    const saved = normalizeProduct(rows?.[0] || payload);
    const cache = getProductsCache();
    const idx = cache.findIndex((p) => p.barcode === saved.barcode);
    if (idx !== -1) cache[idx] = saved;
    else cache.push(saved);
    updateProductsCache(cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex((p) => p.barcode === payload.barcode);
  let saved;
  if (idx !== -1) {
    saved = normalizeProduct({ ...products[idx], ...payload });
    products[idx] = saved;
  } else {
    saved = normalizeProduct({ ...payload, created_at: now });
    products.push(saved);
  }
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(products);
  return saved;
}

export async function updateProduct(barcode, productData) {
  const code = String(barcode || '').trim();
  const now = new Date().toISOString();
  const patch = {
    name: String(productData.name || '').trim(),
    price: Number(productData.price || 0),
    cost_price: Number(productData.cost_price ?? 0),
    stock_qty: Number.isFinite(Number(productData.stock_qty))
      ? Math.max(0, parseInt(productData.stock_qty, 10))
      : 0,
    low_stock_threshold: Number.isFinite(Number(productData.low_stock_threshold))
      ? Math.max(0, parseInt(productData.low_stock_threshold, 10))
      : 5,
    category: String(productData.category || '').trim(),
    updated_at: now,
  };

  if (isCloudActive()) {
    const rows = await restPatch('products', { barcode: `eq.${code}` }, patch);
    if (!rows?.length) throw new Error('ไม่พบสินค้าในระบบ');
    const saved = normalizeProduct(rows[0]);
    const cache = getProductsCache();
    const idx = cache.findIndex((p) => p.barcode === code);
    if (idx !== -1) cache[idx] = saved;
    updateProductsCache(cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex((p) => p.barcode === code);
  if (idx === -1) throw new Error('ไม่พบสินค้าในระบบ');
  const saved = normalizeProduct({ ...products[idx], ...patch, barcode: code });
  products[idx] = saved;
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(products);
  return saved;
}

export async function adjustStock(barcode, delta) {
  const code = String(barcode || '').trim();
  const change = parseInt(delta, 10) || 0;

  if (isCloudActive()) {
    const found = await lookupBarcode(code);
    if (!found.found) throw new Error('ไม่พบสินค้า');
    const nextQty = Math.max(0, Number(found.product.stock_qty || 0) + change);
    const rows = await restPatch(
      'products',
      { barcode: `eq.${code}` },
      { stock_qty: nextQty, updated_at: new Date().toISOString() }
    );
    const saved = normalizeProduct(rows?.[0] || { ...found.product, stock_qty: nextQty });
    const cache = getProductsCache();
    const idx = cache.findIndex((p) => p.barcode === code);
    if (idx !== -1) cache[idx] = saved;
    updateProductsCache(cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex((p) => p.barcode === code);
  if (idx === -1) throw new Error('ไม่พบสินค้า');
  const nextQty = Math.max(0, Number(products[idx].stock_qty || 0) + change);
  products[idx] = normalizeProduct({
    ...products[idx],
    stock_qty: nextQty,
    updated_at: new Date().toISOString(),
  });
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(products);
  return products[idx];
}

export async function deleteProduct(barcode) {
  const code = String(barcode || '').trim();
  if (isCloudActive()) {
    await restDelete('products', { barcode: `eq.${code}` });
    const cache = getProductsCache().filter((p) => p.barcode !== code);
    updateProductsCache(cache);
    return { ok: true };
  }

  const products = getLocalProductsStore().filter((p) => p.barcode !== code);
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(products);
  return { ok: true };
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function getCategories() {
  if (isCloudActive()) {
    const rows = await restGet('categories', { select: 'name', order: 'name.asc' });
    return (rows || []).map((r) => r.name);
  }
  return [...getLocalCategoriesStore()].sort((a, b) => a.localeCompare(b, 'th'));
}

export async function addCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('กรุณากรอกชื่อหมวดหมู่');

  if (isCloudActive()) {
    await restPost(
      'categories',
      { name: trimmed },
      { Prefer: 'resolution=ignore-duplicates,return=representation' }
    );
    return { ok: true, name: trimmed };
  }

  const cats = getLocalCategoriesStore();
  if (!cats.includes(trimmed)) {
    cats.push(trimmed);
    writeJson(KEYS.CATEGORIES, cats);
  }
  return { ok: true, name: trimmed };
}

export async function deleteCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: true };

  if (isCloudActive()) {
    await restDelete('categories', { name: `eq.${trimmed}` });
    return { ok: true };
  }

  const cats = getLocalCategoriesStore().filter((c) => c !== trimmed);
  writeJson(KEYS.CATEGORIES, cats);
  return { ok: true };
}

// ─── Orders & Checkout ──────────────────────────────────────────────────────

export async function createOrder({
  items,
  paymentMethod = 'cash',
  cashReceived = 0,
  cashier = null,
}) {
  if (!items || items.length === 0) {
    throw new Error('ไม่มีสินค้าในตะกร้า');
  }

  const now = new Date().toISOString();
  const normalizedItems = items.map((item) => ({
    barcode: String(item.barcode),
    name: String(item.name),
    price: Number(item.price || 0),
    cost_price: Number(item.cost_price ?? 0),
    qty: Math.max(1, parseInt(item.qty || 1, 10)),
  }));

  const totalAmount = normalizedItems.reduce((s, i) => s + i.price * i.qty, 0);
  const totalCost = normalizedItems.reduce((s, i) => s + i.cost_price * i.qty, 0);
  const totalItems = normalizedItems.reduce((s, i) => s + i.qty, 0);
  const received = paymentMethod === 'cash' ? Number(cashReceived || totalAmount) : totalAmount;
  const changeGiven = paymentMethod === 'cash' ? Math.max(0, received - totalAmount) : 0;

  if (isCloudActive()) {
    const orderRows = await restPost('orders', {
      cashier_id: cashier?.id || null,
      cashier_name: cashier?.display_name || cashier?.email || 'พนักงาน',
      total_amount: totalAmount,
      total_cost: totalCost,
      total_items: totalItems,
      payment_method: paymentMethod,
      cash_received: received,
      change_given: changeGiven,
      status: 'completed',
      sold_at: now,
    });
    const order = orderRows?.[0];
    if (!order?.id) throw new Error('ไม่สามารถสร้างบิลขายได้');

    const itemPayloads = normalizedItems.map((item) => ({
      order_id: order.id,
      barcode: item.barcode,
      name: item.name,
      price: item.price,
      cost_price: item.cost_price,
      qty: item.qty,
      sold_at: now,
    }));
    const createdItems = await restPost('order_items', itemPayloads);

    // Deduct stock for each sold item
    await Promise.all(
      normalizedItems.map(async (item) => {
        try {
          await adjustStock(item.barcode, -item.qty);
        } catch {
          // Product might have been deleted; continue checkout cleanly
        }
      })
    );

    return {
      ...order,
      total_amount: Number(order.total_amount),
      total_cost: Number(order.total_cost || 0),
      cash_received: Number(order.cash_received || 0),
      change_given: Number(order.change_given || 0),
      items: createdItems || itemPayloads,
    };
  }

  // Local storage engine
  const orders = getLocalOrdersStore();
  const nextOrderNo =
    orders.reduce((max, o) => Math.max(max, Number(o.order_no || 0)), 0) + 1;

  const newOrder = {
    id: `local-order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    order_no: nextOrderNo,
    cashier_id: cashier?.id || null,
    cashier_name: cashier?.display_name || 'พนักงาน',
    total_amount: totalAmount,
    total_cost: totalCost,
    total_items: totalItems,
    payment_method: paymentMethod,
    cash_received: received,
    change_given: changeGiven,
    status: 'completed',
    sold_at: now,
    items: normalizedItems.map((item, idx) => ({
      id: Date.now() + idx,
      ...item,
      sold_at: now,
    })),
  };

  orders.unshift(newOrder);
  writeJson(KEYS.ORDERS, orders);

  // Deduct stock locally
  const products = getLocalProductsStore();
  let changed = false;
  for (const sold of normalizedItems) {
    const idx = products.findIndex((p) => p.barcode === sold.barcode);
    if (idx !== -1) {
      products[idx] = normalizeProduct({
        ...products[idx],
        stock_qty: Math.max(0, Number(products[idx].stock_qty || 0) - sold.qty),
        updated_at: now,
      });
      changed = true;
    }
  }
  if (changed) {
    writeJson(KEYS.PRODUCTS, products);
    updateProductsCache(products);
  }

  return newOrder;
}

export async function voidOrder(orderId) {
  if (!orderId) throw new Error('ไม่พบรหัสบิล');

  if (isCloudActive()) {
    const rows = await restGet('orders', {
      id: `eq.${orderId}`,
      select: '*,order_items(*)',
    });
    const order = rows?.[0];
    if (!order) throw new Error('ไม่พบบิลขายนี้');
    if (order.status === 'voided') return order;

    const updatedRows = await restPatch(
      'orders',
      { id: `eq.${orderId}` },
      { status: 'voided' }
    );
    const items = order.order_items || [];
    await Promise.all(
      items.map(async (item) => {
        try {
          await adjustStock(item.barcode, Number(item.qty || 1));
        } catch {
          // Ignore if product no longer exists
        }
      })
    );
    return { ...(updatedRows?.[0] || order), status: 'voided', items };
  }

  const orders = getLocalOrdersStore();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) throw new Error('ไม่พบบิลขายนี้');
  if (orders[idx].status === 'voided') return orders[idx];

  orders[idx] = { ...orders[idx], status: 'voided' };
  writeJson(KEYS.ORDERS, orders);

  // Restore stock
  const products = getLocalProductsStore();
  const now = new Date().toISOString();
  for (const item of orders[idx].items || []) {
    const pIdx = products.findIndex((p) => p.barcode === item.barcode);
    if (pIdx !== -1) {
      products[pIdx] = normalizeProduct({
        ...products[pIdx],
        stock_qty: Number(products[pIdx].stock_qty || 0) + Number(item.qty || 1),
        updated_at: now,
      });
    }
  }
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(products);
  return orders[idx];
}

// ─── Dashboard & Reporting ──────────────────────────────────────────────────

export function getBangkokDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function getBangkokHour(isoString) {
  const str = new Date(isoString).toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    hour12: false,
    hour: '2-digit',
  });
  return parseInt(str, 10) % 24;
}

export async function getDashboardData({ dateFrom, dateTo } = {}) {
  const fromDate = dateFrom || getBangkokDateString();
  const toDate = dateTo || fromDate;

  const startTs = new Date(`${fromDate}T00:00:00+07:00`).getTime();
  const endTs = new Date(`${toDate}T23:59:59.999+07:00`).getTime();

  let rawOrders = [];
  let products = [];

  if (isCloudActive()) {
    const [ordersRes, productsRes] = await Promise.all([
      restGet('orders', {
        select: '*,order_items(*)',
        and: `(sold_at.gte.${fromDate}T00:00:00+07:00,sold_at.lte.${toDate}T23:59:59.999+07:00)`,
        order: 'sold_at.desc',
      }),
      getAllProducts(),
    ]);
    rawOrders = (ordersRes || []).map((o) => ({
      ...o,
      total_amount: Number(o.total_amount || 0),
      total_cost: Number(o.total_cost || 0),
      total_items: Number(o.total_items || 0),
      cash_received: Number(o.cash_received || 0),
      change_given: Number(o.change_given || 0),
      items: (o.order_items || []).map((it) => ({
        ...it,
        price: Number(it.price || 0),
        cost_price: Number(it.cost_price || 0),
        qty: Number(it.qty || 1),
      })),
    }));
    products = productsRes;
  } else {
    products = await getAllProducts();
    rawOrders = getLocalOrdersStore()
      .filter((o) => {
        const ts = new Date(o.sold_at).getTime();
        return ts >= startTs && ts <= endTs;
      })
      .sort((a, b) => new Date(b.sold_at) - new Date(a.sold_at));
  }

  const completedOrders = rawOrders.filter((o) => o.status !== 'voided');

  let totalRevenue = 0;
  let totalCost = 0;
  let totalItems = 0;
  const uniqueBarcodes = new Set();
  const hourlyBuckets = {};
  const topMap = {};

  for (const order of completedOrders) {
    totalRevenue += Number(order.total_amount || 0);
    totalCost += Number(order.total_cost || 0);
    totalItems += Number(order.total_items || 0);

    const hr = getBangkokHour(order.sold_at);
    hourlyBuckets[hr] = (hourlyBuckets[hr] || 0) + Number(order.total_amount || 0);

    for (const item of order.items || []) {
      uniqueBarcodes.add(item.barcode);
      const qty = Number(item.qty || 1);
      const rev = Number(item.price || 0) * qty;
      const cost = Number(item.cost_price || 0) * qty;
      if (!topMap[item.barcode]) {
        topMap[item.barcode] = {
          barcode: item.barcode,
          name: item.name,
          total_qty: 0,
          total_revenue: 0,
          total_cost: 0,
        };
      }
      topMap[item.barcode].total_qty += qty;
      topMap[item.barcode].total_revenue += rev;
      topMap[item.barcode].total_cost += cost;
    }
  }

  const lowStockCount = products.filter(
    (p) => Number(p.stock_qty) <= Number(p.low_stock_threshold ?? 5)
  ).length;

  const hourly = Object.entries(hourlyBuckets)
    .map(([hour, revenue]) => ({ hour: Number(hour), revenue }))
    .sort((a, b) => a.hour - b.hour);

  const topProducts = Object.values(topMap)
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10);

  return {
    summary: {
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_profit: totalRevenue - totalCost,
      total_orders: completedOrders.length,
      total_items: totalItems,
      unique_products: uniqueBarcodes.size,
      low_stock_count: lowStockCount,
    },
    hourly,
    topProducts,
    orders: rawOrders,
  };
}

// ─── Team & Role Management ─────────────────────────────────────────────────

export async function getTeamMembers() {
  if (isCloudActive()) {
    const rows = await restGet('profiles', {
      select: '*',
      order: 'created_at.asc',
    });
    return rows || [];
  }

  return getLocalUsersStore().map(({ password, ...safe }) => safe);
}

export async function updateTeamMember(id, updates) {
  const allowed = {};
  if (updates.role !== undefined) allowed.role = updates.role;
  if (updates.active !== undefined) allowed.active = Boolean(updates.active);
  if (updates.display_name !== undefined) allowed.display_name = String(updates.display_name).trim();

  if (isCloudActive()) {
    const rows = await restPatch('profiles', { id: `eq.${id}` }, allowed);
    return rows?.[0] || null;
  }

  const users = getLocalUsersStore();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('ไม่พบบัญชีผู้ใช้');
  users[idx] = { ...users[idx], ...allowed };
  writeJson(KEYS.USERS, users);
  const { password, ...safe } = users[idx];
  return safe;
}

export async function createTeamMember({ email, password, display_name, role = 'staff' }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(display_name || '').trim() || cleanEmail.split('@')[0];
  if (!cleanEmail || !password || password.length < 6) {
    throw new Error('กรุณากรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร');
  }

  if (isCloudActive()) {
    const res = await cloudAdminInviteSignUp(cleanEmail, password, cleanName, role);
    return {
      id: res?.user?.id || null,
      email: cleanEmail,
      display_name: cleanName,
      role,
      active: true,
      needsEmailConfirm: Boolean(res?.user && !res?.access_token),
    };
  }

  const users = getLocalUsersStore();
  if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    throw new Error('อีเมลนี้ถูกใช้งานแล้ว');
  }
  const newUser = {
    id: `local-user-${Date.now()}`,
    email: cleanEmail,
    password,
    display_name: cleanName,
    role: role === 'owner' ? 'owner' : 'staff',
    active: true,
    created_at: new Date().toISOString(),
  };
  users.push(newUser);
  writeJson(KEYS.USERS, users);
  const { password: _pw, ...safe } = newUser;
  return safe;
}

// ─── Cloud Migration Helper ─────────────────────────────────────────────────

export async function syncLocalDataToCloud() {
  if (!isCloudConfigured()) {
    throw new Error('กรุณาเชื่อมต่อ Supabase URL และ Anon Key ก่อนอัปโหลดข้อมูล');
  }

  const categories = getLocalCategoriesStore();
  const products = getLocalProductsStore().map(normalizeProduct);

  const catPayload = categories.map((name) => ({ name }));
  if (catPayload.length > 0) {
    await restPost('categories', catPayload, {
      Prefer: 'resolution=ignore-duplicates,return=representation',
    });
  }

  const chunkSize = 50;
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize).map((p) => ({
      barcode: p.barcode,
      name: p.name,
      price: p.price,
      cost_price: p.cost_price,
      stock_qty: p.stock_qty,
      low_stock_threshold: p.low_stock_threshold,
      category: p.category,
      updated_at: new Date().toISOString(),
    }));
    await restPost('products', chunk, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
  }

  return {
    categoriesCount: categories.length,
    productsCount: products.length,
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function formatBaht(amount) {
  return `฿${Number(amount || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

let audioCtx = null;

export function playBeep(type = 'success') {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046, now);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  } catch {
    // Ignore audio errors when blocked by browser autoplay policy
  }
}
