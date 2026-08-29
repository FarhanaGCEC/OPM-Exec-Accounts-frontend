import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { clearAuthStorage } from './authPayload';
import { resolveApiBaseUrl } from './apiBaseUrl';

// Same-origin `/api` → Vite dev proxy or Vercel rewrite to your backend.
const API_BASE_URL = resolveApiBaseUrl();

if (import.meta.env.DEV) {
  const b = String(API_BASE_URL);
  if (/^https?:\/\//i.test(b) && !b.replace(/\/$/, '').endsWith('/api')) {
    console.warn(
      '[API] VITE_API_BASE_URL looks like a full URL without /api. Requests go to paths like /admin/users under this base — if the base is wrong you will get 404. Prefer VITE_API_BASE_URL=/api for local dev.'
    );
  }
}

// Live: HTTPS pages + VITE_API_BASE_URL=http://… → browser mixed-content blocking (API looks "down").
if (
  import.meta.env.PROD &&
  typeof window !== 'undefined' &&
  window.location.protocol === 'https:' &&
  /^http:\/\//i.test(String(API_BASE_URL).trim())
) {
  console.warn(
    '[API] Production is HTTPS but VITE_API_BASE_URL is HTTP — the browser will usually block XHR/fetch (mixed content). Fix: unset VITE_API_BASE_URL or set it to /api and proxy /api to your server (e.g. vercel.json rewrites).'
  );
}

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — every apiClient request (GET/POST/…) sends Bearer when logged in
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Helper function to check for token error and redirect
const handleTokenError = () => {
  clearAuthStorage();
  window.location.href = '/';
};

/** Let the browser set multipart boundary (axios default JSON Content-Type breaks FormData). */
function mergeFormDataRequestConfig(
  data: unknown,
  config?: AxiosRequestConfig
): AxiosRequestConfig | undefined {
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
  if (!isFormData) return config;
  return {
    ...config,
    transformRequest: [
      ...(Array.isArray(config?.transformRequest)
        ? config!.transformRequest!
        : config?.transformRequest
          ? [config.transformRequest as any]
          : []),
      (body: unknown, headers) => {
        if (body instanceof FormData && headers && typeof headers === 'object') {
          delete (headers as Record<string, unknown>)['Content-Type'];
        }
        return body;
      },
    ] as AxiosRequestConfig['transformRequest'],
  };
}

