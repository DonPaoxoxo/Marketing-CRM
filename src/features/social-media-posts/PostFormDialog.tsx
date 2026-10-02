import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCreate, useUpdate } from '@/hooks/useData';
import { SOCIAL_POST_PLATFORM, SOCIAL_POST_PURPOSE, type SocialMediaPost, type TeamMember } from '@/lib/types';
import { toISODate } from '@/lib/utils';

const schema = z
  .object({
    marketingMemberId: z.string().min(1, 'Select who posted this.'),
    purpose: z.enum(SOCIAL_POST_PURPOSE),
    customPurpose: z.string(),
    platform: z.enum(SOCIAL_POST_PLATFORM),
    customPlatform: z.string(),
    postDate: z.string().min(1, 'Pick a date.'),
    postLink: z.string().min(1, 'A post link is required.').url('Enter a valid URL.'),
    notes: z.string(),
  })
  .refine((v) => v.purpose !== 'Others' || v.customPurpose.trim().length > 0, { message: 'Write the custom purpose.', path: ['customPurpose'] })
  .refine((v) => v.platform !== 'Others' || v.customPlatform.trim().length > 0, { message: 'Write the custom platform.', path: ['customPlatform'] });

type Values = z.infer<typeof schema>;

export function PostFormDialog({
  open, onOpenChange, post, members,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; post?: SocialMediaPost;
  /** The marketing team to choose from — active members who may edit resources. */
  members: Pick<TeamMember, 'id' | 'name'>[];
}) {
  const create = useCreate<SocialMediaPost>('social-media-posts', 'Post');
  const update = useUpdate<SocialMediaPost>('social-media-posts', 'Post');
  const editing = Boolean(post);
  const today = toISODate(new Date());

  const defaults: Values = React.useMemo(() => ({
    marketingMemberId: post?.marketingMemberId ?? members[0]?.id ?? '',
    purpose: post?.purpose ?? 'Daily Posting',
    customPurpose: post?.customPurpose ?? '',
    platform: post?.platform ?? 'Facebook',
    customPlatform: post?.customPlatform ?? '',
    postDate: post?.postDate ?? today,
    postLink: post?.postLink ?? '',
    notes: post?.notes ?? '',
  }), [post, members, today]);

  const { register, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const purpose = watch('purpose');
  const platform = watch('platform');

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      ...values,
      customPurpose: values.purpose === 'Others' ? values.customPurpose.trim() : '',
      customPlatform: values.platform === 'Others' ? values.customPlatform.trim() : '',
      reason: editing ? 'Post edited' : 'Post logged',
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
          <DialogTitle>{editing ? `Edit ${post!.id}` : 'Add a social media post'}</DialogTitle>
          <DialogDescription>Record what went out, where and why — not its engagement figures.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Marketing Name" htmlFor="smp-member" required error={errors.marketingMemberId?.message}>
            <NativeSelect {...register('marketingMemberId')}>
              {members.length === 0 && <option value="">— No marketing team members configured —</option>}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Date" htmlFor="smp-date" required error={errors.postDate?.message}>
            <Input type="date" max={today} {...register('postDate')} />
          </Field>

          <Field label="Purpose" htmlFor="smp-purpose" required error={errors.purpose?.message}>
            <NativeSelect {...register('purpose')}>
              {SOCIAL_POST_PURPOSE.map((p) => <option key={p} value={p}>{p}</option>)}
            </NativeSelect>
          </Field>
          {purpose === 'Others' ? (
            <Field label="Custom Purpose" htmlFor="smp-custom-purpose" required error={errors.customPurpose?.message}>
              <Input {...register('customPurpose')} placeholder="e.g. Product launch" autoFocus />
            </Field>
          ) : <div className="hidden sm:block" aria-hidden="true" />}

          <Field label="Social Media Platform" htmlFor="smp-platform" required error={errors.platform?.message}>
            <NativeSelect {...register('platform')}>
              {SOCIAL_POST_PLATFORM.map((p) => <option key={p} value={p}>{p}</option>)}
            </NativeSelect>
          </Field>
          {platform === 'Others' ? (
            <Field label="Custom Platform" htmlFor="smp-custom-platform" required error={errors.customPlatform?.message}>
              <Input {...register('customPlatform')} placeholder="e.g. Snapchat" autoFocus />
            </Field>
          ) : <div className="hidden sm:block" aria-hidden="true" />}

          <Field label="Post Link" htmlFor="smp-link" required error={errors.postLink?.message} className="sm:col-span-2">
            <Input {...register('postLink')} placeholder="https://…" />
          </Field>

          <Field label="Notes" htmlFor="smp-notes" className="sm:col-span-2" hint="Campaign, event name, promotion, content category — whatever is useful later.">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || members.length === 0}>
              {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add post'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
