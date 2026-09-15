import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const [me, setMe] = useState(null);          // logged-in user (null until checked)
  const [authReady, setAuthReady] = useState(false);
  const [shop, setShop] = useState({ shop_name: 'GarmentPOS' });
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    (async () => {
      try { setMe(await api('/api/me')); } catch { setMe(null); }
      setAuthReady(true);
      api('/api/settings').then(setShop).catch(() => {});
    })();
  }, []);

  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400);
  }, []);

  const logout = useCallback(async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    setMe(null);
    window.location.href = '/login';
  }, []);

  return (
    <AppCtx.Provider value={{ me, setMe, authReady, shop, setShop, toast, logout, toasts }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
