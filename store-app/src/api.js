import {
  DEFAULT_LOCAL_STORE_ID,
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_STORES,
  SEED_STORE_MEMBERS,
  SEED_USERS,
  buildSeedOrders,
} from './data/seedData.js';
import {
  isCloudConfigured,
  restGet,
  restPost,
  restPatch,
  restDelete,
  restRpc,
} from './lib/supabase.js';

const KEYS = {
  PRODUCTS: 'store_local_products_v2',
  CATEGORIES: 'store_local_categories_v2',
  ORDERS: 'store_local_orders_v2',
  USERS: 'store_local_users_v2',
  STORES: 'store_local_stores_v2',
  MEMBERS: 'store_local_members_v2',
  LOCAL_SESSION: 'store_local_session',
  ACTIVE_STORE: 'store_active_store_id',
  PRODUCTS_CACHE: 'store_products_cache_v2',
  FORCE_LOCAL: 'store_force_local_mode',
};

export function getForcedLocalMode() {
  return localStorage.getItem(KEYS.FORCE_LOCAL) === '1';
}

export function setForcedLocalMode(enabled) {
  if (enabled) localStorage.setItem(KEYS.FORCE_LOCAL, '1');
  else localStorage.removeItem(KEYS.FORCE_LOCAL);
}

export function isCloudActive() {
  return isCloudConfigured() && !getForcedLocalMode();
}

export function getActiveStoreId() {
  return localStorage.getItem(KEYS.ACTIVE_STORE) || '';
}

export function setActiveStoreId(storeId) {
  if (storeId) localStorage.setItem(KEYS.ACTIVE_STORE, storeId);
  else localStorage.removeItem(KEYS.ACTIVE_STORE);
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
  return readJson(KEYS.CATEGORIES, () =>
    SEED_CATEGORIES.map((name) => ({ store_id: DEFAULT_LOCAL_STORE_ID, name }))
  );
}

export function getLocalOrdersStore() {
  return readJson(KEYS.ORDERS, () => buildSeedOrders());
}

export function getLocalUsersStore() {
  return readJson(KEYS.USERS, () => SEED_USERS);
}

export function getLocalStoresStore() {
  return readJson(KEYS.STORES, () => SEED_STORES);
}

export function getLocalMembersStore() {
  return readJson(KEYS.MEMBERS, () => SEED_STORE_MEMBERS);
}

export function getLocalSessionUserId() {
  return localStorage.getItem(KEYS.LOCAL_SESSION) || '';
}

export function setLocalSessionUserId(userId) {
  if (userId) localStorage.setItem(KEYS.LOCAL_SESSION, userId);
  else localStorage.removeItem(KEYS.LOCAL_SESSION);
}

function getCacheKey(storeId) {
  return `${KEYS.PRODUCTS_CACHE}_${storeId || 'default'}`;
}

