import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import request from 'supertest';
import { createApp } from '../src/app.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const at = hour => new Date(Date.UTC(2030, 0, 15, hour)).toISOString();

describe('frontend DOM integration with the real API', () => {
  let app;
  let dom;
  let doc;
  let clock;
  let originalTZ;
  let fetchHook;
  let fetchMock;

  beforeEach(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'UTC';
    clock = Date.parse(at(8));
    app = createApp(':memory:', { now: () => clock });
    fetchHook = null;
  });

  afterEach(() => {
    dom?.window.close();
    dom = undefined;
    app.locals.db.close();
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  async function bridge(path, options = {}) {
    let call = request(app)[(options.method || 'GET').toLowerCase()](path);
    if (options.body) call = call.send(JSON.parse(options.body));
    const response = await call;
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
  }

  async function mount() {
    dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
    const NativeDate = dom.window.Date;
    dom.window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    dom.window.confirm = vi.fn(() => true);
    fetchMock = vi.fn((...args) => fetchHook ? fetchHook(...args) : bridge(...args));
    dom.window.fetch = fetchMock;
    doc = dom.window.document;
    dom.window.eval(script);
    await vi.waitFor(() => expect(doc.getElementById('refresh-button').disabled).toBe(false));
  }

  const $ = id => doc.getElementById(id);
  function fill(input, value, event = 'input') {
    const element = typeof input === 'string' ? $(input) : input;
    if (element.matches('input[data-time-field]')) {
      const [day, enteredTime = '00:00:00'] = value.split('T');
      const time = enteredTime.length === 5 ? `${enteredTime}:00` : enteredTime;
      fill(`${element.id}-date`, day);
      const slots = $(`${element.id}-time`);
      const exact = $(`${element.id}-exact`);
      if (!slots.disabled && [...slots.options].some(option => option.value === time)) {
        fill(slots, time, 'change');
      } else {
        if (exact.disabled) element.closest('.date-time').querySelector('[data-action="edit-time"]').click();
        fill(exact, time);
      }
      return;
    }
    if (element.matches('input[data-exact-time]')) {
      const [hour, ...rest] = value.split(':');
      const period = $(`${element.id.replace(/-exact$/, '')}-period`);
      period.value = Number(hour) >= 12 ? 'PM' : 'AM';
      period.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      value = `${String(Number(hour) % 12 || 12).padStart(2, '0')}:${rest.join(':')}`;
    }
    element.value = value;
    element.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  }
  const select = (id, value) => fill(id, String(value), 'change');
  const chooseGap = (id, index = 0) => select(`gap-${id}`, index);
  const form = (kind, id) => doc.querySelector(`form[data-kind="${kind}"][data-absence-id="${id}"]`);
  const submit = element => element.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const idle = () => vi.waitFor(() => expect($('refresh-button').disabled).toBe(false));
  const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
  const payload = () => JSON.parse(posts().at(-1)[1].body);
  const board = async () => (await request(app).get('/api/absences')).body;

  async function create(teacher = 1, start = at(9), end = at(16), reason) {
    const response = await request(app).post('/api/absences').send({ teacher_id: teacher, start_time: start, end_time: end, reason });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function assign(id, sub, start, end) {
    const res = await request(app).post(`/api/absences/${id}/claim`).send({ substitute_id: sub, start_time: at(start), end_time: at(end) });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('loads seeded users, role selectors, timezone and empty board', async () => {
    await mount();
    expect($('users-tbody').children).toHaveLength(5);
    expect($('teacher-select').options).toHaveLength(4);
    expect($('substitute-select').options).toHaveLength(3);
    expect($('portal-controls').disabled).toBe(false);
    expect($('timezone-label').textContent).toContain('Timezone: UTC');
    expect($('absences-board-container').textContent).toContain('No absences yet');
    expect($('last-updated').textContent).toContain('Last successful update');
  });

  it('serves the HTML and deferred script through Express', async () => {
    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('src="/app.js" defer');
    expect(page.text).not.toContain('TODO');
    const javascript = await request(app).get('/app.js');
    expect(javascript.status).toBe(200);
    expect(javascript.text).toContain('function readWindow');
  });

  it('creates an absence with multiword reasons and preserves the selected teacher', async () => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start', '2030-01-15T09:00');
    fill('absence-end', '2030-01-15T16:00');
    fill('absence-reason', 'Medical appointment\nPersonal leave');
    submit($('absence-form'));
    await idle();
    expect(payload()).toEqual({ teacher_id: 1, start_time: at(9), end_time: at(16), reason: 'Medical appointment\nPersonal leave' });
    expect((await board())[0].reasons).toEqual(['Medical appointment\nPersonal leave']);
    expect($('notice').textContent).toContain('Created absence #1');
    expect($('teacher-select').value).toBe('1');
    expect($('absence-start').value).toBe('');
    expect($('absence-start-time').value).toBe('00:00:00');
    expect(doc.querySelector('.reason').textContent).toContain('Personal leave');
  });

  it('shows a merged result and distinct reasons when logging overlapping open windows', async () => {
    const absence = await create(1, at(9), at(12), 'First reason');
    await mount();
    select('teacher-select', 1);
    fill('absence-start', '2030-01-15T11:00');
    fill('absence-end', '2030-01-15T15:00');
    fill('absence-reason', 'Second reason');
    submit($('absence-form'));
    await idle();
    expect($('notice').textContent).toContain(`Merged absence #${absence.id}`);
    expect(doc.querySelectorAll('article.absence')).toHaveLength(1);
    expect((await board())[0].reasons).toEqual(['First reason', 'Second reason']);
  });

  it('claims split coverage, renders partial/full states, and reopens a cancelled portion', async () => {
    const absence = await create();
    await mount();
    select('substitute-select', 4);
    chooseGap(absence.id);
    fill(form('claim', absence.id).elements.end_time, '2030-01-15T12:00');
    submit(form('claim', absence.id));
    await idle();
    expect((await board())[0].status).toBe('Partially Covered');
    expect(doc.querySelector('article').textContent).toContain('David Kim (Sub)');
    select('substitute-select', 5);
    chooseGap(absence.id);
    submit(form('claim', absence.id));
    await idle();
    expect(payload()).toEqual({ substitute_id: 5, start_time: at(12), end_time: at(16) });
    expect((await board())[0].status).toBe('Claimed');
    expect(form('claim', absence.id)).toBeNull();
    const cancel = [...doc.querySelectorAll('[data-action="cancel"]')].find(button => !button.hidden);
    cancel.click();
    await idle();
    expect((await board())[0].status).toBe('Partially Covered');
    expect((await board())[0].uncovered_windows).toEqual([{ start_time: at(12), end_time: at(16) }]);
  });

  it('lists multiple gaps and permits a partial claim within a selected middle gap', async () => {
    const absence = await create(1, at(9), at(17));
    await assign(absence.id, 4, 9, 10);
    await assign(absence.id, 5, 11, 12);
    await assign(absence.id, 4, 14, 16);
    await mount();
    select('substitute-select', 5);
    select(`gap-${absence.id}`, 1);
    expect(form('claim', absence.id).elements.start_time.value).toContain('T12:00');
    fill(form('claim', absence.id).elements.start_time, '2030-01-15T12:30');
    fill(form('claim', absence.id).elements.end_time, '2030-01-15T13:00');
    submit(form('claim', absence.id));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T12:30:00.000Z');
    expect((await board())[0].uncovered_windows).toHaveLength(4);
  });

  it('preserves edited claim ranges when switching actors or refreshing an expanded absence', async () => {
    const absence = await create(1, at(9), at(12));
    await mount();
    chooseGap(absence.id);
    fill(form('claim', absence.id).elements.start_time, '2030-01-15T10:00');
    select('substitute-select', 4);
    select('substitute-select', 5);
    expect(form('claim', absence.id).elements.start_time.value).toContain('T10:00');
    await request(app).post('/api/absences').send({ teacher_id: 1, start_time: at(11), end_time: at(15) });
    $('refresh-button').click();
    await idle();
    expect(form('claim', absence.id).elements.start_time.value).toContain('T10:00');
    expect(form('claim', absence.id).elements.end_time.value).toContain('T12:00');
    submit(form('claim', absence.id));
    await idle();
    expect(payload()).toEqual({ substitute_id: 5, start_time: at(10), end_time: at(12) });
  });

  it('rejects reversed create times and claim ranges crossing already-covered time locally', async () => {
    const absence = await create();
    await assign(absence.id, 4, 10, 11);
    await mount();
    select('teacher-select', 2);
    fill('absence-start', '2030-01-15T16:00');
    fill('absence-end', '2030-01-15T09:00');
    submit($('absence-form'));
    expect($('notice').textContent).toContain('End must be after start');
    select('substitute-select', 5);
    chooseGap(absence.id);
    fill(form('claim', absence.id).elements.end_time, '2030-01-15T12:00');
    submit(form('claim', absence.id));
    expect($('notice').textContent).toContain('one current uncovered window');
    expect(posts()).toHaveLength(0);
  });

  it('requires a substitute and only offers cancellation to the selected owner', async () => {
    const absence = await create();
    await assign(absence.id, 4, 9, 12);
    await mount();
    expect(form('claim', absence.id).querySelector('button[type="submit"]').disabled).toBe(true);
    select('substitute-select', 5);
    expect(doc.querySelector('[data-action="cancel"]').hidden).toBe(true);
    select('substitute-select', 4);
    expect(doc.querySelector('[data-action="cancel"]').hidden).toBe(false);
    dom.window.confirm.mockReturnValue(false);
    doc.querySelector('[data-action="cancel"]').click();
    expect(posts()).toHaveLength(0);
    expect((await board())[0].assignments).toHaveLength(1);
  });

  it('shortens an absence as its selected teacher and updates all affected assignments', async () => {
    const absence = await create();
    await assign(absence.id, 4, 9, 12);
    await assign(absence.id, 5, 12, 14);
    await assign(absence.id, 4, 14, 16);
    await mount();
    expect(form('return', absence.id).hidden).toBe(true);
    select('teacher-select', 1);
    expect(form('return', absence.id).hidden).toBe(false);
    fill(form('return', absence.id).elements.end_time, '2030-01-15T13:00');
    select('teacher-select', 2);
    expect(form('return', absence.id).hidden).toBe(true);
    select('teacher-select', 1);
    submit(form('return', absence.id));
    await idle();
    expect(payload()).toEqual({ teacher_id: 1, end_time: at(13) });
    expect((await board())[0].assignments.map(item => item.end_time)).toEqual([at(12), at(13)]);
  });

  it('returns now using the server cutoff even if the browser clock advances between calls', async () => {
    clock = Date.parse(at(12));
    const absence = await create();
    await assign(absence.id, 4, 9, 16);
    await mount();
    select('teacher-select', 1);
    let advancing = clock;
    dom.window.Date.now = () => advancing++;
    submit(form('return', absence.id));
    await idle();
    expect(payload()).toEqual({ teacher_id: 1 });
    expect((await board())[0].end_time).toBe(at(12));
  });

  it('shows ended absences without claim, cancellation, or early-return controls', async () => {
    const absence = await create(1, at(6), at(7));
    await mount();
    expect(doc.querySelector('article').textContent).toContain('Ended');
    expect(form('claim', absence.id)).toBeNull();
    expect(form('return', absence.id)).toBeNull();
    expect(doc.querySelector('[data-action="cancel"]')).toBeNull();
  });

  it('prevents duplicate submissions and refresh while a mutation is pending', async () => {
    const absence = await create();
    await mount();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    fetchHook = async (path, options) => {
      if (options.method === 'POST') await gate;
      return bridge(path, options);
    };
    select('substitute-select', 4);
    chooseGap(absence.id);
    const claim = form('claim', absence.id);
    submit(claim);
    submit(claim);
    expect($('portal-controls').disabled).toBe(true);
    expect($('refresh-button').disabled).toBe(true);
    expect(posts()).toHaveLength(1);
    release();
    await idle();
    expect((await board())[0].assignments).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it('refreshes a conflict response without automatically retrying the claim', async () => {
    const absence = await create();
    await mount();
    chooseGap(absence.id);
    await assign(absence.id, 5, 9, 16);
    select('substitute-select', 4);
    submit(form('claim', absence.id));
    await idle();
    expect($('notice').dataset.kind).toBe('error');
    expect($('notice').textContent).toContain('overlaps existing coverage');
    expect(form('claim', absence.id)).toBeNull();
    expect((await board())[0].assignments[0].substitute_id).toBe(5);
    expect(posts()).toHaveLength(1);
  });

  it('refreshes merged-away stale IDs after a 404', async () => {
    await create(1, at(9), at(10));
    const removed = await create(1, at(11), at(12));
    await mount();
    chooseGap(removed.id);
    await request(app).post('/api/absences').send({ teacher_id: 1, start_time: at(9), end_time: at(12) });
    select('substitute-select', 4);
    submit(form('claim', removed.id));
    await idle();
    expect($('notice').textContent).toContain('Absence not found');
    expect(form('claim', removed.id)).toBeNull();
    expect(doc.querySelectorAll('article.absence')).toHaveLength(1);
  });

  it('recovers a committed write with a lost response and does not resend it', async () => {
    const absence = await create();
    await mount();
    fetchHook = async (path, options) => {
      const response = await bridge(path, options);
      if (options.method === 'POST') throw new TypeError('Network response lost');
      return response;
    };
    select('substitute-select', 4);
    chooseGap(absence.id);
    submit(form('claim', absence.id));
    await idle();
    expect($('notice').textContent).toContain('may have succeeded');
    expect(form('claim', absence.id)).toBeNull();
    expect(posts()).toHaveLength(1);
    expect((await board())[0].assignments).toHaveLength(1);
  });

  it.each(['timeout', 'non-JSON response'])('recovers an ambiguous %s without automatically retrying', async failure => {
    const absence = await create();
    await mount();
    const nativeTimeout = dom.window.setTimeout.bind(dom.window);
    dom.window.setTimeout = (callback, delay) => nativeTimeout(callback, delay === 15_000 ? 10 : delay);
    fetchHook = (path, options) => {
      if (options.method !== 'POST') return bridge(path, options);
      if (failure === 'non-JSON response') {
        return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid proxy response'); } });
      }
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new dom.window.DOMException('Timed out', 'AbortError')), { once: true });
      });
    };
    select('substitute-select', 4);
    chooseGap(absence.id);
    submit(form('claim', absence.id));
    await idle();
    expect($('notice').textContent).toContain('may have succeeded');
    expect($('portal-controls').disabled).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it('disables mutations after a failed refresh and recovers through the refresh button', async () => {
    const absence = await create();
    await mount();
    fetchHook = (path, options) => {
      if (path === '/api/absences' && !options.method) throw new TypeError('Offline');
      return bridge(path, options);
    };
    select('substitute-select', 4);
    chooseGap(absence.id);
    submit(form('claim', absence.id));
    await idle();
    expect($('portal-controls').disabled).toBe(true);
    expect($('last-updated').textContent).toContain('stale');
    expect($('notice').textContent).toContain('Refresh failed');
    fetchHook = null;
    $('refresh-button').click();
    await idle();
    expect($('portal-controls').disabled).toBe(false);
    expect(form('claim', absence.id)).toBeNull();
  });

  it('recovers initial loading failure without enabling stale controls', async () => {
    fetchHook = () => { throw new TypeError('Offline'); };
    await mount();
    expect($('portal-controls').disabled).toBe(true);
    expect($('notice').textContent).toContain('Unable to refresh');
    fetchHook = null;
    $('refresh-button').click();
    await idle();
    expect($('portal-controls').disabled).toBe(false);
    expect($('users-tbody').children).toHaveLength(5);
  });

  it('renders names, reasons and credential metadata as text, never HTML', async () => {
    const text = '<img src=x onerror="alert(1)">';
    app.locals.db.prepare('UPDATE users SET name = ? WHERE id = 4').run(text);
    app.locals.db.prepare('INSERT INTO certifications (substitute_id, name, expires_at) VALUES (?, ?, ?)')
      .run(4, '<script>credential</script>', Date.parse(at(7)));
    const absence = await create(1, at(9), at(16), text);
    await assign(absence.id, 4, 9, 12);
    await mount();
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelectorAll('script')).toHaveLength(1); // only our static deferred script
    expect(doc.querySelector('.reason').textContent).toBe(text);
    expect($('users-tbody').textContent).toContain('<script>credential</script>');
    expect($('users-tbody').textContent).toContain('expired');
    expect(doc.querySelector('article').textContent).toContain(text);
  });

  it('converts browser-local times and clearly previews their UTC offset', async () => {
    process.env.TZ = 'America/New_York';
    await mount();
    select('teacher-select', 1);
    fill('absence-start', '2030-01-15T09:00');
    fill('absence-end', '2030-01-15T12:00');
    expect($('timezone-label').textContent).toContain('America/New_York');
    expect($('absence-preview').textContent).toContain('GMT-05:00');
    submit($('absence-form'));
    await idle();
    expect(payload().start_time).toBe(at(14));
    expect(payload().end_time).toBe(at(17));
  });

  it('rejects a nonexistent daylight-saving local time rather than silently shifting it', async () => {
    process.env.TZ = 'America/New_York';
    await mount();
    select('teacher-select', 1);
    fill('absence-start', '2030-03-10T02:30');
    fill('absence-end', '2030-03-10T04:00');
    submit($('absence-form'));
    expect($('notice').textContent).toContain('does not exist during a daylight-saving change');
    expect(posts()).toHaveLength(0);
  });

  it('preserves the exact later DST-fold instant in a prefilled gap across refresh and claim', async () => {
    process.env.TZ = 'America/New_York';
    clock = Date.parse('2026-11-01T04:00:00Z');
    const absence = await create(1, '2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z');
    await mount();
    select('substitute-select', 4);
    chooseGap(absence.id);
    expect(form('claim', absence.id).elements.start_time.value).toContain('T01:30');
    $('refresh-button').click();
    await idle();
    submit(form('claim', absence.id));
    await idle();
    expect(payload().start_time).toBe('2026-11-01T06:30:00.000Z');
    expect((await board())[0].status).toBe('Claimed');
  });

  it('starts with blank dates, midnight times, and 96 fifteen-minute choices rather than the current time', async () => {
    const absence = await create();
    await mount();
    for (const id of ['absence-start', 'absence-end', `claim-start-${absence.id}`, `return-end-${absence.id}`]) {
      expect($(`${id}-date`).value).toBe('');
      expect($(`${id}-time`).value).toBe('00:00:00');
      expect($(`${id}-time`).options).toHaveLength(96);
      expect($(`${id}-exact`).hidden).toBe(true);
    }
    expect($(`gap-${absence.id}`).value).toBe('');
    fill('absence-start-date', '2030-01-16');
    expect($('absence-start').value).toBe('2030-01-16T00:00:00');
    expect($('absence-start-time').value).toBe('00:00:00');
  });

  it('submits selected fifteen-minute slots without displaying milliseconds', async () => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start-date', '2030-01-15');
    fill('absence-end-date', '2030-01-15');
    select('absence-start-time', '09:15:00');
    select('absence-end-time', '09:45:00');
    submit($('absence-form'));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T09:15:00.000Z');
    expect(payload().end_time).toBe('2030-01-15T09:45:00.000Z');
    expect(doc.body.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d/);
    expect(doc.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0);
  });

  it('supports double-click and accessible button editing down to seconds', async () => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start-date', '2030-01-15');
    fill('absence-end-date', '2030-01-15');
    $('absence-start-time').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    expect($('absence-start-exact').hidden).toBe(false);
    expect($('absence-start-exact').pattern).toContain('1[0-2]');
    fill('absence-start-exact', '09:07:37');
    $('absence-end').closest('.date-time').querySelector('[data-action="edit-time"]').click();
    fill('absence-end-exact', '09:12:05');
    submit($('absence-form'));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T09:07:37.000Z');
    expect(payload().end_time).toBe('2030-01-15T09:12:05.000Z');
  });

  it('does not silently snap an exact time when switching back to slot choices', async () => {
    await mount();
    fill('absence-start', '2030-01-15T09:07:37');
    const edit = $('absence-start').closest('.date-time').querySelector('[data-action="edit-time"]');
    edit.click();
    expect($('absence-start-time').value).toBe('09:07:37');
    expect($('absence-start').value).toBe('2030-01-15T09:07:37');
    select('absence-start-time', '09:15:00');
    expect($('absence-start').value).toBe('2030-01-15T09:15:00');
  });

  it('allows an overnight interval ending at the midnight default', async () => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start-date', '2030-01-15');
    select('absence-start-time', '23:45:00');
    fill('absence-end-date', '2030-01-16');
    submit($('absence-form'));
    await idle();
    expect(payload().end_time).toBe('2030-01-16T00:00:00.000Z');
  });

  it('preserves exact-second drafts and editor mode across refresh', async () => {
    const absence = await create();
    await mount();
    chooseGap(absence.id);
    fill(form('claim', absence.id).elements.start_time, '2030-01-15T09:07:37');
    $('refresh-button').click();
    await idle();
    expect($(`claim-start-${absence.id}-exact`).hidden).toBe(false);
    expect($(`claim-start-${absence.id}-exact`).value).toBe('09:07:37');
    select('substitute-select', 4);
    submit(form('claim', absence.id));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T09:07:37.000Z');
  });

  it('preserves unchanged API gap precision without exposing millisecond controls', async () => {
    const absence = await create(1, '2030-01-15T09:00:00.123Z', '2030-01-15T10:00:00.456Z');
    await mount();
    chooseGap(absence.id);
    expect($(`claim-start-${absence.id}-time`).value).toBe('09:00:00');
    expect(doc.body.textContent).not.toContain('09:00:00.123');
    select('substitute-select', 4);
    submit(form('claim', absence.id));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T09:00:00.123Z');
    expect(payload().end_time).toBe('2030-01-15T10:00:00.456Z');
  });

  it('rejects fractional seconds in the exact-time editor instead of submitting hidden precision', async () => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start', '2030-01-15T09:07:37.125');
    fill('absence-end', '2030-01-15T10:00');
    expect($('absence-start-exact').validity.patternMismatch).toBe(true);
    submit($('absence-form'));
    expect(posts()).toHaveLength(0);
  });

  it('requires a date for an edited early-return time instead of accidentally returning now', async () => {
    const absence = await create();
    await mount();
    select('teacher-select', 1);
    select(`return-end-${absence.id}-time`, '13:00:00');
    submit(form('return', absence.id));
    expect($(`return-end-${absence.id}-date`).required).toBe(true);
    expect(posts()).toHaveLength(0);
    expect($('notice').textContent).toContain('Complete the return time');
  });

  it('preserves incomplete date/time drafts rather than resetting them to midnight or return-now on refresh', async () => {
    const absence = await create();
    await mount();
    select('teacher-select', 1);
    select(`return-end-${absence.id}-time`, '13:15:00');
    $(`claim-start-${absence.id}`).closest('.date-time').querySelector('[data-action="edit-time"]').click();
    fill(`claim-start-${absence.id}-exact`, '09:07:37');
    $('refresh-button').click();
    await idle();
    expect($(`return-end-${absence.id}-date`).value).toBe('');
    expect($(`return-end-${absence.id}-time`).value).toBe('13:15:00');
    expect($(`return-end-${absence.id}-date`).required).toBe(true);
    expect($(`claim-start-${absence.id}-exact`).value).toBe('09:07:37');
    expect($(`claim-start-${absence.id}-exact`).hidden).toBe(false);
    submit(form('return', absence.id));
    expect(posts()).toHaveLength(0);
  });

  it('labels every time choice and displayed range with a twelve-hour clock and AM/PM', async () => {
    await create(1, at(13), at(16));
    await mount();
    const slots = $('absence-start-time');
    expect(slots.options[0].text).toBe('12:00 AM');
    expect(slots.options[48].text).toBe('12:00 PM');
    expect(slots.options[53].text).toBe('1:15 PM');
    expect(slots.options[95].text).toBe('11:45 PM');
    expect(doc.querySelector('article').textContent).toMatch(/01:00:00\s*PM/);
    expect(slots.value).toBe('00:00:00'); // canonical values are internal only
  });

  it.each([
    ['12:00:00', 'AM', '00:00:00'], ['12:00:00', 'PM', '12:00:00'],
    ['01:07:37', 'AM', '01:07:37'], ['01:07:37', 'PM', '13:07:37'],
    ['11:59:59', 'PM', '23:59:59']
  ])('converts an explicit %s %s selection correctly', async (time, period, expected) => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start-date', '2030-01-15');
    $('absence-start').closest('.date-time').querySelector('[data-action="edit-time"]').click();
    $('absence-start-exact').value = time;
    $('absence-start-exact').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    select('absence-start-period', period);
    fill('absence-end-date', '2030-01-16');
    submit($('absence-form'));
    await idle();
    expect(payload().start_time).toBe(`2030-01-15T${expected}.000Z`);
  });

  it.each(['00:15:00', '13:15:00', '12:60:00', '12:00:60', '1:07'])('rejects invalid twelve-hour text (%s)', async text => {
    await mount();
    select('teacher-select', 1);
    fill('absence-start-date', '2030-01-15');
    $('absence-start').closest('.date-time').querySelector('[data-action="edit-time"]').click();
    $('absence-start-exact').value = text;
    $('absence-start-exact').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    fill('absence-end', '2030-01-16T00:00');
    expect($('absence-start-exact').validity.patternMismatch).toBe(true);
    submit($('absence-form'));
    expect(posts()).toHaveLength(0);
  });

  it('preserves a PM exact-time draft across refresh and converts it on claim', async () => {
    const absence = await create();
    await mount();
    chooseGap(absence.id);
    fill(form('claim', absence.id).elements.start_time, '2030-01-15T13:07:37');
    $('refresh-button').click();
    await idle();
    expect($(`claim-start-${absence.id}-exact`).value).toBe('01:07:37');
    expect($(`claim-start-${absence.id}-period`).value).toBe('PM');
    select('substitute-select', 4);
    submit(form('claim', absence.id));
    await idle();
    expect(payload().start_time).toBe('2030-01-15T13:07:37.000Z');
  });

  it('preserves incomplete twelve-hour text and PM on refresh without rounding or returning now', async () => {
    const absence = await create();
    await mount();
    select('teacher-select', 1);
    const id = `return-end-${absence.id}`;
    $(id).closest('.date-time').querySelector('[data-action="edit-time"]').click();
    $(`${id}-exact`).value = '1:';
    $(`${id}-exact`).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    select(`${id}-period`, 'PM');
    // Switching editors must not coerce invalid/incomplete text to midnight.
    $(id).closest('.date-time').querySelector('[data-action="edit-time"]').click();
    expect($(`${id}-exact`).hidden).toBe(false);
    $('refresh-button').click();
    await idle();
    expect($(`${id}-exact`).value).toBe('1:');
    expect($(`${id}-period`).value).toBe('PM');
    submit(form('return', absence.id));
    expect(posts()).toHaveLength(0);
  });
});
