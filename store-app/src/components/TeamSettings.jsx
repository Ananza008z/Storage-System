import { useState, useEffect, useCallback } from 'react';
import {
  getTeamMembers,
  updateTeamMember,
  removeTeamMember,
  updateStorePassword,
  syncLocalDataToCloud,
  setForcedLocalMode,
  getForcedLocalMode,
} from '../api.js';
import {
  getCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
  isCloudConfigured,
  testCloudConnection,
} from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import schemaSql from '../../supabase/schema_and_seed.sql?raw';

export default function TeamSettings() {
  const { user, currentStore, isOwner, mode, refreshAuth, setChoosingStore } =
    useAuth();

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [msg, setMsg] = useState({ type: '', text: '' });

  // Store password update
  const [newStorePass, setNewStorePass] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  // Cloud config form
  const currentCfg = getCloudConfig();
  const [cloudUrl, setCloudUrl] = useState(currentCfg.url);
  const [cloudKey, setCloudKey] = useState(currentCfg.anonKey);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!currentStore?.id) return;
    setLoadingMembers(true);
    try {
      const list = await getTeamMembers();
      setMembers(list);
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'ไม่สามารถโหลดรายชื่อพนักงานได้' });
    } finally {
      setLoadingMembers(false);
    }
  }, [currentStore?.id]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers, mode]);

  const handleChangeStorePass = async (e) => {
    e.preventDefault();
    if (!isOwner || !newStorePass.trim()) return;
    setSavingPass(true);
    setMsg({ type: '', text: '' });
    try {
      await updateStorePassword(currentStore.id, newStorePass);
      setNewStorePass('');
      setMsg({
        type: 'ok',
        text: 'เปลี่ยนรหัสผ่านร้านค้าเรียบร้อย พนักงานใหม่ใช้ชื่อร้านและรหัสนี้เข้าร่วมได้ทันที',
      });
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'เปลี่ยนรหัสผ่านร้านค้าไม่สำเร็จ' });
    } finally {
      setSavingPass(false);
    }
  };

  const handleRoleToggle = async (member) => {
    if (!isOwner || member.user_id === user?.id) return;
    const nextRole = member.role === 'owner' ? 'staff' : 'owner';
    try {
      await updateTeamMember(member.id, { role: nextRole });
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m))
      );
      setMsg({
        type: 'ok',
        text: `เปลี่ยนสิทธิ์ของ ${member.display_name} เป็น ${
          nextRole === 'owner' ? 'เจ้าของร้าน' : 'พนักงานขาย'
        } แล้ว`,
      });
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'อัปเดตสิทธิ์ไม่สำเร็จ' });
    }
  };

  const handleActiveToggle = async (member) => {
    if (!isOwner || member.user_id === user?.id) return;
    const nextActive = member.active === false;
    try {
      await updateTeamMember(member.id, { active: nextActive });
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, active: nextActive } : m))
      );
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'อัปเดตสถานะไม่สำเร็จ' });
    }
  };

  const handleRemoveMember = async (member) => {
    if (!isOwner || member.user_id === user?.id) return;
    if (!window.confirm(`นำ "${member.display_name}" ออกจากร้าน "${currentStore?.name}"?`)) {
      return;
    }
    try {
      await removeTeamMember(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'ไม่สามารถนำสมาชิกออกได้' });
    }
  };

  const handleTestCloud = async () => {
    setTesting(true);
    setMsg({ type: '', text: '' });
    try {
      await testCloudConnection(cloudUrl, cloudKey);
      setMsg({ type: 'ok', text: 'เชื่อมต่อ Supabase สำเร็จ!' });
    } catch (err) {
      setMsg({ type: 'err', text: `เชื่อมต่อไม่สำเร็จ: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveCloud = async () => {
    if (!cloudUrl.trim() || !cloudKey.trim()) {
      setMsg({ type: 'err', text: 'กรุณากรอก Supabase URL และ Anon Key' });
      return;
    }
    saveCloudConfig(cloudUrl, cloudKey);
    setForcedLocalMode(false);
    setMsg({
      type: 'ok',
      text: 'บันทึกการตั้งค่า Cloud แล้ว กำลังสลับสู่โหมด Supabase Cloud...',
    });
    await refreshAuth();
  };

  const handleSyncToCloud = async () => {
    setSyncing(true);
    setMsg({ type: '', text: '' });
    try {
      const res = await syncLocalDataToCloud(currentStore?.id, false);
      setMsg({
        type: 'ok',
        text: `อัปโหลดข้อมูลเข้าร้าน "${currentStore?.name}" สำเร็จ! (${res.categoriesCount} หมวดหมู่, ${res.productsCount} สินค้า)`,
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text:
          err.message ||
          'อัปโหลดไม่สำเร็จ กรุณาตรวจสอบว่าได้ล็อกอินและรัน SQL Schema ล่าสุดแล้ว',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(schemaSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowSql(true);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      {msg.text && (
        <div
          className={`text-sm px-4 py-3 rounded-xl border flex justify-between items-center ${
            msg.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{msg.text}</span>
          <button
            type="button"
            onClick={() => setMsg({ type: '', text: '' })}
            className="ml-2 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Section 1: Current Store & Password */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-xs text-gray-400">ร้านค้าที่กำลังใช้งาน</p>
            <h2 className="text-lg font-bold text-gray-800">{currentStore?.name}</h2>
            <p className="text-xs text-green-700 font-medium mt-0.5">
              สิทธิ์ของคุณในร้านนี้: {isOwner ? 'เจ้าของร้าน (Owner)' : 'พนักงานขาย (Staff)'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChoosingStore(true)}
            className="text-xs px-3.5 py-2 rounded-xl border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 font-semibold"
          >
            สลับร้านค้า / สร้างร้านเพิ่ม
          </button>
        </div>

        {isOwner && (
          <form
            onSubmit={handleChangeStorePass}
            className="border-t border-gray-100 pt-3.5 space-y-2"
          >
            <p className="text-xs font-semibold text-gray-700">
              เปลี่ยนรหัสผ่านร้านค้า (สำหรับให้พนักงานกรอกเข้าร่วมร้าน)
            </p>
            <p className="text-[11px] text-gray-400">
              วิธีเพิ่มพนักงาน: ให้พนักงานสมัครบัญชีของตัวเอง แล้วกด "เข้าร่วมร้านค้า" โดยใช้ชื่อร้าน{' '}
              <span className="font-semibold text-gray-600">"{currentStore?.name}"</span>{' '}
              พร้อมรหัสผ่านร้านนี้
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={newStorePass}
                onChange={(e) => setNewStorePass(e.target.value)}
                placeholder="รหัสผ่านร้านค้าใหม่..."
                required
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
              <button
                type="submit"
                disabled={savingPass || !newStorePass}
                className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
              >
                {savingPass ? 'กำลังบันทึก...' : 'อัปเดตรหัสผ่านร้าน'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Section 2: Store Members & Roles */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-800">สมาชิกและพนักงานในร้านนี้</h2>
            <p className="text-xs text-gray-400">
              จัดการสิทธิ์เจ้าของร้าน (Owner) และพนักงาน (Staff) เฉพาะร้าน {currentStore?.name}
            </p>
          </div>
          <span className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium">
            {members.length} คน
          </span>
        </div>

        {loadingMembers ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-green-700 border-t-transparent rounded-full spin" />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map((m) => {
              const isSelf = m.user_id === user?.id;
              const isUserOwner = m.role === 'owner';
              const active = m.active !== false;
              return (
                <div
                  key={m.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">
                        {m.display_name}
                      </span>
                      {isSelf && (
                        <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          คุณ
                        </span>
                      )}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                          isUserOwner
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {isUserOwner ? 'เจ้าของร้าน (Owner)' : 'พนักงาน (Staff)'}
                      </span>
                      {!active && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                          ระงับสิทธิ์
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{m.email}</p>
                  </div>

                  {isOwner && !isSelf && (
                    <div className="flex gap-1.5 shrink-0 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleRoleToggle(m)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium"
                      >
                        สลับเป็น {isUserOwner ? 'Staff' : 'Owner'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleActiveToggle(m)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
                          active
                            ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                            : 'border-green-200 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {active ? 'ระงับสิทธิ์' : 'เปิดสิทธิ์'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 font-medium"
                      >
                        ลบออก
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Cloud Connection & SQL Migration */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-bold text-gray-800">
              เชื่อมต่อระบบ Cloud & ฐานข้อมูล (Supabase)
            </h2>
            <p className="text-xs text-gray-400">
              สถานะปัจจุบัน:{' '}
              <span
                className={`font-semibold ${
                  mode === 'cloud' ? 'text-green-700' : 'text-amber-700'
                }`}
              >
                {mode === 'cloud'
                  ? 'Supabase Cloud (ออนไลน์)'
                  : 'โหมดสาธิต / ออฟไลน์ (Local Mode)'}
              </span>
            </p>
          </div>
          {isCloudConfigured() && (
            <button
              type="button"
              onClick={async () => {
                setForcedLocalMode(!getForcedLocalMode());
                await refreshAuth();
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium"
            >
              {mode === 'cloud' ? 'สลับไปโหมดออฟไลน์' : 'สลับไปใช้ Cloud'}
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Supabase URL</label>
            <input
              value={cloudUrl}
              onChange={(e) => setCloudUrl(e.target.value)}
              placeholder="https://your-project.supabase.co"
              disabled={currentCfg.source === 'env'}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm disabled:bg-gray-50 focus:outline-none focus:border-green-600"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Supabase Publishable / Anon Key
            </label>
            <input
              value={cloudKey}
              onChange={(e) => setCloudKey(e.target.value)}
              placeholder="sb_publishable_... หรือ eyJ..."
              disabled={currentCfg.source === 'env'}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono disabled:bg-gray-50 focus:outline-none focus:border-green-600"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleTestCloud}
            disabled={testing}
            className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50"
          >
            {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
          </button>
          {currentCfg.source !== 'env' && (
            <button
              type="button"
              onClick={handleSaveCloud}
              className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-xs font-semibold"
            >
              บันทึกและเชื่อม Cloud
            </button>
          )}
          {currentCfg.source === 'storage' && (
            <button
              type="button"
              onClick={async () => {
                clearCloudConfig();
                setCloudUrl('');
                setCloudKey('');
                await refreshAuth();
              }}
              className="px-3 py-2 rounded-lg border border-red-100 text-red-500 text-xs hover:bg-red-50"
            >
              ล้างค่า Cloud
            </button>
          )}
        </div>

        {/* 1-Click Migration & SQL Setup */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-700">
                สคริปต์ฐานข้อมูล Multi-Store & ย้ายสินค้า 68 รายการ
              </p>
              <p className="text-xs text-gray-400">
                รันสคริปต์ SQL ด้านล่างใน Supabase SQL Editor เพื่อสร้างตาราง Multi-Store และแก้สิทธิ์ตารางทั้งหมด
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopySql}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50"
              >
                {copied ? '✓ คัดลอก SQL แล้ว' : 'คัดลอก SQL'}
              </button>
              <button
                type="button"
                onClick={() => setShowSql((s) => !s)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50"
              >
                {showSql ? 'ซ่อน SQL' : 'ดูสคริปต์ SQL'}
              </button>
            </div>
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={handleSyncToCloud}
              disabled={syncing || !isCloudConfigured()}
              className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {syncing
                ? 'กำลังอัปโหลดข้อมูลเข้าร้าน...'
                : 'อัปโหลดสินค้า 68 รายการเข้าร้านนี้ (Sync Now)'}
            </button>
          )}

          {showSql && (
            <div className="bg-gray-900 text-gray-100 rounded-xl p-3 overflow-x-auto max-h-72 overflow-y-auto">
              <pre className="text-[11px] font-mono whitespace-pre">{schemaSql}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
