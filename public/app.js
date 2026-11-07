(() => {
  const $ = id => document.getElementById(id);
  const state = { users: [], absences: [], busy: false, fresh: false, loaded: false, updated: null };
  let actorUpdaters = [];
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', timeZoneName: 'longOffset', hour12: false
  });
  const instant = value => formatter.format(new Date(value));
  const range = (start, end) => `${instant(start)} → ${instant(end)}`;
  const teacherId = () => Number($('teacher-select').value);
  const substituteId = () => Number($('substitute-select').value);
  const canAct = () => !state.busy && state.fresh && state.loaded;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function notice(message, kind = 'info') {
    const element = $('notice');
    element.textContent = message;
    element.dataset.kind = kind;
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    element.hidden = false;
  }

  function availability() {
    $('portal-controls').disabled = !canAct();
    $('refresh-button').disabled = state.busy;
    $('absences-board-container').setAttribute('aria-busy', String(state.busy));
    $('last-updated').textContent = state.updated
      ? `Last successful update: ${instant(state.updated)}${state.fresh ? '' : ' — stale; refresh required.'}`
      : 'Not yet loaded. Refresh to retry if loading fails.';
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, {
        ...options, cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error?.message || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return { data, status: response.status };
    } finally {
      clearTimeout(timeout);
    }
  }

  function localValue(value) {
    const date = new Date(value);
    const pad = (number, length = 2) => String(number).padStart(length, '0');
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function prefill(input, iso) {
    input.value = localValue(iso);
    // Preserve the exact instant from a gap, including the later occurrence of
    // an ambiguous DST wall time. Compare against the browser-sanitized value.
    input.dataset.sourceValue = input.value;
    input.dataset.sourceIso = iso;
    input.timeControl.syncFromValue();
  }

  function readTime(input) {
    if (input.value && input.value === input.dataset.sourceValue && input.dataset.sourceIso) {
      return input.dataset.sourceIso;
    }
    const match = input.value.match(/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!match) throw new Error('Choose a valid local date and time.');
    const [, y, mo, d, h, mi, s = '0', fraction = ''] = match;
    const parts = [y, mo, d, h, mi, s].map(Number);
    const millis = Number(fraction.padEnd(3, '0'));
    const date = new Date(0);
    date.setFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setHours(parts[3], parts[4], parts[5], millis);
    const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
    if (parts.some((part, index) => part !== actual[index]) || date.getMilliseconds() !== millis) {
      throw new Error('This local date/time is invalid or does not exist during a daylight-saving change. Choose another time.');
    }
    return date.toISOString();
  }

  function readWindow(startInput, endInput) {
    const start_time = readTime(startInput);
    const end_time = readTime(endInput);
    if (Date.parse(end_time) <= Date.parse(start_time)) throw new Error('End must be after start.');
    return { start_time, end_time };
  }

  function dateField(form, id, name, label, required = true) {
    const group = node('fieldset', undefined, 'date-time');
    group.append(node('legend', label));
    // This canonical local value keeps the existing ISO/validation path while
    // visible controls expose only dates, quarter-hour slots, and whole seconds.
    const input = node('input');
    Object.assign(input, { id, name, type: 'hidden' });
    input.dataset.timeField = '';
    const row = node('div', undefined, 'date-time-row');
    const datePart = node('div');
    const timePart = node('div');
    const date = node('input');
    Object.assign(date, { id: `${id}-date`, type: 'date', required });
    const dateLabel = node('label', 'Date');
    dateLabel.htmlFor = date.id;
    datePart.append(dateLabel, date);
    const slots = node('select');
    slots.id = `${id}-time`;
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const text = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      slots.add(new Option(text, `${text}:00`));
    }
    const exact = node('input');
    Object.assign(exact, { id: `${id}-exact`, type: 'time', step: '1', hidden: true, disabled: true });
    const timeLabel = node('label', 'Time (15-minute choices)');
    timeLabel.htmlFor = slots.id;
    const actions = node('div', undefined, 'time-actions');
    const edit = node('button', 'Edit exact time');
    edit.type = 'button';
    edit.dataset.action = 'edit-time';
    edit.setAttribute('aria-controls', exact.id);
    edit.setAttribute('aria-expanded', 'false');
    const clear = node('button', 'Clear');
    clear.type = 'button';
    clear.setAttribute('aria-label', `Clear ${label}`);
    actions.append(edit, clear);
    timePart.append(timeLabel, slots, exact);
    row.append(datePart, timePart);
    group.append(input, row, actions);
    form.append(group);
    let custom = false;
    const fullTime = value => /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;

    function ensureSlot(value) {
      for (const option of [...slots.options]) {
        if (option.dataset.custom) option.remove();
      }
      if (value && ![...slots.options].some(option => option.value === value)) {
        const option = new Option(`${value} (exact)`, value);
        option.dataset.custom = 'true';
        slots.add(option);
      }
      slots.value = value || '00:00:00';
    }

    function setMode(value) {
      custom = value;
      slots.hidden = custom;
      slots.disabled = custom;
      exact.hidden = !custom;
      exact.disabled = !custom;
      input.dataset.timeMode = custom ? 'exact' : 'slots';
      timeLabel.textContent = custom ? 'Exact time (hours, minutes, seconds)' : 'Time (15-minute choices)';
      timeLabel.htmlFor = custom ? exact.id : slots.id;
      edit.textContent = custom ? 'Use 15-minute choices' : 'Edit exact time';
      edit.setAttribute('aria-expanded', String(custom));
    }

    function sync(edited = false) {
      const time = fullTime(custom ? exact.value : slots.value);
      // Optional early-return fields mean "now" only when truly empty. A user
      // selecting a nonzero/exact time must also explicitly choose its date.
      date.required = required || custom || time !== '00:00:00';
      exact.required = required || Boolean(date.value);
      input.value = date.value && time ? `${date.value}T${time}` : '';
      input.dataset.dateValue = date.value;
      input.dataset.timeValue = time;
      if (edited) {
        delete input.dataset.sourceIso;
        delete input.dataset.sourceValue;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function syncFromValue() {
      const [day, time] = input.value ? input.value.split('T')
        : [input.dataset.dateValue || '', input.dataset.timeValue ?? '00:00:00'];
      date.value = day;
      ensureSlot(fullTime(time));
      exact.value = fullTime(time);
      setMode(input.dataset.timeMode === 'exact');
      sync();
    }

    function toggle() {
      if (!custom) exact.value = slots.value || '00:00:00';
      else ensureSlot(fullTime(exact.value));
      setMode(!custom);
      sync(); // Changing editor alone must not reinterpret a prefilled DST fold.
      (custom ? exact : slots).focus();
    }
    edit.addEventListener('click', toggle);
    slots.addEventListener('dblclick', event => { event.preventDefault(); if (!custom) toggle(); });
    date.addEventListener('input', () => sync(true));
    slots.addEventListener('change', () => sync(true));
    exact.addEventListener('input', () => sync(true));
    function reset() {
      date.value = '';
      exact.value = '00:00:00';
      ensureSlot('00:00:00');
      setMode(false);
      sync(true);
    }
    clear.addEventListener('click', reset);
    input.timeControl = { syncFromValue, reset };
    reset();
    return input;
  }

  function captureDrafts() {
    const drafts = new Map();
    for (const form of document.querySelectorAll('form[data-absence-id]')) {
      const values = {};
      for (const input of form.querySelectorAll('input[data-time-field]')) {
        values[input.name] = { value: input.value, ...input.dataset };
      }
      drafts.set(`${form.dataset.kind}:${form.dataset.absenceId}`, values);
    }
    return drafts;
  }

  function restore(input, saved) {
    if (!saved) return;
    input.value = saved.value;
    if (saved.sourceIso) {
      input.dataset.sourceIso = saved.sourceIso;
      input.dataset.sourceValue = saved.sourceValue;
    }
    input.dataset.timeMode = saved.timeMode || 'slots';
    input.dataset.dateValue = saved.dateValue || '';
    input.dataset.timeValue = saved.timeValue ?? '00:00:00';
    input.timeControl.syncFromValue();
  }

  function renderUsers() {
    const tbody = $('users-tbody');
    tbody.replaceChildren();
    for (const user of state.users) {
      const row = node('tr');
      const role = node('td');
      role.append(node('span', user.role, `badge badge-${user.role}`));
      const credentials = node('td');
      if (user.certifications.length) {
        const list = node('ul');
        for (const cert of user.certifications) {
          list.append(node('li', `${cert.name} — ${cert.expires_at
            ? `${cert.expired ? 'expired' : 'expires'} ${instant(cert.expires_at)}` : 'no expiry recorded'}`));
        }
        credentials.append(list);
      } else credentials.textContent = user.role === 'substitute' ? 'None recorded' : '—';
      row.append(node('td', user.id), node('td', user.name), role, credentials);
      tbody.append(row);
    }
    for (const [id, role] of [['teacher-select', 'teacher'], ['substitute-select', 'substitute']]) {
      const select = $(id);
      const selected = select.value;
      select.replaceChildren(new Option(`Select a ${role}`, ''));
      for (const user of state.users.filter(item => item.role === role)) select.add(new Option(user.name, user.id));
      select.value = selected;
    }
  }

  function updateActors() {
    for (const update of actorUpdaters) update();
  }

  function claimForm(absence, gaps, draft) {
    const form = node('form', undefined, 'action-form');
    form.dataset.kind = 'claim';
    form.dataset.absenceId = absence.id;
    form.setAttribute('aria-label', `Claim coverage for absence ${absence.id}`);
    const selectLabel = node('label', 'Choose uncovered window');
    const select = node('select');
    select.id = `gap-${absence.id}`;
    selectLabel.htmlFor = select.id;
    select.required = true;
    select.add(new Option('Choose a current uncovered window', ''));
    gaps.forEach((gap, index) => select.add(new Option(range(gap.start_time, gap.end_time), String(index))));
    form.append(selectLabel, select);
    const start = dateField(form, `claim-start-${absence.id}`, 'start_time', 'Cover from (local time)');
    const end = dateField(form, `claim-end-${absence.id}`, 'end_time', 'Cover until (local time)');
    const preview = node('p', undefined, 'muted');
    preview.setAttribute('aria-live', 'polite');
    const button = node('button', 'Claim selected time');
    button.type = 'submit';
    form.append(preview, button);
    const update = () => {
      button.disabled = !substituteId();
      try {
        const window = readWindow(start, end);
        const name = state.users.find(user => user.id === substituteId())?.name || 'Select a substitute';
        preview.textContent = `${name}: ${range(window.start_time, window.end_time)}. This exact range will be requested.`;
      } catch (error) { preview.textContent = error.message; }
    };
    const choose = () => {
      const gap = gaps[Number(select.value)];
      if (select.value !== '' && gap) {
        prefill(start, gap.start_time);
        prefill(end, gap.end_time);
      }
      update();
    };
    if (draft) {
      restore(start, draft.start_time);
      restore(end, draft.end_time);
      try {
        const window = readWindow(start, end);
        const index = gaps.findIndex(gap => Date.parse(window.start_time) >= Date.parse(gap.start_time) &&
          Date.parse(window.end_time) <= Date.parse(gap.end_time));
        select.value = index < 0 ? '' : String(index);
      } catch { select.value = ''; }
    }
    select.addEventListener('change', choose);
    start.addEventListener('input', update);
    end.addEventListener('input', update);
    actorUpdaters.push(update);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!canAct()) return;
      try {
        if (!form.reportValidity()) throw new Error('Choose a current gap and complete the claim times.');
        if (!substituteId()) throw new Error('Select a substitute first.');
        const window = readWindow(start, end);
        if (!gaps.some(gap => Date.parse(window.start_time) >= Date.parse(gap.start_time) &&
          Date.parse(window.end_time) <= Date.parse(gap.end_time))) {
          throw new Error('The selected range must fit entirely within one current uncovered window.');
        }
        if (Date.parse(window.end_time) <= Date.now()) throw new Error('This coverage window has already ended. Refresh the board.');
        mutate(`/api/absences/${absence.id}/claim`, { substitute_id: substituteId(), ...window },
          () => `Coverage saved for ${range(window.start_time, window.end_time)}.`);
      } catch (error) { notice(error.message, 'error'); }
    });
    update();
    return form;
  }

  function returnForm(absence, draft) {
    const form = node('form', undefined, 'action-form');
    form.dataset.kind = 'return';
    form.dataset.absenceId = absence.id;
    form.setAttribute('aria-label', `Shorten absence ${absence.id}`);
    form.append(node('strong', 'Teacher early return'));
    const end = dateField(form, `return-end-${absence.id}`, 'end_time', 'New end (local time; leave blank to return now)', false);
    restore(end, draft?.end_time);
    form.append(node('p', 'Earlier work is kept. Coverage crossing this cutoff is shortened; later assignments are removed.', 'muted'));
    const button = node('button', 'Shorten absence');
    button.type = 'submit';
    form.append(button);
    actorUpdaters.push(() => { form.hidden = teacherId() !== absence.teacher_id; });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!canAct()) return;
      try {
        if (!form.reportValidity()) throw new Error('Complete the return time or clear it to return now.');
        const payload = { teacher_id: teacherId() };
        if (end.value) payload.end_time = readTime(end);
        const now = Date.now();
        const cutoff = payload.end_time ? Date.parse(payload.end_time) : now;
        if (cutoff <= Date.parse(absence.start_time) || cutoff > Date.parse(absence.end_time) || cutoff < now) {
          throw new Error('Choose a cutoff after the absence start, no later than its end, and not in the past. Leave blank to return now after it starts.');
        }
        if (!window.confirm(`Shorten ${absence.teacher_name}'s absence to ${payload.end_time ? instant(payload.end_time) : 'now (server time)'}? Later substitute work will be shortened or removed.`)) return;
        mutate(`/api/absences/${absence.id}/return-early`, payload, () => 'Absence shortened and substitute assignments updated.');
      } catch (error) { notice(error.message, 'error'); }
    });
    return form;
  }

  function renderBoard(drafts) {
    const board = $('absences-board-container');
    board.replaceChildren();
    actorUpdaters = [];
    if (!state.absences.length) board.append(node('p', 'No absences yet. Log one using the teacher form.', 'muted'));
    for (const absence of state.absences) {
      const article = node('article', undefined, 'absence');
      article.dataset.absenceId = absence.id;
      const title = node('h3', `#${absence.id} — ${absence.teacher_name}`);
      title.id = `absence-title-${absence.id}`;
      article.setAttribute('aria-labelledby', title.id);
      article.append(title, node('p', range(absence.start_time, absence.end_time)),
        node('p', `${absence.status}${Date.parse(absence.end_time) <= Date.now() ? ' · Ended' : ''}`, 'badge'));
      if (absence.reasons.length) {
        article.append(node('h4', 'Reasons'));
        for (const reason of absence.reasons) article.append(node('p', reason, 'reason'));
      }
      article.append(node('h4', 'Assignments'));
      const assigned = node('ul');
      for (const assignment of absence.assignments) {
        const item = node('li', `${assignment.substitute_name}: ${range(assignment.start_time, assignment.end_time)}`);
        if (Date.parse(assignment.end_time) > Date.now()) {
          const cancel = node('button', 'Cancel remaining coverage');
          cancel.type = 'button';
          cancel.dataset.action = 'cancel';
          actorUpdaters.push(() => { cancel.hidden = substituteId() !== assignment.substitute_id; });
          cancel.addEventListener('click', () => {
            if (!canAct()) return;
            if (!window.confirm(`Cancel ${assignment.substitute_name}'s remaining coverage for ${absence.teacher_name}? Elapsed coverage is kept.`)) return;
            mutate(`/api/assignments/${assignment.id}/cancel`, { substitute_id: substituteId() },
              () => 'Remaining coverage cancelled. The released time is open again.');
          });
          item.append(cancel);
        }
        assigned.append(item);
      }
      article.append(absence.assignments.length ? assigned : node('p', 'No coverage assigned yet.', 'muted'));
      article.append(node('h4', 'Uncovered time'));
      const gaps = node('ul');
      for (const gap of absence.uncovered_windows) {
        gaps.append(node('li', `${range(gap.start_time, gap.end_time)}${Date.parse(gap.end_time) <= Date.now() ? ' — ended' : ''}`));
      }
      article.append(absence.uncovered_windows.length ? gaps : node('p', 'Fully covered.', 'muted'));
      const futureGaps = absence.uncovered_windows.filter(gap => Date.parse(gap.end_time) > Date.now());
      if (absence.claimable && futureGaps.length) article.append(claimForm(absence, futureGaps, drafts.get(`claim:${absence.id}`)));
      if (Date.parse(absence.end_time) > Date.now()) article.append(returnForm(absence, drafts.get(`return:${absence.id}`)));
      board.append(article);
    }
    updateActors();
  }

  async function loadData(resetAbsenceId) {
    const drafts = captureDrafts();
    if (resetAbsenceId) {
      drafts.delete(`claim:${resetAbsenceId}`);
      drafts.delete(`return:${resetAbsenceId}`);
    }
    const [users, absences] = await Promise.all([api('/api/users'), api('/api/absences')]);
    if (!Array.isArray(users.data) || !Array.isArray(absences.data)) throw new Error('The server returned an unexpected response.');
    state.users = users.data;
    state.absences = absences.data;
    state.loaded = true;
    renderUsers();
    renderBoard(drafts);
    state.updated = new Date().toISOString();
    state.fresh = true;
  }

  async function refresh() {
    if (state.busy) return;
    state.busy = true;
    availability();
    notice('Refreshing directory and coverage…');
    try {
      await loadData();
      notice('Directory and coverage refreshed.');
    } catch (error) {
      state.fresh = false;
      notice(`Unable to refresh: ${error.message} Controls are disabled until a refresh succeeds.`, 'error');
    } finally {
      state.busy = false;
      availability();
    }
  }

  async function mutate(path, payload, success) {
    if (!canAct()) return;
    state.busy = true;
    availability();
    notice('Saving… Please wait; do not submit again.');
    let message;
    let kind = 'info';
    let resetId;
    try {
      const response = await api(path, { method: 'POST', body: JSON.stringify(payload) });
      message = success(response);
      resetId = response.data.id;
    } catch (error) {
      kind = 'error';
      message = error.status ? error.message : 'The connection or response was lost. The request may have succeeded; inspect the refreshed board before retrying.';
    }
    try {
      await loadData(resetId);
      notice(`${message} Board refreshed.`, kind);
    } catch (error) {
      state.fresh = false;
      notice(`${message} Refresh failed: ${error.message} Controls are disabled. Use Refresh before doing anything else; do not blindly repeat the request.`, 'error');
    } finally {
      state.busy = false;
      availability();
    }
  }

  const absenceForm = $('absence-form');
  const absenceStart = dateField($('absence-start-container'), 'absence-start', 'start_time', 'Start (local time)');
  const absenceEnd = dateField($('absence-end-container'), 'absence-end', 'end_time', 'End (local time)');
  const updatePreview = () => {
    try {
      const window = readWindow($('absence-start'), $('absence-end'));
      $('absence-preview').textContent = range(window.start_time, window.end_time);
    } catch (error) { $('absence-preview').textContent = error.message; }
  };
  $('absence-start').addEventListener('input', updatePreview);
  $('absence-end').addEventListener('input', updatePreview);
  absenceForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!canAct()) return;
    try {
      if (!absenceForm.reportValidity()) throw new Error('Select a teacher and complete the required times.');
      const payload = {
        teacher_id: teacherId(), ...readWindow($('absence-start'), $('absence-end')),
        reason: $('absence-reason').value
      };
      mutate('/api/absences', payload, response => {
        absenceForm.reset();
        absenceStart.timeControl.reset();
        absenceEnd.timeControl.reset();
        $('teacher-select').value = String(payload.teacher_id);
        $('absence-preview').textContent = 'Select start and end times to preview their UTC offsets.';
        return `${response.status === 201 ? 'Created' : 'Merged'} absence #${response.data.id}.`;
      });
    } catch (error) { notice(error.message, 'error'); }
  });
  $('teacher-select').addEventListener('change', updateActors);
  $('substitute-select').addEventListener('change', updateActors);
  $('refresh-button').addEventListener('click', refresh);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser local time';
  $('timezone-label').textContent = `Timezone: ${zone}. Inputs use this timezone; every displayed range includes its UTC offsets. For manually entered repeated daylight-saving times, check the preview: the browser chooses the earlier occurrence. Prefilled gaps retain their exact instant.`;
  refresh();
})();
