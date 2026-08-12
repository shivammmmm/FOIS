import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import { USER_CATEGORIES } from '@/utils/userCategories';

const MOBILE_PATTERN = /^[6-9]\d{9}$/;
const OTHER_CATEGORY = '__other__';

export default function Signup() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [contactMode, setContactMode] = useState('email'); // 'email' | 'mobile'
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
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

    const resolvedCategory = category === OTHER_CATEGORY ? customCategory.trim() : category;
    if (category === OTHER_CATEGORY && !resolvedCategory) {
      setError('Enter your category.');
      return;
    }
    if (contactMode === 'mobile' && !MOBILE_PATTERN.test(mobile.trim())) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await base44.auth.signup({
        firstName,
        lastName,
        category: resolvedCategory,
        email: contactMode === 'email' ? email.trim() : '',
        mobile: contactMode === 'mobile' ? mobile.trim() : '',
        password,
      });
      navigate('/login');
    } catch (err) {
      setError(err?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSuccess = async () => {
    setError(null);
    await goToLandingForRole();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-2xl font-bold">Sign up</div>
          <div className="text-sm text-muted-foreground mt-1">Create your account</div>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">First Name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
                placeholder="First name"
                required
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Last Name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
                placeholder="Last name"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground">User Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none bg-background"
              required
            >
              <option value="" disabled>Select category</option>
              {USER_CATEGORIES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              <option value={OTHER_CATEGORY}>Other (specify)</option>
            </select>
            {category === OTHER_CATEGORY && (
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="mt-2 w-full rounded-lg border px-3 py-2 outline-none"
                placeholder="Enter your category"
                required
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">
                {contactMode === 'email' ? 'Email' : 'Mobile Number'}
              </label>
              <button
                type="button"
                onClick={() => setContactMode((mode) => (mode === 'email' ? 'mobile' : 'email'))}
                className="text-xs font-medium text-primary hover:underline"
              >
                {contactMode === 'email' ? 'Use mobile number instead' : 'Use email instead'}
              </button>
            </div>
            {contactMode === 'email' ? (
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
                placeholder="you@example.com"
                type="email"
                required
              />
            ) : (
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
                placeholder="10-digit mobile number"
                type="tel"
                inputMode="numeric"
                required
              />
            )}
            <p className="mt-1 text-xs text-muted-foreground">Email or mobile — whichever you prefer.</p>
          </div>

          <div>
            <label className="text-sm text-muted-foreground">Create Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
              placeholder="Create a password (min 6 characters)"
              required
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground">Confirm Password</label>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-lg border px-3 py-2 outline-none"
              placeholder="Re-enter your password"
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
            {loading ? 'Creating...' : 'Create account'}
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <GoogleSignInButton onSuccess={onGoogleSuccess} onError={setError} />

          <div className="text-sm text-muted-foreground flex items-center justify-between">
            <span>Already have an account?</span>
            <Link to="/login" className="text-primary hover:underline font-medium">
              Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
