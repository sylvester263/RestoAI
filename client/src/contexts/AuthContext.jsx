import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

// impl-33 Part 4: the last module map this tenant got from the server, so an
// offline till still knows the plan includes the POS. Only used when the
// server can't be reached; a real answer always replaces it.
const MODULES_CACHE_KEY = 'modules_cache';
function cachedModules(tenantId) {
  try {
    const c = JSON.parse(localStorage.getItem(MODULES_CACHE_KEY) || 'null');
    return c?.tenant_id === tenantId ? c.modules : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  // impl-33: the tenant's module map. null = not loaded (or failed), which
  // the nav treats as "hide gated items" rather than showing them.
  const [modules, setModules] = useState(null);
  const [modulesLoaded, setModulesLoaded] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    const savedTenant = localStorage.getItem('tenant');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      setTenant(savedTenant ? JSON.parse(savedTenant) : null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setModules(null);
      setModulesLoaded(false);
      return undefined;
    }
    let cancelled = false;
    api.getMyModules()
      .then((res) => {
        if (cancelled) return;
        setModules(res.modules);
        localStorage.setItem(MODULES_CACHE_KEY, JSON.stringify({ tenant_id: user.tenant_id, modules: res.modules }));
      })
      .catch((err) => {
        if (cancelled) return;
        // Network failure → last known map; any server answer (403…) → nothing.
        setModules(err?.status ? null : cachedModules(user.tenant_id));
      })
      .finally(() => { if (!cancelled) setModulesLoaded(true); });
    return () => { cancelled = true; };
  }, [user]);

  function login(token, userData, tenantData) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    if (tenantData) localStorage.setItem('tenant', JSON.stringify(tenantData));
    setUser(userData);
    setTenant(tenantData);
  }

  /**
   * impl-33 Part 4: PIN unlock on this device. The session token is the
   * person's POS-scoped token (till endpoints only), never a full session.
   */
  function loginOffline(record) {
    const userData = { id: record.user_id, name: record.name, role: record.role, tenant_id: record.tenant.id, offline_session: true };
    localStorage.setItem('token', record.pos_token || '');
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('tenant', JSON.stringify(record.tenant));
    setUser(userData);
    setTenant(record.tenant);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');
    setUser(null);
    setTenant(null);
  }

  const hasModule = (name) => modules?.[name] === true;

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, loginOffline, logout, modules, modulesLoaded, hasModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
