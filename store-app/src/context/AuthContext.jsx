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
  getActiveStoreId,
  setActiveStoreId,
  getMyStores,
  createStore,
  joinStore,
} from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [stores, setStores] = useState([]);
  const [currentStore, setCurrentStore] = useState(null);
  const [choosingStore, setChoosingStore] = useState(false);
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
    };
  }, []);

  const syncStoresForUser = useCallback(async (userId, preferredStoreId = null) => {
    if (!userId) {
      setStores([]);
      setCurrentStore(null);
      return [];
    }
    try {
      const list = await getMyStores(userId);
      setStores(list);
      const targetId = preferredStoreId || getActiveStoreId();
      let selected = list.find((s) => s.id === targetId) || null;
      if (!selected && list.length === 1) {
        selected = list[0];
      }
      if (selected) {
        setActiveStoreId(selected.id);
      } else {
        setActiveStoreId('');
      }
      setCurrentStore(selected);
      return list;
    } catch {
      setStores([]);
      setCurrentStore(null);
      return [];
    }
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
          await syncStoresForUser(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
          setStores([]);
          setCurrentStore(null);
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
            await syncStoresForUser(safe.id);
          } else {
            setLocalSessionUserId('');
            setUser(null);
            setProfile(null);
            setStores([]);
            setCurrentStore(null);
          }
        } else {
          setUser(null);
          setProfile(null);
          setStores([]);
          setCurrentStore(null);
        }
      }
    } catch {
      setUser(null);
      setProfile(null);
      setStores([]);
      setCurrentStore(null);
    } finally {
      setLoading(false);
    }
  }, [loadProfileForCloudUser, syncStoresForUser]);

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
      setChoosingStore(false);
      await syncStoresForUser(session.user.id);
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
    setChoosingStore(false);
    await syncStoresForUser(safe.id);
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
        setChoosingStore(false);
        await syncStoresForUser(data.user.id);
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
      created_at: new Date().toISOString(),
    };
    users.push(newUser);
    localStorage.setItem('store_local_users_v2', JSON.stringify(users));
    setLocalSessionUserId(newUser.id);
    setMode('local');
    setUser(newUser);
    setProfile(newUser);
    setChoosingStore(false);
    await syncStoresForUser(newUser.id);
    return { loggedIn: true, profile: newUser };
  };

  const selectStore = (storeId) => {
    const found = stores.find((s) => s.id === storeId) || null;
    if (found) {
      setActiveStoreId(found.id);
      setCurrentStore(found);
      setChoosingStore(false);
    }
  };

  const refreshStores = async (preferredStoreId = null) => {
    if (!user?.id) return [];
    return syncStoresForUser(user.id, preferredStoreId);
  };

  const createNewStore = async ({ name, password, seedDefaultData = true }) => {
    const created = await createStore({
      name,
      password,
      seedDefaultData,
      user: profile || user,
    });
    await syncStoresForUser(user.id, created.id);
    setChoosingStore(false);
    return created;
  };

  const joinExistingStore = async ({ name, password }) => {
    const joined = await joinStore({
      name,
      password,
      user: profile || user,
    });
    await syncStoresForUser(user.id, joined.id);
    setChoosingStore(false);
    return joined;
  };

  const logout = async () => {
    if (isCloudActive()) {
      await cloudSignOut();
    } else {
      setLocalSessionUserId('');
    }
    setActiveStoreId('');
    setUser(null);
    setProfile(null);
    setStores([]);
    setCurrentStore(null);
    setChoosingStore(false);
  };

  const value = {
    user,
    profile,
    stores,
    currentStore,
    choosingStore,
    setChoosingStore,
    isOwner: currentStore?.role === 'owner',
    isActive: currentStore ? currentStore.active !== false : true,
    mode,
    loading,
    login,
    register,
    logout,
    refreshAuth,
    selectStore,
    refreshStores,
    createNewStore,
    joinExistingStore,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
