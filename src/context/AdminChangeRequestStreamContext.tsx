import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AUTH_STORAGE_KEYS, isRoleAdmin } from '../lib/authPayload';
import { changeRequestService } from '../services/changeRequestService';

type AdminChangeRequestStreamValue = {
  pendingCount: number;
  /** Increments on each `new_request` or `request_resolved` SSE event (and on initial admin fetch). */
  streamRefreshKey: number;
  streamConnected: boolean;
  refreshPendingMeta: () => Promise<void>;
};

const AdminChangeRequestStreamContext = createContext<AdminChangeRequestStreamValue | null>(null);

export function AdminChangeRequestStreamProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isApprovalAdmin = useMemo(() => isRoleAdmin(), [pathname]);
  const [pendingCount, setPendingCount] = useState(0);
  const [streamRefreshKey, setStreamRefreshKey] = useState(0);
  const [streamConnected, setStreamConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const bump = useCallback(() => {
    setStreamRefreshKey((k) => k + 1);
  }, []);

  const refreshPendingMeta = useCallback(async () => {
    if (!isApprovalAdmin) {
      setPendingCount(0);
      return;
    }
    try {
      const { pendingCount: c } = await changeRequestService.listAdminWithMeta();
      setPendingCount(c);
    } catch {
      /* keep last count */
    }
  }, [isApprovalAdmin]);

  useEffect(() => {
    if (!isApprovalAdmin) {
      setPendingCount(0);
      setStreamConnected(false);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      return;
    }

    void refreshPendingMeta();

    const token = localStorage.getItem(AUTH_STORAGE_KEYS.token)?.trim();
    if (!token) return;

    const url = changeRequestService.adminStreamUrl(token);
    const es = new EventSource(url);
    esRef.current = es;

    const onConnected = () => setStreamConnected(true);
    const onRefresh = () => {
      bump();
      void refreshPendingMeta();
    };

    es.addEventListener('connected', onConnected);
    es.addEventListener('new_request', onRefresh);
    es.addEventListener('request_resolved', onRefresh);
    es.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      es.removeEventListener('connected', onConnected);
      es.removeEventListener('new_request', onRefresh);
      es.removeEventListener('request_resolved', onRefresh);
      es.close();
      if (esRef.current === es) esRef.current = null;
      setStreamConnected(false);
    };
  }, [isApprovalAdmin, refreshPendingMeta, bump]);

  const value = useMemo(
    () => ({
      pendingCount,
      streamRefreshKey,
      streamConnected,
      refreshPendingMeta,
    }),
    [pendingCount, streamRefreshKey, streamConnected, refreshPendingMeta]
  );

  return (
    <AdminChangeRequestStreamContext.Provider value={value}>
      {children}
    </AdminChangeRequestStreamContext.Provider>
  );
}

export function useAdminChangeRequestStream(): AdminChangeRequestStreamValue {
  const ctx = useContext(AdminChangeRequestStreamContext);
  if (!ctx) {
    throw new Error('useAdminChangeRequestStream must be used within AdminChangeRequestStreamProvider');
  }
  return ctx;
}

/** Safe for components that may mount outside the provider (returns inert defaults). */
export function useAdminChangeRequestStreamOptional(): AdminChangeRequestStreamValue | null {
  return useContext(AdminChangeRequestStreamContext);
}
