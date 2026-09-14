import { describe, expect, it } from 'vitest';
import { agentLockReason, bootstrapFor, mayEditAgent } from './access';
import { checkRecoveryDetail } from './recovery';
import { PROOF_MAX_BYTES, checkProofImage, checkProofPostUrl, decodeBase64Image, sniffImageType } from './proofs';
import type { Bootstrap } from './types';

const gordon = { id: 'TM-0005', role: 'Marketing Staff' as const };
const bea = { id: 'TM-0006', role: 'Marketing Staff' as const };
const admin = { id: 'TM-0001', role: 'System Administrator' as const };
const reviewer = { id: 'TM-0009', role: 'Read-only Reviewer' as const };

describe('agent edit lock', () => {
  it('lets only the assigned manager and the System Administrator edit', () => {
    const agent = { managerId: gordon.id };
    expect(mayEditAgent(gordon, agent)).toBe(true);
    expect(mayEditAgent(admin, agent)).toBe(true);
    expect(mayEditAgent(bea, agent)).toBe(false);
    expect(agentLockReason(bea, agent, 'Gordon')).toBe('Only Gordon (the assigned manager) or the System Administrator can edit this agent.');
  });

  it('keeps unassigned agents to the System Administrator, and a reviewer out even as manager', () => {
    expect(mayEditAgent(gordon, { managerId: null })).toBe(false);
    expect(mayEditAgent(admin, { managerId: null })).toBe(true);
    expect(mayEditAgent(reviewer, { managerId: reviewer.id })).toBe(false);
  });
});

describe('admin-only areas in the workspace payload', () => {
  const data = {
    domains: [{ id: 'DOM-1' }],
    auditEntries: [{ recordType: 'Domain' }, { recordType: 'Import' }, { recordType: 'User' }, { recordType: 'Agent' }],
  } as unknown as Bootstrap;

  it('leaves domains and their history out for everyone but the System Administrator', () => {
    const staff = bootstrapFor(data, { role: 'Marketing Manager' });
    expect(staff.domains).toEqual([]);
    expect(staff.auditEntries.map((a) => a.recordType)).toEqual(['Agent']);
    expect(bootstrapFor(data, { role: 'System Administrator' })).toBe(data);
    // A manager given the Domains page sees domains and their history, but still not Import or User history.
    const granted = bootstrapFor(data, { role: 'Marketing Manager', permissions: ['access:domains'] });
    expect(granted.domains).toHaveLength(1);
    expect(granted.auditEntries.map((a) => a.recordType)).toEqual(['Domain', 'Agent']);
  });
});

describe('recovery detail', () => {
  it('takes the recovery email, phone, app or key, normalised', () => {
    expect(checkRecoveryDetail('Recovery Email', ' Recovery.Inbox@Example.com ')).toEqual({ value: 'recovery.inbox@example.com' });
    expect(checkRecoveryDetail('Recovery Email', 'not-an-email')).toHaveProperty('error');
    expect(checkRecoveryDetail('Recovery Phone', '+63 917 555 0420')).toEqual({ value: '+639175550420' });
    expect(checkRecoveryDetail('Authenticator App', "Google Authenticator on Ana's phone")).toEqual({ value: "Google Authenticator on Ana's phone" });
    expect(checkRecoveryDetail('Security Key', 'YubiKey 5C serial 18273645')).toEqual({ value: 'YubiKey 5C serial 18273645' });
    expect(checkRecoveryDetail('None', 'anything')).toEqual({ value: '' });
  });

  it('never stores backup codes or authenticator setup keys', () => {
    expect(checkRecoveryDetail('Backup Codes', '8391 2274 5520 1187')).toHaveProperty('error');
    expect(checkRecoveryDetail('Backup Codes', 'k3x9-p2m7, 4hd8-2kq9')).toHaveProperty('error');
    expect(checkRecoveryDetail('Authenticator App', 'JBSWY3DPEHPK3PXP2345')).toHaveProperty('error');
    expect(checkRecoveryDetail('Backup Codes', 'vault://marketing/recovery/acc-0231')).toEqual({ value: 'vault://marketing/recovery/acc-0231' });
    expect(checkRecoveryDetail('Backup Codes', "Printed, in Ana's office safe")).toHaveProperty('value');
  });
});

