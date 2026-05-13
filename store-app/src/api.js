const BASE = '/api';

// ─── Products ───────────────────────────────────────────────

export async function lookupBarcode(barcode) {
  const res = await fetch(`${BASE}/products?barcode=${encodeURIComponent(barcode)}`);
  return res.json();
}

export async function getAllProducts() {
  const res = await fetch(`${BASE}/products`);
  return res.json();
}

export async function saveProduct(barcode, name, price, category) {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode, name, price, category }),
  });
  return res.json();
}

export async function updateProduct(barcode, name, price, category) {
  const res = await fetch(`${BASE}/products/${encodeURIComponent(barcode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price, category }),
  });
  return res.json();
}

export async function deleteProduct(barcode) {
  const res = await fetch(`${BASE}/products/${encodeURIComponent(barcode)}`, {
    method: 'DELETE',
  });
  return res.json();
}

// ─── Sales ──────────────────────────────────────────────────

export async function recordSale(barcode, name, price, qty = 1) {
  const res = await fetch(`${BASE}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode, name, price, qty }),
  });
  return res.json();
}

export async function getTodaySales(date) {
  const res = await fetchLocal(`/sales/today${date ? `?date=${date}` : ''}`);
  return res.json();
}
export async function getSummary(date) {
  const res = await fetchLocal(`/sales/summary${date ? `?date=${date}` : ''}`);
  return res.json();
}
export async function getTopProducts(date) {
  const res = await fetchLocal(`/sales/top${date ? `?date=${date}` : ''}`);
  return res.json();
}
export async function getHourlySales(date) {
  const res = await fetchLocal(`/sales/hourly${date ? `?date=${date}` : ''}`);
  return res.json();
}

export async function getCategories() {
  const res = await fetch(`${BASE}/categories`);
  return res.json();
}

export async function addCategory(name) {
  const res = await fetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

// ─── Utils ──────────────────────────────────────────────────

export function formatBaht(amount) {
  return `฿${Number(amount).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
