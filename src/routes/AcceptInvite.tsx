import * as React from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, KeyRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Field, Input, Skeleton } from '@/components/ui/primitives';
import { authRequest, useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

/** Where an invite link lands. The person sets their own password here — no
 *  password was ever generated for them, so this is the only way an account
 *  becomes usable. */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, refresh } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = React.useState<{ name: string; email: string } | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setLoadError('That link is missing its token. Ask for a new invite.');
      return;
    }
    authRequest<{ name: string; email: string }>(`invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  if (status === 'disabled') return <Navigate to="/" replace />;

  const mismatch = confirm.length > 0 && password !== confirm;
  const rules = [
    { ok: password.length >= 12, label: 'At least 12 characters' },
    { ok: !invite || !isMostlyIdentity(password, invite), label: 'Not mostly your name or email' },
    { ok: password.length > 0 && password === confirm, label: 'Both entries match' },
  ];

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authRequest('accept-invite', { token, password });
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
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
            <h1 className="text-sm font-semibold leading-tight">Set your password</h1>
            <p className="text-[11px] leading-tight text-muted-foreground">Marketing Resource CRM</p>
          </div>
        </div>

        {loadError ? (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-3 text-[13px]">
            <p className="font-medium text-danger">This invite cannot be used</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/login')}>
              Go to sign in
            </Button>
          </div>
        ) : !invite ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <p className="text-[13px]">
              Welcome, <span className="font-semibold">{invite.name}</span>.
              <span className="block text-[12px] text-muted-foreground">{invite.email}</span>
            </p>

            <Field label="New password" htmlFor="invite-password" required>
              <Input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Field
              label="Confirm password"
              htmlFor="invite-confirm"
              required
              error={mismatch ? 'These do not match.' : undefined}
            >
              <Input
                id="invite-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>

            {/* Shown as you type, so the rules are not a surprise on submit.
                The server checks them again — this is a convenience, not the guard. */}
            <ul className="flex flex-col gap-1">
              {rules.map((rule) => (
                <li key={rule.label} className="flex items-center gap-1.5 text-[12px]">
                  <span
                    className={cn(
                      'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full',
                      rule.ok ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden="true"
                  >
                    {rule.ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                  </span>
                  <span className={rule.ok ? 'text-muted-foreground' : ''}>{rule.label}</span>
                  <span className="sr-only">{rule.ok ? ' met' : ' not met'}</span>
                </li>
              ))}
            </ul>

            {error && (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[12px] font-medium text-danger">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy || !rules.every((r) => r.ok)}>
              <KeyRound /> {busy ? 'Setting…' : 'Set password and sign in'}
            </Button>
          </form>
        )}

        <p className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          This link works once and then stops working. Nobody else — including whoever set up your
          account — knows the password you choose here.
        </p>
      </Card>
    </main>
  );
}

/** Mirrors the server's rule closely enough to be useful while typing. The
 *  server's version is the one that decides. */
function isMostlyIdentity(password: string, invite: { name: string; email: string }): boolean {
  if (!password) return false;
  const lowered = password.toLowerCase();
  const tokens = [invite.email.split('@')[0] ?? '', invite.name]
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 3);
  return tokens.some((t) => lowered.split(t).join('').length < 8);
}
