(() => {
  const Core = self.LeadCore;
  const $ = id => document.getElementById(id);
  const SUFFIX_DASH = ' — ';
  const DEFAULTS = { country: 'China', maxRows: 2500, tags: 'apollo.io', unmapped: 'General Trading', delay: 5, dedupe: true, dropNoSite: true, skipOther: true, skipFilter: true, autoScrape: false, mode: 'preview', dry: false, layout: 'file', usePreset: true };
  let cfg = { ...DEFAULTS }, mapText = Core.mapToText(Core.DEFAULT_MAP), session = null, files = [], parts = [], included = new Set(), doneKeys = new Set();
  let running = false, stopFlag = false, decide = null;

  const store = {
    async get(k) { try { return (await chrome.storage.local.get(k))[k]; } catch { return undefined; } },
    async set(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch {} }
  };
  function log(msg, cls) {
    const el = $('log'); const t = new Date().toLocaleTimeString();
    const line = document.createElement('div'); if (cls) line.className = cls; line.textContent = '[' + t + '] ' + msg;
    el.appendChild(line); el.scrollTop = el.scrollHeight;
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
    $('autoScrape').checked = cfg.autoScrape; $('dry').checked = cfg.dry;
    document.querySelector('input[name=mode][value=' + cfg.mode + ']').checked = true;
    document.querySelector('input[name=layout][value=' + cfg.layout + ']').checked = true; $('usePreset').checked = cfg.usePreset;
  }
  function refreshStartLabel() {
    $('start').textContent = cfg.dry ? 'Start dry run' : 'Start';
    $('start').classList.toggle('primary', true);
  }

  /* ---------- folder + analysis ---------- */
  const natural = (a, b) => {
    const n = s => { const m = s.match(/\((\d+)\)/); return m ? +m[1] : 0; };
    return n(a.name) - n(b.name) || a.name.localeCompare(b.name);
  };
  async function pickFiles() {
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ mode: 'read' });
        const out = [];
        for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /\.csv$/i.test(name)) out.push(await h.getFile());
        return out;
      } catch (e) { if (e && e.name === 'AbortError') return null; log('Folder picker failed (' + e.message + '), using fallback.', 'warn'); }
    }
    return new Promise(res => {
      const inp = $('folderInput'); inp.value = '';
      inp.onchange = () => res([...inp.files].filter(f => /\.csv$/i.test(f.name)));
      inp.click();
    });
  }
  let fileEntries = [];
  function jobsNow() {
    if (cfg.layout === 'file') return fileEntries.filter(e => e.include).map(e => ({
      label: e.name + ' \u2192 ' + e.assigned + ' (' + e.rows + ' rows)', strategy: e.assigned, filename: e.name, rows: e.rows,
      key: 'file|' + e.name + '|' + e.size + '|' + e.assigned, getCsv: () => e.file.text() }));
    return parts.map(d => ({
      label: d.strategy + ' (' + d.rows + ' rows' + (d.of > 1 ? ', part ' + d.part + '/' + d.of : '') + ')', strategy: d.strategy, filename: d.filename, rows: d.rows,
      key: d.key, getCsv: async () => Core.buildCsv(session, d) }));
  }
  async function analyzeFiles() {
    const map = Core.mapFromText(mapText);
    fileEntries = [];
    $('prog').hidden = false; $('prog').max = files.length; $('prog').value = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      $('folderInfo').textContent = 'Reading ' + f.name + ' (' + (i + 1) + '/' + files.length + ')…';
      try {
        const info = Core.dominant(Core.parseCSV(await f.text()), map, cfg.unmapped);
        const preset = Core.presetFor(f.name);
        fileEntries.push({ file: f, name: f.name, size: f.size, rows: info.rows, auto: info.top, autoPct: info.pct, second: info.second, preset, assigned: (cfg.usePreset && preset) || info.top || cfg.unmapped, include: true });
      } catch (e) { log('Skipped ' + f.name + ': ' + e.message, 'bad'); }
      $('prog').value = i + 1;
      await new Promise(r => setTimeout(r, 0));
    }
    $('prog').hidden = true;
    $('folderInfo').textContent = files.length + ' CSV files read.';
    renderFiles();
  }
  function renderFiles() {
    const total = fileEntries.reduce((a, e) => a + (e.include ? e.rows : 0), 0);
    const differ = fileEntries.filter(e => e.auto && e.assigned !== e.auto).length;
    $('summary').innerHTML = `<b>${fileEntries.length}</b> files, <b>${total.toLocaleString()}</b> rows will be uploaded as-is, one file per upload.` + (differ ? ` <span class="warn">${differ} file(s) differ from the auto-detected majority (marked ⚠).</span>` : '');
    const opts = s => Core.STRATEGIES.map(x => `<option${x === s ? ' selected' : ''}>${x}</option>`).join('');
    let h = '<table><tr><th></th><th>File</th><th class="n">Rows</th><th>Auto-detected</th><th>Upload as</th></tr>';
    fileEntries.forEach((e, i) => {
      const short = e.name.replace('apollo-accounts-export', 'export');
      h += `<tr><td><input type="checkbox" data-i="${i}" ${e.include ? 'checked' : ''}></td><td>${short}</td><td class="n">${e.rows.toLocaleString()}</td><td class="ind">${e.auto || '-'} ${Math.round(e.autoPct * 100)}%${e.assigned !== e.auto ? ' \u26a0' : ''}</td><td><select data-a="${i}">${opts(e.assigned)}</select></td></tr>`;
    });
    $('tableWrap').innerHTML = h + '</table>';
    $('tableWrap').querySelectorAll('input[data-i]').forEach(cb => cb.onchange = () => { fileEntries[+cb.dataset.i].include = cb.checked; renderFiles(); });
    $('tableWrap').querySelectorAll('select[data-a]').forEach(sl => sl.onchange = () => { fileEntries[+sl.dataset.a].assigned = sl.value; renderFiles(); });
    $('start').disabled = running || !jobsNow().length;
    updateDone();
  }
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
      $('prog').value = i + 1;
      await new Promise(r => setTimeout(r, 0));
    }
    $('prog').hidden = true;
    $('folderInfo').textContent = files.length + ' CSV files read.';
    included = new Set(session.buckets.keys());
    render();
  }
  function render() {
    const st = session.stats;
    parts = Core.makeParts(session, cfg.maxRows, included);
    $('summary').innerHTML = `<b>${st.rows.toLocaleString()}</b> rows read → <b class="ok">${st.kept.toLocaleString()}</b> to upload. Removed: ${st.dup.toLocaleString()} duplicates, ${st.noSite.toLocaleString()} no website, ${st.otherCountry.toLocaleString()} other country${st.skippedUnmapped ? ', ' + st.skippedUnmapped + ' unmapped' : ''}. (${st.viaKeyword} classified by keywords, ${st.viaDefault} by default.)`;
    const rows = [...session.buckets.entries()].sort((a, b) => b[1].lines.length - a[1].lines.length);
    let h = '<table><tr><th></th><th>Strategy</th><th class="n">Rows</th><th class="n">Uploads</th></tr>';
    for (const [s, b] of rows) {
      const n = Math.ceil(b.lines.length / cfg.maxRows);
      h += `<tr><td><input type="checkbox" data-s="${s.replace(/"/g, '&quot;')}" ${included.has(s) ? 'checked' : ''}></td><td>${s}<div class="ind">${Core.topIndustries(b, 3).join(' · ')}</div></td><td class="n">${b.lines.length.toLocaleString()}</td><td class="n">${n}</td></tr>`;
    }
    $('tableWrap').innerHTML = h + '</table>';
    $('tableWrap').querySelectorAll('input[data-s]').forEach(cb => cb.onchange = () => { cb.checked ? included.add(cb.dataset.s) : included.delete(cb.dataset.s); render(); });
    $('start').disabled = running || !parts.length;
    updateDone();
  }
  function updateDone() {
    const js = jobsNow(); const left = js.filter(p => !doneKeys.has(p.key)).length;
    $('doneInfo').textContent = js.length ? `${js.length - left}/${js.length} already uploaded` : '';
  }

  /* ---------- talking to the page ---------- */
  async function getTab() {
    const tabs = await chrome.tabs.query({ url: 'https://outreachhub.shipcubeai.com/*' });
    const t = tabs.find(x => /\/import\/?($|\?)/.test(new URL(x.url).pathname + new URL(x.url).search)) || tabs.find(x => x.active) || tabs[0];
    if (!t) { log('Open outreachhub.shipcubeai.com/import (signed in) in a tab first.', 'bad'); return null; }
    return t;
  }
  async function send(tabId, msg) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await new Promise(r => setTimeout(r, 400)); return await chrome.tabs.sendMessage(tabId, msg); }
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
    const have = new Set(s.strategyOptions.map(x => x.toLowerCase().replace(/[—–-]+/g, '-').replace(/\s+/g, ' ')));
    const planned = cfg.layout === 'file' ? [...new Set(fileEntries.map(e => e.assigned))] : [...(session ? session.buckets.keys() : [])];
    const missing = planned.filter(k => !has.has((k + SUFFIX_DASH + cfg.country).toLowerCase().replace(/[—–-]+/g, '-').replace(/\s+/g, ' ')));
    if (s.strategyOptions.length && planned.length) log(missing.length ? 'Strategies in your plan that the page does not list: ' + missing.join('; ') : 'All planned strategies exist on the page.', missing.length ? 'warn' : 'ok');
  }

  function waitDecision() { return new Promise(res => { decide = res; }); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function run() {
    readCfg();
    const t = await getTab(); if (!t) return;
    const todo = jobsNow().filter(p => cfg.dry || !doneKeys.has(p.key));
    if (!todo.length) return log('Nothing left to upload.', 'warn');
    running = true; stopFlag = false; $('start').disabled = true; $('stop').disabled = false; $('pick').disabled = true;
    log((cfg.dry ? 'DRY RUN \u2013 ' : '') + 'starting ' + todo.length + ' upload(s)\u2026', cfg.dry ? 'warn' : '');
    let i = 0;
    for (const d of todo) {
      if (stopFlag) break;
      i++;
      const label = `${i}/${todo.length} ${d.label}`;
      const base = {
        type: 'fill', csv: await d.getCsv(), filename: d.filename, country: cfg.country, strategy: d.strategy + SUFFIX_DASH + cfg.country,
        tags: cfg.tags, skip: cfg.skipFilter, autoscrape: cfg.autoScrape, dry: cfg.dry
      };
      log('\u2192 ' + label);
      const usePreview = cfg.dry || cfg.mode === 'preview';
      let r = await send(t.id, { ...base, click: usePreview ? 'preview' : 'import' });
      if (r.steps) log('  steps: ' + r.steps.join(' \u2192 '));
      if (!r.ok) { log('\u2717 ' + (r.error || 'failed') + (r.message ? ' \u2014 ' + r.message : ''), 'bad'); break; }
      log('  form ok' + (r.shown ? ' \u00b7 strategy shows \u201c' + r.shown + '\u201d' : '') + (r.message ? ' \u00b7 ' + r.message.slice(0, 220) : ''));
      if (cfg.dry) { log('  dry run: Import NOT clicked.', 'warn'); }
      else if (cfg.mode === 'preview') {
        log('  waiting for you: press \u201cConfirm import\u201d in the panel (switch to \u201cFully automatic\u201d to skip this).', 'warn');
        $('confirmText').textContent = 'Preview is on the page for: ' + label + '. Import it?';
        $('confirmBox').hidden = false;
        const dec = await waitDecision(); $('confirmBox').hidden = true;
        if (dec === 'stop') break;
        if (dec === 'skip') { log('  skipped by you.', 'warn'); continue; }
        r = await send(t.id, { type: 'import', dry: false });
        if (!r.ok) { log('\u2717 Import: ' + (r.error || 'failed') + (r.message ? ' \u2014 ' + r.message : ''), 'bad'); break; }
        log('\u2713 imported \u00b7 ' + (r.message || '').slice(0, 240), 'ok');
        doneKeys.add(d.key); await store.set('done', [...doneKeys]);
      } else {
        log('\u2713 imported \u00b7 ' + (r.message || '').slice(0, 240), 'ok');
        doneKeys.add(d.key); await store.set('done', [...doneKeys]);
      }
      updateDone();
      if (!stopFlag && i < todo.length) await sleep(cfg.delay * 1000);
    }
    running = false; $('start').disabled = !jobsNow().length; $('stop').disabled = true; $('pick').disabled = false;
    log(stopFlag ? 'Stopped.' : 'Finished.', stopFlag ? 'warn' : 'ok');
    updateDone();
  }

  /* ---------- wiring ---------- */
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    const eff = t === 'light' || t === 'dark' ? t : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    $('theme').textContent = eff === 'light' ? '\u2600 Light' : '\u263E Dark';
  }
  async function initTheme() {
    let t = await store.get('theme'); applyTheme(t);
    $('theme').onclick = async () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      t = cur === 'light' ? 'dark' : 'light'; applyTheme(t); await store.set('theme', t);
    };
  }

  async function init() {
    initTheme();
    const sc = await store.get('cfg'); if (sc) cfg = { ...DEFAULTS, ...sc };
    const sm = await store.get('mapText'); if (sm) mapText = sm;
    const sd = await store.get('done'); if (sd) doneKeys = new Set(sd);
    const sel = $('unmapped'); sel.innerHTML = '<option value="skip">(skip these rows)</option>' + Core.STRATEGIES.map(s => `<option>${s}</option>`).join('');
    $('mapText').value = mapText; writeCfg(); refreshStartLabel();
    $('pick').onclick = async () => {
      const f = await pickFiles(); if (!f) return;
      if (!f.length) return log('No .csv files in that folder.', 'bad');
      files = f.sort(natural); await analyze();
    };
    for (const id of ['country', 'maxRows', 'tags', 'unmapped', 'delay', 'dedupe', 'dropNoSite', 'skipOther', 'skipFilter', 'autoScrape', 'dry']) {
      $(id).addEventListener('change', async () => {
        readCfg(); refreshStartLabel();
        if (['country', 'unmapped', 'dedupe', 'dropNoSite', 'skipOther'].includes(id)) await analyze(); else if (session) render();
      });
    }
    document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', readCfg));
    document.querySelectorAll('input[name=layout]').forEach(r => r.addEventListener('change', async () => { readCfg(); if (files.length) await analyze(); }));
    $('usePreset').addEventListener('change', async () => { readCfg(); if (files.length) await analyze(); });
    $('applyMap').onclick = async () => { mapText = $('mapText').value; await store.set('mapText', mapText); await analyze(); };
    $('resetMap').onclick = async () => { mapText = Core.mapToText(Core.DEFAULT_MAP); $('mapText').value = mapText; await store.set('mapText', mapText); await analyze(); };
    $('check').onclick = checkPage;
    $('start').onclick = () => { if (!running) run(); };
    $('stop').onclick = () => { stopFlag = true; if (decide) { decide('stop'); decide = null; } log('Stopping after the current step…', 'warn'); };
    $('confirmGo').onclick = () => { if (decide) { decide('go'); decide = null; } };
    $('confirmSkip').onclick = () => { if (decide) { decide('skip'); decide = null; } };
    $('clearLog').onclick = async () => { doneKeys.clear(); await store.set('done', []); updateDone(); log('Upload history cleared.'); };
  }
  init();
})();