// Response interceptor - Handle errors globally
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
      // Check response body for token error message (even if status is 200)
      const responseData = response.data;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in response:', errorMessage);
            handleTokenError();
            return Promise.reject(new Error(errorMessage));
          }
        }
      }
    return response;
  },
  (error: AxiosError) => {
    // Handle common errors
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const responseData = error.response.data as any;
      
      // Check for token error in error response body
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected:', errorMessage);
            handleTokenError();
            return Promise.reject(error);
          }
        }
      }
      
      switch (status) {
        case 401: {
          try {
            const attempted = error.config ? apiClient.getUri(error.config) : '(unknown)';
            console.warn(
              '[API] 401 Unauthorized (browser sends Authorization: Bearer … only if authToken exists in localStorage). Request:',
              attempted
            );
          } catch {
            /* ignore */
          }
          handleTokenError();
          break;
        }
        case 403:
          // Forbidden
          console.error('Access forbidden');
          break;
        case 404:
          // Not found
          console.error('Resource not found');
          break;
        case 500:
          // Server error
          console.error('Server error');
          break;
        default:
          console.error('Request failed:', error.message);
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('No response received:', error.request);
    } else {
      // Something else happened
      console.error('Error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// API Response wrapper type
export interface ApiResponse<T = any> {
  data: T;
  message?: string;
  success: boolean;
  error?: string;
  /** HTTP status (e.g. 200 immediate apply, 202 queued for admin approval). */
  status?: number;
  /** True when mutation was queued (202 or CHANGE_REQUEST_SUBMITTED) — do not remove row from list. */
  changeRequestQueued?: boolean;
}

/** 202 or body code CHANGE_REQUEST_SUBMITTED — standard user edit/delete sent for approval. */
export function isQueuedForAdminApproval(status: number, body: unknown): boolean {
  if (status === 202) return true;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const walk = (node: unknown, depth: number): boolean => {
    if (depth > 8 || !node || typeof node !== 'object' || Array.isArray(node)) return false;
    const o = node as Record<string, unknown>;
    if (o.code === 'CHANGE_REQUEST_SUBMITTED') return true;
    const inner = o.data;
    if (inner != null && typeof inner === 'object') return walk(inner, depth + 1);
    return false;
  };
  return walk(body, 0);
}

function buildMutationApiResponse<T>(response: AxiosResponse<T>): ApiResponse<T> {
  const status = response.status;
  const data = response.data;
  throwIfResponseBusinessFailure(status, data);
  const changeRequestQueued = isQueuedForAdminApproval(status, data);
  return {
    data,
    success: true,
    status,
    changeRequestQueued,
    message: extractSuccessMessageFromBody(data),
  };
}

// API Error type
export interface ApiError {
  message: string;
  status?: number;
  /** Backend error code when present (e.g. APPROVAL_REQUIRED). */
  code?: string;
  errors?: Record<string, string[]>;
}

/**
 * Walk `data`, `data.data`, … (common API envelopes) and detect business failures returned with HTTP 2xx.
 * - Any object with `code: "APPROVAL_REQUIRED"` (often nested under `success: true` wrappers).
 * - Any object with `success: false` (or string `"false"`).
 */
function walkResponseEnvelopes(
  node: unknown,
  visit: (layer: Record<string, unknown>) => void,
  depth = 0
): void {
  if (depth > 6 || !node || typeof node !== 'object' || Array.isArray(node)) return;
  const o = node as Record<string, unknown>;
  visit(o);
  const inner = o.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    walkResponseEnvelopes(inner, visit, depth + 1);
  }
}

function throwIfResponseBusinessFailure(status: number, responseData: unknown): void {
  walkResponseEnvelopes(responseData, (o) => {
    if (typeof o.code === 'string' && o.code === 'APPROVAL_REQUIRED') {
      const err = new Error(String(o.error ?? o.message ?? 'Approval required'));
      (err as any).status = status;
      (err as any).code = 'APPROVAL_REQUIRED';
      throw err;
    }
    const s = o.success;
    if (s === false || s === 'false') {
      const err = new Error(String(o.error ?? o.message ?? 'Request failed'));
      (err as any).status = status;
      (err as any).code = typeof o.code === 'string' ? o.code : undefined;
      const errs = o.errors;
      if (Array.isArray(errs)) (err as any).errors = errs;
      throw err;
    }
  });
}

/**
 * Depth-first scan for the first non-empty user-facing string on common keys.
 * Used when `data.message` chains miss (e.g. message only under `result` / nested blobs).
 */
function extractMessageFromObjectGraph(body: unknown, depth = 0): string | undefined {
  if (depth > 10 || body == null) return undefined;
  if (typeof body === 'string') return body.trim() || undefined;
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = extractMessageFromObjectGraph(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  for (const key of ['message', 'msg', 'detail', 'description', 'hint']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const v of Object.values(o)) {
    const found = extractMessageFromObjectGraph(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function extractSuccessMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const pick = (o: Record<string, unknown>): string | undefined => {
    for (const key of ['message', 'msg', 'detail', 'description', 'hint']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  let node: unknown = body;
  for (let depth = 0; depth < 6; depth++) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) break;
    const msg = pick(node as Record<string, unknown>);
    if (msg) return msg;
    const inner = (node as Record<string, unknown>).data;
    if (inner == null) break;
    node = inner;
  }
  return extractMessageFromObjectGraph(body);
}

// Generic API methods
export const api = {
  // GET request
  get: async <T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      console.log(`[API] GET ${url}`);
      const response = await apiClient.get<T>(url, config);
      console.log(`[API] GET ${url} - Response:`, response.data);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in GET response:', errorMessage);
            clearAuthStorage();
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }
      
      // Handle different response structures
      // If response.data already has success/data structure, use it
      if (responseData && typeof responseData === 'object' && 'success' in responseData && 'data' in responseData) {
        return responseData as ApiResponse<T>;
      }
      
      // Otherwise wrap the response
      return {
        data: response.data,
        success: true,
      };
    } catch (error) {
      const apiError = handleError(error);
      console.error(`[API] GET ${url} - Error:`, apiError);
      // Throw as Error instance so it can be caught properly
      const errorInstance = new Error(apiError.message);
      (errorInstance as any).status = apiError.status;
      (errorInstance as any).code = apiError.code;
      (errorInstance as any).errors = apiError.errors;
      throw errorInstance;
    }
  },

  // POST request
  post: async <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const mergedConfig = mergeFormDataRequestConfig(data, config);
      const response = await apiClient.post<T>(url, data, mergedConfig);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in POST response:', errorMessage);
            clearAuthStorage();
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }

      return buildMutationApiResponse(response);
    } catch (error) {
      throw rethrowHandled(error);
    }
  },

  // PUT request
  put: async <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const mergedConfig = mergeFormDataRequestConfig(data, config);
      const response = await apiClient.put<T>(url, data, mergedConfig);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in PUT response:', errorMessage);
            clearAuthStorage();
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }

      return buildMutationApiResponse(response);
    } catch (error) {
      throw rethrowHandled(error);
    }
  },

  // PATCH request
  patch: async <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
      const mergedConfig: AxiosRequestConfig | undefined =
        isFormData || config
          ? {
              ...config,
              ...(isFormData
                ? {
                    transformRequest: [
                      ...(Array.isArray(config?.transformRequest)
                        ? config!.transformRequest!
                        : config?.transformRequest
                          ? [config.transformRequest as any]
                          : []),
                      (body, headers) => {
                        if (body instanceof FormData && headers && typeof headers === 'object') {
                          delete (headers as Record<string, unknown>)['Content-Type'];
                        }
                        return body;
                      },
                    ],
                  }
                : {}),
            }
          : config;
      const response = await apiClient.patch<T>(url, data, mergedConfig);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in PATCH response:', errorMessage);
            clearAuthStorage();
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }

      return buildMutationApiResponse(response);
    } catch (error) {
      throw rethrowHandled(error);
    }
  },

  // DELETE request
  delete: async <T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const response = await apiClient.delete<T>(url, config);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in DELETE response:', errorMessage);
            clearAuthStorage();
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }

      return buildMutationApiResponse(response);
    } catch (error) {
      throw rethrowHandled(error);
    }
  },
};