describe('proof images', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('identifies images by their bytes, not their name', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(checkProofImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toEqual({ error: expect.stringContaining('PNG, JPEG or WebP') });
  });

  it('refuses anything over 500 KB', () => {
    const big = new Uint8Array(PROOF_MAX_BYTES + 1);
    big.set(png);
    expect(checkProofImage(big)).toEqual({ error: expect.stringContaining('limit is 500 KB') });
    const exact = new Uint8Array(PROOF_MAX_BYTES);
    exact.set(png);
    expect(checkProofImage(exact)).toEqual({ mime: 'image/png' });
  });

  it('decodes base64 and data URLs, and reports an oversized one as too large', () => {
    expect(decodeBase64Image(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`)).toEqual(png);
    expect(decodeBase64Image('***')).toBeNull();
    const huge = decodeBase64Image('A'.repeat(900_000))!;
    expect(checkProofImage(huge)).toEqual({ error: expect.stringContaining('limit is 500 KB') });
  });

  it('requires a web Post URL', () => {
    expect(checkProofPostUrl('https://www.facebook.com/xBrightgamers/posts/1')).toMatchObject({ value: 'https://www.facebook.com/xBrightgamers/posts/1' });
    expect(checkProofPostUrl('javascript:alert(1)')).toHaveProperty('error');
    expect(checkProofPostUrl('')).toHaveProperty('error');
  });
});

describe('agent archiving access', () => {
  it('is open to every role that may archive, not only the assigned manager', async () => {
    const { mayArchiveAgent, isArchiveOnlyChange } = await import('./access');
    expect(mayArchiveAgent({ role: 'Marketing Staff' })).toBe(true);
    expect(mayArchiveAgent({ role: 'Marketing Manager' })).toBe(true);
    expect(mayArchiveAgent({ role: 'System Administrator' })).toBe(true);
    expect(mayArchiveAgent({ role: 'Read-only Reviewer' })).toBe(false);
    // A role whose archive permission was removed in Roles & Audit loses it.
    expect(mayArchiveAgent({ role: 'Marketing Staff', permissions: ['edit:resources'] })).toBe(false);
    expect(isArchiveOnlyChange({ archived: true, reason: 'x' })).toBe(true);
    expect(isArchiveOnlyChange({ archived: false })).toBe(true);
    expect(isArchiveOnlyChange({ archived: true, notes: 'x' })).toBe(false);
    expect(isArchiveOnlyChange({ archived: 'yes' })).toBe(false);
  });
});

describe('salary status rules', () => {
  it('labels, validates and belongs to the System Administrator', async () => {
    const { checkSalaryStatus, maySetSalaryStatus, salaryLabel } = await import('./salary');
    expect(maySetSalaryStatus('System Administrator')).toBe(true);
    expect(maySetSalaryStatus('Marketing Manager')).toBe(false);
    expect(maySetSalaryStatus('Marketing Staff')).toBe(false);
    expect(salaryLabel({ salaryStatus: null, salaryNote: '' })).toBe('Not set');
    expect(salaryLabel({ salaryStatus: 'Customize', salaryNote: 'Half now' })).toBe('Half now');
    expect(checkSalaryStatus({ status: 'Hold', note: 'x' })).toEqual({ status: 'Hold', note: '' });
    expect(checkSalaryStatus({ status: 'Customize', note: '  Half   now ' })).toEqual({ status: 'Customize', note: 'Half now' });
    expect(checkSalaryStatus({ status: 'Customize', note: 'a' })).toMatchObject({ field: 'note' });
    expect(checkSalaryStatus({ status: 'Bonus' })).toMatchObject({ field: 'status' });
    expect(checkSalaryStatus({ status: null })).toEqual({ status: null, note: '' });
  });
});
