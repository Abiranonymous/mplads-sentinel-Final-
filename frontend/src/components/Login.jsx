import { useState } from 'react';
import { Shield, Lock, Zap, User, KeyRound } from 'lucide-react';

// ━━━ DEMO MODE KILL SWITCH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Flip to `false` to instantly hide the demo backdoor during your presentation.
const ENABLE_DEMO_MODE = true;
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VALID_USERNAME = 'cag_auditor';
const VALID_PASSWORD = 'admin123';
const DEMO_USER = {
  username: 'cag_auditor',
  displayName: 'CAG Chief Auditor',
  email: 'auditor@mospi.gov.in',
  isDemo: true,
};

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      const user = {
        username,
        displayName: 'CAG Chief Auditor',
        email: 'auditor@mospi.gov.in',
        isDemo: false,
      };
      sessionStorage.setItem('sentinel_session', JSON.stringify(user));
      onLogin(user);
    } else {
      setError('Invalid credentials. Please check your username and password.');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  const handleDemoLogin = () => {
    sessionStorage.setItem('sentinel_session', JSON.stringify(DEMO_USER));
    onLogin(DEMO_USER);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 50%, #f1f5f9 100%)' }}>

      <div className={`card p-8 w-full max-w-md animate-fade-in ${shaking ? 'animate-shake' : ''}`}>
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
               style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}>
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            MPLADS-Sentinel
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Public Fund Integrity Engine
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                placeholder="Enter your username"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-light)] focus:border-transparent
                           transition-all duration-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter your password"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-light)] focus:border-transparent
                           transition-all duration-200"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm font-medium"
                 style={{ background: 'var(--color-critical-bg)', color: 'var(--color-critical)' }}>
              <Lock className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            id="login-submit"
            type="submit"
            className="w-full py-2.5 rounded-lg font-semibold text-sm text-white cursor-pointer
                       transition-all duration-200 hover:shadow-md active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1e40af, #2563eb)' }}
          >
            Sign In to Integrity Engine
          </button>
        </form>

        {/* Demo Mode Button */}
        {ENABLE_DEMO_MODE && (
          <div className="mt-6 pt-6 border-t border-[var(--color-border-light)]">
            <button
              id="demo-login"
              onClick={handleDemoLogin}
              className="w-full py-2.5 rounded-lg text-sm font-medium cursor-pointer
                         flex items-center justify-center gap-2
                         transition-all duration-200 hover:shadow-sm active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)',
                color: '#059669',
                border: '1px solid #a7f3d0',
              }}
            >
              <Zap className="w-4 h-4" />
              Demo Mode: 1-Click Login
            </button>
            <p className="text-xs text-center text-[var(--color-text-muted)] mt-2">
              Instant access for demonstration purposes
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-center text-[var(--color-text-muted)] mt-6">
          Ministry of Statistics and Programme Implementation
        </p>
      </div>
    </div>
  );
}
