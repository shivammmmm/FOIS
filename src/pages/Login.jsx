import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import GoogleSignInButton from '@/components/GoogleSignInButton';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const navigate = useNavigate();
  const { checkUserAuth } = useAuth();

  const goToLandingForRole = async () => {
    const currentUser = await checkUserAuth();
    const nextPath = currentUser?.role === 'super_admin' || currentUser?.role === 'admin'
      ? '/admin'
      : '/dashboard';
    navigate(nextPath, { replace: true });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await base44.auth.login({ identifier, password });
      await goToLandingForRole();
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSuccess = async () => {
    setError(null);
    await goToLandingForRole();
  };

  const requestReset = async () => {
    if (!identifier.trim()) return setResetMessage('Please enter your Username or Email first.');
    setResetLoading(true);
    setResetMessage('');
    try {
      const result = await base44.auth.requestPasswordReset(identifier.trim());
      if (result.development_code) {
        setResetCode(String(result.development_code));
        setResetMessage(`${result.message} (Dev Code: ${result.development_code})`);
      } else {
        setResetMessage(result.message);
      }
    } catch (err) {
      setResetMessage(err?.message || 'Reset request failed');
    } finally {
      setResetLoading(false);
    }
  };

  const resetPassword = async () => {
    setResetLoading(true);
    setResetMessage('');
    try {
      const result = await base44.auth.resetPassword({
        identifier: identifier.trim(),
        code: resetCode,
        password: newPassword,
      });
      setResetMessage('✅ ' + result.message);
      setPassword(newPassword);
      setResetCode('');
      setNewPassword('');
    } catch (err) {
      setResetMessage('❌ ' + (err?.message || 'Password reset failed'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-2xl font-bold">Login</div>
          <div className="text-sm text-muted-foreground mt-1">Enter username/email and password</div>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-sm text-muted-foreground">Username / Email</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
              placeholder="Username or email"
              required
            />
            <button type="button" onClick={() => setResetOpen((value) => !value)} className="mt-2 text-sm font-medium text-primary hover:underline">Forgot password?</button>
          </div>

          {resetOpen && (
            <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 animate-fade-in">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                Password Reset Assistance
              </div>
              <button
                type="button"
                onClick={requestReset}
                disabled={resetLoading}
                className="w-full rounded-lg border border-primary/30 bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
              >
                {resetLoading ? 'Sending...' : '1. Send Reset Code to Email'}
              </button>
              <input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="2. Enter 6-digit reset code"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="3. Enter new password (min 6 chars)"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={resetPassword}
                disabled={resetLoading || !resetCode || newPassword.length < 6}
                className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {resetLoading ? 'Resetting...' : 'Confirm & Reset Password'}
              </button>
              {resetMessage && (
                <div className="text-xs leading-relaxed text-muted-foreground bg-card p-2.5 rounded-lg border border-border">
                  {resetMessage}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
              placeholder="Password"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 font-medium disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <GoogleSignInButton onSuccess={onGoogleSuccess} onError={setError} />

          <div className="text-sm text-muted-foreground flex items-center justify-between">
            <span>New here?</span>
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

