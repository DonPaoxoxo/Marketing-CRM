import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NotConnectedNotice } from '@/components/common/bits';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import { postUrlKey } from '@/lib/identity';
import { engagementRate } from '@/lib/growth';
import { CONTENT_FORMAT, type ContentPost } from '@/lib/types';
import { toISODate } from '@/lib/utils';

const count = (label: string) =>
  z.coerce.number({ message: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(0, `${label} cannot be negative.`);

const schema = z
  .object({
    accountId: z.string().min(1, 'Select the account this was posted from.'),
    format: z.enum(CONTENT_FORMAT),
    title: z.string().min(2, 'Give the post a title you will recognise.'),
    url: z.string().url('Enter a valid URL.').or(z.literal('')),
    publishedDate: z.string().min(1, 'When was it published?'),
    views: count('Views'),
    likes: count('Likes'),
    comments: count('Comments'),
    shares: count('Shares'),
    followerGain: z.string(),
    metricsMeasuredAt: z.string().min(1, 'Record when you read these numbers.'),
    notes: z.string(),
  })
  .refine((v) => v.likes + v.comments + v.shares <= v.views, {
    message: 'Likes, comments and shares together cannot exceed views.',
    path: ['views'],
  });

type Values = z.infer<typeof schema>;

export function ContentPostDialog({
  open, onOpenChange, post,
}: { open: boolean; onOpenChange: (v: boolean) => void; post?: ContentPost }) {
  const { data, lookups } = useCrmData();
  const create = useCreate<ContentPost>('content-posts', 'Content post');
  const update = useUpdate<ContentPost>('content-posts', 'Content post');
  const editing = Boolean(post);
  const today = toISODate(new Date());

  // Only accounts that can carry short-form video.
  const eligible = React.useMemo(
    () => (data?.socialAccounts ?? []).filter(
      (a) => !a.archived && ['PLT-02', 'PLT-03', 'PLT-04'].includes(a.platformId),
    ),
    [data],
  );

  const defaults: Values = React.useMemo(() => ({
    accountId: post?.accountId ?? eligible[0]?.id ?? '',
    format: post?.format ?? 'Reel',
    title: post?.title ?? '',
    url: post?.url ?? '',
    publishedDate: post?.publishedDate ?? today,
    views: post?.views ?? 0,
    likes: post?.likes ?? 0,
    comments: post?.comments ?? 0,
    shares: post?.shares ?? 0,
    followerGain: post?.followerGain != null ? String(post.followerGain) : '',
    metricsMeasuredAt: post?.metricsMeasuredAt ?? today,
    notes: post?.notes ?? '',
  }), [post, eligible, today]);

  const { register, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const live = watch();
  const rate = engagementRate({
    views: Number(live.views) || 0,
    likes: Number(live.likes) || 0,
    comments: Number(live.comments) || 0,
    shares: Number(live.shares) || 0,
  });

  const typedUrl = postUrlKey(live.url);
  const urlHolder = typedUrl && typedUrl !== postUrlKey(post?.url)
    ? (data?.contentPosts ?? []).find((p) => p.id !== post?.id && !p.archived && postUrlKey(p.url) === typedUrl)
    : undefined;
  const urlMessage = urlHolder ? `This post is already recorded as ${urlHolder.id} (“${urlHolder.title}”).` : undefined;

  const onSubmit = handleSubmit(async (values) => {
    if (urlMessage) {
      setError('url', { message: urlMessage });
      return;
    }
    const payload = {
      ...values,
      followerGain: values.followerGain === '' ? null : Number(values.followerGain),
      reason: editing ? 'Content metrics updated' : 'Content engagement recorded',
    };
    try {
      if (editing) await update.mutateAsync({ id: post!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${post!.title}` : 'Record a post'}</DialogTitle>
          <DialogDescription>
            Short-form video only — Reels, Shorts and TikToks behave alike, so their engagement rates are comparable.
          </DialogDescription>
        </DialogHeader>

        <NotConnectedNotice what="No platform is connected. Every number here is read off the platform by a person and stamped with the date it was read." />

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Account" htmlFor="cnt-account" required error={errors.accountId?.message} className="lg:col-span-2">
            <NativeSelect {...register('accountId')}>
              {eligible.map((a) => (
                <option key={a.id} value={a.id}>@{a.username} — {lookups.platformName(a.platformId)}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Format" htmlFor="cnt-format">
            <NativeSelect {...register('format')}>
              {CONTENT_FORMAT.map((f) => <option key={f} value={f}>{f}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Title" htmlFor="cnt-title" required error={errors.title?.message} className="lg:col-span-2">
            <Input {...register('title')} placeholder="Festive unboxing in 30 seconds" />
          </Field>
          <Field label="Published" htmlFor="cnt-published" required error={errors.publishedDate?.message}>
            <Input type="date" max={today} {...register('publishedDate')} />
          </Field>

          <Field label="Post URL" htmlFor="cnt-url" error={errors.url?.message ?? urlMessage} className="lg:col-span-3">
            <Input {...register('url')} placeholder="https://…" />
          </Field>

          <Field label="Views" htmlFor="cnt-views" required error={errors.views?.message}>
            <Input type="number" min="0" step="1" {...register('views')} />
          </Field>
          <Field label="Likes" htmlFor="cnt-likes" required error={errors.likes?.message}>
            <Input type="number" min="0" step="1" {...register('likes')} />
          </Field>
          <Field label="Comments" htmlFor="cnt-comments" required error={errors.comments?.message}>
            <Input type="number" min="0" step="1" {...register('comments')} />
          </Field>
          <Field label="Shares" htmlFor="cnt-shares" required error={errors.shares?.message}>
            <Input type="number" min="0" step="1" {...register('shares')} />
          </Field>
          <Field label="Followers gained" htmlFor="cnt-gain" hint="Leave blank if the platform does not report it.">
            <Input type="number" min="0" step="1" {...register('followerGain')} />
          </Field>
          <Field label="Numbers read on" htmlFor="cnt-measured" required error={errors.metricsMeasuredAt?.message}>
            <Input type="date" max={today} {...register('metricsMeasuredAt')} />
          </Field>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 sm:col-span-2 lg:col-span-3">
            <p className="text-[12px] text-muted-foreground">
              Engagement rate{' '}
              <span className="font-semibold text-foreground tabular">
                {rate === null ? '—' : `${rate.toFixed(1)}%`}
              </span>{' '}
              — (likes + comments + shares) ÷ views.
            </p>
          </div>

          <Field label="Notes" htmlFor="cnt-notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea {...register('notes')} placeholder="What made this work, or why it underperformed." />
          </Field>

          <DialogFooter className="sm:col-span-2 lg:col-span-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Record post'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
