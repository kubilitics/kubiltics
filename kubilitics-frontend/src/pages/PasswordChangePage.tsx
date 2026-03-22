import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, Check, X, LogOut } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';

interface PasswordError {
  message: string;
}

interface PasswordStrength {
  score: number;
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

function checkPasswordStrength(password: string): PasswordStrength {
  const hasMinLength = password.length >= 12;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

  const score = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecialChar].filter(Boolean).length;

  return {
    score,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
  };
}

function getStrengthColor(score: number): string {
  if (score < 2) return 'bg-destructive/50';
  if (score < 4) return 'bg-yellow-500/50';
  return 'bg-green-500/50';
}

function getStrengthLabel(score: number): string {
  if (score < 2) return 'Weak';
  if (score < 4) return 'Fair';
  return 'Strong';
}

export default function PasswordChangePage() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<PasswordError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordStrength = checkPasswordStrength(newPassword);
  const isPasswordValid = passwordStrength.hasMinLength && passwordStrength.hasUppercase &&
    passwordStrength.hasLowercase && passwordStrength.hasNumber && passwordStrength.hasSpecialChar;
  const passwordsMatch = newPassword && confirmPassword === newPassword;
  const canSubmit = currentPassword && newPassword && confirmPassword && isPasswordValid && passwordsMatch && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    // Validate before submission
    if (!isPasswordValid) {
      setError({ message: 'Password does not meet complexity requirements' });
      setIsLoading(false);
      return;
    }

    if (!passwordsMatch) {
      setError({ message: 'Passwords do not match' });
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/v1/auth/change-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `Failed to change password (${response.status})`);
      }

      // Success — redirect to dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password. Please try again.';
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

  const handleSignOut = () => {
    logout();
    navigate('/login', { replace: true });
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

      {/* Password Change Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-lg border border-border shadow-xl px-6 sm:px-8 py-8 sm:py-10">
          {/* Logo and Title */}
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4">
              <BrandLogo height={48} className="drop-shadow-lg" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-slate-900 dark:text-slate-100 mb-2">
              Change Password
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium text-center">
              Your password must be changed before continuing
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 sm:p-4 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm" role="alert" aria-live="polite" tabIndex={-1}>
              {error.message}
            </div>
          )}

          {/* Password Change Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="current-password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Current Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  placeholder="Enter your current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10 pr-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  {showCurrentPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* New Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Enter a new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10 pr-10"
                  required
                  autoComplete="new-password"
                  aria-describedby="password-requirements"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  {showNewPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {newPassword && (
                <div className="space-y-3" id="password-requirements" aria-live="polite" aria-label="Password strength requirements">
                  {/* Strength Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Password Strength
                      </span>
                      <span className={`text-xs font-semibold ${
                        passwordStrength.score < 2 ? 'text-destructive' :
                        passwordStrength.score < 4 ? 'text-yellow-600 dark:text-yellow-400' :
                        'text-green-600 dark:text-green-400'
                      }`}>
                        {getStrengthLabel(passwordStrength.score)} ({passwordStrength.score} of 5)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${getStrengthColor(passwordStrength.score)}`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                        role="progressbar"
                        aria-valuenow={passwordStrength.score}
                        aria-valuemin={0}
                        aria-valuemax={5}
                        aria-label={`Password strength: ${getStrengthLabel(passwordStrength.score)}`}
                      />
                    </div>
                  </div>

                  {/* Requirements Checklist */}
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {passwordStrength.hasMinLength ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={passwordStrength.hasMinLength ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'}>
                        At least 12 characters
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {passwordStrength.hasUppercase ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={passwordStrength.hasUppercase ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'}>
                        Uppercase letter (A-Z)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {passwordStrength.hasLowercase ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={passwordStrength.hasLowercase ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'}>
                        Lowercase letter (a-z)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {passwordStrength.hasNumber ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={passwordStrength.hasNumber ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'}>
                        Number (0-9)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {passwordStrength.hasSpecialChar ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={passwordStrength.hasSpecialChar ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'}>
                        Special character (!@#$%^&* etc.)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10 pr-10"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Password Match Indicator */}
              {confirmPassword && (
                <div className="flex items-center gap-2 text-xs">
                  {passwordsMatch ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      <span className="text-green-600 dark:text-green-400 font-medium">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <X className="w-3.5 h-3.5 text-destructive" />
                      <span className="text-destructive font-medium">Passwords do not match</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full mt-8"
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
                  Changing password...
                </span>
              ) : (
                'Change Password'
              )}
            </Button>
          </form>

          {/* Sign Out / Cancel Link */}
          <div className="mt-6 pt-6 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center text-sm"
              onClick={handleSignOut}
              disabled={isLoading}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out and return to login
            </Button>
          </div>

          {/* Footer Text */}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6">
            This password must be strong and unique
          </p>
        </div>
      </div>
    </div>
  );
}
