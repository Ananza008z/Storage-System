-- ============================================================================
-- ระบบร้านค้า POS (Store System v3 — Multi-Store & Role Auth)
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางโค้ดนี้ทั้งหมดแล้วกด Run
-- ============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Reset old tables cleanly so re-running this script upgrades safely
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.store_members CASCADE;
DROP TABLE IF EXISTS public.stores CASCADE;

-- 3. Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Drop legacy single-store columns on profiles if upgrading from v2
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS active;

-- 4. Stores & Store Memberships (Multi-Store)
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  store_password text NOT NULL,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.store_members (
  id serial PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (store_id, user_id)
);

-- 5. Store-Scoped Catalog & Sales Tables
CREATE TABLE public.categories (
  id serial PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE (store_id, name)
);

CREATE TABLE public.products (
  id serial PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  cost_price numeric(10,2) NOT NULL DEFAULT 0,
  stock_qty integer NOT NULL DEFAULT 50,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  category text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (store_id, barcode)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_no serial,
  cashier_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cashier_name text DEFAULT '',
  total_amount numeric(10,2) NOT NULL,
  total_cost numeric(10,2) NOT NULL DEFAULT 0,
  total_items integer NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'qr')),
  cash_received numeric(10,2) DEFAULT 0,
  change_given numeric(10,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  sold_at timestamptz DEFAULT now()
);