function updateProductsCache(storeId, products) {
  try {
    if (storeId && Array.isArray(products)) {
      localStorage.setItem(getCacheKey(storeId), JSON.stringify(products));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function getProductsCache(storeId) {
  try {
    const raw = localStorage.getItem(getCacheKey(storeId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function requireStoreId() {
  const sid = getActiveStoreId();
  if (!sid) throw new Error('กรุณาเลือกร้านค้าก่อนใช้งาน');
  return sid;
}

function normalizeProduct(raw) {
  return {
    store_id: raw.store_id || getActiveStoreId(),
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

// ─── Multi-Store Management ─────────────────────────────────────────────────

export async function getMyStores(userId) {
  if (!userId) return [];

  if (isCloudActive()) {
    const rows = await restGet('store_members', {
      user_id: `eq.${userId}`,
      select: 'id,store_id,role,active,stores(id,name,owner_id,created_at)',
      order: 'created_at.asc',
    });
    return (rows || []).map((r) => ({
      member_id: r.id,
      id: r.store_id,
      name: r.stores?.name || 'ร้านค้า',
      owner_id: r.stores?.owner_id || null,
      role: r.role,
      active: r.active !== false,
      created_at: r.stores?.created_at || r.created_at,
    }));
  }

  const stores = getLocalStoresStore();
  const members = getLocalMembersStore();
  return members
    .filter((m) => m.user_id === userId)
    .map((m) => {
      const store = stores.find((s) => s.id === m.store_id);
      if (!store) return null;
      return {
        member_id: m.id,
        id: store.id,
        name: store.name,
        owner_id: store.owner_id,
        role: m.role,
        active: m.active !== false,
        created_at: store.created_at,
      };
    })
    .filter(Boolean);
}

export async function createStore({ name, password, seedDefaultData = true, user }) {
  const cleanName = String(name || '').trim();
  const cleanPass = String(password || '');
  if (!cleanName) throw new Error('กรุณากรอกชื่อร้านค้า');
  if (!cleanPass) throw new Error('กรุณากำหนดรหัสผ่านร้านค้า');

  if (isCloudActive()) {
    const res = await restRpc('create_store_with_password', {
      p_name: cleanName,
      p_password: cleanPass,
    });
    const storeId = res.store_id;
    setActiveStoreId(storeId);
    if (seedDefaultData) {
      await syncLocalDataToCloud(storeId, true);
    }
    return {
      id: storeId,
      name: res.name,
      role: res.role || 'owner',
      active: true,
    };
  }

  const stores = getLocalStoresStore();
  if (stores.some((s) => s.name.trim().toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(`ชื่อร้านค้า "${cleanName}" ถูกใช้แล้ว`);
  }

  const newStore = {
    id: `local-store-${Date.now()}`,
    name: cleanName,
    store_password: cleanPass,
    owner_id: user?.id || 'local-owner-1',
    created_at: new Date().toISOString(),
  };
  stores.push(newStore);
  writeJson(KEYS.STORES, stores);

  const members = getLocalMembersStore();
  members.push({
    id: Date.now(),
    store_id: newStore.id,
    user_id: user?.id || 'local-owner-1',
    role: 'owner',
    active: true,
    created_at: new Date().toISOString(),
  });
  writeJson(KEYS.MEMBERS, members);

  if (seedDefaultData) {
    const cats = getLocalCategoriesStore();
    SEED_CATEGORIES.forEach((catName) => {
      cats.push({ store_id: newStore.id, name: catName });
    });
    writeJson(KEYS.CATEGORIES, cats);

    const prods = getLocalProductsStore();
    SEED_PRODUCTS.forEach((p) => {
      prods.push({ ...p, store_id: newStore.id });
    });
    writeJson(KEYS.PRODUCTS, prods);
  }

  setActiveStoreId(newStore.id);
  return {
    id: newStore.id,
    name: newStore.name,
    role: 'owner',
    active: true,
  };
}

export async function joinStore({ name, password, user }) {
  const cleanName = String(name || '').trim();
  const cleanPass = String(password || '');
  if (!cleanName || !cleanPass) {
    throw new Error('กรุณากรอกชื่อร้านค้าและรหัสผ่านร้านค้า');
  }

  if (isCloudActive()) {
    const res = await restRpc('join_store_with_password', {
      p_name: cleanName,
      p_password: cleanPass,
    });
    setActiveStoreId(res.store_id);
    return {
      id: res.store_id,
      name: res.name,
      role: res.role || 'staff',
      active: res.active !== false,
    };
  }

  const stores = getLocalStoresStore();
  const store = stores.find(
    (s) => s.name.trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (!store || store.store_password !== cleanPass) {
    throw new Error('ชื่อร้านค้าหรือรหัสผ่านร้านค้าไม่ถูกต้อง');
  }

  const members = getLocalMembersStore();
  let membership = members.find(
    (m) => m.store_id === store.id && m.user_id === user?.id
  );
  if (!membership) {
    membership = {
      id: Date.now(),
      store_id: store.id,
      user_id: user?.id,
      role: 'staff',
      active: true,
      created_at: new Date().toISOString(),
    };
    members.push(membership);
    writeJson(KEYS.MEMBERS, members);
  }

  setActiveStoreId(store.id);
  return {
    id: store.id,
    name: store.name,
    role: membership.role,
    active: membership.active !== false,
  };
}

export async function updateStorePassword(storeId, newPassword) {
  const sid = storeId || requireStoreId();
  const cleanPass = String(newPassword || '');
  if (!cleanPass) throw new Error('กรุณากรอกรหัสผ่านใหม่ของร้านค้า');

  if (isCloudActive()) {
    await restRpc('change_store_password', {
      p_store_id: sid,
      p_new_password: cleanPass,
    });
    return true;
  }

  const stores = getLocalStoresStore();
  const idx = stores.findIndex((s) => s.id === sid);
  if (idx === -1) throw new Error('ไม่พบร้านค้า');
  stores[idx] = { ...stores[idx], store_password: cleanPass };
  writeJson(KEYS.STORES, stores);
  return true;
}

// ─── Products ───────────────────────────────────────────────────────────────

export async function lookupBarcode(barcode) {
  const storeId = requireStoreId();
  const code = String(barcode || '').trim();
  if (!code) return { found: false };

  if (isCloudActive()) {
    try {
      const rows = await restGet('products', {
        store_id: `eq.${storeId}`,
        barcode: `eq.${code}`,
        select: '*',
      });
      if (rows?.length > 0) {
        return { found: true, product: normalizeProduct(rows[0]) };
      }
      return { found: false };
    } catch (err) {
      const cached = getProductsCache(storeId).find((p) => p.barcode === code);
      if (cached) {
        return { found: true, product: normalizeProduct(cached), offlineCache: true };
      }
      throw err;
    }
  }

  const products = getLocalProductsStore();
  const hit = products.find((p) => p.store_id === storeId && p.barcode === code);
  if (!hit) return { found: false };
  return { found: true, product: normalizeProduct(hit) };
}

export async function getAllProducts() {
  const storeId = requireStoreId();

  if (isCloudActive()) {
    const rows = await restGet('products', {
      store_id: `eq.${storeId}`,
      select: '*',
      order: 'name.asc',
    });
    const normalized = (rows || []).map(normalizeProduct);
    updateProductsCache(storeId, normalized);
    return normalized;
  }

  const products = getLocalProductsStore()
    .filter((p) => p.store_id === storeId)
    .map(normalizeProduct)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  updateProductsCache(storeId, products);
  return products;
}

export async function saveProduct(productData) {
  const storeId = requireStoreId();
  const now = new Date().toISOString();
  const payload = {
    store_id: storeId,
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
      { Prefer: 'resolution=merge-duplicates,return=representation' },
      { on_conflict: 'store_id,barcode' }
    );
    const saved = normalizeProduct(rows?.[0] || payload);
    const cache = getProductsCache(storeId);
    const idx = cache.findIndex((p) => p.barcode === saved.barcode);
    if (idx !== -1) cache[idx] = saved;
    else cache.push(saved);
    updateProductsCache(storeId, cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex(
    (p) => p.store_id === storeId && p.barcode === payload.barcode
  );
  let saved;
  if (idx !== -1) {
    saved = normalizeProduct({ ...products[idx], ...payload });
    products[idx] = saved;
  } else {
    saved = normalizeProduct({ ...payload, created_at: now });
    products.push(saved);
  }
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(
    storeId,
    products.filter((p) => p.store_id === storeId)
  );
  return saved;
}

export async function updateProduct(barcode, productData) {
  const storeId = requireStoreId();
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
    const rows = await restPatch(
      'products',
      { store_id: `eq.${storeId}`, barcode: `eq.${code}` },
      patch
    );
    if (!rows?.length) throw new Error('ไม่พบสินค้าในระบบ');
    const saved = normalizeProduct(rows[0]);
    const cache = getProductsCache(storeId);
    const idx = cache.findIndex((p) => p.barcode === code);
    if (idx !== -1) cache[idx] = saved;
    updateProductsCache(storeId, cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex(
    (p) => p.store_id === storeId && p.barcode === code
  );
  if (idx === -1) throw new Error('ไม่พบสินค้าในระบบ');
  const saved = normalizeProduct({
    ...products[idx],
    ...patch,
    store_id: storeId,
    barcode: code,
  });
  products[idx] = saved;
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(
    storeId,
    products.filter((p) => p.store_id === storeId)
  );
  return saved;
}

export async function adjustStock(barcode, delta) {
  const storeId = requireStoreId();
  const code = String(barcode || '').trim();
  const change = parseInt(delta, 10) || 0;

  if (isCloudActive()) {
    const found = await lookupBarcode(code);
    if (!found.found) throw new Error('ไม่พบสินค้า');
    const nextQty = Math.max(0, Number(found.product.stock_qty || 0) + change);
    const rows = await restPatch(
      'products',
      { store_id: `eq.${storeId}`, barcode: `eq.${code}` },
      { stock_qty: nextQty, updated_at: new Date().toISOString() }
    );
    const saved = normalizeProduct(rows?.[0] || { ...found.product, stock_qty: nextQty });
    const cache = getProductsCache(storeId);
    const idx = cache.findIndex((p) => p.barcode === code);
    if (idx !== -1) cache[idx] = saved;
    updateProductsCache(storeId, cache);
    return saved;
  }

  const products = getLocalProductsStore();
  const idx = products.findIndex(
    (p) => p.store_id === storeId && p.barcode === code
  );
  if (idx === -1) throw new Error('ไม่พบสินค้า');
  const nextQty = Math.max(0, Number(products[idx].stock_qty || 0) + change);
  products[idx] = normalizeProduct({
    ...products[idx],
    stock_qty: nextQty,
    updated_at: new Date().toISOString(),
  });
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(
    storeId,
    products.filter((p) => p.store_id === storeId)
  );
  return products[idx];
}

export async function deleteProduct(barcode) {
  const storeId = requireStoreId();
  const code = String(barcode || '').trim();
  if (isCloudActive()) {
    await restDelete('products', {
      store_id: `eq.${storeId}`,
      barcode: `eq.${code}`,
    });
    const cache = getProductsCache(storeId).filter((p) => p.barcode !== code);
    updateProductsCache(storeId, cache);
    return { ok: true };
  }

  const products = getLocalProductsStore().filter(
    (p) => !(p.store_id === storeId && p.barcode === code)
  );
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(
    storeId,
    products.filter((p) => p.store_id === storeId)
  );
  return { ok: true };
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function getCategories() {
  const storeId = requireStoreId();

  if (isCloudActive()) {
    const rows = await restGet('categories', {
      store_id: `eq.${storeId}`,
      select: 'name',
      order: 'name.asc',
    });
    return (rows || []).map((r) => r.name);
  }

  return getLocalCategoriesStore()
    .filter((c) => c.store_id === storeId)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, 'th'));
}

export async function addCategory(name) {
  const storeId = requireStoreId();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('กรุณากรอกชื่อหมวดหมู่');

  if (isCloudActive()) {
    await restPost(
      'categories',
      { store_id: storeId, name: trimmed },
      { Prefer: 'resolution=ignore-duplicates,return=representation' },
      { on_conflict: 'store_id,name' }
    );
    return { ok: true, name: trimmed };
  }

  const cats = getLocalCategoriesStore();
  if (!cats.some((c) => c.store_id === storeId && c.name === trimmed)) {
    cats.push({ store_id: storeId, name: trimmed });
    writeJson(KEYS.CATEGORIES, cats);
  }
  return { ok: true, name: trimmed };
}

export async function deleteCategory(name) {
  const storeId = requireStoreId();
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: true };

  if (isCloudActive()) {
    await restDelete('categories', {
      store_id: `eq.${storeId}`,
      name: `eq.${trimmed}`,
    });
    return { ok: true };
  }

  const cats = getLocalCategoriesStore().filter(
    (c) => !(c.store_id === storeId && c.name === trimmed)
  );
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
  const storeId = requireStoreId();
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
  const received =
    paymentMethod === 'cash' ? Number(cashReceived || totalAmount) : totalAmount;
  const changeGiven =
    paymentMethod === 'cash' ? Math.max(0, received - totalAmount) : 0;

  if (isCloudActive()) {
    const orderRows = await restPost('orders', {
      store_id: storeId,
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
      store_id: storeId,
      order_id: order.id,
      barcode: item.barcode,
      name: item.name,
      price: item.price,
      cost_price: item.cost_price,
      qty: item.qty,
      sold_at: now,
    }));
    const createdItems = await restPost('order_items', itemPayloads);

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

  const orders = getLocalOrdersStore();
  const storeOrders = orders.filter((o) => o.store_id === storeId);
  const nextOrderNo =
    storeOrders.reduce((max, o) => Math.max(max, Number(o.order_no || 0)), 0) + 1;

  const newOrder = {
    id: `local-order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    store_id: storeId,
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

  const products = getLocalProductsStore();
  let changed = false;
  for (const sold of normalizedItems) {
    const idx = products.findIndex(
      (p) => p.store_id === storeId && p.barcode === sold.barcode
    );
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
    updateProductsCache(
      storeId,
      products.filter((p) => p.store_id === storeId)
    );
  }

  return newOrder;
}

export async function voidOrder(orderId) {
  const storeId = requireStoreId();
  if (!orderId) throw new Error('ไม่พบรหัสบิล');

  if (isCloudActive()) {
    const rows = await restGet('orders', {
      store_id: `eq.${storeId}`,
      id: `eq.${orderId}`,
      select: '*,order_items(*)',
    });
    const order = rows?.[0];
    if (!order) throw new Error('ไม่พบบิลขายนี้');
    if (order.status === 'voided') return order;

    const updatedRows = await restPatch(
      'orders',
      { store_id: `eq.${storeId}`, id: `eq.${orderId}` },
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
  const idx = orders.findIndex(
    (o) => o.store_id === storeId && o.id === orderId
  );
  if (idx === -1) throw new Error('ไม่พบบิลขายนี้');
  if (orders[idx].status === 'voided') return orders[idx];

  orders[idx] = { ...orders[idx], status: 'voided' };
  writeJson(KEYS.ORDERS, orders);

  const products = getLocalProductsStore();
  const now = new Date().toISOString();
  for (const item of orders[idx].items || []) {
    const pIdx = products.findIndex(
      (p) => p.store_id === storeId && p.barcode === item.barcode
    );
    if (pIdx !== -1) {
      products[pIdx] = normalizeProduct({
        ...products[pIdx],
        stock_qty: Number(products[pIdx].stock_qty || 0) + Number(item.qty || 1),
        updated_at: now,
      });
    }
  }
  writeJson(KEYS.PRODUCTS, products);
  updateProductsCache(
    storeId,
    products.filter((p) => p.store_id === storeId)
  );
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
  const storeId = requireStoreId();
  const fromDate = dateFrom || getBangkokDateString();
  const toDate = dateTo || fromDate;

  const startTs = new Date(`${fromDate}T00:00:00+07:00`).getTime();
  const endTs = new Date(`${toDate}T23:59:59.999+07:00`).getTime();

  let rawOrders = [];
  let products = [];

  if (isCloudActive()) {
    const [ordersRes, productsRes] = await Promise.all([
      restGet('orders', {
        store_id: `eq.${storeId}`,
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
        if (o.store_id !== storeId) return false;
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

// ─── Store Team & Role Management ───────────────────────────────────────────

export async function getTeamMembers() {
  const storeId = requireStoreId();

  if (isCloudActive()) {
    const rows = await restGet('store_members', {
      store_id: `eq.${storeId}`,
      select: 'id,store_id,user_id,role,active,created_at,profiles(id,email,display_name)',
      order: 'created_at.asc',
    });
    return (rows || []).map((r) => ({
      id: r.id,
      store_id: r.store_id,
      user_id: r.user_id,
      email: r.profiles?.email || '',
      display_name: r.profiles?.display_name || 'ผู้ใช้',
      role: r.role,
      active: r.active !== false,
      created_at: r.created_at,
    }));
  }

  const users = getLocalUsersStore();
  return getLocalMembersStore()
    .filter((m) => m.store_id === storeId)
    .map((m) => {
      const u = users.find((usr) => usr.id === m.user_id);
      return {
        id: m.id,
        store_id: m.store_id,
        user_id: m.user_id,
        email: u?.email || '',
        display_name: u?.display_name || 'ผู้ใช้',
        role: m.role,
        active: m.active !== false,
        created_at: m.created_at,
      };
    });
}

export async function updateTeamMember(memberId, updates) {
  const storeId = requireStoreId();
  const allowed = {};
  if (updates.role !== undefined) allowed.role = updates.role;
  if (updates.active !== undefined) allowed.active = Boolean(updates.active);

  if (isCloudActive()) {
    const rows = await restPatch(
      'store_members',
      { id: `eq.${memberId}`, store_id: `eq.${storeId}` },
      allowed
    );
    return rows?.[0] || null;
  }

  const members = getLocalMembersStore();
  const idx = members.findIndex(
    (m) => m.id === memberId && m.store_id === storeId
  );
  if (idx === -1) throw new Error('ไม่พบสมาชิกในร้านนี้');
  members[idx] = { ...members[idx], ...allowed };
  writeJson(KEYS.MEMBERS, members);
  return members[idx];
}

export async function removeTeamMember(memberId) {
  const storeId = requireStoreId();

  if (isCloudActive()) {
    await restDelete('store_members', {
      id: `eq.${memberId}`,
      store_id: `eq.${storeId}`,
    });
    return { ok: true };
  }

  const members = getLocalMembersStore().filter(
    (m) => !(m.id === memberId && m.store_id === storeId)
  );
  writeJson(KEYS.MEMBERS, members);
  return { ok: true };
}

// ─── Cloud Migration Helper ─────────────────────────────────────────────────

export async function syncLocalDataToCloud(targetStoreId = null, useSeedDefaults = false) {
  if (!isCloudConfigured()) {
    throw new Error('กรุณาเชื่อมต่อ Supabase URL และ Anon Key ก่อนอัปโหลดข้อมูล');
  }
  const storeId = targetStoreId || requireStoreId();

  const categoryNames = useSeedDefaults
    ? SEED_CATEGORIES
    : Array.from(
        new Set(
          getLocalCategoriesStore()
            .filter((c) => c.store_id === storeId || c.store_id === DEFAULT_LOCAL_STORE_ID)
            .map((c) => c.name)
        )
      );

  const localStoreProducts = getLocalProductsStore().filter(
    (p) => p.store_id === storeId
  );
  const sourceProducts =
    !useSeedDefaults && localStoreProducts.length > 0
      ? localStoreProducts
      : SEED_PRODUCTS;

  const catPayload = (categoryNames.length ? categoryNames : SEED_CATEGORIES).map(
    (name) => ({ store_id: storeId, name })
  );
  if (catPayload.length > 0) {
    await restPost(
      'categories',
      catPayload,
      { Prefer: 'resolution=ignore-duplicates,return=representation' },
      { on_conflict: 'store_id,name' }
    );
  }

  const chunkSize = 50;
  for (let i = 0; i < sourceProducts.length; i += chunkSize) {
    const chunk = sourceProducts.slice(i, i + chunkSize).map((p) => ({
      store_id: storeId,
      barcode: p.barcode,
      name: p.name,
      price: Number(p.price),
      cost_price: Number(p.cost_price ?? 0),
      stock_qty: Number.isFinite(Number(p.stock_qty)) ? parseInt(p.stock_qty, 10) : 24,
      low_stock_threshold: Number.isFinite(Number(p.low_stock_threshold))
        ? parseInt(p.low_stock_threshold, 10)
        : 5,
      category: p.category || '',
      updated_at: new Date().toISOString(),
    }));
    await restPost(
      'products',
      chunk,
      { Prefer: 'resolution=merge-duplicates,return=representation' },
      { on_conflict: 'store_id,barcode' }
    );
  }

  return {
    categoriesCount: catPayload.length,
    productsCount: sourceProducts.length,
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
