import * as React from 'react';
import { AtSign, Mail, Send } from 'lucide-react';
import { Badge, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import { DefinitionList, SafeExternalLink, StatusBadge } from '@/components/common/bits';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { instagramLinkIn, leadMailto, promoConfidenceTone, telegramLinkIn } from '@/lib/leads';
import { DATA_LEAD_ASSIGNEE, DATA_LEAD_STATUS, type DataLeadRecord } from '@/lib/types';

/** The creator's own detail: full context, the contact channels that were
 *  actually found, and the one action this page exists for — reaching out.
 *  Opening a contact link also marks the lead Contacted the first time, so
 *  the register reflects outreach as it happens rather than needing a second,
 *  separate click. */
export function LeadDetailDialog({ lead, onOpenChange }: { lead: DataLeadRecord | undefined; onOpenChange: (v: boolean) => void }) {
  const { lookups } = useCrmData();
  const { can } = useSession();
  const update = useUpdate<DataLeadRecord>('data-leads', 'Lead');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => { setNotes(lead?.notes ?? ''); }, [lead?.id, lead?.notes]);

  if (!lead) return null;
  const mayEdit = can('edit:resources');

  const markContactedIfFresh = () => {
    if (lead.status === 'Not contacted') update.mutate({ id: lead.id, status: 'Contacted' });
  };

  const mailto = leadMailto(lead);
  const telegram = telegramLinkIn(lead.publicTelegram);
  const instagram = instagramLinkIn(lead.publicInstagram);
  const hasAnyContact = Boolean(mailto || telegram || instagram);

  return (
    <Dialog open={Boolean(lead)} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{lead.creator}</DialogTitle>
          <DialogDescription>
            {lookups.platformName(lead.platformId)} · {lookups.countryName(lead.countryCode)}{lead.niche ? ` · ${lead.niche}` : ''}
          </DialogDescription>
        </DialogHeader>

        <DefinitionList
          columns={2}
          items={[
            { label: 'Status', value: <StatusBadge kind="dataLead" value={lead.status} /> },
            { label: 'Promo confidence', value: lead.promoConfidence ? <Badge tone={promoConfidenceTone(lead.promoConfidence)}>{lead.promoConfidence}</Badge> : '—' },
            { label: 'Followers / subscribers', value: lead.followerCount !== null ? lead.followerCount.toLocaleString() : '—' },
            { label: 'Tier', value: lead.tier || '—' },
            { label: 'Keyword', value: lead.keyword || '—' },
            { label: 'Channel', value: lead.channelUrl ? <SafeExternalLink href={lead.channelUrl}>{lead.channelUrl}</SafeExternalLink> : '—' },
          ]}
        />

        {lead.evidenceTitle && (
          <div className="rounded-md border border-border p-3 text-[13px]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
            <p className="mt-1">{lead.evidenceTitle}</p>
            {lead.evidenceUrl && <SafeExternalLink href={lead.evidenceUrl} className="mt-0.5 text-[12px]">{lead.evidenceUrl}</SafeExternalLink>}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reach out</p>
          {!hasAnyContact ? (
            <p className="text-[13px] text-muted-foreground">No public contact reference was found for this lead.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {mailto && (
                <Button asChild size="sm" onClick={markContactedIfFresh}>
                  <a href={mailto}><Mail /> Email {lead.publicEmail.split(/[;,\s]+/)[0]}</a>
                </Button>
              )}
              {telegram && (
                <Button asChild size="sm" variant={mailto ? 'outline' : 'default'} onClick={markContactedIfFresh}>
                  <a href={telegram} target="_blank" rel="noreferrer noopener external"><Send /> Telegram</a>
                </Button>
              )}
              {instagram && (
                <Button asChild size="sm" variant={mailto || telegram ? 'outline' : 'default'} onClick={markContactedIfFresh}>
                  <a href={instagram} target="_blank" rel="noreferrer noopener external"><AtSign /> Instagram</a>
                </Button>
              )}
            </div>
          )}
          {(lead.publicEmail || lead.publicTelegram || lead.publicInstagram) && (
            <dl className="mt-1 flex flex-col gap-0.5 text-[12px] text-muted-foreground">
              {lead.publicEmail && <div><dt className="inline font-medium">Email as scraped:</dt> <dd className="inline">{lead.publicEmail}</dd></div>}
              {lead.publicTelegram && <div><dt className="inline font-medium">Telegram as scraped:</dt> <dd className="inline">{lead.publicTelegram}</dd></div>}
              {lead.publicInstagram && <div><dt className="inline font-medium">Instagram as scraped:</dt> <dd className="inline">{lead.publicInstagram}</dd></div>}
            </dl>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-status">Status</Label>
            <NativeSelect
              id="lead-status"
              value={lead.status}
              disabled={!mayEdit}
              onChange={(e) => update.mutate({ id: lead.id, status: e.target.value as DataLeadRecord['status'] })}
            >
              {DATA_LEAD_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-assignee">Assigned to</Label>
            <NativeSelect
              id="lead-assignee"
              value={lead.assignedTo ?? ''}
              disabled={!mayEdit}
              onChange={(e) => update.mutate({ id: lead.id, assignedTo: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {DATA_LEAD_ASSIGNEE.map((name) => <option key={name} value={name}>{name}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Contacted</Label>
            <p className="pt-1.5 text-[13px]">
              {lead.contactedAt ? `${new Date(lead.contactedAt).toLocaleDateString()} by ${lookups.personName(lead.contactedById)}` : 'Not yet'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-notes">Notes</Label>
          <Textarea id="lead-notes" value={notes} disabled={!mayEdit} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {mayEdit && (
            <Button disabled={notes === lead.notes || update.isPending} onClick={() => update.mutate({ id: lead.id, notes })}>
              {update.isPending ? 'Saving…' : 'Save notes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
