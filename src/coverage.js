const { reject } = require('./errors');

const iso = value => new Date(value).toISOString();

function coverageGaps(start, end, assignments) {
  const gaps = [];
  let cursor = start;
  for (const assignment of assignments) {
    if (assignment.start_time > cursor) {
      gaps.push({ start_time: cursor, end_time: assignment.start_time });
    }
    cursor = Math.max(cursor, assignment.end_time);
  }
  if (cursor < end) gaps.push({ start_time: cursor, end_time: end });
  return gaps;
}

function createCoverageService(db, { now = Date.now } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?');
  const absence = db.prepare(`
    SELECT a.*, u.name AS teacher_name FROM absences a
    JOIN users u ON u.id = a.teacher_id WHERE a.id = ?
  `);
  const allAbsences = db.prepare(`
    SELECT a.*, u.name AS teacher_name FROM absences a
    JOIN users u ON u.id = a.teacher_id ORDER BY a.start_time, a.id
  `);
  const assignmentSelect = `
    SELECT a.*, u.name AS substitute_name FROM assignments a
    JOIN users u ON u.id = a.substitute_id
  `;
  const assignmentsFor = db.prepare(`${assignmentSelect} WHERE a.absence_id = ? ORDER BY a.start_time, a.id`);
  const allAssignments = db.prepare(`${assignmentSelect} ORDER BY a.absence_id, a.start_time, a.id`);
  const assignmentById = db.prepare('SELECT * FROM assignments WHERE id = ?');
  const overlaps = db.prepare(`
    SELECT a.*, EXISTS(SELECT 1 FROM assignments WHERE absence_id = a.id) AS has_assignments
    FROM absences a WHERE teacher_id = ? AND start_time < ? AND end_time > ? ORDER BY id
  `);
  const insertAbsence = db.prepare('INSERT INTO absences (teacher_id, start_time, end_time, reasons) VALUES (?, ?, ?, ?)');
  const updateAbsence = db.prepare('UPDATE absences SET start_time = ?, end_time = ?, reasons = ? WHERE id = ?');
  const deleteAbsence = db.prepare('DELETE FROM absences WHERE id = ?');
  const absenceConflict = db.prepare('SELECT 1 FROM assignments WHERE absence_id = ? AND start_time < ? AND end_time > ? LIMIT 1');
  const substituteConflict = db.prepare('SELECT 1 FROM assignments WHERE substitute_id = ? AND start_time < ? AND end_time > ? LIMIT 1');
  const insertAssignment = db.prepare('INSERT INTO assignments (absence_id, substitute_id, start_time, end_time) VALUES (?, ?, ?, ?)');
  const deleteAssignment = db.prepare('DELETE FROM assignments WHERE id = ?');
  const truncateAssignment = db.prepare('UPDATE assignments SET end_time = ? WHERE id = ?');

  function requireUser(id, role) {
    const found = user.get(id);
    if (!found || found.role !== role) {
      reject(400, 'INVALID_ACTOR', `The selected user must be an existing ${role}.`);
    }
    return found;
  }

  function requireAbsence(id) {
    const found = absence.get(id);
    if (!found) reject(404, 'ABSENCE_NOT_FOUND', 'Absence not found. Refresh the board.');
    return found;
  }

  function serialize(row, assignments, time) {
    const gaps = coverageGaps(row.start_time, row.end_time, assignments);
    return {
      id: row.id,
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      start_time: iso(row.start_time),
      end_time: iso(row.end_time),
      reasons: JSON.parse(row.reasons),
      status: !assignments.length ? 'Open' : gaps.length ? 'Partially Covered' : 'Claimed',
      claimable: gaps.some(gap => gap.end_time > time),
      assignments: assignments.map(item => ({
        ...item, start_time: iso(item.start_time), end_time: iso(item.end_time)
      })),
      uncovered_windows: gaps.map(gap => ({ start_time: iso(gap.start_time), end_time: iso(gap.end_time) }))
    };
  }

  function result(id, time) {
    return serialize(requireAbsence(id), assignmentsFor.all(id), time);
  }

  const list = db.transaction(() => {
    const time = now();
    const rows = allAbsences.all();
    const grouped = new Map();
    for (const item of allAssignments.all()) {
      if (!grouped.has(item.absence_id)) grouped.set(item.absence_id, []);
      grouped.get(item.absence_id).push(item);
    }
    return rows.map(row => serialize(row, grouped.get(row.id) || [], time));
  });

  const listUsers = db.transaction(role => {
    const time = now();
    const rows = role
      ? db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id').all(role)
      : db.prepare('SELECT * FROM users ORDER BY id').all();
    const certificates = db.prepare('SELECT * FROM certifications ORDER BY substitute_id, name, id').all();
    const grouped = new Map();
    for (const item of certificates) {
      if (!grouped.has(item.substitute_id)) grouped.set(item.substitute_id, []);
      grouped.get(item.substitute_id).push({
        id: item.id,
        name: item.name,
        expires_at: item.expires_at === null ? null : iso(item.expires_at),
        expired: item.expires_at !== null && item.expires_at <= time
      });
    }
    return rows.map(row => ({ ...row, certifications: grouped.get(row.id) || [] }));
  });

  const create = db.transaction(({ teacherId, start, end, reasons }) => {
    const time = now();
    requireUser(teacherId, 'teacher');
    // Baseline indexed overlap query. Re-expand to closure defensively if older
    // data ever contains overlapping rows; no writes happen during discovery.
    let affected;
    while (true) {
      affected = overlaps.all(teacherId, end, start);
      if (affected.some(row => row.has_assignments)) {
        reject(409, 'COVERAGE_PROTECTED', 'An overlapping absence already has coverage and cannot be merged.');
      }
      const nextStart = affected.reduce((value, row) => Math.min(value, row.start_time), start);
      const nextEnd = affected.reduce((value, row) => Math.max(value, row.end_time), end);
      if (nextStart === start && nextEnd === end) break;
      start = nextStart;
      end = nextEnd;
    }
    const combined = [...new Set([...affected.flatMap(row => JSON.parse(row.reasons)), ...reasons])];
    const encoded = JSON.stringify(combined);
    if (Buffer.byteLength(encoded) > 32 * 1024) {
      reject(400, 'REASONS_TOO_LARGE', 'Combined reasons exceed 32 KiB; no records were changed.');
    }
    let id;
    if (affected.length) {
      id = affected[0].id;
      updateAbsence.run(start, end, encoded, id);
      for (const row of affected.slice(1)) deleteAbsence.run(row.id);
    } else {
      id = Number(insertAbsence.run(teacherId, start, end, encoded).lastInsertRowid);
    }
    return { created: affected.length === 0, absence: result(id, time) };
  });

  const claim = db.transaction(({ absenceId, substituteId, start, end }) => {
    const time = now();
    const row = requireAbsence(absenceId);
    requireUser(substituteId, 'substitute');
    if (start < row.start_time || end > row.end_time) {
      reject(400, 'OUTSIDE_ABSENCE', 'The requested coverage must be entirely inside the absence.');
    }
    if (row.end_time <= time || end <= time) {
      reject(409, 'WINDOW_ENDED', 'An already-ended coverage window cannot be claimed.');
    }
    if (absenceConflict.get(absenceId, end, start)) {
      reject(409, 'ALREADY_COVERED', 'The requested time overlaps existing coverage of this absence.');
    }
    if (substituteConflict.get(substituteId, end, start)) {
      reject(409, 'SUBSTITUTE_CONFLICT', 'The substitute already has an overlapping assignment.');
    }
    insertAssignment.run(absenceId, substituteId, start, end);
    return result(absenceId, time);
  });

  const cancel = db.transaction(({ assignmentId, substituteId }) => {
    const time = now();
    const row = assignmentById.get(assignmentId);
    if (!row) reject(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found. Refresh the board.');
    requireUser(substituteId, 'substitute');
    if (row.substitute_id !== substituteId) {
      reject(403, 'NOT_OWNER', 'Only the assigned substitute can cancel this assignment.');
    }
    if (row.end_time <= time) reject(409, 'ASSIGNMENT_ENDED', 'An ended assignment cannot be cancelled.');
    if (row.start_time >= time) deleteAssignment.run(assignmentId);
    else truncateAssignment.run(time, assignmentId);
    return result(row.absence_id, time);
  });

  const returnEarly = db.transaction(({ absenceId, teacherId, end }) => {
    const time = now();
    const row = requireAbsence(absenceId);
    requireUser(teacherId, 'teacher');
    if (row.teacher_id !== teacherId) reject(403, 'NOT_OWNER', 'Only the absent teacher can shorten this absence.');
    const cutoff = end === undefined ? time : end;
    if (cutoff === row.end_time && end !== undefined) return result(absenceId, time);
    if (row.end_time <= time) reject(409, 'WINDOW_ENDED', 'An ended absence cannot be shortened.');
    if (cutoff <= row.start_time || cutoff > row.end_time || cutoff < time) {
      reject(400, 'INVALID_RETURN_TIME', 'Return time must shorten the absence, be after its start, and not be in the past.');
    }
    // Adjust dependent rows first, then the parent, all in one transaction.
    for (const item of assignmentsFor.all(absenceId)) {
      if (item.start_time >= cutoff) deleteAssignment.run(item.id);
      else if (item.end_time > cutoff) truncateAssignment.run(cutoff, item.id);
    }
    db.prepare('UPDATE absences SET end_time = ? WHERE id = ?').run(cutoff, absenceId);
    return result(absenceId, time);
  });

  return {
    list: () => list(),
    listUsers: role => listUsers(role),
    create: input => create.immediate(input),
    claim: input => claim.immediate(input),
    cancel: input => cancel.immediate(input),
    returnEarly: input => returnEarly.immediate(input)
  };
}

module.exports = { createCoverageService, coverageGaps };
