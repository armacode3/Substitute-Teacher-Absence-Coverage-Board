const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp(process.argv[2], { now: () => Number(process.argv[3]) });

// Keep the first assignment writer inside its transaction briefly so competing
// processes exercise file locking, not just sequential in-process handlers.
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
app.locals.db.function('test_write_delay', () => {
  Atomics.wait(waitBuffer, 0, 0, 40);
  return 0;
});
app.locals.db.exec(`
  CREATE TEMP TRIGGER test_assignment_delay BEFORE INSERT ON assignments
  BEGIN SELECT test_write_delay(); END;
`);

process.on('message', async ({ id, method, path, body }) => {
  try {
    let call = request(app)[method](path);
    if (body !== undefined) call = call.send(body);
    const response = await call;
    process.send({ id, status: response.status, body: response.body, headers: response.headers });
  } catch (error) {
    process.send({ id, failure: error.message });
  }
});

process.on('SIGTERM', () => {
  app.locals.db.close();
  process.exit(0);
});

process.send({ ready: true });
