import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import ViewAllRecords from './pages/ViewAllRecords';
import BankTransaction from './pages/BankTransaction';
import PostDatedCheque from './pages/PostDatedCheque';
import PaymentMatching from './pages/PaymentMatching';
import PayablesCategory from './pages/PayablesCategory';
import ReciveableCategory from './pages/ReciveableCategory';
import GCECBeneficiary from './pages/GCECBeneficiary';
import './App.css';

const App = () => {
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/records" element={<ViewAllRecords />} />
        <Route path="/bank" element={<BankTransaction />} />
        <Route path="/cheque" element={<PostDatedCheque />} />
        <Route path="/matching" element={<PaymentMatching />} />
        <Route path="/category" element={<PayablesCategory />} />
        <Route path="/reciveables" element={<ReciveableCategory />} />
        <Route path="/beneficiary" element={<GCECBeneficiary />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
