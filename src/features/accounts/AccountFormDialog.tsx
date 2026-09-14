import * as React from 'react';
import { RECOVERY_DETAIL_HELP, checkRecoveryDetail } from '@/lib/recovery';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Link } from 'react-router-dom';
import { Measured, SecurityNotice } from '@/components/common/bits';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import { pageUrlKey } from '@/lib/identity';
import {
  ACCOUNT_ALLOCATION_STATUS, ACCOUNT_OPERATIONAL_STATUS, ASSET_TYPE,
  RECOVERY_METHOD, TWO_FA_METHOD, type SocialAccount,
} from '@/lib/types';

const schema = z.object({
  platformId: z.string().min(1, 'Select a platform.'),
  platformAccountId: z.string(),
  assetType: z.enum(ASSET_TYPE),
  displayName: z.string().min(1, 'Enter a display name.'),
  username: z.string().min(1, 'Enter the username or handle.'),
  profileUrl: z.string().url('Enter a valid URL.').or(z.literal('')),
  brandId: z.string(),
  projectId: z.string(),
  targetCountryCode: z.string(),
  contentLanguage: z.string(),
  responsibleTeamMemberId: z.string(),
  loginEmailRef: z.string(),
  credentialId: z.string(),
  recoveryMethod: z.enum(RECOVERY_METHOD),
  recoveryRef: z.string(),
  twoFaEnabled: z.string(),
  twoFaMethod: z.enum(TWO_FA_METHOD),
  operationalStatus: z.enum(ACCOUNT_OPERATIONAL_STATUS),
  allocationStatus: z.enum(ACCOUNT_ALLOCATION_STATUS),
  reservedForProjectId: z.string(),
  lastAccessVerifiedDate: z.string(),
  lastPostingDate: z.string(),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function AccountFormDialog({
  open, onOpenChange, account,
}: { open: boolean; onOpenChange: (v: boolean) => void; account?: SocialAccount }) {
  const { data } = useCrmData();
  const create = useCreate<SocialAccount>('social-accounts', 'Account');
  const update = useUpdate<SocialAccount>('social-accounts', 'Account');
  const editing = Boolean(account);

  const defaults: Values = React.useMemo(() => ({
    platformId: account?.platformId ?? data?.platforms[0]?.id ?? '',
    platformAccountId: account?.platformAccountId ?? '',
    assetType: account?.assetType ?? 'Profile',
    displayName: account?.displayName ?? '',
    username: account?.username ?? '',
    profileUrl: account?.profileUrl ?? '',
    brandId: account?.brandId ?? '',
    projectId: account?.projectId ?? '',
    targetCountryCode: account?.targetCountryCode ?? 'IN',
    contentLanguage: account?.contentLanguage ?? 'English',
    responsibleTeamMemberId: account?.responsibleTeamMemberId ?? '',
    loginEmailRef: account?.loginEmailRef ?? '',
    credentialId: account?.credentialId ?? '',
    recoveryMethod: account?.recoveryMethod ?? 'None',
    recoveryRef: account?.recoveryRef ?? '',
    twoFaEnabled: account?.twoFaEnabled ? 'yes' : 'no',
    twoFaMethod: account?.twoFaMethod ?? 'None',
    operationalStatus: account?.operationalStatus ?? 'Active',
    allocationStatus: account?.allocationStatus ?? 'Unassigned',
    reservedForProjectId: account?.reservedForProjectId ?? '',
    lastAccessVerifiedDate: account?.lastAccessVerifiedDate ?? '',
    lastPostingDate: account?.lastPostingDate ?? '',
    notes: account?.notes ?? '',
  }), [account, data]);

  const { register, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const platformId = watch('platformId');
  const platformAccountId = watch('platformAccountId');
  const brandId = watch('brandId');

  const platform = data?.platforms.find((p) => p.id === platformId);
  const projectOptions = (data?.projects ?? []).filter((p) => !brandId || p.brandId === brandId);

  // The recovery detail is checked by the same rule the server applies.
  const recoveryMethod = watch('recoveryMethod');
  const recoveryChecked = checkRecoveryDetail(recoveryMethod, watch('recoveryRef'));
  const recoveryError = 'error' in recoveryChecked ? recoveryChecked.error : undefined;

  const profileUrl = watch('profileUrl');
  const urlKeyTyped = pageUrlKey(profileUrl);
  const dupProfileUrl = urlKeyTyped && urlKeyTyped !== pageUrlKey(account?.profileUrl)
    ? (data?.socialAccounts ?? []).find((a) => a.id !== account?.id && !a.archived && pageUrlKey(a.profileUrl) === urlKeyTyped)
    : undefined;
  const dupPlatformId = (data?.socialAccounts ?? []).find(
    (a) => a.id !== account?.id && !a.archived && a.platformId === platformId && platformAccountId.trim() !== '' &&
      a.platformAccountId === platformAccountId.trim(),
  );

  const onSubmit = handleSubmit(async (values) => {
    if (recoveryError) {
      setError('recoveryRef', { message: recoveryError });
      return;
    }
    if (dupProfileUrl || dupPlatformId) {
      if (dupProfileUrl) setError('profileUrl', { message: `This page is already registered on ${dupProfileUrl.id} (@${dupProfileUrl.username}).` });
      if (dupPlatformId) setError('platformAccountId', { message: `Already used by ${dupPlatformId.id}.` });
      return;
    }
    const payload = {
      ...values,
      brandId: values.brandId || null,
      projectId: values.projectId || null,
      responsibleTeamMemberId: values.responsibleTeamMemberId || null,
      credentialId: values.credentialId || null,
      reservedForProjectId: values.reservedForProjectId || null,
      lastAccessVerifiedDate: values.lastAccessVerifiedDate || null,
      lastPostingDate: values.lastPostingDate || null,
      twoFaEnabled: values.twoFaEnabled === 'yes',
      recoveryRef: values.recoveryMethod === 'None' ? '' : values.recoveryRef,
      reason: editing ? 'Account record edited' : 'Account registered',
    };
    try {
      if (editing) await update.mutateAsync({ id: account!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field === 'username') setError('username', { message: e.message });
      if (e instanceof ApiError && e.field === 'platformAccountId') setError('platformAccountId', { message: e.message });
      if (e instanceof ApiError && e.field === 'profileUrl') setError('profileUrl', { message: e.message });
      if (e instanceof ApiError && e.field === 'recoveryRef') setError('recoveryRef', { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${account!.id}` : 'Register a social media account'}</DialogTitle>
          <DialogDescription>
            Operational status (does the account work) is kept separate from allocation status (is it spoken for).
          </DialogDescription>
        </DialogHeader>

        <SecurityNotice>
          Only <strong>references</strong> are recorded here — a login identifier and a vault item reference. Never type
          a password, token, recovery code or session cookie into this form.
        </SecurityNotice>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Platform" htmlFor="acc-platform" required error={errors.platformId?.message}>
            <NativeSelect {...register('platformId')}>
              {(data?.platforms ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.builtIn ? '' : ' (custom)'}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Asset type" htmlFor="acc-asset">
            <NativeSelect {...register('assetType')}>
              {(platform?.supportsAssetTypes ?? ASSET_TYPE).map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Platform account ID" htmlFor="acc-platform-id"
            error={errors.platformAccountId?.message ?? (dupPlatformId ? `Already used by ${dupPlatformId.id}.` : undefined)}
            hint="The platform's own identifier for this asset.">
            <Input {...register('platformAccountId')} placeholder="FA1000000" />
          </Field>

          <Field label="Display name" htmlFor="acc-display" required error={errors.displayName?.message}>
            <Input {...register('displayName')} />
          </Field>
          <Field label="Username or handle" htmlFor="acc-username" required error={errors.username?.message}
            hint="Can be the same on several accounts. The platform account ID is what identifies each one.">
            <Input {...register('username')} placeholder="aurorashop" />
          </Field>
          <Field label="Profile URL" htmlFor="acc-url"
            error={errors.profileUrl?.message ?? (dupProfileUrl ? `This page is already registered on ${dupProfileUrl.id} (@${dupProfileUrl.username}).` : undefined)}>
            <Input {...register('profileUrl')} placeholder="https://…" />
          </Field>

          <Field label="Associated brand" htmlFor="acc-brand">
            <NativeSelect {...register('brandId')}>
              <option value="">— None —</option>
              {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Project" htmlFor="acc-project">
            <NativeSelect {...register('projectId')}>
              <option value="">— None —</option>
              {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Target country" htmlFor="acc-country">
            <NativeSelect {...register('targetCountryCode')}>
              {(data?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Content language" htmlFor="acc-lang"><Input {...register('contentLanguage')} /></Field>
          <Field label="Responsible employee" htmlFor="acc-owner" hint="Ownership must be documented for reserve readiness.">
            <NativeSelect {...register('responsibleTeamMemberId')}>
              <option value="">— Unassigned —</option>
              {(data?.teamMembers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Login email reference" htmlFor="acc-login" hint="An identifier, not a credential.">
            <Input {...register('loginEmailRef')} placeholder="ops+acc0231@example-internal.test" autoComplete="off" />
          </Field>

          <Field label="Credential vault reference" htmlFor="acc-cred" hint="Points at a vault item. Not connected in this phase.">
            <NativeSelect {...register('credentialId')}>
              <option value="">— None —</option>
              {(data?.credentials ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.vaultRef}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Recovery method" htmlFor="acc-recovery-method">
            <NativeSelect {...register('recoveryMethod')}>
              {RECOVERY_METHOD.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </Field>
          <Field
            label={RECOVERY_DETAIL_HELP[recoveryMethod].label}
            htmlFor="acc-recovery-ref"
            error={errors.recoveryRef?.message ?? recoveryError}
            hint={RECOVERY_DETAIL_HELP[recoveryMethod].hint}
          >
            <Input {...register('recoveryRef')} placeholder={RECOVERY_DETAIL_HELP[recoveryMethod].placeholder}
              autoComplete="off" spellCheck={false} disabled={recoveryMethod === 'None'} />
          </Field>

          <Field label="2FA enabled" htmlFor="acc-2fa">
            <NativeSelect {...register('twoFaEnabled')}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </NativeSelect>
          </Field>
          <Field label="2FA method" htmlFor="acc-2fa-method">
            <NativeSelect {...register('twoFaMethod')}>
              {TWO_FA_METHOD.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Last access verification" htmlFor="acc-verified">
            <Input type="date" {...register('lastAccessVerifiedDate')} />
          </Field>

          <Field label="Operational status" htmlFor="acc-op" hint="Does the account work?">
            <NativeSelect {...register('operationalStatus')}>
              {ACCOUNT_OPERATIONAL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Allocation status" htmlFor="acc-alloc" hint="Is it spoken for?">
            <NativeSelect {...register('allocationStatus')}>
              {ACCOUNT_ALLOCATION_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reserved for project" htmlFor="acc-reserved">
            <NativeSelect {...register('reservedForProjectId')}>
              <option value="">— None —</option>
              {(data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Last posting date" htmlFor="acc-posted"><Input type="date" {...register('lastPostingDate')} /></Field>

          {/* Follower numbers are not typed here. They come from the dated daily
              entry on Growth, so every figure has a date and lands in the series. */}
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 sm:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Follower count</p>
            <p className="mt-1 text-[13px]">
              {account?.followerCount != null
                ? <><span className="font-semibold tabular">{account.followerCount.toLocaleString()}</span>{' '}<Measured date={account.followerCountMeasuredAt} /></>
                : <span className="text-muted-foreground">Not recorded yet</span>}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recorded daily under <Link to="/growth" className="text-primary hover:underline">Growth</Link>, so each
              figure keeps the date it was read on and feeds the trend.
            </p>
          </div>

          <Field label="Notes" htmlFor="acc-notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2 lg:col-span-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Register account'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
