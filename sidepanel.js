(() => {
  const Core = self.LeadCore;
  const $ = id => document.getElementById(id);
  const DASH = ' — ';
  const DEFAULTS = { country: 'China', maxRows: 2500, tags: '', unmapped: 'General Trading', delay: 5, dedupe: true, dropNoSite: true, skipOther: true, skipFilter: true, autoScrape: false, mode: 'preview', dry: false, layout: 'file', usePreset: true };
  let cfg = { ...DEFAULTS }, mapText = Core.mapToText(Core.DEFAULT_MAP);
  let session = null, files = [], parts = [], included = new Set(), fileEntries = [];
  let hist = {};                                   // finished uploads: key -> {name, strategy, rows, at, msg}
  let running = false, stopFlag = false, paused = false, pauseWaiters = [], decide = null, errDecide = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const store = {
    async get(k) { try { return (await chrome.storage.local.get(k))[k]; } catch { return undefined; } },
    async set(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch {} }
  };
  function log(msg, cls) {
    const el = $('log'); const line = document.createElement('div'); if (cls) line.className = cls;
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg; el.appendChild(line); el.scrollTop = el.scrollHeight;
  }
  const isDone = k => !!hist[k];
  async function markDone(job, msg) {
    hist[job.key] = { name: job.filename, strategy: job.strategy, rows: job.rows, at: Date.now(), msg: (msg || '').slice(0, 200) };
    await store.set('hist', hist);
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- settings ---------- */
  function readCfg() {
    cfg = {
      country: $('country').value.trim() || 'China', maxRows: Math.max(100, +$('maxRows').value || 2500), tags: $('tags').value.trim(),
      unmapped: $('unmapped').value, delay: Math.max(1, +$('delay').value || 5), dedupe: $('dedupe').checked, dropNoSite: $('dropNoSite').checked,
      skipOther: $('skipOther').checked, skipFilter: $('skipFilter').checked, autoScrape: $('autoScrape').checked,
      mode: document.querySelector('input[name=mode]:checked').value, dry: $('dry').checked,
      layout: document.querySelector('input[name=layout]:checked').value, usePreset: $('usePreset').checked
    };
    store.set('cfg', cfg);
  }
  function writeCfg() {
    $('country').value = cfg.country; $('maxRows').value = cfg.maxRows; $('tags').value = cfg.tags; $('unmapped').value = cfg.unmapped; $('delay').value = cfg.delay;
    $('dedupe').checked = cfg.dedupe; $('dropNoSite').checked = cfg.dropNoSite; $('skipOther').checked = cfg.skipOther; $('skipFilter').checked = cfg.skipFilter;
    $('autoScrape').checked = cfg.autoScrape; $('dry').checked = cfg.dry; $('usePreset').checked = cfg.usePreset;
    document.querySelector('input[name=mode][value=' + cfg.mode + ']').checked = true;
    document.querySelector('input[name=layout][value=' + cfg.layout + ']').checked = true;
  }
  const refreshStartLabel = () => { $('start').textContent = cfg.dry ? 'Start dry run' : 'Start'; };

  /* ---------- theme ---------- */
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    const eff = t === 'light' || t === 'dark' ? t : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    $('theme').textContent = eff === 'light' ? '☀ Light' : '☾ Dark';
  }
  async function initTheme() {
    let t = await store.get('theme'); applyTheme(t);
    $('theme').onclick = async () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      t = cur === 'light' ? 'dark' : 'light'; applyTheme(t); await store.set('theme', t);
    };
  }

  /* ---------- folder ---------- */
  const natural = (a, b) => { const n = s => { const m = s.match(/\((\d+)\)/); return m ? +m[1] : 0; }; return n(a.name) - n(b.name) || a.name.localeCompare(b.name); };
  async function pickFiles() {
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ mode: 'read' }); const out = [];
        for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /\.csv$/i.test(name)) out.push(await h.getFile());
        return out;
      } catch (e) { if (e && e.name === 'AbortError') return null; log('Folder picker failed (' + e.message + '), using fallback.', 'warn'); }
    }
    return new Promise(res => { const inp = $('folderInput'); inp.value = ''; inp.onchange = () => res([...inp.files].filter(f => /\.csv$/i.test(f.name))); inp.click(); });
  }

  /* ---------- jobs (one list for both layouts) ---------- */
  function jobsNow() {
    if (cfg.layout === 'file') return fileEntries.filter(e => e.include).map(e => ({
      label: e.name + ' → ' + e.assigned + ' (' + e.rows + ' rows)', strategy: e.assigned, filename: e.name, rows: e.rows,
      key: 'h:' + e.hash, getCsv: () => e.file.text() }));
    return parts.map(d => ({
      label: d.strategy + ' (' + d.rows + ' rows' + (d.of > 1 ? ', part ' + d.part + '/' + d.of : '') + ')', strategy: d.strategy, filename: d.filename, rows: d.rows,
      key: 'p:' + d.key, getCsv: async () => Core.buildCsv(session, d) }));
  }
  function updateDone() {
    const js = jobsNow(); const left = js.filter(p => !isDone(p.key)).length;
    $('doneInfo').textContent = js.length ? `${js.length - left}/${js.length} already uploaded` : '';
  }

  /* ---------- per-file analysis ---------- */
  async function analyzeFiles() {
    const map = Core.mapFromText(mapText); fileEntries = []; const seenHash = new Map();
    $('prog').hidden = false; $('prog').max = files.length; $('prog').value = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      $('folderInfo').textContent = 'Reading ' + f.name + ' (' + (i + 1) + '/' + files.length + ')…';
      try {
        const text = await f.text();
        const hash = await sha256(text);
        const info = Core.dominant(Core.parseCSV(text), map, cfg.unmapped);
        const preset = Core.presetFor(f.name);
        const dupOf = seenHash.get(hash) || null; if (!dupOf) seenHash.set(hash, f.name);
        const uploaded = hist['h:' + hash] || null;
        fileEntries.push({ file: f, name: f.name, size: f.size, hash, rows: info.rows, auto: info.top, autoPct: info.pct, preset, dupOf, uploaded,
          assigned: (cfg.usePreset && preset) || info.top || cfg.unmapped, include: !uploaded && !dupOf });
      } catch (e) { log('Skipped ' + f.name + ': ' + e.message, 'bad'); }
      $('prog').value = i + 1; await sleep(0);
    }
    $('prog').hidden = true; $('folderInfo').textContent = files.length + ' CSV files read.';
    renderFiles();
  }
  function renderFiles() {
    for (const e of fileEntries) e.uploaded = hist['h:' + e.hash] || null;
    const todo = fileEntries.filter(e => e.include);
    const total = todo.reduce((a, e) => a + e.rows, 0);
    const done = fileEntries.filter(e => e.uploaded).length, dups = fileEntries.filter(e => e.dupOf).length;
    const differ = fileEntries.filter(e => e.auto && e.assigned !== e.auto).length;
    $('summary').innerHTML = `<b>${todo.length}</b> of ${fileEntries.length} files selected (<b>${total.toLocaleString()}</b> rows), uploaded as-is.` +
      (done ? ` <span class="ok">${done} already uploaded before.</span>` : '') + (dups ? ` <span class="warn">${dups} identical to another file.</span>` : '') +
      (differ ? ` <span class="warn">${differ} differ from auto-detect (⚠).</span>` : '');
    const opts = s => Core.STRATEGIES.map(x => `<option${x === s ? ' selected' : ''}>${x}</option>`).join('');
    let h = '<table><tr><th></th><th>File</th><th class="n">Rows</th><th>Auto</th><th>Upload as</th></tr>';
    fileEntries.forEach((e, i) => {
      const status = e.uploaded ? `<div class="st up">✓ uploaded ${new Date(e.uploaded.at).toLocaleString()} as ${e.uploaded.strategy} <a class="forget" data-f="${i}">forget</a></div>`
        : e.dupOf ? `<div class="st dup">same content as ${e.dupOf.replace('apollo-accounts-export', 'export')}</div>` : '';
      h += `<tr><td><input type="checkbox" data-i="${i}" ${e.include ? 'checked' : ''}></td><td>${e.name.replace('apollo-accounts-export', 'export')}${status}</td><td class="n">${e.rows.toLocaleString()}</td><td class="ind">${e.auto || '-'} ${Math.round(e.autoPct * 100)}%${e.assigned !== e.auto ? ' ⚠' : ''}</td><td><select data-a="${i}">${opts(e.assigned)}</select></td></tr>`;
    });
    $('tableWrap').innerHTML = h + '</table>';
    $('tableWrap').querySelectorAll('input[data-i]').forEach(cb => cb.onchange = () => { fileEntries[+cb.dataset.i].include = cb.checked; renderFiles(); });
    $('tableWrap').querySelectorAll('select[data-a]').forEach(sl => sl.onchange = () => { fileEntries[+sl.dataset.a].assigned = sl.value; renderFiles(); });
    $('tableWrap').querySelectorAll('a[data-f]').forEach(a => a.onclick = async () => { const e = fileEntries[+a.dataset.f]; delete hist['h:' + e.hash]; await store.set('hist', hist); e.include = true; renderFiles(); });
    $('start').disabled = running || !jobsNow().length;
    updateDone();
  }

  /* ---------- split analysis ---------- */
  async function analyze() {
    readCfg();
    if (!files.length) return;
    if (cfg.layout === 'file') return analyzeFiles();
    const map = Core.mapFromText(mapText);
    session = Core.createSession({ country: cfg.country, dedupe: cfg.dedupe, dropNoSite: cfg.dropNoSite, skipOtherCountries: cfg.skipOther, unmapped: cfg.unmapped, map });
    $('prog').hidden = false; $('prog').max = files.length; $('prog').value = 0;
    for (let i = 0; i < files.length; i++) {
      $('folderInfo').textContent = 'Reading ' + files[i].name + ' (' + (i + 1) + '/' + files.length + ')…';
      try { Core.addFile(session, files[i].name, await files[i].text()); } catch (e) { log('Skipped ' + files[i].name + ': ' + e.message, 'bad'); }
      $('prog').value = i + 1; await sleep(0);
    }
    $('prog').hidden = true; $('folderInfo').textContent = files.length + ' CSV files read.';
    included = new Set(session.buckets.keys()); render();
  }
  function render() {
    const st = session.stats;
    parts = Core.makeParts(session, cfg.maxRows, included);
    $('summary').innerHTML = `<b>${st.rows.toLocaleString()}</b> rows read → <b class="ok">${st.kept.toLocaleString()}</b> to upload. Removed: ${st.dup.toLocaleString()} duplicates, ${st.noSite.toLocaleString()} no website, ${st.otherCountry.toLocaleString()} other country${st.skippedUnmapped ? ', ' + st.skippedUnmapped + ' unmapped' : ''}.`;
    const rows = [...session.buckets.entries()].sort((a, b) => b[1].lines.length - a[1].lines.length);
    let h = '<table><tr><th></th><th>Strategy</th><th class="n">Rows</th><th class="n">Uploads</th></tr>';
    for (const [s, b] of rows) h += `<tr><td><input type="checkbox" data-s="${s.replace(/"/g, '&quot;')}" ${included.has(s) ? 'checked' : ''}></td><td>${s}<div class="ind">${Core.topIndustries(b, 3).join(' · ')}</div></td><td class="n">${b.lines.length.toLocaleString()}</td><td class="n">${Math.ceil(b.lines.length / cfg.maxRows)}</td></tr>`;
    $('tableWrap').innerHTML = h + '</table>';
    $('tableWrap').querySelectorAll('input[data-s]').forEach(cb => cb.onchange = () => { cb.checked ? included.add(cb.dataset.s) : included.delete(cb.dataset.s); render(); });
    $('start').disabled = running || !parts.length; updateDone();
  }

  /* ---------- talking to the page ---------- */
  async function getTab() {
    const tabs = await chrome.tabs.query({ url: 'https://outreachhub.shipcubeai.com/*' });
    const t = tabs.find(x => /\/import\/?$/.test(new URL(x.url).pathname)) || tabs.find(x => x.active) || tabs[0];
    if (!t) { log('Open outreachhub.shipcubeai.com/import (signed in) in a tab first.', 'bad'); return null; }
    return t;
  }
  async function send(tabId, msg) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await sleep(400); return await chrome.tabs.sendMessage(tabId, msg); }
      catch (e2) { return { ok: false, error: 'Cannot reach the page: ' + e2.message + ' (reload the Outreach tab)' }; }
    }
  }
  async function checkPage() {
    readCfg();
    const t = await getTab(); if (!t) return;
    const r = await send(t.id, { type: 'scan', country: cfg.country });
    if (!r.ok) return log(r.error, 'bad');
    const s = r.scan;
    log('Page: ' + s.path + ' · file box: ' + (s.fileInput ? 'ok' : 'MISSING') + ' · country: ' + s.country + ' · ' + s.buttons.join(', ') + ' · auto-scrape box: ' + s.autoScrapeBox + ' · skip-filter box: ' + s.skipFilterBox);
    log('Strategy field: ' + s.strategyKind + ', ' + s.strategyOptions.length + ' options.', s.strategyOptions.length ? '' : 'bad');
    const flat = x => x.toLowerCase().replace(/[—–-]+/g, '-').replace(/\s+/g, ' ');
    const have = new Set(s.strategyOptions.map(flat));
    const planned = cfg.layout === 'file' ? [...new Set(fileEntries.filter(e => e.include).map(e => e.assigned))] : [...(session ? session.buckets.keys() : [])];
    const missing = planned.filter(k => !have.has(flat(k + DASH + cfg.country)));
    if (s.strategyOptions.length && planned.length) log(missing.length ? 'Strategies in your plan that the page does not list: ' + missing.join('; ') : 'All planned strategies exist on the page.', missing.length ? 'warn' : 'ok');
  }

  /* ---------- pause / decisions ---------- */
  function setPaused(v) {
    paused = v; $('pause').textContent = v ? '▶ Resume' : '⏸ Pause';
    if (!v) { const w = pauseWaiters; pauseWaiters = []; w.forEach(r => r()); }
  }
  async function gate() {
    if (paused) log('Paused — press Resume to continue.', 'warn');
    while (paused && !stopFlag) await new Promise(r => pauseWaiters.push(r));
  }
  const waitDecision = () => new Promise(res => { decide = res; });
  function askError(msg, canMark) {
    $('errText').textContent = msg; $('errMark').hidden = !canMark; $('errBox').hidden = false;
    return new Promise(res => { errDecide = res; }).then(v => { $('errBox').hidden = true; return v; });
  }

  async function doJob(d, t, label) {
    const base = { type: 'fill', csv: await d.getCsv(), filename: d.filename, country: cfg.country, strategy: d.strategy + DASH + cfg.country, tags: cfg.tags, skip: cfg.skipFilter, autoscrape: cfg.autoScrape, dry: cfg.dry };
    const usePreview = cfg.dry || cfg.mode === 'preview';
    let r = await send(t.id, { ...base, click: usePreview ? 'preview' : 'import' });
    if (r.steps) log('  steps: ' + r.steps.join(' → '));
    if (!r.ok) return { ok: false, error: (r.error || 'failed') + (r.message ? ' — ' + r.message : ''), ambiguous: !usePreview && /No response/.test(r.error || '') };
    log('  form ok' + (r.message ? ' · ' + r.message.slice(0, 220) : ''));
    if (cfg.dry) { log('  dry run: Import NOT clicked.', 'warn'); return { ok: true, dry: true }; }
    if (cfg.mode === 'preview') {
      log('  waiting for you: press “Confirm import” below (choose “Fully automatic” to skip this).', 'warn');
      $('confirmText').textContent = 'Preview is on the page for: ' + label + '. Import it?'; $('confirmBox').hidden = false;
      const dec = await waitDecision(); $('confirmBox').hidden = true;
      if (dec === 'stop') return { ok: true, stop: true };
      if (dec === 'skip') { log('  skipped by you.', 'warn'); return { ok: true, skipped: true }; }
      r = await send(t.id, { type: 'import', dry: false });
      if (!r.ok) return { ok: false, error: 'Import: ' + (r.error || 'failed') + (r.message ? ' — ' + r.message : ''), ambiguous: /No response/.test(r.error || '') };
    }
    return { ok: true, message: r.message };
  }

  async function run() {
    readCfg();
    const t = await getTab(); if (!t) return;
    const todo = jobsNow().filter(p => cfg.dry || !isDone(p.key));
    if (!todo.length) return log('Nothing left to upload.', 'warn');
    running = true; stopFlag = false; setPaused(false);
    $('start').disabled = true; $('stop').disabled = false; $('pause').disabled = false; $('pick').disabled = true;
    log((cfg.dry ? 'DRY RUN – ' : '') + 'starting ' + todo.length + ' upload(s)…', cfg.dry ? 'warn' : '');
    for (let i = 0; i < todo.length; i++) {
      await gate(); if (stopFlag) break;
      const d = todo[i], label = `${i + 1}/${todo.length} ${d.label}`;
      if (!cfg.dry && isDone(d.key)) { log('↷ already uploaded: ' + d.filename); continue; }   // never upload the same content twice
      log('→ ' + label);
      let out;
      while (true) {
        out = await doJob(d, t, label);
        if (out.ok || stopFlag) break;
        log('✗ ' + out.error, 'bad');
        const msg = out.error + (out.ambiguous ? '\n\nImport was clicked but the page gave no confirmation. Check Import History on the page BEFORE retrying, or the file may upload twice.' : '');
        const choice = await askError(msg, out.ambiguous);
        if (choice === 'retry') { log('  retrying…', 'warn'); continue; }
        if (choice === 'skip') { out = { ok: true, skipped: true }; log('  skipped.', 'warn'); break; }
        if (choice === 'mark') { out = { ok: true, message: 'marked uploaded manually' }; break; }
        stopFlag = true; break;
      }
      if (out.stop) break;
      if (out.ok && !out.skipped && !out.dry) { await markDone(d, out.message); log('✓ imported · ' + (out.message || '').slice(0, 240), 'ok'); if (cfg.layout === 'file') renderFiles(); }
      updateDone();
      if (!stopFlag && i < todo.length - 1) await sleep(cfg.delay * 1000);
    }
    running = false; setPaused(false);
    $('start').disabled = !jobsNow().length; $('stop').disabled = true; $('pause').disabled = true; $('pick').disabled = false;
    log(stopFlag ? 'Stopped.' : 'Finished.', stopFlag ? 'warn' : 'ok'); updateDone();
  }

  /* ---------- wiring ---------- */
  async function init() {
    initTheme();
    const sc = await store.get('cfg'); if (sc) cfg = { ...DEFAULTS, ...sc };
    const sm = await store.get('mapText'); if (sm) mapText = sm;
    const sh = await store.get('hist'); if (sh) hist = sh;
    $('unmapped').innerHTML = '<option value="skip">(skip these rows)</option>' + Core.STRATEGIES.map(s => `<option>${s}</option>`).join('');
    $('mapText').value = mapText; writeCfg(); refreshStartLabel();
    $('pick').onclick = async () => {
      const f = await pickFiles(); if (!f) return;
      if (!f.length) return log('No .csv files in that folder.', 'bad');
      files = f.sort(natural); await analyze();
    };
    for (const id of ['country', 'maxRows', 'tags', 'unmapped', 'delay', 'dedupe', 'dropNoSite', 'skipOther', 'skipFilter', 'autoScrape', 'dry']) {
      $(id).addEventListener('change', async () => {
        readCfg(); refreshStartLabel();
        if (['country', 'unmapped', 'dedupe', 'dropNoSite', 'skipOther'].includes(id)) await analyze(); else if (cfg.layout === 'split' && session) render();
      });
    }
    document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', readCfg));
    document.querySelectorAll('input[name=layout]').forEach(r => r.addEventListener('change', async () => { readCfg(); if (files.length) await analyze(); }));
    $('usePreset').addEventListener('change', async () => { readCfg(); if (files.length) await analyze(); });
    $('applyMap').onclick = async () => { mapText = $('mapText').value; await store.set('mapText', mapText); await analyze(); };
    $('resetMap').onclick = async () => { mapText = Core.mapToText(Core.DEFAULT_MAP); $('mapText').value = mapText; await store.set('mapText', mapText); await analyze(); };
    $('check').onclick = checkPage;
    $('start').onclick = () => { if (!running) run(); };
    $('pause').onclick = () => { if (!running) return; setPaused(!paused); log(paused ? 'Pausing — the current file finishes, then it waits.' : 'Resumed.', 'warn'); };
    $('stop').onclick = () => {
      stopFlag = true; setPaused(false);
      if (decide) { decide('stop'); decide = null; } if (errDecide) { errDecide('stop'); errDecide = null; }
      log('Stopping after the current step…', 'warn');
    };
    $('confirmGo').onclick = () => { if (decide) { decide('go'); decide = null; } };
    $('confirmSkip').onclick = () => { if (decide) { decide('skip'); decide = null; } };
    for (const [id, v] of [['errRetry', 'retry'], ['errSkip', 'skip'], ['errMark', 'mark'], ['errStop', 'stop']]) $(id).onclick = () => { if (errDecide) { errDecide(v); errDecide = null; } };
    $('clearLog').onclick = async () => {
      if (!confirm('Forget ALL finished uploads? The bot could upload the same files again.')) return;
      hist = {}; await store.set('hist', hist); if (cfg.layout === 'file' && fileEntries.length) { fileEntries.forEach(e => { e.uploaded = null; e.include = !e.dupOf; }); renderFiles(); } else updateDone();
      log('Upload history cleared.', 'warn');
    };
  }
  init();
})();
