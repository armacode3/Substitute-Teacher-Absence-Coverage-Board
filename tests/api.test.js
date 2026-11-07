import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const at = (hour, minute = 0) => new Date(Date.UTC(2030, 0, 15, hour, minute)).toISOString();

describe('Sub Coverage API', () => {
  let app;
  let clock;

  const postAbsence = (teacher, start, end, reason) => request(app).post('/api/absences').send({
    teacher_id: teacher, start_time: at(start), end_time: at(end), reason
  });
  const create = async (teacher = 1, start = 9, end = 16, reason) => {
    const res = await postAbsence(teacher, start, end, reason);
    expect(res.status).toBe(201);
    return res.body;
  };
  const claim = (id, sub, start, end) => request(app).post(`/api/absences/${id}/claim`).send({
    substitute_id: sub, start_time: at(start), end_time: at(end)
  });
  const board = async () => (await request(app).get('/api/absences')).body;
  const rows = table => app.locals.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();

  beforeEach(() => {
    clock = Date.parse(at(8));
    app = createApp(':memory:', { now: () => clock });
  });

  afterEach(() => {
    app.locals.db.close();
    vi.restoreAllMocks();
  });

  it('returns the seeded teachers and substitutes', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5);
    expect(res.body.some(u => u.role === 'teacher')).toBe(true);
    expect(res.body.some(u => u.role === 'substitute')).toBe(true);
  });

  it('filters roles and returns informational certification metadata without enforcing it', async () => {
    const db = app.locals.db;
    db.prepare('INSERT INTO certifications (substitute_id, name, expires_at) VALUES (?, ?, ?)')
      .run(4, 'Synthetic test credential', Date.parse(at(7)));
    const res = await request(app).get('/api/users?role=substitute');
    expect(res.body.map(u => u.id)).toEqual([4, 5]);
    expect(res.body[0].certifications).toEqual([{
      id: 1, name: 'Synthetic test credential', expires_at: at(7), expired: true
    }]);
    expect(res.body[1].certifications).toEqual([]);
    const absence = await create();
    expect((await claim(absence.id, 4, 9, 16)).status).toBe(200);
    expect((await request(app).get('/api/users?role=admin')).status).toBe(400);
  });

  it('lists an empty board with cache prevention', async () => {
    const res = await request(app).get('/api/absences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('creates a named, open absence and stores integer UTC timestamps', async () => {
    const absence = await create(1, 9, 16, '  Medical appointment and personal leave  ');
    expect(absence).toMatchObject({
      teacher_id: 1, teacher_name: 'Alice Henderson (Math)', status: 'Open', claimable: true,
      reasons: ['Medical appointment and personal leave'], assignments: [],
      uncovered_windows: [{ start_time: at(9), end_time: at(16) }]
    });
    expect(rows('absences')[0].start_time).toBe(Date.parse(at(9)));
    expect(rows('absences')[0].end_time).toBe(Date.parse(at(16)));
  });

  it.each([undefined, null, '', '   '])('accepts an empty optional reason (%s)', async reason => {
    expect((await create(1, 9, 16, reason)).reasons).toEqual([]);
  });

  it('preserves markup-like, multiline and Unicode reason text as data', async () => {
    const text = '<script>alert("test")</script>\nPersonal leave — 先生';
    expect((await create(1, 9, 16, text)).reasons).toEqual([text]);
  });

  it.each([0, -1, 1.5, '1', null, 999, 4, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid or non-teacher actor (%s)', async teacher_id => {
      const res = await request(app).post('/api/absences').send({ teacher_id, start_time: at(9), end_time: at(16) });
      expect(res.status).toBe(400);
      expect(rows('absences')).toEqual([]);
    }
  );

  it.each([
    undefined, null, 123, '', '2030-01-15', '2030-01-15T09:00:00',
    '2030-02-29T09:00:00Z', '2030-04-31T09:00:00Z', '2030-00-15T09:00:00Z',
    '2030-13-15T09:00:00Z', '2030-01-00T09:00:00Z', '2030-01-15T24:00:00Z',
    '2030-01-15T09:60:00Z', '2030-01-15T09:00:60Z', '2030-01-15T09:00:00+24:00',
    '2030-01-15T09:00:00+01:60', '2030-01-15T09:00:00.123abcZ'
  ])('rejects invalid timestamps without rolling or truncating them into validity (%s)', async start_time => {
    const res = await request(app).post('/api/absences').send({ teacher_id: 1, start_time, end_time: at(16) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIME');
    expect(rows('absences')).toEqual([]);
  });

  it('accepts leap dates and overnight windows', async () => {
    const res = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: '2032-02-29T23:00:00Z', end_time: '2032-03-01T01:00:00Z'
    });
    expect(res.status).toBe(201);
    expect(res.body.start_time).toBe('2032-02-29T23:00:00.000Z');
  });

  it('normalizes offsets, truncates fractions, and compares conflicts at millisecond precision', async () => {
    const first = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: '2030-01-15T10:00:00.123456+01:00', end_time: '2030-01-15T11:00:00.9+01:00'
    });
    expect(first.status).toBe(201);
    expect(first.body.start_time).toBe('2030-01-15T09:00:00.123Z');
    expect(first.body.end_time).toBe('2030-01-15T10:00:00.900Z');
    const merged = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: '2030-01-15T09:00:00.123999Z', end_time: '2030-01-15T10:00:00.9009Z'
    });
    expect(merged.status).toBe(200);
    expect(merged.body.id).toBe(first.body.id);
    expect(merged.body.start_time).toBe(first.body.start_time);
    const assigned = await request(app).post(`/api/absences/${first.body.id}/claim`).send({
      substitute_id: 4, start_time: '2030-01-15T09:00:00.1238Z', end_time: '2030-01-15T10:00:00.9008Z'
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('Claimed');
  });

  it('round-trips offset-normalized expanded years and truncates pre-epoch fractions correctly', async () => {
    const ancient = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: '0000-01-01T00:00:00+01:00', end_time: '0000-01-01T01:00:00+01:00'
    });
    expect(ancient.status).toBe(201);
    expect(ancient.body.start_time).toBe('-000001-12-31T23:00:00.000Z');
    const retry = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: ancient.body.start_time, end_time: ancient.body.end_time
    });
    expect(retry.status).toBe(200);
    const beforeEpoch = await request(app).post('/api/absences').send({
      teacher_id: 2, start_time: '1969-12-31T23:59:59.999999Z', end_time: '1970-01-01T00:00:00Z'
    });
    expect(beforeEpoch.status).toBe(201);
    expect(rows('absences').find(row => row.teacher_id === 2).start_time).toBe(-1);
    const invalid = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: '+999999-01-01T00:00:00Z', end_time: '+999999-01-02T00:00:00Z'
    });
    expect(invalid.status).toBe(400);
  });

  it.each([
    [at(9), at(9)], [at(10), at(9)],
    ['2030-01-15T09:00:00.1231Z', '2030-01-15T09:00:00.1239Z']
  ])('rejects reversed or normalized-zero-duration windows', async (start_time, end_time) => {
    const res = await request(app).post('/api/absences').send({ teacher_id: 1, start_time, end_time });
    expect(res.status).toBe(400);
    expect(rows('absences')).toEqual([]);
  });

  it.each([false, {}, [], 12, 'x'.repeat(2001)])('rejects invalid reasons', async reason => {
    expect((await postAbsence(1, 9, 16, reason)).status).toBe(400);
  });

  it('merges multiple windows, preserves the lowest ID rather than earliest time, and deduplicates reasons', async () => {
    const first = await create(1, 11, 12, 'Personal leave');
    await create(1, 9, 10, 'Medical appointment');
    const merged = await request(app).post('/api/absences').send({
      teacher_id: 1, start_time: at(9, 30), end_time: at(11, 30), reason: ' Personal leave '
    });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ id: first.id, start_time: at(9), end_time: at(12) });
    expect(merged.body.reasons).toEqual(['Personal leave', 'Medical appointment']);
    expect((await board())).toHaveLength(1);
  });

  it('keeps adjacent teacher windows and different teachers separate with deterministic ordering', async () => {
    const later = await create(1, 10, 11);
    const earlier = await create(1, 9, 10);
    const other = await create(2, 9, 11);
    expect((await board()).map(row => row.id)).toEqual([earlier.id, other.id, later.id]);
  });

  it('does not partly merge when another affected absence has partial coverage', async () => {
    const first = await create(1, 9, 10, 'First');
    const second = await create(1, 11, 12, 'Second');
    expect((await request(app).post(`/api/absences/${second.id}/claim`).send({
      substitute_id: 4, start_time: at(11), end_time: at(11, 30)
    })).status).toBe(200);
    const before = rows('absences');
    const res = await postAbsence(1, 9, 12, 'Bridge');
    expect(res.status).toBe(409);
    expect(rows('absences')).toEqual(before);
    expect(rows('assignments')).toHaveLength(1);
    expect((await board())[0].id).toBe(first.id);
  });

  it('rejects accumulated reasons exceeding the limit without dropping information', async () => {
    for (let hour = 9; hour < 26; hour++) {
      await create(1, hour, hour + 1, `${hour}: ${'x'.repeat(1990)}`);
    }
    const before = rows('absences');
    const res = await postAbsence(1, 9, 26, 'Merge all');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REASONS_TOO_LARGE');
    expect(rows('absences')).toEqual(before);
  });

  it('derives multiple gaps and partial/full coverage from assignments inserted out of order', async () => {
    const absence = await create(1, 9, 17);
    expect((await claim(absence.id, 4, 14, 17)).body.status).toBe('Partially Covered');
    await claim(absence.id, 4, 9, 10);
    const partial = await claim(absence.id, 5, 11, 12);
    expect(partial.body.uncovered_windows).toEqual([
      { start_time: at(10), end_time: at(11) }, { start_time: at(12), end_time: at(14) }
    ]);
    expect(partial.body.assignments.map(a => a.start_time)).toEqual([at(9), at(11), at(14)]);
    await claim(absence.id, 5, 10, 11);
    const full = await claim(absence.id, 4, 12, 14);
    expect(full.body.status).toBe('Claimed');
    expect(full.body.uncovered_windows).toEqual([]);
    expect(full.body.claimable).toBe(false);
    expect((await claim(absence.id, 5, 9, 17)).status).toBe(409);
  });

  it.each([[8, 10], [15, 17]])('rejects coverage outside the absence', async (start, end) => {
    const absence = await create();
    expect((await claim(absence.id, 4, start, end)).status).toBe(400);
    expect(rows('assignments')).toEqual([]);
  });

  it.each([[9, 12], [10, 11], [9, 16], [11, 14]])('rejects same-absence overlap even for another substitute', async (start, end) => {
    const absence = await create();
    await claim(absence.id, 4, 10, 12);
    expect((await claim(absence.id, 5, start, end)).status).toBe(409);
    expect(rows('assignments')).toHaveLength(1);
  });

  it('prevents global substitute overlaps but allows adjacent work and different substitutes', async () => {
    const a = await create(1, 9, 12);
    const b = await create(2, 10, 14);
    await claim(a.id, 4, 9, 12);
    expect((await claim(b.id, 4, 10, 12)).status).toBe(409);
    expect((await claim(b.id, 5, 10, 12)).status).toBe(200);
    expect((await claim(b.id, 4, 12, 14)).status).toBe(200);
  });

  it('requires both explicit claim times and validates substitute roles and resource IDs', async () => {
    const absence = await create();
    for (const body of [
      { substitute_id: 4 }, { substitute_id: 4, start_time: at(9) },
      { substitute_id: 4, end_time: at(16) },
      { substitute_id: 1, start_time: at(9), end_time: at(16) },
      { substitute_id: 999, start_time: at(9), end_time: at(16) }
    ]) {
      expect((await request(app).post(`/api/absences/${absence.id}/claim`).send(body)).status).toBe(400);
    }
    expect((await claim(999, 4, 9, 16)).status).toBe(404);
    expect((await claim('1oops', 4, 9, 16)).status).toBe(400);
    expect(rows('assignments')).toEqual([]);
  });

  it('rejects ended requested portions even when the absence itself has not ended', async () => {
    const absence = await create();
    clock = Date.parse(at(12));
    expect((await claim(absence.id, 4, 9, 12)).status).toBe(409);
    expect((await claim(absence.id, 4, 11, 13)).status).toBe(200); // in-progress is allowed
    clock = Date.parse(at(16));
    expect((await claim(absence.id, 5, 13, 16)).status).toBe(409);
  });

  it('never expands a stale explicit claim after an ID-preserving merge', async () => {
    const absence = await create(1, 9, 12);
    await postAbsence(1, 11, 15);
    const res = await claim(absence.id, 4, 9, 12);
    expect(res.status).toBe(200);
    expect(res.body.assignments[0].end_time).toBe(at(12));
    expect(res.body.uncovered_windows).toEqual([{ start_time: at(12), end_time: at(15) }]);
  });

  it('returns 404 for a merged-away ID and does not recreate it', async () => {
    await create(1, 9, 10);
    const removed = await create(1, 11, 12);
    await postAbsence(1, 9, 12);
    expect((await claim(removed.id, 4, 11, 12)).status).toBe(404);
    expect(rows('assignments')).toEqual([]);
  });

  it('rejects duplicate claims after an unknown-response retry without adding assignments', async () => {
    const absence = await create();
    expect((await claim(absence.id, 4, 9, 16)).status).toBe(200);
    expect((await claim(absence.id, 4, 9, 16)).status).toBe(409);
    expect((await board())[0].assignments).toHaveLength(1);
  });

  it('cancels a future assignment, reopens coverage and frees the substitute elsewhere', async () => {
    const absence = await create();
    const assigned = await claim(absence.id, 4, 9, 16);
    const id = assigned.body.assignments[0].id;
    expect((await request(app).post(`/api/assignments/${id}/cancel`).send({ substitute_id: 5 })).status).toBe(403);
    const cancelled = await request(app).post(`/api/assignments/${id}/cancel`).send({ substitute_id: 4 });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('Open');
    expect(cancelled.body.assignments).toEqual([]);
    const other = await create(2, 9, 16);
    expect((await claim(other.id, 4, 9, 16)).status).toBe(200);
    expect((await request(app).post(`/api/assignments/${id}/cancel`).send({ substitute_id: 4 })).status).toBe(404);
  });

  it('cancels only remaining time for an ongoing assignment and rejects ended cancellation', async () => {
    const absence = await create();
    const assigned = await claim(absence.id, 4, 9, 16);
    const id = assigned.body.assignments[0].id;
    clock = Date.parse(at(12));
    const cancelled = await request(app).post(`/api/assignments/${id}/cancel`).send({ substitute_id: 4 });
    expect(cancelled.body.assignments[0].end_time).toBe(at(12));
    expect(cancelled.body.uncovered_windows).toEqual([{ start_time: at(12), end_time: at(16) }]);
    expect((await request(app).post(`/api/assignments/${id}/cancel`).send({ substitute_id: 4 })).status).toBe(409);
    expect((await claim(absence.id, 5, 12, 16)).body.status).toBe('Claimed');
  });

  it('returns early atomically: keeps earlier work, trims crossing work, removes later work', async () => {
    const absence = await create();
    await claim(absence.id, 4, 9, 12);
    await claim(absence.id, 5, 12, 14);
    await claim(absence.id, 4, 14, 16);
    clock = Date.parse(at(13));
    const res = await request(app).post(`/api/absences/${absence.id}/return-early`).send({ teacher_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.end_time).toBe(at(13));
    expect(res.body.assignments.map(a => [a.start_time, a.end_time])).toEqual([[at(9), at(12)], [at(12), at(13)]]);
    expect(res.body.status).toBe('Claimed');
    const other = await create(2, 13, 16);
    expect((await claim(other.id, 4, 13, 16)).status).toBe(200);
  });

  it('validates early-return ownership, cutoff, ended records, and explicit idempotent retry', async () => {
    const absence = await create();
    const endpoint = `/api/absences/${absence.id}/return-early`;
    expect((await request(app).post(endpoint).send({ teacher_id: 2, end_time: at(12) })).status).toBe(403);
    expect((await request(app).post(endpoint).send({ teacher_id: 4, end_time: at(12) })).status).toBe(400);
    for (const end_time of [at(9), at(8), at(17)]) {
      expect((await request(app).post(endpoint).send({ teacher_id: 1, end_time })).status).toBe(400);
    }
    expect((await request(app).post(endpoint).send({ teacher_id: 1, end_time: at(12) })).status).toBe(200);
    expect((await request(app).post(endpoint).send({ teacher_id: 1, end_time: at(12) })).status).toBe(200);
    clock = Date.parse(at(13));
    expect((await request(app).post(endpoint).send({ teacher_id: 1 })).status).toBe(409);
  });

  it('rolls back a merge after a later delete fails, including dates and reasons', async () => {
    await create(1, 9, 10, 'First');
    await create(1, 11, 12, 'Second');
    const before = rows('absences');
    app.locals.db.exec("CREATE TRIGGER fail_merge BEFORE DELETE ON absences BEGIN SELECT RAISE(ABORT, 'forced merge failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await postAbsence(1, 9, 12, 'Bridge');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('forced merge failure');
    expect(rows('absences')).toEqual(before);
    expect(app.locals.db.inTransaction).toBe(false);
  });

  it('rolls back dependent assignment changes when the final early-return write fails', async () => {
    const absence = await create();
    await claim(absence.id, 4, 9, 12);
    await claim(absence.id, 5, 12, 14);
    await claim(absence.id, 4, 14, 16);
    const before = { absences: rows('absences'), assignments: rows('assignments') };
    app.locals.db.exec("CREATE TRIGGER fail_return BEFORE UPDATE ON absences BEGIN SELECT RAISE(ABORT, 'forced return failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post(`/api/absences/${absence.id}/return-early`).send({ teacher_id: 1, end_time: at(13) });
    expect(res.status).toBe(500);
    expect(rows('absences')).toEqual(before.absences);
    expect(rows('assignments')).toEqual(before.assignments);
  });

  it('rolls back an inserted assignment when a later trigger fails', async () => {
    const absence = await create();
    app.locals.db.exec("CREATE TRIGGER fail_claim AFTER INSERT ON assignments BEGIN SELECT RAISE(FAIL, 'forced claim failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await claim(absence.id, 4, 9, 16)).status).toBe(500);
    expect(rows('assignments')).toEqual([]);
    expect((await board())[0].status).toBe('Open');
  });

  it('rolls back an in-progress cancellation if its mutation fails after updating the row', async () => {
    const absence = await create();
    const assigned = await claim(absence.id, 4, 9, 16);
    const before = rows('assignments');
    clock = Date.parse(at(12));
    app.locals.db.exec("CREATE TRIGGER fail_cancel AFTER UPDATE ON assignments BEGIN SELECT RAISE(FAIL, 'forced cancellation failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post(`/api/assignments/${assigned.body.assignments[0].id}/cancel`).send({ substitute_id: 4 });
    expect(res.status).toBe(500);
    expect(rows('assignments')).toEqual(before);
  });

  it('enforces database references, integer positive windows, JSON array reasons, and credential uniqueness', () => {
    const db = app.locals.db;
    const insert = db.prepare('INSERT INTO absences (teacher_id, start_time, end_time, reasons) VALUES (?, ?, ?, ?)');
    expect(() => insert.run(999, 1, 2, '[]')).toThrow();
    expect(() => insert.run(1, 2, 2, '[]')).toThrow();
    expect(() => insert.run(1, 1.5, 2, '[]')).toThrow();
    expect(() => insert.run(1, 8640000000000001, 8640000000000002, '[]')).toThrow();
    expect(() => insert.run(1, 1, 2, '{}')).toThrow();
    const id = Number(insert.run(1, 1, 2, '[]').lastInsertRowid);
    db.prepare('INSERT INTO assignments (absence_id, substitute_id, start_time, end_time) VALUES (?, ?, ?, ?)').run(id, 4, 1, 2);
    expect(() => db.prepare('DELETE FROM absences WHERE id = ?').run(id)).toThrow();
    const cert = db.prepare('INSERT INTO certifications (substitute_id, name) VALUES (?, ?)');
    cert.run(4, 'Synthetic credential');
    expect(() => cert.run(4, 'Synthetic credential')).toThrow();
  });

  it('returns consistent JSON errors for malformed JSON, array bodies, oversized requests and unknown APIs', async () => {
    const malformed = await request(app).post('/api/absences').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect((await request(app).post('/api/absences').send([])).body.error.code).toBe('INVALID_BODY');
    const oversized = await request(app).post('/api/absences').send({ reason: 'x'.repeat(40 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('BODY_TOO_LARGE');
    expect((await request(app).get('/api/missing')).body.error.code).toBe('NOT_FOUND');
  });
});
