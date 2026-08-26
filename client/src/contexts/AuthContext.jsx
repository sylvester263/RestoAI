import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

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

  function login(token, userData, tenantData) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    if (tenantData) localStorage.setItem('tenant', JSON.stringify(tenantData));
    setUser(userData);
    setTenant(tenantData);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');
    setUser(null);
    setTenant(null);
  }

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
