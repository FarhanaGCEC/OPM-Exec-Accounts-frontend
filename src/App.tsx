import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import ViewAllRecords from './pages/ViewAllRecords';
import BankTransaction from './pages/BankTransaction';
import PostDatedCheque from './pages/PostDatedCheque';
import PaymentMatching from './pages/PaymentMatching';
import './App.css';

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Auth />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/records" element={<ViewAllRecords />} />
        <Route path="/bank" element={<BankTransaction />} />
        <Route path="/cheque" element={<PostDatedCheque />} />
        <Route path="/matching" element={<PaymentMatching />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
