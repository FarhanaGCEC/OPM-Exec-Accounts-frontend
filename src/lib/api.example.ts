/**
 * API Wrapper Usage Examples
 * 
 * This file shows how to use the API wrapper throughout the application
 */

import api from './api';
import { authService } from '../services/authService';
import { transactionService } from '../services/transactionService';

// ============================================
// Example 1: Using the generic API wrapper
// ============================================

// GET request
const fetchUsers = async () => {
  try {
    const response = await api.get('/users');
    console.log('Users:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

// POST request
const createUser = async (userData: { name: string; email: string }) => {
  try {
    const response = await api.post('/users', userData);
    console.log('User created:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
};

// PUT request
const updateUser = async (id: string, userData: { name: string }) => {
  try {
    const response = await api.put(`/users/${id}`, userData);
    console.log('User updated:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

// DELETE request
const deleteUser = async (id: string) => {
  try {
    const response = await api.delete(`/users/${id}`);
    console.log('User deleted');
    return response.data;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

// ============================================
// Example 2: Using service functions
// ============================================

// Authentication
const loginExample = async () => {
  try {
    const response = await authService.login({
      email: 'user@example.com',
      password: 'password123',
      rememberMe: true,
    });
    
    // Store token
    localStorage.setItem('authToken', response.data.token);
    return response.data;
  } catch (error: any) {
    console.error('Login failed:', error.message);
    throw error;
  }
};

// Get transactions
const getTransactionsExample = async () => {
  try {
    const response = await transactionService.getBankTransactions();
    return response.data;
  } catch (error: any) {
    console.error('Error fetching transactions:', error.message);
    throw error;
  }
};

// Create transaction
const createTransactionExample = async () => {
  try {
    const response = await transactionService.createBankTransaction({
      date: '2024-01-15',
      type: 'Debit',
      description: 'Payment',
      details: 'Details here',
      amount: '1000',
    });
    return response.data;
  } catch (error: any) {
    console.error('Error creating transaction:', error.message);
    throw error;
  }
};

// ============================================
// Example 3: Using in React components
// ============================================

/*
import { useState, useEffect } from 'react';
import { transactionService } from '../services/transactionService';

function TransactionsList() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
*/

export {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  loginExample,
  getTransactionsExample,
  createTransactionExample,
};