/** Normalize API errors to `Error` with optional `status`, `code`, `errors`. */
function rethrowHandled(error: unknown): never {
  const e = handleError(error);
  const err = new Error(e.message);
  (err as any).status = e.status;
  (err as any).code = e.code;
  (err as any).errors = e.errors;
  throw err;
}

function describeRequest(config: AxiosError['config']): string {
  if (!config) return '';
  try {
    return apiClient.getUri(config);
  } catch {
    const b = (config.baseURL || '').replace(/\/$/, '');
    const u = (config.url || '').replace(/^\//, '');
    const path = [b, u].filter(Boolean).join('/');
    if (typeof window !== 'undefined' && path && !/^https?:\/\//i.test(path)) {
      return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return path;
  }
}

// Error handler
const handleError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const response = axiosError.response as any;
      const status = axiosError.response.status;
      const bodyMsg = response.data?.message || response.data?.error;
      const bodyCode =
        typeof response.data?.code === 'string' ? response.data.code : undefined;
      const urlHint = describeRequest(axiosError.config);
      let message = bodyMsg || axiosError.message || 'An error occurred';
      if (status === 404) {
        message =
          bodyMsg ||
          `Not found (404). Browser request URL should be like …/api/admin/users (see Network tab). Postman often uses the server IP directly; here it goes through /api proxy. ${urlHint ? `Attempted: ${urlHint}` : ''}`;
      } else       if (status === 401) {
        message =
          bodyMsg ||
          `Unauthorized (401). Log in again and ensure the same Bearer token works in Postman. ${urlHint ? `Request: ${urlHint}` : ''}`;
      } else if (status === 409) {
        message =
          bodyMsg ||
          'This request was already approved or rejected. Refresh the list.';
      } else if (urlHint && !bodyMsg) {
        message = `${message} (${urlHint})`;
      }
      return {
        message: message.trim(),
        status,
        code: bodyCode,
        errors: response.data?.errors,
      };
    } else if (axiosError.request) {
      const directToBackend =
        typeof API_BASE_URL === 'string' &&
        (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://'));
      return {
        message: directToBackend
          ? 'Browser blocked or could not reach server (often CORS). Postman ignores CORS. Set VITE_API_BASE_URL=/api and use the Vite proxy locally or Vercel rewrites in production.'
          : 'No response from server. Please check your connection.',
      };
    }
  }

  if (error instanceof Error) {
    const ex = error as any;
    return {
      message: error.message,
      status: typeof ex.status === 'number' ? ex.status : undefined,
      code: typeof ex.code === 'string' ? ex.code : undefined,
      errors: ex.errors,
    };
  }

  // Unknown error
  return {
    message: 'An unknown error occurred',
  };
};

// Export the axios instance for advanced usage
export { apiClient };

// Export default api object
export default api;

