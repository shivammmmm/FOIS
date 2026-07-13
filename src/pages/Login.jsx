import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

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

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await base44.auth.login({ identifier, password });
      const currentUser = await checkUserAuth();
      const nextPath = currentUser?.role === 'super_admin' || currentUser?.role === 'admin'
        ? '/admin'
        : '/dashboard';
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async () => {
    if (!identifier.trim()) return setResetMessage('पहले Username / Email भरें।');
    setResetLoading(true); setResetMessage('');
    try {
      const result = await base44.auth.requestPasswordReset(identifier.trim());
      setResetMessage(`${result.message}${result.development_code ? ` Development code: ${result.development_code}` : ''}`);
    } catch (err) { setResetMessage(err?.message || 'Reset request failed'); }
    finally { setResetLoading(false); }
  };

  const resetPassword = async () => {
    setResetLoading(true); setResetMessage('');
    try {
      const result = await base44.auth.resetPassword({ identifier: identifier.trim(), code: resetCode, password: newPassword });
      setResetMessage(result.message); setResetCode(''); setNewPassword('');
    } catch (err) { setResetMessage(err?.message || 'Password reset failed'); }
    finally { setResetLoading(false); }
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
              placeholder="6266782930"
              required
            />
            <button type="button" onClick={() => setResetOpen((value) => !value)} className="mt-2 text-sm font-medium text-primary hover:underline">Forgot password?</button>
          </div>

          {resetOpen && <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <button type="button" onClick={requestReset} disabled={resetLoading} className="w-full rounded-lg border border-primary/30 px-3 py-2 text-sm text-primary disabled:opacity-50">Send reset code</button>
            <input value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="6-digit reset code" className="w-full rounded-lg border px-3 py-2 outline-none" />
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (minimum 6 characters)" className="w-full rounded-lg border px-3 py-2 outline-none" />
            <button type="button" onClick={resetPassword} disabled={resetLoading || !resetCode || newPassword.length < 6} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Reset password</button>
            {resetMessage && <div className="text-xs text-muted-foreground">{resetMessage}</div>}
          </div>}

          <div>
            <label className="text-sm text-muted-foreground">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
              placeholder="123456"
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

