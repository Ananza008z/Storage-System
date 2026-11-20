# ระบบร้านค้า POS & คลังสินค้า (Multi-Store Cloud + Native Mobile & PC)

ระบบ POS สแกนบาร์โค้ดและจัดการสต็อกสินค้าแบบ **Multi-Store Serverless (React + Supabase BaaS)**  
รองรับทั้ง **แอปมือถือ Native (Android / iOS ผ่าน Capacitor)** และ **เครื่อง PC เคาน์เตอร์ร้านค้าพร้อมเครื่องยิงบาร์โค้ด USB / Bluetooth**

---

## ความสามารถหลัก (v3)

1. **Multi-Store (1 บัญชี สร้างหรือเข้าร่วมหลายร้านได้):**
   - **สร้างร้านค้าใหม่:** ตั้งชื่อร้าน + รหัสผ่านร้านค้า → เจ้าของร้านได้รับสิทธิ์ **`owner`**
   - **เข้าร่วมร้านค้า (สำหรับพนักงาน):** สมัครบัญชีส่วนตัว แล้วกรอก **ชื่อร้านค้า + รหัสผ่านร้าน** → ได้รับสิทธิ์ **`staff` (พนักงานขาย)** ของร้านนั้นทันที
   - ข้อมูลสินค้า หมวดหมู่ บิลขาย และพนักงาน แยกอิสระตาม `store_id` ของแต่ละร้าน
2. **สแกนเนอร์ความเร็วสูง (Native Hardware + PC Gun):**
   - **มือถือ:** ใช้ **`window.BarcodeDetector`** (MLKit บน Android / Vision บน iOS ระดับ 60 FPS สแกนติดในเฟรมเดียว + ปุ่มไฟฉาย `🔦`) และรองรับปลั๊กอิน Native เมื่อคอมไพล์ด้วย Capacitor
   - **PC เคาน์เตอร์:** ดักรับสัญญาณ **เครื่องยิงบาร์โค้ด USB / Bluetooth (Keyboard Wedge)** อัตโนมัติจากทุกจุดบนหน้าขาย ไม่ต้องคลิกช่องค้นหาก่อน พร้อมคีย์ลัด `F2` (ค้นหา) / `F9` (ชำระเงิน) และตารางสินค้ากดเลือกด่วน
3. **ระบบบิลขายและสต็อก:**
   - รวมตะกร้าเป็นบิล (`orders` + `order_items`), คำนวณเงินทอน (เงินสด / โอน QR), ตัดสต็อกอัตโนมัติ, แจ้งเตือนสต็อกต่ำ, และ `owner` สามารถดูต้นทุน/กำไร หรือยกเลิกบิลคืนสต็อกได้

---

## วิธีติดตั้งฐานข้อมูล Supabase (แก้ `permission denied` และเปิด Multi-Store)

1. เปิดโปรเจกต์ใน [Supabase Dashboard](https://supabase.com) → เข้าเมนู **SQL Editor**
2. เปิดไฟล์ [`supabase/schema_and_seed.sql`](./supabase/schema_and_seed.sql) คัดลอกทั้งหมดไปวางแล้วกด **Run**
   - สคริปต์จะสร้างตาราง `profiles`, `stores`, `store_members`, `categories`, `products`, `orders`, `order_items`, ฟังก์ชัน `create_store_with_password` / `join_store_with_password` และตั้งค่า **`GRANT` + RLS Policies** ให้เรียบร้อย
3. *(แนะนำ)* ใน Supabase **Authentication → Sign In / Providers → Email** ปิด **Confirm email** เพื่อให้พนักงานสมัครแล้วเข้าใช้งานได้ทันที
4. ตั้งค่า `.env` (ดูตัวอย่างใน `.env.example`):
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

---

## การรันบน PC และ Deploy ขึ้น Cloud

```bash
cd store-app
npm run dev     # ทดสอบบนเครื่อง http://localhost:5173
npm run build   # Build สำหรับ Vercel / Cloudflare Pages / Capacitor
```

- **โหมดสาธิต (Local Mode):** หากไม่ได้ต่อ Cloud สามารถกดเข้าสู่ระบบด่วนได้ด้วย `owner@store.local` / `owner1234` (เจ้าของร้าน) หรือ `staff@store.local` / `staff1234` (พนักงานขาย) รหัสผ่านร้านสาธิตคือ `1234`

---

## การทำเป็นแอปมือถือ Native (Android APK / iOS App ด้วย Capacitor)

ไฟล์ [`capacitor.config.json`](./capacitor.config.json) ถูกตั้งค่าไว้แล้ว (`appId: com.storesystem.pos`, `webDir: dist`):

1. ติดตั้งแพ็กเกจ Capacitor ในโฟลเดอร์ `store-app`:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android
   ```
2. Build และสร้างโปรเจกต์ Android (หรือ iOS บน Mac):
   ```bash
   npm run build
   npx cap add android
   npx cap sync
   npx cap open android
   ```
3. *(ตัวเลือกเสริมสำหรับความเร็ว Native เต็มพิกัด)* ติดตั้งปลั๊กอิน `@capacitor-mlkit/barcode-scanning` หรือเปิดใช้งานกล้องผ่าน HTTPS/Capacitor WebView ซึ่งรองรับ `BarcodeDetector` ของ Android/iOS อยู่แล้ว
4. กด **Build APK / Run** จาก Android Studio เพื่อลงในเครื่องพนักงานได้เลย
