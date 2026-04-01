import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

// Use same-origin `/api` so browser requests go through the proxy/rewrite.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add auth token to requests
apiClient.interceptors.request.use(
  (config) => {
    // Get token from localStorage or wherever you store it
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
  localStorage.removeItem('authToken');
  localStorage.removeItem('userName');
  window.location.href = '/';
};

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
        case 401:
          // Unauthorized - clear token and redirect to login
          handleTokenError();
          break;
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
}

// API Error type
export interface ApiError {
  message: string;
  status?: number;
  errors?: Record<string, string[]>;
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
            localStorage.removeItem('authToken');
            localStorage.removeItem('userName');
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
      const response = await apiClient.post<T>(url, data, config);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in POST response:', errorMessage);
            localStorage.removeItem('authToken');
            localStorage.removeItem('userName');
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }
      
      return {
        data: response.data,
        success: true,
        message: (response.data as any)?.message,
      };
    } catch (error) {
      throw handleError(error);
    }
  },

  // PUT request
  put: async <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const response = await apiClient.put<T>(url, data, config);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in PUT response:', errorMessage);
            localStorage.removeItem('authToken');
            localStorage.removeItem('userName');
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }
      
      return {
        data: response.data,
        success: true,
        message: (response.data as any)?.message,
      };
    } catch (error) {
      throw handleError(error);
    }
  },

  // PATCH request
  patch: async <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> => {
    try {
      const response = await apiClient.patch<T>(url, data, config);
      
      // Check for token error in response body
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object') {
        const errorMessage = responseData.error || responseData.message;
        if (errorMessage && typeof errorMessage === 'string') {
          const lowerError = errorMessage.toLowerCase();
          if ((lowerError.includes('invalid') && lowerError.includes('token')) || 
              (lowerError.includes('expired') && lowerError.includes('token'))) {
            console.warn('[API] Token error detected in PATCH response:', errorMessage);
            localStorage.removeItem('authToken');
            localStorage.removeItem('userName');
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }
      
      return {
        data: response.data,
        success: true,
        message: (response.data as any)?.message,
      };
    } catch (error) {
      throw handleError(error);
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
            localStorage.removeItem('authToken');
            localStorage.removeItem('userName');
            window.location.href = '/';
            throw new Error(errorMessage);
          }
        }
      }
      
      return {
        data: response.data,
        success: true,
        message: (response.data as any)?.message,
      };
    } catch (error) {
      throw handleError(error);
    }
  },
};

// Error handler
const handleError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    
    if (axiosError.response) {
      // Server responded with error
      const response = axiosError.response as any;
      return {
        message: response.data?.message || axiosError.message || 'An error occurred',
        status: axiosError.response.status,
        errors: response.data?.errors,
      };
    } else if (axiosError.request) {
      // Request made but no response
      return {
        message: 'No response from server. Please check your connection.',
      };
    }
  }
  
  // Unknown error
  return {
    message: error instanceof Error ? error.message : 'An unknown error occurred',
  };
};

// Export the axios instance for advanced usage
export { apiClient };

// Export default api object
export default api;

