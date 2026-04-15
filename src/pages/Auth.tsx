import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import { PasswordInput } from '../components/ui/password-input';
import { Checkbox } from '../components/ui/checkbox';
import { User, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { authService } from '../services/authService';
import { extractLoginData, persistLoginSession } from '../lib/authPayload';

type LoginFormData = {
  username: string;
  password: string;
};

export default function Auth() {
  console.log('[Auth] Auth component rendering...');
  
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formData, setFormData] = useState<LoginFormData>({
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof LoginFormData, string>>>({});

  // Redirect to dashboard if user already has a token
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof LoginFormData, string>> = {};
    
    if (!formData.username) {
      newErrors.username = 'Username is required';
    
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setError(false);
    setLoading(true);
    
    try {
      const response = await authService.login({
        username: formData.username,
        password: formData.password,
       
      });
      
      const { token, user } = extractLoginData(response.data);

      if (response.success && response.data && token) {
        persistLoginSession({
          token,
          user,
          formUsername: formData.username.trim() || undefined,
        });
        
        // Store remember me preference
        if (rememberMe) {
          localStorage.setItem('rememberMe', 'true');
        }
        
        // Redirect to dashboard
        navigate('/dashboard');
      } else {
        setError(true);
      }
    } catch (err: any) {
      setError(true);
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  console.log('[Auth] Rendering JSX...');
  
  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Card className="w-full bg-gray-100 rounded-lg border-0 shadow-lg sm:w-96 md:w-96 relative pt-16">
        <CardHeader className="flex flex-col items-center pb-6">
          <div className="absolute -top-[80px] left-1/2 transform -translate-x-1/2 flex items-center justify-center">
            <img 
              src="https://res.cloudinary.com/dstnwi5iq/image/upload/v1757503157/Screenshot_2025-09-02_at_11.52.12_AM-removebg-preview_qv6odb.png" 
              alt="GCEC Cloud Logo" 
              width={150} 
              height={150}
              className="block"
              onError={(e) => {
                console.error('[Auth] Image failed to load');
                (e.target as HTMLImageElement).style.display = 'none';
              }}
              onLoad={() => {
                console.log('[Auth] Image loaded successfully');
              }}
            />
          </div>
          <h2 className="text-2xl font-bold text-center text-black mt-2">
          GMS Accounts Login
          </h2>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="flex flex-col space-y-4 px-6 pt-0">
            <div className="w-full">
              <div className="relative">
                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-30 pointer-events-none"
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px'
                  }}
                >
                  <User className="w-5 h-5 text-gray-600" strokeWidth={2} />
                </div>
                <Input
                  id="username"
                  placeholder="Username"
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className={cn(
                    "pl-10 pr-4 py-2 bg-white rounded-md text-gray-800 border",
                    errors.username || error ? "border-red-500" : "border-gray-300"
                  )}
                  style={{ position: 'relative', zIndex: 10 }}
                />
              </div>
              {errors.username && (
                <p className="mt-1 text-sm text-red-500 min-h-[20px]">
                  {errors.username}
                </p>
              )}
            </div>
            <div className="w-full">
              <div className="relative">
                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-30 pointer-events-none"
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px'
                  }}
                >
                  <Lock className="w-5 h-5 text-gray-600" strokeWidth={2} />
                </div>
                <PasswordInput
                  placeholder="Password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={cn(
                    'pl-10 py-2 bg-white rounded-md text-gray-800 border',
                    errors.password || error ? 'border-red-500' : 'border-gray-300'
                  )}
                  style={{ position: 'relative', zIndex: 10 }}
                />
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-500 min-h-[20px]">
                  {errors.password}
                </p>
              )}
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked: boolean | 'indeterminate') => setRememberMe(checked === true)}
                className="border-gray-600 data-[state=checked]:bg-gray-600"
              />
              <label
                htmlFor="remember"
                className="text-sm text-gray-400 cursor-pointer"
              >
                Remember me
              </label>
            </div>
            {error && (
              <p className="mt-1 text-sm text-red-500">
                Invalid email or password.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 px-6 pb-6 pt-4">
            <Button
              type="submit"
              className="w-full text-white rounded-md py-2.5 hover:opacity-90 transition-opacity font-semibold bg-transparent"
              style={{
                background: 'linear-gradient(11deg, rgba(0, 0, 0, 1) 30%, rgba(194, 148, 56, 1) 100%)',
              }}
              disabled={loading}
            >
              {loading ? 'LOGGING IN...' : 'LOGIN'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
