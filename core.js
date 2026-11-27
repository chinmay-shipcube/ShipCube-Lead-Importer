/* ShipCube Lead Importer - core logic (CSV parse, classify, dedupe, split, per-file). Runs in the side panel and in Node (tests). */
(function (root) {
  'use strict';
  const STRATEGIES = ['Appliances','Arts, Crafts & Sewing','Automotive Parts & Accessories','Baby','Beauty & Personal Care','Cell Phones & Accessories','Clothing, Shoes & Jewelry','Computers & Accessories','Consulting','Consumer Electronics (approval-required)','Education','Electronics','Finance','Food & Beverage','General Trading','Handmade','Health & Household','Home & Kitchen','Industrial & Scientific','Logistics','Luggage & Travel Gear','Luxury Stores','Marketing','Media','Musical Instruments','Office Products','Patio, Lawn & Garden','Pet Supplies','Retail & E-commerce','Sports & Outdoors','Tools & Home Improvement','Toys & Games','Trading & Import/Export'];

  const MAP_SOURCE = {
    'Industrial & Scientific': ['machinery','mechanical or industrial engineering','plastics','industrial automation','chemicals','mining & metals','nanotechnology','shipbuilding','railroad manufacture','research','packaging & containers','printing','environmental services','renewables & environment','oil & energy','utilities','aviation & aerospace','defense & space','military'],
    'Electronics': ['electrical/electronic manufacturing','semiconductors','consumer electronics'],
    'Computers & Accessories': ['computer hardware'],
    'Cell Phones & Accessories': ['telecommunications','wireless'],
    'Consulting': ['information technology & services','computer software','computer networking','computer & network security','management consulting','human resources','staffing & recruiting','legal services','law practice','translation & localization','outsourcing/offshoring','think tanks','public policy','program development','executive office','government administration','government relations','international affairs','nonprofit organization management','civic & social organization','philanthropy','political organization','security & investigations','public safety','real estate','commercial real estate','information services'],
    'Marketing': ['marketing & advertising','events services','market research','public relations & communications','graphic design','photography'],
    'Media': ['media production','entertainment','motion pictures & film','animation','publishing','newspapers','writing & editing','online media','performing arts','museums & institutions'],
    'Retail & E-commerce': ['retail','supermarkets','internet','consumer services'],
    'Trading & Import/Export': ['import & export','international trade & development'],
    'General Trading': ['wholesale','consumer goods','tobacco','hospitality'],
    'Clothing, Shoes & Jewelry': ['apparel & fashion','textiles'],
    'Luxury Stores': ['luxury goods & jewelry'],
    'Beauty & Personal Care': ['cosmetics'],
    'Health & Household': ['medical devices','pharmaceuticals','hospital & health care','medical practice','alternative medicine','mental health care','biotechnology','health, wellness & fitness','individual & family services'],
    'Pet Supplies': ['veterinary'],
    'Sports & Outdoors': ['sports','sporting goods','recreational facilities & services'],
    'Luggage & Travel Gear': ['leisure, travel & tourism'],
    'Home & Kitchen': ['furniture'],
    'Tools & Home Improvement': ['building materials','construction','glass, ceramics & concrete','architecture & planning','civil engineering','facilities services'],
    'Food & Beverage': ['food production','food & beverages','dairy','restaurants','wine & spirits','fishery','farming','ranching'],
    'Patio, Lawn & Garden': ['agriculture'],
    'Logistics': ['logistics & supply chain','warehousing','transportation/trucking/railroad','package/freight delivery','maritime','airlines/aviation'],
    'Automotive Parts & Accessories': ['automotive'],
    'Finance': ['financial services','banking','insurance','investment management','venture capital & private equity','investment banking','capital markets','accounting','fund-raising'],
    'Education': ['education management','higher education','primary/secondary education','e-learning','professional training & coaching'],
    'Office Products': ['business supplies & equipment','paper & forest products'],
    'Arts, Crafts & Sewing': ['arts & crafts','fine art','design'],
    'Musical Instruments': ['music'],
    'Toys & Games': ['computer games','gambling & casinos']
  };
  const KEYWORDS = [
    [/\b(toy|toys|plush|puzzle|board game)\b/, 'Toys & Games'], [/\b(baby|infant|stroller|diaper)\b/, 'Baby'], [/\b(pet|dog|cat supplies)\b/, 'Pet Supplies'],
    [/\b(furniture|sofa|mattress|kitchenware|cookware|home textile)\b/, 'Home & Kitchen'], [/\b(cosmetic|skincare|makeup|beauty)\b/, 'Beauty & Personal Care'],
    [/\b(garment|apparel|clothing|shoes|footwear|jewelry|jewellery|fashion)\b/, 'Clothing, Shoes & Jewelry'], [/\b(food|beverage|tea|snack|seafood|sauce)\b/, 'Food & Beverage'],
    [/\b(led|lighting|pcb|electronic|electronics|circuit|battery|charger|cable)\b/, 'Electronics'], [/\b(machine|machinery|cnc|valve|pump|bearing|steel|plastic|mold|mould|industrial)\b/, 'Industrial & Scientific'],
    [/\b(logistics|freight|forwarder|shipping)\b/, 'Logistics'], [/\b(auto parts|automotive|car accessories)\b/, 'Automotive Parts & Accessories'], [/\b(medical|health|hospital|pharma)\b/, 'Health & Household'],
    [/\b(sport|sports|fitness|outdoor|camping)\b/, 'Sports & Outdoors'], [/\b(stationery|office supplies)\b/, 'Office Products'], [/\b(tool|tools|hardware|building material)\b/, 'Tools & Home Improvement']
  ];
  function buildMap(source) { const map = {}; for (const [s, inds] of Object.entries(source)) for (const i of inds) map[i.toLowerCase()] = s; return map; }
  const DEFAULT_MAP = buildMap(MAP_SOURCE);
  function mapToText(map) { return Object.keys(map).sort().map(k => k + ' = ' + map[k]).join('\n'); }
  function mapFromText(text) {
    const map = {};
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const i = line.lastIndexOf('='); if (i < 1) continue;
      const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
      if (k && v) map[k] = v;
    }
    return map;
  }

  function parseCSV(text) {
    text = text.replace(/\u0000/g, '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], field = '', inQ = false; const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (!(row.length === 1 && row[0] === '')) rows.push(row); }
    return rows;
  }
  function csvLine(fields) { return fields.map(f => (/[",\r\n]/.test(f) ? '"' + f.replace(/"/g, '""') + '"' : f)).join(','); }
  function normDomain(site) {
    let s = String(site || '').trim().toLowerCase(); if (!s) return '';
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, ''); return s.split(/[\/?#]/)[0];
  }
  function classify(industry, text, map, unmapped) {
    const k = String(industry || '').trim().toLowerCase();
    if (k && map[k]) return { strategy: map[k], via: 'industry' };
    const t = String(text || '').toLowerCase();
    for (const [re, s] of KEYWORDS) if (re.test(t)) return { strategy: s, via: 'keyword' };
    if (unmapped && unmapped !== 'skip') return { strategy: unmapped, via: 'default' };
    return null;
  }
  function colIndex(header) { const idx = {}; header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; }); return idx; }

  /* ---- split mode ---- */
  function createSession(opts) {
    return {
      opts: Object.assign({ country: 'China', dedupe: true, dropNoSite: true, skipOtherCountries: true, unmapped: 'General Trading', map: DEFAULT_MAP }, opts || {}),
      header: null, headerIdx: null, seen: new Set(), buckets: new Map(),
      stats: { files: 0, rows: 0, noSite: 0, otherCountry: 0, dup: 0, skippedUnmapped: 0, kept: 0, viaKeyword: 0, viaDefault: 0 }, perFile: []
    };
  }
  function addFile(session, name, text) {
    const rows = parseCSV(text);
    if (!rows.length) return { name, rows: 0, kept: 0 };
    const header = rows[0], idx = colIndex(header);
    if (idx['website'] === undefined) throw new Error(name + ': no "Website" column');
    if (!session.header) { session.header = header; session.headerIdx = idx; }
    const master = session.headerIdx;
    const same = header.length === session.header.length && header.every((h, i) => h === session.header[i]);
    const remap = same ? null : session.header.map(h => idx[h.trim().toLowerCase()]);
    const o = session.opts, st = session.stats; let kept = 0; st.files++;
    for (let r = 1; r < rows.length; r++) {
      let row = rows[r]; if (remap) row = remap.map(i => (i === undefined ? '' : row[i] || ''));
      st.rows++;
      const domain = normDomain((row[master['website']] || '').trim());
      if (o.dropNoSite && !domain) { st.noSite++; continue; }
      const country = (row[master['company country']] || '').trim();
      if (o.skipOtherCountries && o.country && country && country.toLowerCase() !== o.country.toLowerCase()) { st.otherCountry++; continue; }
      if (o.dedupe && domain) { if (session.seen.has(domain)) { st.dup++; continue; } session.seen.add(domain); }
      const industry = row[master['industry']] || '';
      const c = classify(industry, (row[master['keywords']] || '') + ' ' + (row[master['short description']] || ''), o.map, o.unmapped);
      if (!c) { st.skippedUnmapped++; continue; }
      if (c.via === 'keyword') st.viaKeyword++; if (c.via === 'default') st.viaDefault++;
      let b = session.buckets.get(c.strategy); if (!b) { b = { lines: [], doms: [], ind: new Map() }; session.buckets.set(c.strategy, b); }
      while (row.length < session.header.length) row.push('');
      b.lines.push(csvLine(row)); b.doms.push(domain);
      const ik = industry.trim().toLowerCase() || '(blank)'; b.ind.set(ik, (b.ind.get(ik) || 0) + 1);
      kept++; st.kept++;
    }
    const info = { name, rows: rows.length - 1, kept }; session.perFile.push(info); return info;
  }
  function topIndustries(bucket, n) { return [...bucket.ind.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => k + ' ' + v); }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function makeParts(session, maxRows, include) {
    const out = [];
    for (const [strategy, b] of [...session.buckets.entries()].sort((a, b) => b[1].lines.length - a[1].lines.length)) {
      if (include && !include.has(strategy)) continue;
      const n = b.lines.length, parts = Math.max(1, Math.ceil(n / maxRows)), size = Math.ceil(n / parts);
      for (let p = 0; p < parts; p++) {
        const start = p * size, end = Math.min(n, start + size); if (end <= start) continue;
        out.push({ strategy, part: p + 1, of: parts, start, end, rows: end - start, filename: slug(strategy) + (parts > 1 ? '_part' + (p + 1) + 'of' + parts : '') + '.csv', key: strategy + '|' + (p + 1) + '/' + parts + '|' + (end - start) + '|' + b.doms[start] });
      }
    }
    return out;
  }
  function buildCsv(session, d) { const b = session.buckets.get(d.strategy); return csvLine(session.header) + '\n' + b.lines.slice(d.start, d.end).join('\n') + '\n'; }

  /* ---- per-file mode ---- */
  const PRESET = {0:'Industrial & Scientific',1:'Industrial & Scientific',2:'Industrial & Scientific',3:'Industrial & Scientific',4:'Electronics',5:'Clothing, Shoes & Jewelry',6:'Clothing, Shoes & Jewelry',7:'Trading & Import/Export',8:'Beauty & Personal Care',9:'Beauty & Personal Care',10:'Electronics',11:'Electronics',12:'Electronics',13:'Electronics',14:'Electronics',15:'General Trading',16:'Food & Beverage',17:'Food & Beverage',18:'Consulting',19:'Logistics',20:'Logistics',21:'Electronics',22:'Electronics',23:'Electronics',24:'Food & Beverage',25:'Food & Beverage',26:'Health & Household',27:'Electronics',28:'Health & Household',29:'Health & Household',30:'Health & Household',31:'Home & Kitchen',32:'Home & Kitchen',33:'Retail & E-commerce',34:'Home & Kitchen',35:'Home & Kitchen',36:'Home & Kitchen',37:'Home & Kitchen',38:'Luxury Stores',39:'Health & Household',40:'Logistics',41:'Industrial & Scientific',42:'Sports & Outdoors',43:'Sports & Outdoors'};
  function presetFor(name) { const m = /^apollo-accounts-export(?: \((\d+)\))?\.csv$/i.exec(name); return m ? (PRESET[m[1] ? +m[1] : 0] || null) : null; }
  function dominant(rows, map, unmapped) {
    if (rows.length < 2) return { rows: 0, top: null, pct: 0 };
    const idx = colIndex(rows[0]), counts = new Map(); let n = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; n++;
      const c = classify(row[idx['industry']] || '', (row[idx['keywords']] || '') + ' ' + (row[idx['short description']] || ''), map, unmapped);
      if (c) counts.set(c.strategy, (counts.get(c.strategy) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { rows: n, top: sorted[0] ? sorted[0][0] : null, pct: sorted[0] ? sorted[0][1] / n : 0, second: sorted[1] ? sorted[1][0] : null };
  }

  const api = { STRATEGIES, MAP_SOURCE, DEFAULT_MAP, KEYWORDS, PRESET, presetFor, dominant, buildMap, mapToText, mapFromText, parseCSV, csvLine, normDomain, classify, createSession, addFile, makeParts, buildCsv, topIndustries, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LeadCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
