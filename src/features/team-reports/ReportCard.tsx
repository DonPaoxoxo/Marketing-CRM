import * as React from 'react';
import { CheckCircle2, Download, FileText, MessageSquareReply, Paperclip, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Field, Textarea } from '@/components/ui/primitives';
import { ConfirmWithReason } from '@/components/common/controls';
import { useSession } from '@/hooks/useSession';
import { ApiError } from '@/hooks/useData';
import {
  REPLY_MAX, REPORT_FILE_ACCEPT, REPORT_FILE_LIMITS, REPORT_TEXT_MAX, classifyReportFile, formatBytes,
  mayDeleteReport, mayEditReport, mayReply, mayReview, periodLabel,
  type ReportContent, type ReportPeriod, type ReportStatus, type TeamReport,
} from '@/lib/team-reports';
import {
  reportFileUrl, useCreateReport, useDeleteReport, useRemoveReportFile, useReplyToReport, useSetReportStatus,
  useUpdateReport, useUploadReportFile,
} from './api';

const STATUS_TONE: Record<ReportStatus, React.ComponentProps<typeof Badge>['tone']> = {
  Submitted: 'info', Reviewed: 'success', 'Needs changes': 'warning',
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

const FIELDS: { key: keyof ReportContent; label: string; placeholder: string; required?: boolean }[] = [
  { key: 'workDone', label: 'What I did', placeholder: 'Tasks completed, accounts handled, posts published…', required: true },
  { key: 'results', label: 'Results / numbers', placeholder: 'Followers gained, leads, sign-ups, engagement…' },
  { key: 'blockers', label: 'Problems / blockers', placeholder: 'Anything that slowed you down or needs help.' },
  { key: 'recommendation', label: 'Recommendation', placeholder: 'What should we do next? Ideas and suggestions for the owner.' },
];

/** Write a new report or change an existing one. */
export function ReportForm({ period, date, report, onDone }: {
  period: ReportPeriod; date: string; report?: TeamReport; onDone?: () => void;
}) {
  const create = useCreateReport();
  const update = useUpdateReport();
  const uploadFile = useUploadReportFile();
  // Files chosen while writing a new report; uploaded right after it is created.
  const [pending, setPending] = React.useState<File[]>([]);
  const [fileProblems, setFileProblems] = React.useState<string[]>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const choose = async (chosen: File[]) => {
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of chosen) {
      if (pending.length + accepted.length >= REPORT_FILE_LIMITS.perReport) {
        problems.push(`A report can have up to ${REPORT_FILE_LIMITS.perReport} files — ${file.name} was not added.`);
        continue;
      }
      // Checked here first, so a refused file is explained before anything is sent.
      const checked = classifyReportFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if ('error' in checked) problems.push(checked.error);
      else accepted.push(file);
    }
    setPending((p) => [...p, ...accepted]);
    setFileProblems(problems);
  };
  const [values, setValues] = React.useState<ReportContent>({
    workDone: report?.workDone ?? '', results: report?.results ?? '', blockers: report?.blockers ?? '', recommendation: report?.recommendation ?? '',
  });
  const [error, setError] = React.useState<{ field: string; message: string }>();
  const busy = create.isPending || update.isPending || uploadFile.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.workDone.trim()) { setError({ field: 'workDone', message: 'Write what you did in this period.' }); return; }
    try {
      if (report) await update.mutateAsync({ id: report.id, ...values });
      else {
        const created = await create.mutateAsync({ period, date, ...values }) as TeamReport;
        const failed: string[] = [];
        for (const file of pending) {
          try { await uploadFile.mutateAsync({ id: created.id, file }); } catch (err) { failed.push(`${file.name}: ${(err as Error).message}`); }
        }
        setPending([]);
        setFileProblems(failed);
      }
      setError(undefined);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.field) setError({ field: err.field, message: err.message });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`report-${f.key}`} required={f.required}
          error={error?.field === f.key ? error.message : undefined}>
          <Textarea
            id={`report-${f.key}`} value={values[f.key]} maxLength={REPORT_TEXT_MAX} placeholder={f.placeholder}
            rows={f.key === 'workDone' ? 4 : 3}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </Field>
      ))}
      {error?.field === 'date' && <p role="alert" className="text-[12px] font-medium text-danger">{error.message}</p>}

      {!report && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Files <span className="font-normal text-muted-foreground">({pending.length}/{REPORT_FILE_LIMITS.perReport})</span></p>
          {pending.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pending.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12px]">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="max-w-[14rem] truncate" title={f.name}>{f.name}</span>
                  <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} className="text-muted-foreground hover:text-danger"
                    onClick={() => setPending((p) => p.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" multiple accept={REPORT_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose files for this report"
              onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void choose(files); }} />
            <Button type="button" size="sm" variant="outline" disabled={pending.length >= REPORT_FILE_LIMITS.perReport} onClick={() => fileInput.current?.click()}>
              <Paperclip /> Attach files
            </Button>
            <span className="text-[12px] text-muted-foreground">Images under 1 MB · PDF, Word, Excel, PowerPoint, CSV up to 5 MB · up to 5 files</span>
          </div>
          {fileProblems.length > 0 && (
            <ul role="alert" className="flex flex-col gap-0.5 text-[12px] text-danger">{fileProblems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {report && <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>}
        <Button type="submit" disabled={busy}>{busy ? (uploadFile.isPending ? 'Uploading files…' : 'Saving…') : report ? 'Save changes' : 'Submit report'}</Button>
      </div>
      {!report && <p className="text-[12px] text-muted-foreground">Never include ID documents, passwords or recovery codes.</p>}
    </form>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px]">{text}</p>
    </div>
  );
}

