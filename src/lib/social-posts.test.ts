import { describe, expect, it } from 'vitest';
import {
  effectivePlatform, inWindow, resolveDateWindow, summarisePosts, type DateWindow,
} from './social-posts';
import type { SocialMediaPost } from './types';

const post = (over: Partial<SocialMediaPost> = {}): SocialMediaPost => ({
  id: 'SMP-0001', marketingMemberId: 'TM-01', purpose: 'Daily Posting', customPurpose: '',
  platform: 'Facebook', customPlatform: '', postDate: '2026-10-01', postLink: 'https://facebook.com/x',
  notes: '', status: 'active', archivedAt: null, archivedById: null, createdById: 'TM-01',
  createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
  ...over,
});

describe('resolveDateWindow', () => {
  const today = '2026-10-15';

  it('today is a one-day window on today', () => {
    expect(resolveDateWindow('today', today)).toEqual({ from: today, to: today });
  });

  it('yesterday is a one-day window the day before', () => {
    expect(resolveDateWindow('yesterday', today)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
  });

  it('custom uses the picked date, or today if none was picked yet', () => {
    expect(resolveDateWindow('custom', today, '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-01' });
    expect(resolveDateWindow('custom', today)).toEqual({ from: today, to: today });
  });

  it('range covers both ends, swapped if entered backwards', () => {
    expect(resolveDateWindow('range', today, undefined, '2026-10-01', '2026-10-07')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(resolveDateWindow('range', today, undefined, '2026-10-07', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });
});

describe('inWindow', () => {
  const w: DateWindow = { from: '2026-10-01', to: '2026-10-07' };
  it('includes both endpoints', () => {
    expect(inWindow('2026-10-01', w)).toBe(true);
    expect(inWindow('2026-10-07', w)).toBe(true);
  });
  it('excludes dates outside the window', () => {
    expect(inWindow('2026-09-30', w)).toBe(false);
    expect(inWindow('2026-10-08', w)).toBe(false);
  });
});

describe('effectivePlatform', () => {
  it('uses the preset platform directly', () => {
    expect(effectivePlatform(post({ platform: 'Facebook' }))).toBe('Facebook');
  });
  it('uses the custom text when "Others" was picked', () => {
    expect(effectivePlatform(post({ platform: 'Others', customPlatform: 'Snapchat' }))).toBe('Snapchat');
  });
  it('falls back to "Others" if the custom text is somehow blank', () => {
    expect(effectivePlatform(post({ platform: 'Others', customPlatform: '  ' }))).toBe('Others');
  });
});

describe('summarisePosts', () => {
  const members = [
    { id: 'TM-01', name: 'Tonyo' }, { id: 'TM-02', name: 'CJ' }, { id: 'TM-03', name: 'Renze' },
  ];

  it('counts totals, staff and platforms, and bucket purposes', () => {
    const posts = [
      post({ id: 'SMP-1', marketingMemberId: 'TM-01', platform: 'Facebook', purpose: 'Daily Posting' }),
      post({ id: 'SMP-2', marketingMemberId: 'TM-01', platform: 'Instagram', purpose: 'Event' }),
      post({ id: 'SMP-3', marketingMemberId: 'TM-02', platform: 'Facebook', purpose: 'Others', customPurpose: 'Promo' }),
    ];
    const s = summarisePosts(posts, members);
    expect(s.totalPosts).toBe(3);
    expect(s.activeMarketers).toBe(2); // Tonyo and CJ posted; Renze did not
    expect(s.platformsUsed).toBe(2); // Facebook, Instagram
    expect(s.eventPosts).toBe(1);
    expect(s.byPlatform.find((p) => p.label === 'Facebook')?.count).toBe(2);
    expect(s.byPlatform.find((p) => p.label === 'Instagram')?.count).toBe(1);
    expect(s.byMember).toEqual([
      { memberId: 'TM-01', label: 'Tonyo', count: 2 },
      { memberId: 'TM-02', label: 'CJ', count: 1 },
      { memberId: 'TM-03', label: 'Renze', count: 0 }, // every expected member appears, even at zero
    ]);
    expect(s.byPurpose).toEqual([
      { purpose: 'Daily Posting', count: 1 },
      { purpose: 'Event', count: 1 },
      { purpose: 'Others', count: 1 },
    ]);
  });

  it('shows every standard platform at zero when nothing was posted there', () => {
    const s = summarisePosts([post({ platform: 'Facebook' })], members);
    expect(s.byPlatform.find((p) => p.label === 'Pinterest')).toEqual({ label: 'Pinterest', count: 0 });
    expect(s.byPlatform.find((p) => p.label === 'WhatsApp')).toEqual({ label: 'WhatsApp', count: 0 });
  });

  it('lists custom platforms individually, alongside the standard ones', () => {
    const s = summarisePosts([post({ platform: 'Others', customPlatform: 'Snapchat' })], members);
    expect(s.byPlatform.find((p) => p.label === 'Snapchat')).toEqual({ label: 'Snapchat', count: 1 });
    expect(s.platformsUsed).toBe(1);
  });

  it('an empty set reads as every count at zero, not an error', () => {
    const s = summarisePosts([], members);
    expect(s.totalPosts).toBe(0);
    expect(s.activeMarketers).toBe(0);
    expect(s.platformsUsed).toBe(0);
    expect(s.eventPosts).toBe(0);
    expect(s.byMember.every((m) => m.count === 0)).toBe(true);
  });
});
