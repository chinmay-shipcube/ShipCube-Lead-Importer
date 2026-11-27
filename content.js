/* ShipCube Lead Importer - drives the Import Leads form on outreachhub.shipcubeai.com */
(() => {
  if (window.__slImporter) return;
  window.__slImporter = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').toLowerCase().replace(/[—–‒-]+/g, '-').replace(/\s+/g, ' ').trim();
  const txt = el => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };

  function findLabel(prefix) {
    const p = prefix.toLowerCase();
    const els = [...document.querySelectorAll('label,div,span,p,legend,h3,h4')].filter(e => {
      const t = txt(e).toLowerCase();
      return t.startsWith(p) && t.length < p.length + 140 && e.children.length <= 4;
    });
    els.sort((a, b) => txt(a).length - txt(b).length);
    return els[0] || null;
  }
  function after(labelEl, selector, filter) {
    return [...document.querySelectorAll(selector)].find(c =>
      (labelEl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !labelEl.contains(c) && (!filter || filter(c)));
  }
  function checkboxFor(prefix) {
    const l = findLabel(prefix);
    if (!l) return null;
    return (l.closest('label') && l.closest('label').querySelector('input[type=checkbox]')) || l.control ||
      l.querySelector('input[type=checkbox]') || (l.parentElement && l.parentElement.querySelector('input[type=checkbox]')) ||
      (l.previousElementSibling && l.previousElementSibling.matches('input[type=checkbox]') ? l.previousElementSibling : null);
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setCheckbox(cb, want) { if (cb && cb.checked !== want) cb.click(); }
  function fireClick(el) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    el.click();
  }
  function buttonByText(wanted, exact) {
    const w = wanted.toLowerCase();
    return [...document.querySelectorAll('button,[role=button],input[type=submit],a.btn')].find(b => {
      if (!visible(b)) return false;
      const t = txt(b).replace(/^[^A-Za-z]+/, '').toLowerCase() || (b.value || '').toLowerCase();
      return exact ? t === w : t.includes(w);
    });
  }

  /* ----- result watcher (start BEFORE clicking) ----- */
  function watch(timeoutMs) {
    return new Promise(resolve => {
      const added = []; let settle = null;
      const re = /(import|added|created|inserted|preview|valid|invalid|skipp|duplicate|error|fail|success|rows?|leads?|agents?|companies)/i;
      const finish = () => { obs.disconnect(); clearTimeout(tm); clearTimeout(settle); resolve(added.join(' | ').slice(0, 900)); };
      const obs = new MutationObserver(ms => {
        for (const m of ms) {
          const nodes = [...m.addedNodes]; if (m.type === 'characterData') nodes.push(m.target);
          for (const n of nodes) {
            const t = ((n.nodeType === 1 ? (n.innerText || n.textContent) : n.textContent) || '').replace(/\s+/g, ' ').trim();
            if (t && t.length < 500 && re.test(t) && !added.includes(t)) { added.push(t); clearTimeout(settle); settle = setTimeout(finish, 2500); }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      const tm = setTimeout(finish, timeoutMs);
    });
  }
  // only real failure messages count ("0 errors" in a preview must not stop a run)
  const looksFailed = t => /(import failed|upload failed|failed to|could not|unable to|something went wrong|exception|unauthori[sz]ed|forbidden|denied|invalid csv|invalid file|no valid)/i.test(t);

  /* ----- form pieces ----- */
  function setFile(csv, filename) {
    const file = new File([csv], filename, { type: 'text/csv' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('input[type=file]');
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const zone = [...document.querySelectorAll('div,label')].find(e => /click to upload|drag & drop/i.test(txt(e)) && txt(e).length < 200);
    if (!zone) return false;
    for (const t of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  }

  function setCountry(country) {
    const label = findLabel('Country');
    const sel = label && after(label, 'select', s => [...s.options].some(o => /^china|^all|^united/i.test(o.text.trim())));
    if (!sel) return { ok: false, error: 'Country dropdown not found' };
    const want = country.toLowerCase();
    const opt = [...sel.options].find(o => o.text.trim().toLowerCase().startsWith(want));
    if (!opt) return { ok: false, error: 'Country "' + country + '" not in dropdown' };
    setNativeValue(sel, opt.value);
    return { ok: true };
  }

  const OPTION_SEL = '[role=option],.option,.ts-dropdown .option,.select2-results__option,.choices__item--choice,.dropdown-item,li';
  const TRIGGER_SEL = '[role=combobox],.ts-control,.select2-selection,.choices,.dropdown-toggle,button[aria-haspopup],[class*=select],input[type=text]';

  // Outreach Hub strategy picker: widget = [trigger div][panel div: search box + option divs]
  function strategyParts() {
    const label = findLabel('Assign to strategy');
    if (!label) return null;
    const search = after(label, 'input[placeholder*="earch"]');
    if (search && search.parentElement) {
      const host = search.parentElement;
      const root = host.parentElement;
      const trigger = host.previousElementSibling || (root && [...root.children].find(c => c !== host)) || host.firstElementChild;
      return { label, host, search, trigger, native: null };
    }
    const native = after(label, 'select', s => [...s.options].length > 1 && [...s.options].some(o => /no strategy|—|strategy/i.test(o.text)));
    let trigger = null;
    if (native && native.nextElementSibling && visible(native.nextElementSibling)) trigger = native.nextElementSibling;
    if (!trigger) trigger = after(label, TRIGGER_SEL, c => visible(c) && c !== native);
    if (!trigger && native && visible(native)) trigger = native;
    return { label, native, trigger, host: null };
  }
  function optionEls(parts) {
    if (parts.host) {
      return [...parts.host.querySelectorAll('*')].filter(e => e.children.length === 0 && e !== parts.search && !(parts.trigger && parts.trigger.contains(e)) && txt(e) && /—/.test(txt(e)));
    }
    return [...document.querySelectorAll(OPTION_SEL)].filter(visible);
  }
  function displayedStrategy(parts) {
    if (parts.host) return txt(parts.trigger);
    if (parts.native && visible(parts.native)) { const o = parts.native.selectedOptions[0]; return o ? o.text : ''; }
    const box = parts.trigger && (parts.trigger.closest('.ts-wrapper,.choices,.select2,.select2-container') || parts.trigger.parentElement || parts.trigger);
    return txt(box);
  }
  function matches(optionText, want) {
    const o = norm(optionText), w = norm(want);
    return o === w || o.startsWith(w);
  }
  async function pickStrategy(want) {
    let parts = strategyParts();
    if (!parts) return { ok: false, error: '"Assign to strategy" field not found' };
    const shownOk = () => { const p = strategyParts(); return p && norm(displayedStrategy(p)).includes(norm(want)); };
    if (shownOk()) return { ok: true, shown: displayedStrategy(parts) };
    if (parts.native) {
      const opt = [...parts.native.options].find(o => matches(o.text, want));
      if (opt) { setNativeValue(parts.native, opt.value); await sleep(300); if (shownOk()) return { ok: true, shown: displayedStrategy(strategyParts()) }; }
    }
    if (!parts.trigger) return { ok: false, error: 'Strategy picker has no clickable trigger' };
    for (let attempt = 0; attempt < 3; attempt++) {
      parts = strategyParts();
      fireClick(parts.trigger); await sleep(450);
      parts = strategyParts();
      const cands = optionEls(parts).filter(e => matches(txt(e), want));
      if (!cands.length) { if (attempt === 2) break; continue; }
      const el = cands[0];
      try { el.scrollIntoView({ block: 'nearest' }); } catch {}
      fireClick(el); await sleep(450);
      if (shownOk()) return { ok: true, shown: displayedStrategy(strategyParts()) };
      if (el.parentElement) { fireClick(el.parentElement); await sleep(450); if (shownOk()) return { ok: true, shown: displayedStrategy(strategyParts()) }; }
    }
    const p = strategyParts();
    const seen = optionEls(p).map(e => txt(e)).slice(0, 6).join(' | ');
    return { ok: false, error: 'Could not select "' + want + '" (picker shows "' + displayedStrategy(p).slice(0, 60) + '"; options seen: ' + (seen || 'none') + ')' };
  }

  async function readStrategyOptions() {
    let parts = strategyParts();
    if (!parts) return { kind: 'not found', options: [] };
    if (parts.native && [...parts.native.options].length > 1) return { kind: 'native select', options: [...parts.native.options].map(o => o.text.trim()) };
    if (!parts.trigger) return { kind: 'unknown widget', options: [] };
    fireClick(parts.trigger); await sleep(500);
    parts = strategyParts();
    const opts = optionEls(parts).map(e => txt(e)).filter(t => t && t.length < 90);
    fireClick(parts.trigger); await sleep(200);
    return { kind: parts.host ? 'custom list' : 'custom widget', options: [...new Set(opts)] };
  }

  /* ----- clicking Preview / Import ----- */
  async function waitEnabled(find, ms) {
    const t0 = Date.now(); let b = find();
    while (b && b.disabled && Date.now() - t0 < ms) { await sleep(500); b = find(); }
    return b;
  }
  async function click(which, m, shown) {
    const find = () => which === 'import' ? buttonByText('import', true) : buttonByText('preview first', false);
    const name = which === 'import' ? 'Import' : 'Preview First';
    let btn = await waitEnabled(find, 90000);              // the page keeps the button disabled while it reads/validates the file
    if (!btn) return { ok: false, error: name + ' button not found' };
    if (btn.disabled && which === 'import') {
      // some builds only enable Import after a successful preview: run it, then wait again
      const pv = buttonByText('preview first', false);
      if (pv && !pv.disabled) {
        const w0 = watch(60000); fireClick(pv); await w0;
        btn = await waitEnabled(find, 60000);
      }
    }
    if (!btn) return { ok: false, error: name + ' button not found' };
    if (btn.disabled) return { ok: false, error: name + ' button stayed disabled for 90s (file still being read, or the form is not valid)' };
    try { btn.scrollIntoView({ block: 'center' }); } catch {}
    const w = watch(m.timeoutMs || 120000);
    fireClick(btn);
    const text = await w;
    if (!text) return { ok: false, error: 'No response from the page after clicking ' + which, message: '' };
    if (looksFailed(text)) return { ok: false, error: 'Page reported a problem', message: text };
    return { ok: true, message: text, shown };
  }

  /* ----- operations ----- */
  async function fill(m) {
    const steps = [];
    const done = o => Object.assign(o, { steps });
    if (!location.pathname.replace(/\/+$/, '').endsWith('/import')) return done({ ok: false, error: 'Open the Import Leads page first (you are on ' + location.pathname + ')' });
    if (!setFile(m.csv, m.filename)) return done({ ok: false, error: 'File upload box not found' });
    steps.push('file set');
    await sleep(500);
    let r = setCountry(m.country); if (!r.ok) return done(r);
    steps.push('country ' + m.country);
    await sleep(900);                                   // strategy list re-filters after country change
    r = await pickStrategy(m.strategy); if (!r.ok) return done(r);
    steps.push('strategy shows "' + (r.shown || '?').replace(/▾/g, '').trim() + '"');
    const auto = checkboxFor('Auto-scrape'); if (auto) setCheckbox(auto, !!m.autoscrape); steps.push('auto-scrape box ' + (auto ? 'found' : 'MISSING'));
    const skip = checkboxFor('Skip strategy filter'); if (skip) setCheckbox(skip, !!m.skip); steps.push('skip-filter box ' + (skip ? 'found' : 'MISSING'));
    const tags = [...document.querySelectorAll('input[type=text],input:not([type])')].find(i => /apollo|tag/i.test(i.placeholder || '') && visible(i));
    if (tags) setNativeValue(tags, m.tags || '');
    if (!document.body.innerText.includes(m.filename)) await sleep(1500);
    if (!document.body.innerText.includes(m.filename)) return done({ ok: false, error: 'File was not accepted by the page (name not shown)' });
    if (!m.click) return done({ ok: true, message: 'Form filled', shown: r.shown });
    // a dry run can only ever press Preview, never Import
    const which = m.dry ? 'preview' : m.click;
    steps.push('pressing ' + (which === 'import' ? 'Import' : 'Preview First') + (m.dry ? ' (dry run: Import blocked)' : ''));
    return done(await click(which, m, r.shown));
  }

  async function scan(m) {
    const out = { path: location.pathname, fileInput: !!document.querySelector('input[type=file]'), country: null, strategyKind: null, strategyOptions: [], buttons: [] };
    if (m.country) { const r = setCountry(m.country); out.country = r.ok ? 'set to ' + m.country : r.error; await sleep(900); }
    const so = await readStrategyOptions();
    out.strategyKind = so.kind; out.strategyOptions = so.options;
    out.buttons = ['preview first', 'import'].map(b => b + ': ' + (buttonByText(b, b === 'import') ? 'found' : 'MISSING'));
    out.autoScrapeBox = !!checkboxFor('Auto-scrape'); out.skipFilterBox = !!checkboxFor('Skip strategy filter');
    return { ok: true, scan: out };
  }

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    const run = m.type === 'ping' ? Promise.resolve({ ok: true, path: location.pathname })
      : m.type === 'scan' ? scan(m)
      : m.type === 'fill' ? fill(m)
      : m.type === 'import' ? (m.dry ? Promise.resolve({ ok: false, error: 'Dry run: Import is blocked' }) : click('import', m))
      : Promise.resolve({ ok: false, error: 'unknown message' });
    run.then(send).catch(e => send({ ok: false, error: String((e && e.message) || e) }));
    return true;
  });
})();