function Files({ report, editable }: { report: TeamReport; editable: boolean }) {
  const upload = useUploadReportFile();
  const remove = useRemoveReportFile();
  const input = React.useRef<HTMLInputElement>(null);
  const [problems, setProblems] = React.useState<string[]>([]);
  const room = REPORT_FILE_LIMITS.perReport - report.files.length;

  const attach = async (chosen: File[]) => {
    const found: string[] = [];
    if (chosen.length > room) found.push(`Only ${room} more file${room === 1 ? '' : 's'} can be attached (5 per report).`);
    for (const file of chosen.slice(0, room)) {
      // Checked here first so a refused file is explained without uploading it.
      const checked = classifyReportFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if ('error' in checked) { found.push(checked.error); continue; }
      try { await upload.mutateAsync({ id: report.id, file }); } catch (e) { found.push((e as Error).message); }
    }
    setProblems(found);
  };

  if (!report.files.length && !editable) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Files ({report.files.length}/{REPORT_FILE_LIMITS.perReport})</p>
      {report.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {report.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-md border border-border p-1.5 pr-2 text-[12px]">
              {f.kind === 'image' ? (
                <a href={reportFileUrl(f.id)} target="_blank" rel="noopener noreferrer">
                  <img src={reportFileUrl(f.id)} alt={f.fileName} loading="lazy" className="h-10 w-10 rounded object-cover" />
                </a>
              ) : <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
              <span className="flex max-w-[12rem] flex-col">
                <span className="truncate font-medium" title={f.fileName}>{f.fileName}</span>
                <span className="text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
              </span>
              <a href={reportFileUrl(f.id, true)} aria-label={`Download ${f.fileName}`} className="text-muted-foreground hover:text-foreground"><Download className="h-4 w-4" /></a>
              {editable && (
                <button type="button" aria-label={`Remove ${f.fileName}`} className="text-muted-foreground hover:text-danger"
                  onClick={() => remove.mutate({ fileId: f.id })}><X className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && room > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" multiple accept={REPORT_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Attach files to report"
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void attach(files); }} />
          <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Paperclip /> {upload.isPending ? 'Uploading…' : 'Attach files'}
          </Button>
          <span className="text-[12px] text-muted-foreground">Images under 1 MB · PDF, Word, Excel, PowerPoint, CSV up to 5 MB</span>
        </div>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-[12px] text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
    </div>
  );
}

function Replies({ report }: { report: TeamReport }) {
  const { actorId, role, permissions } = useSession();
  const reply = useReplyToReport();
  const [text, setText] = React.useState('');
  const canReply = mayReply({ id: actorId, role, permissions }, report);
  const send = async () => {
    if (!text.trim()) return;
    try { await reply.mutateAsync({ id: report.id, body: text }); setText(''); } catch { /* toast shown */ }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Replies ({report.replies.length})</p>
      {report.replies.map((r) => (
        <div key={r.id} className={`rounded-md px-3 py-2 text-[13px] ${r.authorRole === 'System Administrator' ? 'bg-accent/40' : 'bg-muted'}`}>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{r.authorName}</span>
            {r.authorRole === 'System Administrator' && ' · System owner'} · {new Date(r.createdAt).toLocaleString()}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{r.body}</p>
        </div>
      ))}
      {canReply && (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={`Reply to ${report.authorName}'s report`} value={text} maxLength={REPLY_MAX} rows={2}
            placeholder={role === 'System Administrator' ? 'Reply to this report…' : 'Answer the owner…'} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" className="w-fit self-end" onClick={send} disabled={!text.trim() || reply.isPending}>
            <MessageSquareReply /> {reply.isPending ? 'Sending…' : 'Reply'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ReportCard({ report, defaultOpen = false }: { report: TeamReport; defaultOpen?: boolean }) {
  const { actorId, role, permissions } = useSession();
  const person = { id: actorId, role, permissions };
  const [open, setOpen] = React.useState(defaultOpen);
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const setStatus = useSetReportStatus();
  const remove = useDeleteReport();
  const editable = mayEditReport(person, report);

  return (
    <article className="rounded-lg border border-border bg-card" aria-label={`${report.authorName} — ${periodLabel(report.period, report.periodStart)}`}>
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex flex-col">
          <span className="text-[14px] font-medium">{report.authorName}</span>
          <span className="text-[12px] text-muted-foreground">
            {periodLabel(report.period, report.periodStart)} · updated {new Date(report.updatedAt).toLocaleString()}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {report.files.length > 0 && <Badge tone="outline"><Paperclip className="h-3 w-3" aria-hidden="true" /> {report.files.length}</Badge>}
          {report.replies.length > 0 && <Badge tone="outline"><MessageSquareReply className="h-3 w-3" aria-hidden="true" /> {report.replies.length}</Badge>}
          <ReportStatusBadge status={report.status} />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          {editing ? (
            <ReportForm period={report.period} date={report.periodStart} report={report} onDone={() => setEditing(false)} />
          ) : (
            <>
              {FIELDS.map((f) => <TextBlock key={f.key} label={f.label} text={report[f.key]} />)}
              {report.reviewedAt && (
                <p className="text-[12px] text-muted-foreground">{report.status} by {report.reviewedByName || '—'} · {new Date(report.reviewedAt).toLocaleString()}</p>
              )}
            </>
          )}

          <Files report={report} editable={editable && !editing} />

          <div className="flex flex-wrap gap-2">
            {editable && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
            {mayReview(person) && report.status !== 'Reviewed' && (
              <Button size="sm" onClick={() => setStatus.mutate({ id: report.id, status: 'Reviewed' })}><CheckCircle2 /> Mark reviewed</Button>
            )}
            {mayReview(person) && report.status !== 'Needs changes' && (
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: report.id, status: 'Needs changes' })}><RotateCcw /> Needs changes</Button>
            )}
            {mayDeleteReport(person) && (
              <Button size="sm" variant="outline" className="ml-auto text-danger" onClick={() => setDeleting(true)}><Trash2 /> Delete permanently</Button>
            )}
          </div>

          <Replies report={report} />
        </div>
      )}

      <ConfirmWithReason
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${report.authorName}'s report permanently?`}
        description="The report, its files and all replies are erased from the database and cannot be recovered. The audit history keeps one line: who deleted which report, when, and your reason."
        confirmLabel="Delete permanently"
        placeholder="Why is this report being deleted? This line is kept in the audit history."
        hint="At least 10 characters. This cannot be undone."
        onConfirm={(reason) => remove.mutateAsync({ id: report.id, reason })}
      />
    </article>
  );
}
