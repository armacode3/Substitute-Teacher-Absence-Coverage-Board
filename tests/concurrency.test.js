import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const at = hour => new Date(Date.UTC(2030, 0, 15, hour)).toISOString();
const workerFile = fileURLToPath(new URL('./helpers/api-worker.cjs', import.meta.url));

function startWorker(dbPath) {
  const child = fork(workerFile, [dbPath, String(Date.parse(at(8)))], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let sequence = 0;
  let output = '';
  const pending = new Map();
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const readyTimer = setTimeout(() => {
    readyReject(new Error(`Worker startup timed out: ${output}`));
    child.kill('SIGKILL');
  }, 5000);
  child.on('message', message => {
    if (message.ready) {
      clearTimeout(readyTimer);
      readyResolve();
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.failure) item.reject(new Error(message.failure));
    else item.resolve(message);
  });
  child.on('error', error => {
    clearTimeout(readyTimer);
    readyReject(error);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  });
  child.on('exit', code => {
    clearTimeout(readyTimer);
    readyReject(new Error(`Worker exited (${code}): ${output}`));
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(`Worker exited (${code}): ${output}`));
    }
    pending.clear();
  });
  return {
    ready,
    call(method, path, body) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Worker request timed out: ${output}`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, method, path, body });
      });
    },
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
  };
}

describe('file-backed, separate-process scheduling concurrency', () => {
  let app;
  let directory;
  let dbPath;
  let workers;

  beforeEach(() => {
    directory = mkdtempSync('/tmp/opencode/aps-api-test-');
    dbPath = join(directory, 'school.db');
    app = createApp(dbPath, { now: () => Date.parse(at(8)) });
    workers = [];
  });

  afterEach(async () => {
    await Promise.all(workers.map(worker => worker.stop()));
    app.locals.db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function worker() {
    const instance = startWorker(dbPath);
    workers.push(instance);
    await instance.ready;
    return instance;
  }

  async function create(teacher = 1, start = 9, end = 16) {
    const response = await request(app).post('/api/absences').send({
      teacher_id: teacher, start_time: at(start), end_time: at(end)
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  const claimBody = (sub, start, end) => ({ substitute_id: sub, start_time: at(start), end_time: at(end) });
  const assignments = () => app.locals.db.prepare('SELECT * FROM assignments ORDER BY start_time, id').all();

  it('allows only one of two processes to cover the same time', async () => {
    const absence = await create();
    const a = await worker();
    const b = await worker();
    const results = await Promise.all([
      a.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 9, 16)),
      b.call('post', `/api/absences/${absence.id}/claim`, claimBody(5, 9, 16))
    ]);
    expect(results.map(res => res.status).sort()).toEqual([200, 409]);
    expect(assignments()).toHaveLength(1);
  });

  it('prevents one substitute claiming overlapping windows on different absences', async () => {
    const first = await create(1);
    const second = await create(2);
    const a = await worker();
    const b = await worker();
    const results = await Promise.all([
      a.call('post', `/api/absences/${first.id}/claim`, claimBody(4, 9, 16)),
      b.call('post', `/api/absences/${second.id}/claim`, claimBody(4, 9, 16))
    ]);
    expect(results.map(res => res.status).sort()).toEqual([200, 409]);
    expect(assignments()).toHaveLength(1);
  });

  it('allows both processes to claim adjacent portions', async () => {
    const absence = await create();
    const a = await worker();
    const b = await worker();
    const results = await Promise.all([
      a.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 9, 12)),
      b.call('post', `/api/absences/${absence.id}/claim`, claimBody(5, 12, 16))
    ]);
    expect(results.map(res => res.status)).toEqual([200, 200]);
    const board = await request(app).get('/api/absences');
    expect(board.body[0].status).toBe('Claimed');
    expect(assignments()).toHaveLength(2);
  });

  it('serializes a merge with a stale explicit claim without expanding accepted hours', async () => {
    const absence = await create(1, 9, 12);
    const a = await worker();
    const b = await worker();
    const [claimed, merged] = await Promise.all([
      a.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 9, 12)),
      b.call('post', '/api/absences', { teacher_id: 1, start_time: at(11), end_time: at(15), reason: 'Extension' })
    ]);
    expect(claimed.status).toBe(200);
    expect([200, 409]).toContain(merged.status);
    expect(assignments()).toHaveLength(1);
    expect(assignments()[0].end_time).toBe(Date.parse(at(12)));
    const row = app.locals.db.prepare('SELECT * FROM absences WHERE id = ?').get(absence.id);
    expect(row.end_time).toBe(Date.parse(at(merged.status === 200 ? 15 : 12)));
  });

  it('serializes cancellation and another substitute claiming the released window', async () => {
    const absence = await create();
    const initial = await request(app).post(`/api/absences/${absence.id}/claim`).send(claimBody(4, 9, 16));
    const id = initial.body.assignments[0].id;
    const a = await worker();
    const b = await worker();
    const [cancelled, claimed] = await Promise.all([
      a.call('post', `/api/assignments/${id}/cancel`, { substitute_id: 4 }),
      b.call('post', `/api/absences/${absence.id}/claim`, claimBody(5, 9, 16))
    ]);
    expect(cancelled.status).toBe(200);
    expect([200, 409]).toContain(claimed.status);
    expect(assignments()).toHaveLength(claimed.status === 200 ? 1 : 0);
    expect(assignments().every(item => item.substitute_id === 5)).toBe(true);
  });

  it('serializes early return and a claim in the removed future portion', async () => {
    const absence = await create();
    const a = await worker();
    const b = await worker();
    const [returned, claimed] = await Promise.all([
      a.call('post', `/api/absences/${absence.id}/return-early`, { teacher_id: 1, end_time: at(12) }),
      b.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 13, 16))
    ]);
    expect(returned.status).toBe(200);
    expect([200, 400]).toContain(claimed.status);
    expect(assignments()).toEqual([]);
    expect(app.locals.db.prepare('SELECT end_time FROM absences WHERE id = ?').get(absence.id).end_time).toBe(Date.parse(at(12)));
  });

  it('returns coherent board snapshots while another process repeatedly shortens coverage', async () => {
    const absence = await create(1, 9, 17);
    await request(app).post(`/api/absences/${absence.id}/claim`).send(claimBody(4, 9, 17));
    const writer = await worker();
    const reader = await worker();
    await Promise.all([
      (async () => {
        for (let hour = 16; hour >= 10; hour--) {
          const res = await writer.call('post', `/api/absences/${absence.id}/return-early`, { teacher_id: 1, end_time: at(hour) });
          expect(res.status).toBe(200);
        }
      })(),
      (async () => {
        for (let i = 0; i < 20; i++) {
          const res = await reader.call('get', '/api/absences');
          expect(res.status).toBe(200);
          expect(res.body[0].status).toBe('Claimed');
          expect(res.body[0].assignments[0].end_time).toBe(res.body[0].end_time);
          expect(res.body[0].uncovered_windows).toEqual([]);
        }
      })()
    ]);
  });

  it('reports bounded lock contention without writing, then succeeds after the lock is released', async () => {
    const absence = await create();
    const other = await worker();
    app.locals.db.exec('BEGIN IMMEDIATE');
    let busy;
    try {
      busy = await other.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 9, 16));
    } finally {
      app.locals.db.exec('ROLLBACK');
    }
    expect(busy.status).toBe(503);
    expect(busy.body.error.code).toBe('DATABASE_BUSY');
    expect(busy.headers['retry-after']).toBe('1');
    expect(assignments()).toEqual([]);
    expect((await other.call('post', `/api/absences/${absence.id}/claim`, claimBody(4, 9, 16))).status).toBe(200);
  });

  it('preserves assignments and avoids reseeding users when a database is reopened', async () => {
    const absence = await create();
    await request(app).post(`/api/absences/${absence.id}/claim`).send(claimBody(4, 9, 16));
    app.locals.db.close();
    app = createApp(dbPath, { now: () => Date.parse(at(8)) });
    expect((await request(app).get('/api/users')).body).toHaveLength(5);
    const board = await request(app).get('/api/absences');
    expect(board.body[0].status).toBe('Claimed');
    expect(board.body[0].assignments).toHaveLength(1);
  });
});
