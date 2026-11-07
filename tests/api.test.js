import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Sub Coverage API', () => {
  let app;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('returns the seeded teachers and substitutes', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5);
    expect(res.body.some(u => u.role === 'teacher')).toBe(true);
    expect(res.body.some(u => u.role === 'substitute')).toBe(true);
  });

  // TODO: Add tests for creating absences, claiming shifts,
  // preventing double-claims, and preventing overlapping sub schedules.
});
