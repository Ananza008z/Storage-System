import { useState, useEffect, useCallback } from 'react';
import {
  getTeamMembers,
  updateTeamMember,
  createTeamMember,
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
  const { profile, isOwner, mode, refreshAuth } = useAuth();

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [msg, setMsg] = useState({ type: '', text: '' });

  // Add new staff form
  const [newUser, setNewUser] = useState({
    display_name: '',
    email: '',
    password: '',
    role: 'staff',
  });
  const [creating, setCreating] = useState(false);

  // Cloud config form
  const currentCfg = getCloudConfig();
  const [cloudUrl, setCloudUrl] = useState(currentCfg.url);
  const [cloudKey, setCloudKey] = useState(currentCfg.anonKey);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const list = await getTeamMembers();
      setMembers(list);
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'ไม่สามารถโหลดรายชื่อพนักงานได้' });
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers, mode]);

  const handleRoleToggle = async (member) => {
    if (!isOwner || member.id === profile?.id) return;
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
    if (!isOwner || member.id === profile?.id) return;
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

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!isOwner) return;
    setCreating(true);
    setMsg({ type: '', text: '' });
    try {
      const created = await createTeamMember(newUser);
      setNewUser({ display_name: '', email: '', password: '', role: 'staff' });
      setMsg({
        type: 'ok',
        text: created.needsEmailConfirm
          ? `สร้างบัญชี ${created.email} แล้ว (ผู้ใช้ต้องยืนยันอีเมลก่อนเข้าใช้งาน)`
          : `เพิ่มบัญชี ${created.display_name} (${created.email}) เรียบร้อย`,
      });
      loadMembers();
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'สร้างบัญชีไม่สำเร็จ' });
    } finally {
      setCreating(false);
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
      const res = await syncLocalDataToCloud();
      setMsg({
        type: 'ok',
        text: `อัปโหลดข้อมูลขึ้น Supabase Cloud สำเร็จ! (${res.categoriesCount} หมวดหมู่, ${res.productsCount} สินค้า)`,
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text:
          err.message ||
          'อัปโหลดไม่สำเร็จ กรุณาตรวจสอบว่าได้ล็อกอินด้วยบัญชี Supabase Cloud และรัน SQL Schema แล้ว',
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

      {/* Section 1: Team & Roles */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-800">จัดการบัญชีและสิทธิ์พนักงาน</h2>
            <p className="text-xs text-gray-400">
              1 ร้านค้า • แยกสิทธิ์เจ้าของร้าน (Owner) และพนักงานขาย (Staff)
            </p>
          </div>
          <span className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium">
            {members.length} บัญชี
          </span>
        </div>

        {loadingMembers ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-green-700 border-t-transparent rounded-full spin" />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map((m) => {
              const isSelf = m.id === profile?.id;
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
                        {isUserOwner ? 'เจ้าของร้าน (Owner)' : 'พนักงานขาย (Staff)'}
                      </span>
                      {!active && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                          ระงับการใช้งาน
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{m.email}</p>
                  </div>

                  {isOwner && !isSelf && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRoleToggle(m)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium"
                      >
                        สลับเป็น {isUserOwner ? 'Staff' : 'Owner'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleActiveToggle(m)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${
                          active
                            ? 'border-red-100 text-red-600 hover:bg-red-50'
                            : 'border-green-200 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {active ? 'ระงับบัญชี' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Create new user form (Owner only) */}
        {isOwner && (
          <form
            onSubmit={handleCreateUser}
            className="border-t border-gray-100 pt-4 space-y-3"
          >
            <p className="text-xs font-semibold text-gray-600">+ เพิ่มบัญชีพนักงานใหม่</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                value={newUser.display_name}
                onChange={(e) =>
                  setNewUser((u) => ({ ...u, display_name: e.target.value }))
                }
                placeholder="ชื่อพนักงาน *"
                required
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                placeholder="อีเมลสำหรับเข้าสู่ระบบ *"
                required
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว) *"
                required
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-green-600"
              />
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:border-green-600"
              >
                <option value="staff">พนักงานขาย (Staff)</option>
                <option value="owner">เจ้าของร้าน (Owner)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-xs font-semibold disabled:opacity-50"
            >
              {creating ? 'กำลังสร้างบัญชี...' : 'สร้างบัญชีผู้ใช้'}
            </button>
          </form>
        )}
      </div>

      {/* Section 2: Cloud Connection & SQL Migration */}
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
            <label className="text-xs text-gray-500 block mb-1">Supabase Anon Key</label>
            <input
              value={cloudKey}
              onChange={(e) => setCloudKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
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
                ย้ายข้อมูลสินค้า 68 รายการขึ้น Supabase Cloud
              </p>
              <p className="text-xs text-gray-400">
                1) รันสคริปต์ SQL ใน Supabase SQL Editor • 2) กดปุ่มอัปโหลดข้อมูลสินค้าขึ้น Cloud
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

          <button
            type="button"
            onClick={handleSyncToCloud}
            disabled={syncing || !isCloudConfigured()}
            className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
          >
            {syncing
              ? 'กำลังอัปโหลดข้อมูลขึ้น Cloud...'
              : 'อัปโหลดข้อมูลสินค้า 68 รายการขึ้น Cloud (Sync Now)'}
          </button>

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
