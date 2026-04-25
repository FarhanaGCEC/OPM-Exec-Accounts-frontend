import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import ViewAllRecords from './pages/ViewAllRecords';
import BankTransaction from './pages/BankTransaction';
import PostDatedCheque from './pages/PostDatedCheque';
import CustomerPDC from './pages/CustomerPDC';
import GCECpdc from './pages/GCECpdc';
import PaymentMatching from './pages/PaymentMatching';
import PayablesCategory from './pages/PayablesCategory';
import ReciveableCategory from './pages/ReciveableCategory';
import GCECBeneficiary from './pages/GCECBeneficiary';
import CreditCardStatements from './pages/CreditCardStatments';
import CreditCardDetails from './pages/CreditCardDetails';
import CreditCardPaymentsPage from './pages/CreditCardPaymentsPage';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';
import GbpTranstion from './pages/GbpTranstion';
import UsdTranstion from './pages/UsdTranstion';
import FkEmrits from './pages/FkEmrits';
import UserManagement from './pages/UserManagement';
import AdminRoute from './components/AdminRoute';
import ApprovalQueueAdminRoute from './components/ApprovalQueueAdminRoute';
import MyChangeRequestsRoute from './components/MyChangeRequestsRoute';
import MyChangeRequests from './pages/MyChangeRequests';
import ApprovalQueue from './pages/ApprovalQueue';
import { AdminChangeRequestStreamProvider } from './context/AdminChangeRequestStreamContext';
import MonthlyBankStatements from './pages/MonthlyBankStatements';
import AdminOrAccountantRoute from './components/AdminOrAccountantRoute';

console.log('[App] App component loading...');

const App = () => {
  console.log('[App] App component rendering...');
  
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AdminChangeRequestStreamProvider>
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/records"
          element={
            <ProtectedRoute>
              <ViewAllRecords />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bank"
          element={
            <ProtectedRoute>
              <BankTransaction />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cheque"
          element={
            <ProtectedRoute>
              <PostDatedCheque />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-pdc"
          element={
            <ProtectedRoute>
              <CustomerPDC />
            </ProtectedRoute>
          }
        />
        <Route
          path="/gcec-pdc"
          element={
            <ProtectedRoute>
              <GCECpdc />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matching"
          element={
            <ProtectedRoute>
              <PaymentMatching />
            </ProtectedRoute>
          }
        />
        <Route
          path="/category"
          element={
            <ProtectedRoute>
              <PayablesCategory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reciveables"
          element={
            <ProtectedRoute>
              <ReciveableCategory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/beneficiary"
          element={
            <ProtectedRoute>
              <GCECBeneficiary />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-card-statements"
          element={
            <ProtectedRoute>
              <CreditCardStatements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-card-statements/details"
          element={
            <ProtectedRoute>
              <CreditCardDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-card-statements/payments"
          element={
            <ProtectedRoute>
              <CreditCardPaymentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/gbp-transactions"
          element={
            <ProtectedRoute>
              <GbpTranstion />
            </ProtectedRoute>
          }
        />
        <Route
          path="/usd-transactions"
          element={
            <ProtectedRoute>
              <UsdTranstion />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fks-transactions"
          element={
            <ProtectedRoute>
              <FkEmrits />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <UserManagement />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-change-requests"
          element={
            <ProtectedRoute>
              <MyChangeRequestsRoute>
                <MyChangeRequests />
              </MyChangeRequestsRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/approval-queue"
          element={
            <ProtectedRoute>
              <ApprovalQueueAdminRoute>
                <ApprovalQueue />
              </ApprovalQueueAdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/monthly-bank-statements"
          element={
            <ProtectedRoute>
              <AdminOrAccountantRoute>
                <MonthlyBankStatements />
              </AdminOrAccountantRoute>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AdminChangeRequestStreamProvider>
    </Router>
  );
};

export default App;
