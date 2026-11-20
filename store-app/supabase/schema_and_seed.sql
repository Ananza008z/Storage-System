-- ============================================================================
-- ระบบร้านค้า POS (Store System v2) — Supabase Schema, RLS & Seed Data
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางโค้ดนี้ทั้งหมดแล้วกด Run
-- ============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public.products (
  barcode text PRIMARY KEY,
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  cost_price numeric(10,2) NOT NULL DEFAULT 0,
  stock_qty integer NOT NULL DEFAULT 50,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  category text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE IF NOT EXISTS public.order_items (
  id serial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  cost_price numeric(10,2) NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  sold_at timestamptz DEFAULT now()
);

-- Indexes for dashboard & lookup speed
CREATE INDEX IF NOT EXISTS idx_orders_sold_at ON public.orders (sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);

-- 3. Auto-create profile when user signs up (First user automatically becomes 'owner')
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count integer;
  assigned_role text;
  meta_role text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  meta_role := new.raw_user_meta_data->>'role';

  IF user_count = 0 THEN
    assigned_role := 'owner';
  ELSIF meta_role IN ('owner', 'staff') THEN
    assigned_role := meta_role;
  ELSE
    assigned_role := 'staff';
  END IF;

  INSERT INTO public.profiles (id, email, display_name, role, active)
  VALUES (
    new.id,
    COALESCE(new.email, ''),
    COALESCE(NULLIF(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(COALESCE(new.email, 'user'), '@', 1)),
    assigned_role,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. RLS Helper Functions
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true AND role = 'owner'
  );
$$;

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_active_user());

DROP POLICY IF EXISTS "profiles_update_owner" ON public.profiles;
CREATE POLICY "profiles_update_owner" ON public.profiles
  FOR UPDATE USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Categories policies
DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT USING (public.is_active_user());

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert" ON public.categories
  FOR INSERT WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "categories_delete_owner" ON public.categories;
CREATE POLICY "categories_delete_owner" ON public.categories
  FOR DELETE USING (public.is_owner());

-- Products policies
DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products
  FOR SELECT USING (public.is_active_user());

DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products
  FOR INSERT WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products
  FOR UPDATE USING (public.is_active_user()) WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "products_delete_owner" ON public.products;
CREATE POLICY "products_delete_owner" ON public.products
  FOR DELETE USING (public.is_owner());

-- Orders policies
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders
  FOR SELECT USING (public.is_active_user());

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders
  FOR INSERT WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "orders_update_owner" ON public.orders;
CREATE POLICY "orders_update_owner" ON public.orders
  FOR UPDATE USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Order items policies
DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items
  FOR SELECT USING (public.is_active_user());

DROP POLICY IF EXISTS "order_items_insert" ON public.order_items;
CREATE POLICY "order_items_insert" ON public.order_items
  FOR INSERT WITH CHECK (public.is_active_user());

-- 6. Seed Historical Store Data (5 Categories + 68 Products from backup.sql)
INSERT INTO public.categories (name) VALUES
  ('ยา'),
  ('เครื่องดื่ม'),
  ('อาหาร'),
  ('บุหรี่'),
  ('ของใช้')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.products (barcode, name, price, cost_price, stock_qty, low_stock_threshold, category) VALUES
  ('8851932354516', 'ซันซิลขวด', 20.00, 15.00, 24, 5, 'ของใช้'),
  ('8850188900058', 'โฟร์โมสต์แพ็ค', 40.00, 30.00, 24, 5, 'เครื่องดื่ม'),
  ('8859361300258', 'เหล้าข้าวหอมขวดเล็ก', 65.00, 48.75, 24, 5, 'เครื่องดื่ม'),
  ('8859361300296', 'เหล้าข้าวหมอขวดใหญ่', 105.00, 78.75, 24, 5, 'เครื่องดื่ม'),
  ('8851993616059', 'เบียร์ช้างลัง', 630.00, 472.50, 24, 5, 'เครื่องดื่ม'),
  ('8850999141015', 'เบียร์ลีโอลัง', 645.00, 483.75, 24, 5, 'เครื่องดื่ม'),
  ('8850999111018', 'เบียร์สิงห์ลัง', 695.00, 521.25, 24, 5, 'เครื่องดื่ม'),
  ('8850999014616', 'เบียร์สิงห์กระป๋องยาว', 55.00, 41.25, 24, 5, 'เครื่องดื่ม'),
  ('8850999320007', 'น้ำสิงห์ขวด', 15.00, 11.25, 24, 5, 'เครื่องดื่ม'),
  ('8854786000370', 'เหล้าขาวขวดใหญ่', 105.00, 78.75, 24, 5, 'เครื่องดื่ม'),
  ('8858992504301', 'Finasteride', 290.00, 217.50, 24, 5, 'ยา'),
  ('8850250007425', 'เบอร์ดี้แดง27ซอง', 100.00, 75.00, 24, 5, 'เครื่องดื่ม'),
  ('8850250007449', 'เบอร์ดี้เขียว27ซอง', 100.00, 75.00, 24, 5, 'เครื่องดื่ม'),
  ('8850170000797', 'บุหรี่ SMS แดงซอง', 70.00, 52.50, 24, 5, 'บุหรี่'),
  ('8851717901799', 'นมเปรี้ยวดีไลท์', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('8850250000365', 'เบอร์ดี้แดงกระป๋อง', 17.00, 12.75, 24, 5, 'เครื่องดื่ม'),
  ('8850999113005', 'เบียร์สิงห์กระป๋องสั้น', 38.00, 28.50, 24, 5, 'เครื่องดื่ม'),
  ('8850999009674', 'เบียร์ลีโอกระป๋องยาว', 50.00, 37.50, 24, 5, 'เครื่องดื่ม'),
  ('8851123237079', 'ซีวิตแดงแพ็ค', 135.00, 101.25, 24, 5, ''),
  ('8854786000417', 'เหล้าขาวขวดเล็ก', 65.00, 48.75, 24, 5, 'เครื่องดื่ม'),
  ('8851959142011', 'โค้กขวด 2 ลิตร', 40.00, 30.00, 24, 5, 'เครื่องดื่ม'),
  ('8851959144015', 'โค้กขวด 1.5 ลิตร', 30.00, 22.50, 24, 5, 'เครื่องดื่ม'),
  ('8851993625013', 'เบียร์ช้างกระป๋องยาว', 50.00, 37.50, 24, 5, 'เครื่องดื่ม'),
  ('8851993623019', 'เบียร์ช้างกระป๋องสั้น', 35.00, 26.25, 24, 5, 'เครื่องดื่ม'),
  ('8850999143002', 'เบียร์ลีโอกระป๋องสั้น', 35.00, 26.25, 24, 5, 'เครื่องดื่ม'),
  ('8850425004532', 'ปีโป้ห่อ', 25.00, 18.75, 24, 5, 'อาหาร'),
  ('8850250000358', 'เบอร์ดี้ลาเต้', 17.00, 12.75, 24, 5, 'เครื่องดื่ม'),
  ('8850424001471', 'สาหร่ายตี๋เล็กซอง', 5.00, 3.75, 24, 5, 'อาหาร'),
  ('8850170000803', 'บุหรี่ SMS เขียวซอง', 70.00, 52.50, 24, 5, 'บุหรี่'),
  ('8850170001794', 'บุหรี่ Wonder S แดงซอง', 70.00, 52.50, 24, 5, 'บุหรี่'),
  ('8850170001800', 'บุหรี่ Wonder S เขียวซอง', 70.00, 52.50, 24, 5, 'บุหรี่'),
  ('8852388000620', 'เหล้าหงส์ทองแบน', 150.00, 112.50, 24, 5, 'เครื่องดื่ม'),
  ('8858638007067', 'บิ๊กโคล่า 360 มล.', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('8855790000011', 'คาราบาวแดงขวด', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('4', 'น้ำแข็งกระสอบใส่เอง', 45.00, 33.75, 24, 5, 'เครื่องดื่ม'),
  ('5', 'น้ำแข็งกระสอบใส่ถุง', 55.00, 41.25, 24, 5, 'เครื่องดื่ม'),
  ('3', 'น้ำแข็ง 20 บาท', 20.00, 15.00, 24, 5, 'เครื่องดื่ม'),
  ('2', 'น้ำแข็ง 10 บาท', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('1', 'น้ำแข็ง 5 บาท', 5.00, 3.75, 24, 5, 'เครื่องดื่ม'),
  ('8850250014980', 'ชูรสซอง 250 กรัม.', 32.00, 24.00, 24, 5, 'อาหาร'),
  ('8850250010944', 'รสดีซอง 155 กรัม', 27.00, 20.25, 24, 5, 'อาหาร'),
  ('8851959158166', 'แฟนต้าส้ม ขวด 450 มล.', 16.00, 12.00, 24, 5, 'เครื่องดื่ม'),
  ('8850423000093', 'เฮลบลูบอยขวด', 70.00, 52.50, 24, 5, 'เครื่องดื่ม'),
  ('8996001358306', 'ขนมวาเฟโร', 5.00, 3.75, 24, 5, 'อาหาร'),
  ('8858891310027', 'อิชิตันขวด', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('8850002022805', 'ผงซักฟอก 3 แจ๋ว 300 กรัม', 20.00, 15.00, 24, 5, 'ของใช้'),
  ('9555192501879', 'หมากฝรั่งดับเบิ้ลมินต์ แบบแพ็ค', 100.00, 75.00, 24, 5, 'อาหาร'),
  ('8851959004661', 'แฟนต้าส้มขวด 245 มล.', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('8436556777493', 'ก้นกรองเย็นกล่อง', 50.00, 37.50, 24, 5, 'บุหรี่'),
  ('8851959144169', 'แฟนต้าส้มขวด 1.25 ลิตร', 30.00, 22.50, 24, 5, 'เครื่องดื่ม'),
  ('8851959144183', 'แฟนต้าเขียวขวด 1.25 ลิตร', 30.00, 22.50, 24, 5, 'เครื่องดื่ม'),
  ('8851959144176', 'แฟนต้าแดงขวด 1.25 ลิตร', 30.00, 22.50, 24, 5, 'เครื่องดื่ม'),
  ('8850127004397', 'เนสกาแฟแดง 27 ซอง', 115.00, 86.25, 24, 5, 'เครื่องดื่ม'),
  ('8850127004410', 'เนสกาแฟเขียว 27 ซอง', 115.00, 86.25, 24, 5, 'เครื่องดื่ม'),
  ('8851959139714', 'น้ำทิพย์ขวดเล็ก', 5.00, 3.75, 24, 5, 'เครื่องดื่ม'),
  ('8858998581306', 'เป็ปซี่ขวด 640 มล.', 19.00, 14.25, 24, 5, 'เครื่องดื่ม'),
  ('8851959144367', 'สไปรต์ขวด 1.25 ลิตร', 30.00, 22.50, 24, 5, 'เครื่องดื่ม'),
  ('8858998581238', 'เป็ปซี่ขวด 1.5 ลิตร', 30.00, 22.50, 24, 5, ''),
  ('8858998583607', 'เป็ปซี่ขวด 2 ลิตร', 40.00, 30.00, 24, 5, 'เครื่องดื่ม'),
  ('8850425003214', 'ขนม5บาท', 5.00, 3.75, 24, 5, 'อาหาร'),
  ('8852965100033', 'เสือ11ตัวซอง', 20.00, 15.00, 24, 5, 'ยา'),
  ('8850188800051', 'โฟร์โมสต์กล่อง', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('8851717040023', 'ดัชมิลล์รสส้มแบบกล่อง', 10.00, 7.50, 24, 5, 'เครื่องดื่ม'),
  ('95509747', 'บุหรี่ LM เขียวแบบซอง', 70.00, 52.50, 24, 5, 'บุหรี่'),
  ('8851993616011', 'ช้างขวด', 60.00, 45.00, 24, 5, 'เครื่องดื่ม'),
  ('8850124083111', 'เนสกาแฟเขียว 60 ซอง', 230.00, 172.50, 24, 5, 'เครื่องดื่ม'),
  ('8850124083081', 'เนสกาแฟแดง 60 ซอง', 230.00, 172.50, 24, 5, 'เครื่องดื่ม'),
  ('8436556777615', 'ก้นกรองแดง 250 มวน', 100.00, 75.00, 24, 5, 'บุหรี่')
ON CONFLICT (barcode) DO NOTHING;
