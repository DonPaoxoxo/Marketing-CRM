import * as React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Field, Input } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Already signed in, or running on the mock where there is nothing to sign in to.
  if (status === 'authenticated' || status === 'disabled') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            MR
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Marketing Resource</h1>
            <p className="text-[11px] leading-tight text-muted-foreground">Internal CRM</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Email" htmlFor="login-email" required>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {/* One message for every failure, because "no such account" and "wrong
              password" told apart is a list of who works here. */}
          {error && (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[12px] font-medium text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !email || !password}>
            <LogIn /> {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          Accounts are created by an administrator. If you were sent an invite link, open that
          instead to set your password. Lost it? Ask for a new one — links expire.
        </p>
      </Card>
    </main>
  );
}
