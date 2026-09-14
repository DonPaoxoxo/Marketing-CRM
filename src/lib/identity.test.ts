import { describe, expect, it } from 'vitest';
import { firstRepeat, pageUrlKey, phoneKey, postUrlKey, urlKey } from './identity';

describe('pageUrlKey — the same page, written differently', () => {
  const same = [
    'https://www.facebook.com/xBrightgamers',
    'https://www.facebook.com/xBrightgamers',
    'http://facebook.com/xbrightgamers/',
    'facebook.com/xBrightgamers',
    'https://m.facebook.com/xBrightgamers?mibextid=ZbWKwL',
    'https://web.facebook.com/xBrightgamers/?fbclid=IwAR0abc&utm_source=whatsapp',
    'https://www.facebook.com/xBrightgamers#posts',
    '  https://WWW.FACEBOOK.COM/xBrightgamers  ',
  ];

  it.each(same)('%s is the same page', (url) => {
    expect(pageUrlKey(url)).toBe('facebook.com/xbrightgamers');
  });

  it('keeps the query parameter that says whose profile it is', () => {
    expect(pageUrlKey('https://www.facebook.com/profile.php?id=100012345')).not.toBe(
      pageUrlKey('https://www.facebook.com/profile.php?id=100099999'),
    );
    expect(pageUrlKey('https://facebook.com/profile.php?id=1&fbclid=x')).toBe(pageUrlKey('facebook.com/profile.php?id=1'));
  });

  it('keeps different pages different', () => {
    expect(pageUrlKey('https://www.facebook.com/xBrightgamers')).not.toBe(pageUrlKey('https://www.facebook.com/BrightGames'));
    expect(pageUrlKey('https://www.facebook.com/abc')).not.toBe(pageUrlKey('https://www.instagram.com/abc'));
  });

  it('treats blanks and non-addresses as nothing to compare', () => {
    for (const v of ['', '   ', null, undefined, 'not a url', 'javascript:alert(1)', 'mailto:a@b.co', 'tel:+639170000001']) {
      expect(urlKey(v)).toBe('');
    }
  });

  it('refuses a URL disguising its real site behind a username', () => {
    expect(urlKey('https://facebook.com@evil.example/xBrightgamers')).toBe('');
  });

  it('still reads a bare host with a port', () => {
    expect(urlKey('example.com:8080/page')).toBe('example.com/page');
  });
});

describe('postUrlKey — individual videos', () => {
  it('matches one short across YouTube’s three URL shapes', () => {
    const key = postUrlKey('https://www.youtube.com/watch?v=AbC123xyz');
    expect(postUrlKey('https://youtu.be/AbC123xyz?si=tracking')).toBe(key);
    expect(postUrlKey('https://youtube.com/shorts/AbC123xyz')).toBe(key);
    expect(postUrlKey('https://m.youtube.com/shorts/AbC123xyz/?feature=share')).toBe(key);
  });

  it('keeps case in video IDs, where it changes which video it is', () => {
    expect(postUrlKey('https://www.tiktok.com/@page/video/AbC')).not.toBe(postUrlKey('https://www.tiktok.com/@page/video/abc'));
    expect(postUrlKey('https://youtu.be/AbC')).not.toBe(postUrlKey('https://youtu.be/abc'));
  });
});

describe('phoneKey', () => {
  it('matches a number however it was typed', () => {
    const key = phoneKey('+63 917 000 0001');
    expect(phoneKey('+639170000001')).toBe(key);
    expect(phoneKey('0063-917-000-0001')).toBe(key);
    expect(phoneKey('(+63) 917.000.0001')).toBe(key);
  });

  it('treats blanks and fragments as nothing to compare', () => {
    expect(phoneKey('')).toBe('');
    expect(phoneKey('+')).toBe('');
    expect(phoneKey('123')).toBe('');
  });
});

describe('firstRepeat', () => {
  it('finds a URL listed twice in one field, however it was written', () => {
    expect(firstRepeat(['https://t.me/a', 'https://youtube.com/@b', 'http://www.t.me/a/'], pageUrlKey)).toBe('http://www.t.me/a/');
    expect(firstRepeat(['https://t.me/a', '', ''], pageUrlKey)).toBeNull();
  });
});

describe('telegramUrl', () => {
  it('turns a username, however it was written, into its t.me link', async () => {
    const { telegramUrl } = await import('./identity');
    expect(telegramUrl('cedarhillwanderer')).toBe('https://t.me/cedarhillwanderer');
    expect(telegramUrl('@CedarhillWanderer')).toBe('https://t.me/cedarhillwanderer');
    expect(telegramUrl('https://t.me/cedarhillwanderer')).toBe('https://t.me/cedarhillwanderer');
    expect(telegramUrl('')).toBe('');
  });
});
