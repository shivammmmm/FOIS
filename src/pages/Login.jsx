import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
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
          </div>

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

