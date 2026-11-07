const { reject } = require('./errors');

function bodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject(400, 'INVALID_BODY', 'A JSON object is required.');
  }
  return body;
}

function userId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    reject(400, 'INVALID_ID', `${name} must be a positive integer.`);
  }
  return value;
}

function pathId(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    reject(400, 'INVALID_ID', 'The resource ID must be a positive integer.');
  }
  return userId(Number(value), 'id');
}

// Parse an explicit ISO calendar/offset contract, not Date.parse's permissive
// rollover rules. Validate the entire fraction before truncating its digits.
function timestamp(value, name) {
  const match = typeof value === 'string' && value.match(
    /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!match) {
    reject(400, 'INVALID_TIME', `${name} must be an ISO timestamp with Z or a UTC offset.`);
  }
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (y === '-000000' || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    reject(400, 'INVALID_TIME', `${name} contains an invalid calendar date, time, or offset.`);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, '0')));
  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (zone[0] === '-' ? -1 : 1);
  const normalized = date.getTime() - offset;
  if (!Number.isSafeInteger(normalized) || !Number.isFinite(new Date(normalized).getTime())) {
    reject(400, 'INVALID_TIME', `${name} is outside the supported JavaScript date range.`);
  }
  return normalized;
}

function windowTimes(body) {
  const start = timestamp(body.start_time, 'start_time');
  const end = timestamp(body.end_time, 'end_time');
  if (end <= start) {
    reject(400, 'INVALID_WINDOW', 'end_time must be after start_time at millisecond precision.');
  }
  return { start, end };
}

function reason(value) {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string' || value.length > 2000) {
    reject(400, 'INVALID_REASON', 'reason must be a string of at most 2000 characters.');
  }
  return value.trim() ? [value.trim()] : [];
}

module.exports = { bodyObject, userId, pathId, timestamp, windowTimes, reason };
