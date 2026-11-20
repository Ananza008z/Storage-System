import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  cloudGetSession,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  restGet,
} from '../lib/supabase.js';
import {
  isCloudActive,
  getLocalUsersStore,
  getLocalSessionUserId,
  setLocalSessionUserId,
} from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState(() => (isCloudActive() ? 'cloud' : 'local'));
  const [loading, setLoading] = useState(true);

  const loadProfileForCloudUser = useCallback(async (authUser) => {
    if (!authUser?.id) return null;
    try {
      const rows = await restGet('profiles', {
        id: `eq.${authUser.id}`,
        select: '*',
      });
      if (rows?.length > 0) return rows[0];
    } catch {
      // Fallback below if profile row not readable yet
    }
    return {
      id: authUser.id,
      email: authUser.email || '',
      display_name:
        authUser.user_metadata?.display_name ||
        (authUser.email || 'user').split('@')[0],
      role: authUser.user_metadata?.role === 'owner' ? 'owner' : 'staff',
      active: true,
    };
  }, []);

  const refreshAuth = useCallback(async () => {
    setLoading(true);
    const cloud = isCloudActive();
    setMode(cloud ? 'cloud' : 'local');

    try {
      if (cloud) {
        const session = await cloudGetSession();
        if (session?.user) {
          const prof = await loadProfileForCloudUser(session.user);
          setUser(session.user);
          setProfile(prof);
        } else {
          setUser(null);
          setProfile(null);
        }
      } else {
        const savedId = getLocalSessionUserId();
        if (savedId) {
          const users = getLocalUsersStore();
          const hit = users.find((u) => u.id === savedId);
          if (hit) {
            const { password: _pw, ...safe } = hit;
            setUser(safe);
            setProfile(safe);
          } else {
            setLocalSessionUserId('');
            setUser(null);
            setProfile(null);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      }
    } catch {
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [loadProfileForCloudUser]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = async (email, password) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error('กรุณากรอกอีเมลและรหัสผ่าน');
    }

    if (isCloudActive()) {
      const session = await cloudSignIn(cleanEmail, password);
      const prof = await loadProfileForCloudUser(session.user);
      setMode('cloud');
      setUser(session.user);
      setProfile(prof);
      return prof;
    }

    const users = getLocalUsersStore();
    const hit = users.find(
      (u) => u.email.toLowerCase() === cleanEmail && u.password === password
    );
    if (!hit) {
      throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    const { password: _pw, ...safe } = hit;
    setLocalSessionUserId(safe.id);
    setMode('local');
    setUser(safe);
    setProfile(safe);
    return safe;
  };

  const register = async (email, password, displayName) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(displayName || '').trim() || cleanEmail.split('@')[0];
    if (!cleanEmail || !password || password.length < 6) {
      throw new Error('กรุณากรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร');
    }

    if (isCloudActive()) {
      const data = await cloudSignUp(cleanEmail, password, cleanName, 'staff');
      if (data?.access_token && data?.user) {
        const prof = await loadProfileForCloudUser(data.user);
        setMode('cloud');
        setUser(data.user);
        setProfile(prof);
        return { loggedIn: true, profile: prof };
      }
      return {
        loggedIn: false,
        message: 'สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลในกล่องจดหมายแล้วเข้าสู่ระบบ',
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
      role: users.length === 0 ? 'owner' : 'staff',
      active: true,
      created_at: new Date().toISOString(),
    };
    users.push(newUser);
    localStorage.setItem('store_local_users', JSON.stringify(users));
    const { password: _pw, ...safe } = newUser;
    setLocalSessionUserId(safe.id);
    setMode('local');
    setUser(safe);
    setProfile(safe);
    return { loggedIn: true, profile: safe };
  };

  const logout = async () => {
    if (isCloudActive()) {
      await cloudSignOut();
    } else {
      setLocalSessionUserId('');
    }
    setUser(null);
    setProfile(null);
  };

  const value = {
    user,
    profile,
    isOwner: profile?.role === 'owner',
    isActive: profile ? profile.active !== false : false,
    mode,
    loading,
    login,
    register,
    logout,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
