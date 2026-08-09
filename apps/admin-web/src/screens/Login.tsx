import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, mfaEnroll, mfaVerify, setTokens, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Field, Input, Logo, buttonClass, cardClass } from '@ruostack/ui';

type Stage = 'credentials' | 'totp' | 'enroll';

export function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [stage, setStage] = useState<Stage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [enrollToken, setEnrollToken] = useState('');
  const [enrollSecret, setEnrollSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function finish(access: string, refreshToken: string) {
    setTokens(access, refreshToken);
    refresh();
    navigate('/overview');
  }

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await login(email, password);
      if (r.mfa_enrollment_required && r.enrollment_token) {
        // First login → force TOTP enrollment.
        const enrolled = await mfaEnroll(r.enrollment_token);
        setEnrollToken(r.enrollment_token);
        setEnrollSecret(enrolled.secret);
        setOtpauthUri(enrolled.otpauth_uri);
        setStage('enroll');
      } else if (r.access_token && r.refresh_token) {
        finish(r.access_token, r.refresh_token);
      } else if (r.mfa_required) {
        // Password OK; MFA already enrolled → prompt for the 6-digit code.
        setStage('totp');
      } else {
        setErr('Unexpected login response');
      }
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await login(email, password, totp);
      if (r.access_token && r.refresh_token) finish(r.access_token, r.refresh_token);
      else setErr('Invalid code');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitEnroll(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await mfaVerify(enrollToken, totp);
      if (r.access_token && r.refresh_token) finish(r.access_token, r.refresh_token);
      else setErr('Invalid code');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className={cardClass('w-full max-w-sm p-7')}>
        <div className="mb-6 flex items-center gap-2">
          <Logo variant="mark" className="h-8 w-auto text-accent" />
          <span className="text-xl font-bold text-content">RUOStack Admin</span>
        </div>

        {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

        {stage === 'credentials' && (
          <form onSubmit={submitCredentials}>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <button className={buttonClass('primary', 'md', 'mt-2 w-full')} disabled={busy}>
              {busy ? '…' : 'Continue'}
            </button>
          </form>
        )}

        {stage === 'totp' && (
          <form onSubmit={submitTotp}>
            <p className="mb-4 text-sm text-content-muted">Enter the 6-digit code from your authenticator app.</p>
            <Field label="Authentication code">
              <Input className="tracking-[0.4em]" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} required />
            </Field>
            <button className={buttonClass('primary', 'md', 'mt-2 w-full')} disabled={busy}>
              {busy ? '…' : 'Verify'}
            </button>
          </form>
        )}

        {stage === 'enroll' && (
          <form onSubmit={submitEnroll}>
            <p className="mb-3 text-sm text-content-muted">
              Set up MFA. Add this secret to your authenticator app, then enter the current code to finish.
            </p>
            <div className="mb-3 break-all rounded-lg border border-line bg-surface-3 px-3 py-2 font-mono text-xs text-accent-hover">
              {enrollSecret}
            </div>
            <a className="mb-3 block text-xs text-accent underline" href={otpauthUri}>
              Open in authenticator (otpauth URI)
            </a>
            <Field label="Authentication code">
              <Input className="tracking-[0.4em]" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} required />
            </Field>
            <button className={buttonClass('primary', 'md', 'mt-2 w-full')} disabled={busy}>
              {busy ? '…' : 'Enable MFA & sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
