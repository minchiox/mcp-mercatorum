import { describe, expect, it } from 'vitest';
import { HostNotAllowedError } from '../src/core/errors.js';
import { assertHostAllowed, classifyRequest, isHostAllowed } from '../src/core/guard.js';

const API = 'https://lms-api.prod.mercatorum.multiversity.click';

describe('classifyRequest — the read-only guarantee', () => {
  it.each(['GET', 'POST', 'PUT'])('blocks attendance tracking with %s', (method) => {
    const v = classifyRequest(method, `${API}/student/course/0662509IUS17/lesson/view/inizialize`);
    expect(v.allow).toBe(false);
  });

  it('blocks tracking endpoints on any host', () => {
    expect(classifyRequest('POST', 'https://other.multiversity.click/x/lesson/view').allow).toBe(false);
  });

  it('blocks other writes to the student API', () => {
    expect(classifyRequest('POST', `${API}/student/course/X/video-lesson/1/progress`).allow).toBe(false);
    expect(classifyRequest('DELETE', `${API}/student/anything`).allow).toBe(false);
  });

  it('allows reads', () => {
    expect(classifyRequest('GET', `${API}/student/course/X/video-lessons/0`).allow).toBe(true);
    expect(classifyRequest('OPTIONS', `${API}/student/info`).allow).toBe(true);
  });

  it('allows session maintenance and read-only POSTs the web app needs', () => {
    expect(classifyRequest('POST', `${API}/auth/refresh`).allow).toBe(true);
    expect(classifyRequest('POST', `${API}/student/video-lessons/getNotes`).allow).toBe(true);
  });

  it('does not interfere with other hosts or non-network URLs', () => {
    expect(classifyRequest('POST', 'https://lms.mercatorum.multiversity.click/form').allow).toBe(true);
    expect(classifyRequest('GET', 'data:text/plain,hi').allow).toBe(true);
  });

  it('is not fooled by look-alike paths', () => {
    expect(classifyRequest('GET', `${API}/student/lesson/viewer-config`).allow).toBe(true);
    expect(classifyRequest('GET', `${API}/student/LESSON/VIEW/x`).allow).toBe(false);
  });
});

describe('host allowlist', () => {
  it('accepts platform hosts over https', () => {
    expect(isHostAllowed('https://lms.mercatorum.multiversity.click/')).toBe(true);
    expect(isHostAllowed('https://d9t931z8aeptt.cloudfront.net/a.pdf')).toBe(true);
    expect(isHostAllowed('https://www.unimercatorum.it/')).toBe(true);
  });
  it('rejects other hosts, look-alikes and plain http', () => {
    expect(isHostAllowed('https://evil.com/')).toBe(false);
    expect(isHostAllowed('https://multiversity.click.evil.com/')).toBe(false);
    expect(isHostAllowed('https://evilmultiversity.click/')).toBe(false);
    expect(isHostAllowed('http://lms.mercatorum.multiversity.click/')).toBe(false);
    expect(isHostAllowed('https://other.cloudfront.net/')).toBe(false);
    expect(isHostAllowed('not a url')).toBe(false);
  });
  it('supports extra hosts', () => {
    expect(isHostAllowed('https://sso.example.org/', ['example.org'])).toBe(true);
    expect(() => assertHostAllowed('https://evil.com/')).toThrow(HostNotAllowedError);
  });
});
