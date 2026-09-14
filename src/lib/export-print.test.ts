// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportMatrix, type ExportColumn } from './csv';
import { printTableHtml } from './print';
import { currentNavItem, shortcutFor } from '@/components/layout/GlobalToolbar';

interface Row { name: string; phone: string; password: string; tags: string[]; formula: string }
const rows: Row[] = [{ name: 'Rohit <b>', phone: '+919876543210', password: 'hunter2', tags: ['a', 'b'], formula: '=HYPERLINK("x")' }];
const columns: ExportColumn<Row>[] = [
  { key: 'name', header: 'Name', value: (r) => r.name },
  { key: 'phone', header: 'Phone', value: (r) => r.phone, sensitive: true },
  { key: 'password', header: 'Password', value: (r) => r.password },
  { key: 'tags', header: 'Tags', value: (r) => r.tags },
  { key: 'formula', header: 'Note', value: (r) => r.formula },
];

describe('exportMatrix (Excel and PDF exports)', () => {
  it('drops secret columns, masks contact details and keeps values as plain text', () => {
    expect(exportMatrix(rows, columns)).toEqual({
      headers: ['Name', 'Phone', 'Tags', 'Note'],
      values: [['Rohit <b>', '[masked]', 'a; b', '=HYPERLINK("x")']],
    });
    expect(exportMatrix(rows, columns, { includeContactDetails: true }).values[0][1]).toBe('+919876543210');
  });
});

describe('PDF print document', () => {
  it('escapes every value so nothing in a record becomes markup', () => {
    const html = printTableHtml({ title: 'Agents <script>', headers: ['Name'], values: [['Rohit <b>']] });
    expect(html).toContain('<h1>Agents &lt;script&gt;</h1>');
    expect(html).toContain('<td>Rohit &lt;b&gt;</td>');
    expect(html).not.toContain('<script>');
  });
});

describe('global shortcuts', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: document.body, ...extra });

  it('maps Shift + letter and ? to actions, and ignores typing and browser shortcuts', () => {
    expect(shortcutFor(key('R', { shiftKey: true }))).toBe('refresh');
    expect(shortcutFor(key('e', { shiftKey: true }))).toBe('export');
    expect(shortcutFor(key('?', { shiftKey: true }))).toBe('shortcuts');
    expect(shortcutFor(key('r'))).toBeNull();
    expect(shortcutFor(key('P', { shiftKey: true, ctrlKey: true }))).toBeNull();
    const input = document.createElement('input');
    expect(shortcutFor(key('R', { shiftKey: true, target: input }))).toBeNull();
  });

  it('finds the page for nested routes', () => {
    expect(currentNavItem('/agents/AGT-0001')?.label).toBe('Agents');
    expect(currentNavItem('/')?.label).toBe('Dashboard');
    expect(currentNavItem('/shared-spiel')?.label).toBe('Shared Spiel Library');
    expect(currentNavItem('/nowhere')).toBeUndefined();
  });
});
