import { Link } from 'react-router-dom';
import { User, Building2 } from 'lucide-react';
import Layout from '../components/Layout';

export default function PostDatedCheque() {
  return (
    <Layout>
      <div>
        <div className="">
        
        <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900">Post Dated Cheque</h2>
       </div>
      </div>
          
          <div className="grid md:grid-cols-2 gap-8 p-8">
            {/* Customer PDC in hand card */}
            <Link to="/customer-pdc" className="block">
              <div className="group relative cursor-pointer transition-all duration-200 hover:scale-105">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#a8061d] to-[#6b0210] rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative bg-white rounded-2xl p-8 shadow-xl border border-gray-200 hover:shadow-2xl transition-shadow">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-4 bg-[#a8061d] rounded-xl">
                      <User className="w-8 h-8 text-black" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-black">Customer PDC in hand</h2>
                      <p className="text-[#d90522]">Post Dated Cheque</p>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
            
            {/* GCEC PDC Card */}
            <Link to="/gcec-pdc" className="block">
              <div className="group relative cursor-pointer transition-all duration-200 hover:scale-105">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#a8061d] to-[#6b0210] rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative bg-white rounded-2xl p-8 shadow-xl border border-gray-200 hover:shadow-2xl transition-shadow">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-4 bg-[#a8061d] rounded-xl">
                      <Building2 className="w-8 h-8 text-black" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-black">GCEC issued PDC</h2>
                      <p className="text-[#d90522]">Corporate Cheques</p>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}