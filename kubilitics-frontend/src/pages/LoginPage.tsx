import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LoginError {
  message: string;
}

interface AuthProvider {
  name: string;
  available: boolean;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setToken } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [oidcAvailable, setOidcAvailable] = useState(false);
  const [checkingProviders, setCheckingProviders] = useState(true);

  const returnUrl = searchParams.get('returnUrl');
  const isSessionExpired = searchParams.get('expired') === 'true';

  // Check if OIDC is available
  useEffect(() => {
    const checkAuthProviders = async () => {
      try {
        const response = await fetch('/api/v1/auth/providers');
        if (response.ok) {
          const data = await response.json();
          // Check if OIDC provider is available
          setOidcAvailable(data.oidc?.enabled === true || data.oidc?.available === true);
        }
      } catch (err) {
        console.warn('[LoginPage] Failed to check auth providers:', err);
      } finally {
        setCheckingProviders(false);
      }
    };

    checkAuthProviders();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `Login failed (${response.status})`);
      }

      const data = await response.json();

      // Store the JWT token
      if (data.token) {
        setToken(data.token);

        // Check if password change is required
        if (data.passwordChangeRequired === true) {
          navigate('/change-password', { replace: true });
        } else {
          // Navigate to the requested page or dashboard
          const destination = returnUrl ? decodeURIComponent(returnUrl) : '/dashboard';
          navigate(destination, { replace: true });
        }
      } else {
        throw new Error('No token received from server');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError({ message });
      // Focus error message for accessibility
      setTimeout(() => {
        const errorElement = document.querySelector('[role="alert"]');
        if (errorElement instanceof HTMLElement) {
          errorElement.focus();
        }
      }, 0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOidcLogin = (provider: 'google' | 'okta' | 'generic') => {
    // Store the provider in sessionStorage so the callback can identify which provider was used
    sessionStorage.setItem('oidc_provider', provider);

    // Redirect to OIDC authorize endpoint
    // The backend will handle provider-specific logic based on the provider parameter
    const authorizeUrl = `/api/v1/auth/oidc/authorize?provider=${provider}`;

    if (returnUrl) {
      sessionStorage.setItem('oidc_return_url', returnUrl);
    }

    window.location.href = authorizeUrl;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/30 dark:from-[hsl(228,14%,7%)] dark:via-[hsl(228,14%,9%)] dark:to-[hsl(228,14%,11%)] text-foreground overflow-hidden flex items-center justify-center px-4 py-8 sm:px-6 md:px-8">
      {/* Ambient light orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/20 dark:bg-blue-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-200/20 dark:bg-indigo-900/20 rounded-full blur-[120px]" />
        <div className="absolute top-[30%] right-[10%] w-[25%] h-[30%] bg-purple-100/15 dark:bg-purple-900/15 rounded-full blur-[100px]" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(circle, #64748b 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-lg border border-border shadow-xl px-6 sm:px-8 py-8 sm:py-10">
          {/* Logo and Title */}
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4">
              <BrandLogo height={48} className="drop-shadow-lg" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-slate-900 dark:text-slate-100 mb-2">
              Kubilitics
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
              In-Cluster
            </p>
          </div>

          {/* Session Expired Message or Error */}
          {isSessionExpired && !error && (
            <div className="mb-6 p-3 sm:p-4 rounded-md bg-yellow-100 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 text-sm" role="alert" aria-live="polite">
              Your session has expired. Please sign in again.
            </div>
          )}
          {error && (
            <div className="mb-6 p-3 sm:p-4 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm" role="alert" aria-live="polite">
              {error.message}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Field */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Username
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="pl-10"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10"
                  required
                  autoComplete="current-password"
                  aria-describedby="password-hint"
                />
              </div>
              <p id="password-hint" className="text-xs text-slate-500 dark:text-slate-400">
                Password is required to sign in
              </p>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading || !username || !password}
              className="w-full mt-6"
              size="lg"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    role="status"
                    aria-label="Loading"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* SSO Section - shown if OIDC is available */}
          {!checkingProviders && oidcAvailable && (
            <>
              {/* Divider */}
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium">or sign in with SSO</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* SSO Buttons */}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => handleOidcLogin('google')}
                >
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Sign in with Google
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => handleOidcLogin('okta')}
                >
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="3" />
                    <circle cx="5" cy="5" r="2" />
                    <circle cx="19" cy="5" r="2" />
                    <circle cx="5" cy="19" r="2" />
                    <circle cx="19" cy="19" r="2" />
                  </svg>
                  Sign in with Okta
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => handleOidcLogin('generic')}
                >
                  <svg className="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Sign in with OIDC
                </Button>
              </div>
            </>
          )}

          {/* Footer Text */}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6">
            Kubilitics In-Cluster Mode
          </p>
        </div>
      </div>
    </div>
  );
}
