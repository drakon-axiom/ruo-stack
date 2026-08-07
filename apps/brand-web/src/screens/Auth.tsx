import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { signupBrand, ApiError } from '../lib/api.js';
import { Card, InlineAlert, buttonClass, inputClass } from '@ruostack/ui';

/* Auth shell. This used to be light-only (the old "light auth, dark app"
 * pattern) and still carried a hard-coded white card and slate text, so in dark
 * mode the fields rendered as near-black boxes on a white card. It now follows
 * the theme like everything else. */
function AuthShell({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-solid text-lg font-black text-white">
            R
          </span>
          <span className="text-xl font-bold text-content">RUOStack</span>
        </div>
        <h1 className="mb-1 text-xl font-bold text-content">{title}</h1>
        <p className="mb-5 text-sm text-content-muted">Research-use-only fulfillment platform.</p>
        {children}
        {footer && <div className="mt-5 text-center text-sm text-content-muted">{footer}</div>}
      </Card>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="mb-4">
      <InlineAlert tone="danger">{msg}</InlineAlert>
    </div>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState('');
  const ref = params.get('ref') ?? undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await signupBrand({ full_name: fullName, brand_name: brandName, email, password, ref });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Email confirmation likely required (per Supabase project config).
        setConfirmMsg('Account created. Check your email to confirm, then sign in.');
      } else {
        navigate('/app/account');
      }
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  }

  if (confirmMsg) {
    return (
      <AuthShell title="Almost there" footer={<Link className="text-accent" to="/login">Go to sign in</Link>}>
        <p className="text-sm text-content-muted">{confirmMsg}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" footer={<>Already have one? <Link className="text-accent" to="/login">Sign in</Link></>}>
      <Err msg={err} />
      <form onSubmit={submit} className="space-y-3">
        {ref && <div className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">Referral code applied: {ref}</div>}
        <input className={inputClass()} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input className={inputClass()} placeholder="Research company name" value={brandName} onChange={(e) => setBrandName(e.target.value)} required />
        <input className={inputClass()} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputClass()} type="password" placeholder="Password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button className={buttonClass('primary', 'md', 'w-full')} disabled={busy}>{busy ? '…' : 'Create account'}</button>
        <p className="text-center text-2xs text-content-faint">No card required. Research use only.</p>
      </form>
    </AuthShell>
  );
}

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
    else navigate('/app/account');
  }

  return (
    <AuthShell title="Sign in" footer={<>New here? <Link className="text-accent" to="/signup">Create an account</Link></>}>
      <Err msg={err} />
      <form onSubmit={submit} className="space-y-3">
        <input className={inputClass()} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputClass()} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className={buttonClass('primary', 'md', 'w-full')} disabled={busy}>{busy ? '…' : 'Sign in'}</button>
        <div className="text-center"><Link className="text-xs text-content-muted transition-colors duration-fast hover:text-accent" to="/forgot">Forgot password?</Link></div>
      </form>
    </AuthShell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <AuthShell title="Reset password" footer={<Link className="text-accent" to="/login">Back to sign in</Link>}>
      {sent ? (
        <p className="text-sm text-content-muted">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Err msg={err} />
          <input className={inputClass()} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className={buttonClass('primary', 'md', 'w-full')}>Send reset link</button>
        </form>
      )}
    </AuthShell>
  );
}

export function Reset() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setErr(error.message);
    else navigate('/app/account');
  }

  return (
    <AuthShell title="Choose a new password" footer={<Link className="text-accent" to="/login">Back to sign in</Link>}>
      <Err msg={err} />
      <form onSubmit={submit} className="space-y-3">
        <input className={inputClass()} type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button className={buttonClass('primary', 'md', 'w-full')} disabled={busy}>{busy ? '…' : 'Update password'}</button>
      </form>
    </AuthShell>
  );
}