CREATE TABLE public.order_items (
  id serial PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  cost_price numeric(10,2) NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  sold_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_store_members_user ON public.store_members (user_id);
CREATE INDEX idx_store_members_store ON public.store_members (store_id);
CREATE INDEX idx_categories_store ON public.categories (store_id);
CREATE INDEX idx_products_store_barcode ON public.products (store_id, barcode);
CREATE INDEX idx_orders_store_sold_at ON public.orders (store_id, sold_at DESC);
CREATE INDEX idx_order_items_order_id ON public.order_items (order_id);

-- 6. Auto-create profile on signup + backfill any existing auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    COALESCE(new.email, ''),
    COALESCE(
      NULLIF(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(COALESCE(new.email, 'user'), '@', 1)
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(NULLIF(public.profiles.display_name, ''), EXCLUDED.display_name);

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (id, email, display_name)
SELECT
  id,
  COALESCE(email, ''),
  COALESCE(
    NULLIF(trim(raw_user_meta_data->>'display_name'), ''),
    split_part(COALESCE(email, 'user'), '@', 1)
  )
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 7. RLS Helper Functions
CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_store_owner(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND active = true
      AND role = 'owner'
  );
$$;

-- 8. Store Creation & Join RPC Functions (by Store Name & Store Password)
CREATE OR REPLACE FUNCTION public.create_store_with_password(p_name text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_clean_name text;
  v_store_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนสร้างร้านค้า';
  END IF;

  v_clean_name := trim(COALESCE(p_name, ''));
  IF v_clean_name = '' THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อร้านค้า';
  END IF;

  IF length(COALESCE(p_password, '')) < 1 THEN
    RAISE EXCEPTION 'กรุณากำหนดรหัสผ่านร้านค้า';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stores WHERE lower(trim(name)) = lower(v_clean_name)) THEN
    RAISE EXCEPTION 'ชื่อร้านค้า "%" ถูกใช้แล้ว กรุณาใช้ชื่ออื่น', v_clean_name;
  END IF;

  -- Ensure caller has a profile row
  INSERT INTO public.profiles (id, email, display_name)
  SELECT
    u.id,
    COALESCE(u.email, ''),
    COALESCE(NULLIF(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(COALESCE(u.email, 'user'), '@', 1))
  FROM auth.users u
  WHERE u.id = v_uid
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.stores (name, store_password, owner_id)
  VALUES (v_clean_name, p_password, v_uid)
  RETURNING id INTO v_store_id;

  INSERT INTO public.store_members (store_id, user_id, role, active)
  VALUES (v_store_id, v_uid, 'owner', true);

  RETURN json_build_object(
    'store_id', v_store_id,
    'name', v_clean_name,
    'role', 'owner',
    'active', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_store_with_password(p_name text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_clean_name text;
  v_store record;
  v_member record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนเข้าร่วมร้านค้า';
  END IF;

  v_clean_name := trim(COALESCE(p_name, ''));
  IF v_clean_name = '' OR COALESCE(p_password, '') = '' THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อร้านค้าและรหัสผ่านร้านค้า';
  END IF;

  SELECT id, name, store_password
  INTO v_store
  FROM public.stores
  WHERE lower(trim(name)) = lower(v_clean_name)
  LIMIT 1;

  IF NOT FOUND OR v_store.store_password <> p_password THEN
    RAISE EXCEPTION 'ชื่อร้านค้าหรือรหัสผ่านร้านค้าไม่ถูกต้อง';
  END IF;

  -- Ensure caller has a profile row
  INSERT INTO public.profiles (id, email, display_name)
  SELECT
    u.id,
    COALESCE(u.email, ''),
    COALESCE(NULLIF(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(COALESCE(u.email, 'user'), '@', 1))
  FROM auth.users u
  WHERE u.id = v_uid
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.store_members (store_id, user_id, role, active)
  VALUES (v_store.id, v_uid, 'staff', true)
  ON CONFLICT (store_id, user_id) DO NOTHING;

  SELECT role, active
  INTO v_member
  FROM public.store_members
  WHERE store_id = v_store.id AND user_id = v_uid;

  RETURN json_build_object(
    'store_id', v_store.id,
    'name', v_store.name,
    'role', v_member.role,
    'active', v_member.active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.change_store_password(p_store_id uuid, p_new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_store_owner(p_store_id) THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านเท่านั้นที่เปลี่ยนรหัสผ่านร้านค้าได้';
  END IF;

  IF length(COALESCE(p_new_password, '')) < 1 THEN
    RAISE EXCEPTION 'รหัสผ่านร้านค้าต้องไม่ว่าง';
  END IF;

  UPDATE public.stores
  SET store_password = p_new_password
  WHERE id = p_store_id;

  RETURN true;
END;
$$;

-- 9. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Stores
DROP POLICY IF EXISTS "stores_select" ON public.stores;
CREATE POLICY "stores_select" ON public.stores
  FOR SELECT USING (owner_id = auth.uid() OR public.is_store_member(id));

-- Store Members
DROP POLICY IF EXISTS "store_members_select" ON public.store_members;
CREATE POLICY "store_members_select" ON public.store_members
  FOR SELECT USING (user_id = auth.uid() OR public.is_store_member(store_id));

DROP POLICY IF EXISTS "store_members_update_owner" ON public.store_members;
CREATE POLICY "store_members_update_owner" ON public.store_members
  FOR UPDATE USING (public.is_store_owner(store_id)) WITH CHECK (public.is_store_owner(store_id));

DROP POLICY IF EXISTS "store_members_delete_owner" ON public.store_members;
CREATE POLICY "store_members_delete_owner" ON public.store_members
  FOR DELETE USING (public.is_store_owner(store_id));

-- Categories
DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT USING (public.is_store_member(store_id));

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert" ON public.categories
  FOR INSERT WITH CHECK (public.is_store_member(store_id));

DROP POLICY IF EXISTS "categories_delete_owner" ON public.categories;
CREATE POLICY "categories_delete_owner" ON public.categories
  FOR DELETE USING (public.is_store_owner(store_id));

-- Products
DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products
  FOR SELECT USING (public.is_store_member(store_id));

DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products
  FOR INSERT WITH CHECK (public.is_store_member(store_id));

DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products
  FOR UPDATE USING (public.is_store_member(store_id)) WITH CHECK (public.is_store_member(store_id));

DROP POLICY IF EXISTS "products_delete_owner" ON public.products;
CREATE POLICY "products_delete_owner" ON public.products
  FOR DELETE USING (public.is_store_owner(store_id));

-- Orders
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders
  FOR SELECT USING (public.is_store_member(store_id));

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders
  FOR INSERT WITH CHECK (public.is_store_member(store_id));

DROP POLICY IF EXISTS "orders_update_owner" ON public.orders;
CREATE POLICY "orders_update_owner" ON public.orders
  FOR UPDATE USING (public.is_store_owner(store_id)) WITH CHECK (public.is_store_owner(store_id));

-- Order Items
DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items
  FOR SELECT USING (public.is_store_member(store_id));

DROP POLICY IF EXISTS "order_items_insert" ON public.order_items;
CREATE POLICY "order_items_insert" ON public.order_items
  FOR INSERT WITH CHECK (public.is_store_member(store_id));

-- 10. Explicit Postgres Grants (Fixes "permission denied for table categories" & all tables)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
