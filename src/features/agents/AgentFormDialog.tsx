import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { SecurityNotice } from '@/components/common/bits';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import { firstRepeat, pageUrlKey, phoneKey, postUrlKey, telegramKey, urlKeys } from '@/lib/identity';
import { paymentTermFitsType, paymentTermOptionsFor } from '@/lib/agents';
import { AGENT_TYPE, COMMS_CHANNEL, COOPERATION_STATUS, type Agent, type AgentType } from '@/lib/types';
import { useSession } from '@/hooks/useSession';
import { isAdmin } from '@/lib/access';

const schema = z.object({
  name: z.string().min(2, 'Enter the agent or business name.'),
  externalUid: z.string().max(64, 'A UID is at most 64 characters.'),
  agentType: z.enum(AGENT_TYPE),
  contactNumber: z.string(),
  email: z.string().email('Enter a valid email address.').or(z.literal('')),
  telegramUsername: z.string(),
  preferredChannel: z.enum(COMMS_CHANNEL),
  managerId: z.string(),
  cooperationStatus: z.enum(COOPERATION_STATUS),
  paymentTerm: z.string(),
  startDate: z.string(),
  lastContactedDate: z.string(),
  nextFollowUpDate: z.string(),
  agreementRef: z.string(),
  channelUrls: z.string(),
  postLinks: z.string(),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function AgentFormDialog({
  open, onOpenChange, agent,
}: { open: boolean; onOpenChange: (v: boolean) => void; agent?: Agent }) {
  const { data } = useCrmData();
  const create = useCreate<Agent>('agents', 'Agent');
  const update = useUpdate<Agent>('agents', 'Agent');
  const editing = Boolean(agent);
  const { actorId, role } = useSession();

  const defaults: Values = React.useMemo(
    () => ({
      name: agent?.name ?? '',
      externalUid: agent?.externalUid ?? '',
      agentType: agent?.agentType ?? 'Individual',
      contactNumber: agent?.contactNumber ?? '',
      email: agent?.email ?? '',
      telegramUsername: agent?.telegramUsername ? `@${agent.telegramUsername}` : '',
      preferredChannel: agent?.preferredChannel ?? 'Email',
      // A new agent is managed by whoever registers it, unless they choose someone
      // else — otherwise staff would register agents they could not edit.
      managerId: agent ? agent.managerId ?? '' : isAdmin(role) ? '' : actorId,
      cooperationStatus: agent?.cooperationStatus ?? 'Prospect',
      paymentTerm: agent?.paymentTerm ?? '',
      startDate: agent?.startDate ?? '',
      lastContactedDate: agent?.lastContactedDate ?? '',
      nextFollowUpDate: agent?.nextFollowUpDate ?? '',
      agreementRef: agent?.agreementRef ?? '',
      channelUrls: (agent?.channelUrls ?? []).join('\n'),
      postLinks: (agent?.postLinks ?? []).join('\n'),
      notes: agent?.notes ?? '',
    }),
    [agent, role, actorId],
  );

  const { register, handleSubmit, reset, watch, setValue, setError, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  // Payment Term choices depend on Agent type; a term left over from a type
  // switch (an Agency's Net 30 surviving a change to Promoter/Influencer)
  // is cleared rather than silently kept.
  const watchedAgentType = watch('agentType') as AgentType;
  const paymentTermOptions = paymentTermOptionsFor(watchedAgentType);
  const watchedPaymentTerm = watch('paymentTerm');
  React.useEffect(() => {
    if (watchedPaymentTerm && !paymentTermFitsType(watchedPaymentTerm as Agent['paymentTerm'], watchedAgentType)) {
      setValue('paymentTerm', '');
    }
  }, [watchedAgentType, watchedPaymentTerm, setValue]);

  // Live duplicate checks, mirroring the server: only values this agent did not
  // already have, so an older clash never locks the record.
  const others = (data?.agents ?? []).filter((a) => a.id !== agent?.id && !a.archived);
  const typedPhone = phoneKey(watch('contactNumber'));
  const phoneHolder = typedPhone && typedPhone !== phoneKey(agent?.contactNumber)
    ? others.find((a) => phoneKey(a.contactNumber) === typedPhone)
    : undefined;
  const typedUrls = (watch('channelUrls') ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const repeatedUrl = firstRepeat(typedUrls, pageUrlKey);
  const hadUrls = new Set(urlKeys(agent?.channelUrls ?? []));
  const urlClash = typedUrls
    .filter((u) => pageUrlKey(u) && !hadUrls.has(pageUrlKey(u)))
    .map((u) => ({ url: u, holder: others.find((a) => urlKeys(a.channelUrls).includes(pageUrlKey(u))) }))
    .find((c) => c.holder);
  const typedPostLinks = (watch('postLinks') ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const repeatedPostLink = firstRepeat(typedPostLinks, postUrlKey);
  const hadPostLinks = new Set(urlKeys(agent?.postLinks ?? [], { caseSensitivePath: true }));
  const postLinkClash = typedPostLinks
    .filter((u) => postUrlKey(u) && !hadPostLinks.has(postUrlKey(u)))
    .map((u) => ({ url: u, holder: others.find((a) => urlKeys(a.postLinks, { caseSensitivePath: true }).includes(postUrlKey(u))) }))
    .find((c) => c.holder);
  const typedUid = (watch('externalUid') ?? '').trim().toLowerCase();
  const uidHolder = typedUid && typedUid !== (agent?.externalUid ?? '').toLowerCase()
    ? others.find((a) => a.externalUid.toLowerCase() === typedUid)
    : undefined;
  const typedTelegram = telegramKey(watch('telegramUsername'));
  const telegramHolder = typedTelegram && typedTelegram !== telegramKey(agent?.telegramUsername)
    ? others.find((a) => telegramKey(a.telegramUsername) === typedTelegram)
    : undefined;
  const uidMessage = uidHolder ? `This UID is already on ${uidHolder.id} (${uidHolder.name}).` : undefined;
  const phoneMessage = phoneHolder ? `This number is already registered on ${phoneHolder.id} (${phoneHolder.name}).` : undefined;
  const telegramMessage = telegramHolder ? `This Telegram username is already on ${telegramHolder.id} (${telegramHolder.name}).` : undefined;
  const urlMessage = repeatedUrl
    ? `${repeatedUrl} is listed twice.`
    : urlClash ? `${urlClash.url} is already listed on ${urlClash.holder!.id} (${urlClash.holder!.name}).` : undefined;
  const postLinkMessage = repeatedPostLink
    ? `${repeatedPostLink} is listed twice.`
    : postLinkClash ? `${postLinkClash.url} is already listed on ${postLinkClash.holder!.id} (${postLinkClash.holder!.name}).` : undefined;

  const onSubmit = handleSubmit(async (values) => {
    if (phoneMessage || urlMessage || uidMessage || telegramMessage || postLinkMessage) {
      if (uidMessage) setError('externalUid', { message: uidMessage });
      if (phoneMessage) setError('contactNumber', { message: phoneMessage });
      if (telegramMessage) setError('telegramUsername', { message: telegramMessage });
      if (urlMessage) setError('channelUrls', { message: urlMessage });
      if (postLinkMessage) setError('postLinks', { message: postLinkMessage });
      return;
    }
    const payload = {
      ...values,
      externalUid: values.externalUid.trim(),
      telegramUsername: telegramKey(values.telegramUsername),
      paymentTerm: values.paymentTerm || null,
      managerId: values.managerId || null,
      startDate: values.startDate || null,
      lastContactedDate: values.lastContactedDate || null,
      nextFollowUpDate: values.nextFollowUpDate || null,
      channelUrls: values.channelUrls.split('\n').map((s) => s.trim()).filter(Boolean),
      postLinks: values.postLinks.split('\n').map((s) => s.trim()).filter(Boolean),
      reason: editing ? 'Agent record edited' : 'Agent registered',
    };
    try {
      if (editing) await update.mutateAsync({ id: agent!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      // The mutation already surfaced the message as a toast; keep the dialog
      // open with the user's input, and put a duplicate refusal on its field.
      if (e instanceof ApiError && (
        e.field === 'contactNumber' || e.field === 'channelUrls' || e.field === 'externalUid'
        || e.field === 'telegramUsername' || e.field === 'postLinks' || e.field === 'paymentTerm'
      )) {
        setError(e.field, { message: e.message });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${agent!.id}` : 'Register an agent'}</DialogTitle>
          <DialogDescription>Agents are contacts, not system users.</DialogDescription>
        </DialogHeader>

        <SecurityNotice>
          Creating an agent record does <strong>not</strong> create a CRM login. Access to this workspace is managed
          separately under Roles &amp; Audit.
        </SecurityNotice>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Name or business name" htmlFor="agent-name" required error={errors.name?.message}>
            <Input {...register('name')} placeholder="Ananya Deshpande" />
          </Field>
          <Field label="UID" htmlFor="agent-uid" error={errors.externalUid?.message ?? uidMessage} hint="The agent’s own UID, e.g. their player or platform UID.">
            <Input {...register('externalUid')} placeholder="81000037" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Agent type" htmlFor="agent-type">
            <NativeSelect {...register('agentType')}>
              {AGENT_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Contact number" htmlFor="agent-phone" error={errors.contactNumber?.message ?? phoneMessage}>
            <Input {...register('contactNumber')} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email" htmlFor="agent-email" error={errors.email?.message}>
            <Input type="email" {...register('email')} placeholder="name@agency.example" />
          </Field>
          <Field label="Telegram username" htmlFor="agent-telegram" error={errors.telegramUsername?.message ?? telegramMessage}>
            <Input {...register('telegramUsername')} placeholder="@handle" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Preferred communication channel" htmlFor="agent-channel">
            <NativeSelect {...register('preferredChannel')}>
              {COMMS_CHANNEL.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Assigned manager" htmlFor="agent-manager" hint="Only this person and the System Administrator can edit the agent.">
            <NativeSelect {...register('managerId')}>
              <option value="">— Unassigned —</option>
              {(data?.teamMembers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Cooperation status" htmlFor="agent-status">
            <NativeSelect {...register('cooperationStatus')}>
              {COOPERATION_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Payment term" htmlFor="agent-payment-term" error={errors.paymentTerm?.message}
            hint={watchedAgentType === 'Promoter/Influencer' ? 'Content-style terms.' : 'Invoice-style terms.'}>
            <NativeSelect {...register('paymentTerm')}>
              <option value="">— Not set —</option>
              {paymentTermOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Agreement or document reference" htmlFor="agent-doc" hint="A reference only — no files are stored in this phase.">
            <Input {...register('agreementRef')} placeholder="DOC-1042" />
          </Field>
          <Field label="Start date" htmlFor="agent-start"><Input type="date" {...register('startDate')} /></Field>
          <Field label="Last contacted" htmlFor="agent-contacted"><Input type="date" {...register('lastContactedDate')} /></Field>
          <Field label="Next follow-up" htmlFor="agent-followup"><Input type="date" {...register('nextFollowUpDate')} /></Field>
          <Field label="Channels or profile URLs" htmlFor="agent-urls" className="sm:col-span-2" hint="One per line."
            error={errors.channelUrls?.message ?? urlMessage}>
            <Textarea {...register('channelUrls')} placeholder="https://instagram.com/handle" />
          </Field>
          <Field label="Post links" htmlFor="agent-post-links" className="sm:col-span-2" hint="Links to specific posts, one per line — not the channel itself."
            error={errors.postLinks?.message ?? postLinkMessage}>
            <Textarea {...register('postLinks')} placeholder="https://instagram.com/p/…" />
          </Field>
          <Field label="Notes" htmlFor="agent-notes" className="sm:col-span-2">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Register agent'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
