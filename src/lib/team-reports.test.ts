import { describe, expect, it } from 'vitest';
import {
  checkPeriod, checkReportContent, classifyReportFile, mayDeleteReport, mayEditReport, mayFileReports, mayReply,
  mayViewReport, periodEndOf, periodLabel, periodStartOf, reportLabel, safeFileName,
} from './team-reports';

const gordon = { id: 'TM-0005', role: 'Marketing Staff' as const };
const bea = { id: 'TM-0006', role: 'Marketing Staff' as const };
const manager = { id: 'TM-0002', role: 'Marketing Manager' as const };
const owner = { id: 'TM-0001', role: 'System Administrator' as const };
const reviewer = { id: 'TM-0009', role: 'Read-only Reviewer' as const };

describe('periods', () => {
  it('starts a week on Monday and a month on the 1st', () => {
    expect(periodStartOf('daily', '2026-09-13')).toBe('2026-09-13');
    expect(periodStartOf('weekly', '2026-09-13')).toBe('2026-09-07'); // a Sunday belongs to the week from Monday the 7th
    expect(periodStartOf('weekly', '2026-09-07')).toBe('2026-09-07');
    expect(periodStartOf('monthly', '2026-09-13')).toBe('2026-09-01');
    expect(periodStartOf('daily', '2026-02-30')).toBeNull();
    expect(periodEndOf('monthly', '2026-02-01')).toBe('2026-02-28');
  });

  it('labels periods the way people say them', () => {
    expect(periodLabel('daily', '2026-09-13')).toBe('Sep 13, 2026');
    expect(periodLabel('weekly', '2026-09-07')).toBe('Sep 7 – 13, 2026');
    expect(periodLabel('weekly', '2026-09-28')).toBe('Sep 28 – Oct 4, 2026');
    expect(periodLabel('monthly', '2026-09-01')).toBe('September 2026');
  });

  it('refuses a period that has not started', () => {
    expect(checkPeriod('weekly', '2026-09-13', '2026-09-13')).toEqual({ period: 'weekly', start: '2026-09-07' });
    expect(checkPeriod('daily', '2026-09-14', '2026-09-13')).toHaveProperty('error');
    expect(checkPeriod('yearly', '2026-09-13', '2026-09-13')).toHaveProperty('error');
  });
});

describe('who may do what', () => {
  const report = { authorId: gordon.id, status: 'Submitted' as const };
  it('shows a report to its author and the owner only — managers see their own', () => {
    expect(mayViewReport(gordon, report)).toBe(true);
    expect(mayViewReport(owner, report)).toBe(true);
    expect(mayViewReport(bea, report)).toBe(false);
    expect(mayViewReport(manager, report)).toBe(false);
    expect(mayReply(owner, report)).toBe(true);
    expect(mayReply(manager, report)).toBe(false);
  });

  it('lets the author edit until reviewed, and only the owner delete', () => {
    expect(mayEditReport(gordon, report)).toBe(true);
    expect(mayEditReport(gordon, { ...report, status: 'Needs changes' })).toBe(true);
    expect(mayEditReport(gordon, { ...report, status: 'Reviewed' })).toBe(false);
    expect(mayEditReport(owner, report)).toBe(false);
    expect(mayDeleteReport(owner)).toBe(true);
    expect(mayDeleteReport(manager)).toBe(false);
    expect(mayFileReports(reviewer)).toBe(false);
  });
});

describe('content', () => {
  it('requires what was done and keeps the rest optional', () => {
    expect(checkReportContent({ workDone: ' Posted 3 reels ', recommendation: 'Boost the Sunday post' })).toEqual({
      value: { workDone: 'Posted 3 reels', recommendation: 'Boost the Sunday post' },
    });
    expect(checkReportContent({ results: 'x' })).toEqual({ field: 'workDone', error: expect.any(String) });
    expect(checkReportContent({ blockers: 'x'.repeat(5001) })).toHaveProperty('field', 'blockers');
  });
});

describe('files', () => {
  const png = (size: number) => { const b = new Uint8Array(size); b.set([0x89, 0x50, 0x4e, 0x47]); return b; };
  const zip = (size: number) => { const b = new Uint8Array(size); b.set([0x50, 0x4b, 0x03, 0x04]); return b; };

  it('takes images only under 1 MB', () => {
    expect(classifyReportFile('screenshot.png', png(1024 * 1024 - 1))).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(classifyReportFile('screenshot.png', png(1024 * 1024))).toEqual({ error: expect.stringContaining('under 1 MB') });
    // A renamed image is still an image, and still held to 1 MB.
    expect(classifyReportFile('report.pdf', png(2 * 1024 * 1024))).toEqual({ error: expect.stringContaining('under 1 MB') });
  });

  it('takes documents up to 5 MB, identified by their bytes', () => {
    expect(classifyReportFile('September.xlsx', zip(4 * 1024 * 1024))).toMatchObject({ kind: 'document' });
    expect(classifyReportFile('Summary.pdf', new TextEncoder().encode('%PDF-1.7 …'))).toMatchObject({ mimeType: 'application/pdf' });
    expect(classifyReportFile('notes.csv', new TextEncoder().encode('a,b\n1,2'))).toMatchObject({ mimeType: 'text/csv' });
    expect(classifyReportFile('big.docx', zip(5 * 1024 * 1024 + 1))).toEqual({ error: expect.stringContaining('up to 5 MB') });
    expect(classifyReportFile('fake.docx', new TextEncoder().encode('MZ executable'))).toEqual({ error: expect.stringContaining('not really') });
    expect(classifyReportFile('macro.xlsm', zip(100))).toEqual({ error: expect.stringContaining('only images') });
    expect(classifyReportFile('tool.exe', new Uint8Array([0x4d, 0x5a]))).toHaveProperty('error');
  });

  it('keeps file names safe to store and send back', () => {
    const name = safeFileName('..\\..//evil"name<>.pdf');
    expect(name).not.toMatch(/[\\/"<>]/);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(safeFileName('')).toBe('file');
  });

  it('names a deleted report without its content', () => {
    expect(reportLabel({ authorName: 'Gordon', period: 'daily', periodStart: '2026-09-13' })).toBe("Gordon's daily report for Sep 13, 2026");
  });
});
