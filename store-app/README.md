# ระบบสต็อกร้านค้า 🏪

ระบบสแกนบาร์โค้ดและจัดการราคาสินค้า — ทำงานบน LAN ไม่ต้องอินเทอร์เน็ต

## สิ่งที่ต้องมี

- Node.js (ดาวน์โหลดที่ https://nodejs.org)
- PostgreSQL (ที่คุณมีอยู่แล้ว)

---

## ขั้นตอนติดตั้ง

### 1. แก้ไขไฟล์ `.env`

เปิดไฟล์ `.env` แล้วใส่ข้อมูลฐานข้อมูลของคุณ:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=store_db        ← ชื่อ database ที่ต้องการใช้ (สร้างใหม่ก็ได้)
DB_USER=postgres        ← username ของ postgres
DB_PASSWORD=รหัสผ่าน   ← รหัสผ่านของคุณ
PORT=3000
```

> หมายเหตุ: ถ้ายังไม่มี database ให้สร้างก่อนด้วย:
> `createdb store_db`  หรือสร้างใน pgAdmin

### 2. ติดตั้ง dependencies

```bash
npm install
```

### 3. Build frontend

```bash
npm run build
```

### 4. รัน server

```bash
npm run start
```

Server จะสร้าง table ใน database อัตโนมัติตอนเริ่มต้น ไม่ต้อง migrate เอง

---

## การใช้งาน

### เปิดแอป

- **เครื่อง PC :** http://localhost:3000
- **มือถือ (LAN) :** http://<IP-เครื่อง-PC>:3000

หา IP เครื่อง PC:
- Windows: เปิด CMD พิมพ์ `ipconfig` → ดูที่ IPv4 Address
- Mac/Linux: พิมพ์ `ip addr` หรือ `ifconfig`

ตัวอย่าง: `http://192.168.1.100:3000`

### แท็บในแอป

| แท็บ | ใช้สำหรับ |
|------|----------|
| **สแกน** | สแกนบาร์โค้ด ดูราคา บันทึกการขาย — ใช้บนมือถือ |
| **สินค้า** | เพิ่ม/แก้ไข/ลบสินค้าในระบบ |
| **แดชบอร์ด** | ดูยอดขายวันนี้ สินค้าขายดี กราฟรายชั่วโมง |

### การสแกนบาร์โค้ด

1. เปิดแอปบนมือถือ
2. กด **เปิดกล้องสแกนบาร์โค้ด**
3. ส่องกล้องที่บาร์โค้ด
4. ถ้ามีราคาในระบบ → แสดงราคาทันที → กด **บันทึกการขาย**
5. ถ้าไม่มี → ให้กรอกชื่อและราคา → กด **เพิ่มสินค้า**

---

## Development mode (สำหรับแก้โค้ด)

```bash
npm run dev
```

จะรัน backend ที่ port 3000 และ frontend dev server ที่ port 5173 พร้อมกัน

---

## โครงสร้างฐานข้อมูล

สร้างอัตโนมัติตอนรัน server ครั้งแรก:

```sql
-- สินค้า
products (
  barcode    TEXT PRIMARY KEY,
  name       TEXT,
  price      NUMERIC,
  category   TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- ประวัติการขาย
sales (
  id       SERIAL PRIMARY KEY,
  barcode  TEXT,
  name     TEXT,
  price    NUMERIC,
  qty      INTEGER,
  sold_at  TIMESTAMPTZ
)
```
