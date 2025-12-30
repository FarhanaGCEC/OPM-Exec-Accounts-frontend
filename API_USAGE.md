# API Wrapper Usage Guide

This project uses a centralized Axios wrapper for all API calls. This ensures consistent error handling, authentication, and request/response formatting.

## Installation

First, install axios:
```bash
npm install axios
```

## Structure

```
src/
├── lib/
│   └── api.ts              # Main API wrapper with axios instance
├── services/
│   ├── authService.ts      # Authentication API calls
│   └── transactionService.ts # Transaction-related API calls
```

## Basic Usage

### 1. Using the Generic API Wrapper

```typescript
import api from '@/lib/api';

// GET request
const fetchData = async () => {
  try {
    const response = await api.get('/endpoint');
    console.log(response.data); // Your data
    return response.data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// POST request
const createData = async (data: any) => {
  try {
    const response = await api.post('/endpoint', data);
    return response.data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// PUT request
const updateData = async (id: string, data: any) => {
  try {
    const response = await api.put(`/endpoint/${id}`, data);
    return response.data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// DELETE request
const deleteData = async (id: string) => {
  try {
    const response = await api.delete(`/endpoint/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
```

### 2. Using Service Functions

```typescript
import { authService } from '@/services/authService';
import { transactionService } from '@/services/transactionService';

// Login
const login = async () => {
  try {
    const response = await authService.login({
      email: 'user@example.com',
      password: 'password123',
    });
    
    // Store token
    localStorage.setItem('authToken', response.data.token);
    return response.data;
  } catch (error: any) {
    console.error('Login failed:', error.message);
  }
};

// Get transactions
const getTransactions = async () => {
  try {
    const response = await transactionService.getBankTransactions();
    return response.data;
  } catch (error: any) {
    console.error('Error:', error.message);
  }
};

// Create transaction
const createTransaction = async () => {
  try {
    const response = await transactionService.createBankTransaction({
      date: '2024-01-15',
      type: 'Debit',
      description: 'Payment',
      details: 'Details',
      amount: '1000',
    });
    return response.data;
  } catch (error: any) {
    console.error('Error:', error.message);
  }
};
```

### 3. Using in React Components

```typescript
import { useState, useEffect } from 'react';
import { transactionService } from '@/services/transactionService';

function TransactionsList() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        const response = await transactionService.getBankTransactions();
        setTransactions(response.data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {transactions.map((transaction) => (
        <div key={transaction.id}>{transaction.description}</div>
      ))}
    </div>
  );
}
```

## Features

### Automatic Token Management
The API wrapper automatically adds the authentication token from `localStorage.getItem('authToken')` to all requests.

### Error Handling
- Automatic error handling for common HTTP status codes
- 401 errors automatically clear token and redirect to login
- Consistent error format across all API calls

### Response Format
All API responses follow this format:
```typescript
{
  data: T,           // Your actual data
  success: boolean,   // Whether the request was successful
  message?: string,  // Optional success/error message
  error?: string     // Optional error message
}
```

## Configuration

### Base URL
Set the API base URL via environment variable:
```env
VITE_API_BASE_URL=http://localhost:3000/api
```

Or it defaults to `http://localhost:3000/api`

### Timeout
Default timeout is 30 seconds. You can modify this in `src/lib/api.ts`:

```typescript
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // Change this value
  // ...
});
```

## Adding New Services

Create a new service file in `src/services/`:

```typescript
// src/services/userService.ts
import api, { ApiResponse } from '../lib/api';

export interface User {
  id: string;
  name: string;
  email: string;
}

export const userService = {
  getUsers: async (): Promise<ApiResponse<User[]>> => {
    return api.get<User[]>('/users');
  },

  getUser: async (id: string): Promise<ApiResponse<User>> => {
    return api.get<User>(`/users/${id}`);
  },

  createUser: async (data: Omit<User, 'id'>): Promise<ApiResponse<User>> => {
    return api.post<User>('/users', data);
  },
};
```

## Error Handling

The API wrapper automatically handles:
- **401 Unauthorized**: Clears token and redirects to login
- **403 Forbidden**: Logs error
- **404 Not Found**: Logs error
- **500 Server Error**: Logs error
- **Network Errors**: Handles connection issues

You can catch and handle errors in your components:

```typescript
try {
  const response = await api.get('/endpoint');
  // Handle success
} catch (error: any) {
  // error.message - Error message
  // error.status - HTTP status code (if available)
  // error.errors - Validation errors (if available)
  console.error('API Error:', error);
}
```

## Best Practices

1. **Always use try-catch** when calling API functions
2. **Use service functions** instead of direct API calls when possible
3. **Store tokens** in localStorage after successful login
4. **Handle loading states** in your components
5. **Show user-friendly error messages** to users

## Example: Updating Auth Page

```typescript
import { authService } from '@/services/authService';

const onSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  
  if (!validateForm()) return;
  
  setLoading(true);
  setError(false);
  
  try {
    const response = await authService.login({
      email: formData.email,
      password: formData.password,
      rememberMe: rememberMe,
    });
    
    // Store token
    localStorage.setItem('authToken', response.data.token);
    
    // Redirect to dashboard
    navigate('/dashboard');
  } catch (err: any) {
    setError(true);
    // Show error message: err.message
  } finally {
    setLoading(false);
  }
};
```

