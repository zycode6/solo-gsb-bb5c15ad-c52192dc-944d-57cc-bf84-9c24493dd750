'use strict';

/* global RangeParser, UnicodeBlocks, GlyphDetector */

const UB = window.UnicodeBlocks;
const RP = window.RangeParser;
const detector = new GlyphDetector();

const state = {
  fonts: [],
  selectedFont: null,
  families: null,
  scan: null,        // 当前展示的检测结果
  savedScanId: null,
  scanHandle: null,
  cmapSet: null,
  scans: []
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = UB.hex;

// ---------------- Tab 切换 ----------------
$$('#tabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#tabs .tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#tab-' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'history') loadHistory();
  if (t.dataset.tab === 'compare') loadCompareOptions();
}));

// ---------------- 预置范围 ----------------
const PRESETS = [
  ['ASCII', 'U+0020–U+007E'],
  ['Latin+', 'U+00A0–U+024F'],
  ['Greek', 'U+0370–U+03FF'],
  ['Cyrillic', 'U+0400–U+04FF'],
  ['Arabic', 'U+0600–U+06FF'],
  ['Hebrew', 'U+0590–U+05FF'],
  ['Devanagari', 'U+0900–U+097F'],
  ['Thai', 'U+0E00–U+0E7F'],
  ['Hiragana', 'U+3040–U+309F'],
  ['Katakana', 'U+30A0–U+30FF'],
  ['CJK', 'U+4E00–U+9FFF'],
  ['CJK Ext-A', 'U+3400–U+4DBF'],
  ['Hangul', 'U+AC00–U+D7AF'],
  ['常用标点符号', 'U+2000–U+27BF'],
  ['Emoji', 'U+1F300–U+1FAFF, U+2600–U+26FF, U+2700–U+27BF'],
  ['全常用脚本合集', 'Latin; Greek; Cyrillic; Arabic; Hebrew; Thai; Devanagari; Hiragana; Katakana; Hangul; CJK']
];
$('#range-presets').innerHTML = PRESETS.map(([label, v]) =>
  `<button class="preset" data-range="${esc(v)}">${esc(label)}</button>`).join('');
$('#range-presets').addEventListener('click', e => {
  const b = e.target.closest('.preset');
  if (!b) return;
  $('#range-input').value = b.dataset.range;
});

// ---------------- 字体上传 ----------------
const drop = $('#file-drop');
const fileInput = $('#font-file');
let pickedFile = null;
drop.addEventListener('click', e => { if (e.target.tagName !== 'INPUT') fileInput.click(); });
;['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
;['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
function setFile(f) {
  pickedFile = f;
  $('#drop-name').textContent = `${f.name}（${(f.size / 1024 / 1024).toFixed(2)} MB）`;
  $('#upload-btn').disabled = false;
}

$('#upload-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!pickedFile) return;
  const btn = $('#upload-btn');
  btn.disabled = true;
  btn.textContent = '解析中…';
  try {
    const fd = new FormData();
    fd.append('font', pickedFile);
    const r = await fetch('/api/fonts', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '上传失败');
    $('#upload-notice').textContent =
      (j.deduped ? '该字体已存在（sha256 去重），已直接选用。' : `上传成功：${j.font.family_name}`) +
      (j.notice ? '\n' + j.notice : '');
    await loadFonts(j.id);
  } catch (err) {
    $('#upload-notice').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '上传并解析';
  }
});

async function loadFonts(selectId) {
  const r = await fetch('/api/fonts');
  state.fonts = await r.json();
  // 卡片列表
  $('#font-list').innerHTML = state.fonts.map(f => `
    <div class="font-item">
      <div>
        <div class="fname">${esc(f.family_name || f.name)}</div>
        <div class="fmeta">${esc(f.format)} · ${f.num_glyphs || '?'} glyphs · cmap ${f.cmap_size} · ${(f.file_size / 1024 / 1024).toFixed(2)} MB${f.version ? ' · v' + esc(f.version) : ''}</div>
      </div>
      <div>
        <button class="btn small" data-use="${f.id}">选用</button>
        <button class="btn small danger" data-del="${f.id}">删除</button>
      </div>
    </div>`).join('') || '<div class="muted">还没有上传字体</div>';

  const sel = $('#font-select');
  sel.innerHTML = state.fonts.map(f =>
    `<option value="${f.id}">#${f.id} ${esc(f.family_name || f.name)}${f.version ? ' v' + esc(f.version) : ''}</option>`).join('');
  if (selectId) sel.value = String(selectId);
  onSelectFont();
}

$('#font-list').addEventListener('click', async e => {
  const use = e.target.dataset.use;
  const del = e.target.dataset.del;
  if (use) { $('#font-select').value = use; onSelectFont(); }
  if (del && confirm('删除该字体及其全部扫描记录？')) {
    await fetch('/api/fonts/' + del, { method: 'DELETE' });
    loadFonts();
  }
});
$('#font-select').addEventListener('change', onSelectFont);

function onSelectFont() {
  const id = Number($('#font-select').value);
  state.selectedFont = state.fonts.find(f => f.id === id) || null;
  const f = state.selectedFont;
  $('#font-meta').textContent = f
    ? `#${f.id}  ${f.family_name}\nPostScript: ${f.postscript || '-'}\n版本: ${f.version || '-'}\n格式: ${f.format} · 字形数: ${f.num_glyphs} · cmap 码点: ${f.cmap_size}`
    : '未选择字体';
}

$('#detect-installed').addEventListener('click', async () => {
  $('#installed-hint').textContent = '探测中…';
  const fams = await detector.probeAvailableFamilies();
  state.families = fams;
  $('#installed-hint').innerHTML =
    `当前浏览器可用候选字体（${fams.length}）：${fams.map(esc).join(', ')}`;
});

// ---------------- 范围预览 ----------------
$('#preview-range').addEventListener('click', previewRange);
function previewRange() {
  const spec = RP.parse($('#range-input').value);
  const box = $('#range-preview');
  if (spec.errors.length) {
    box.innerHTML = spec.errors.map(e => `<div class="rp-err">⚠ ${esc(e)}</div>`).join('');
    return null;
  }
  const exp = RP.expand(spec, { limit: 200000 });
  const byScript = new Map();
  for (const cp of exp.codepoints) {
    const blk = UB.findBlock(cp);
    const s = blk ? blk.script : 'Unassigned';
    byScript.set(s, (byScript.get(s) || 0) + 1);
  }
  box.innerHTML = `
    <div class="muted small">共 <b>${exp.total}</b> 个可渲染码点${exp.truncated ? '（超过上限已截断）' : ''}，区间 ${spec.ranges.length} 段，散点 ${spec.codepoints.length} 个</div>
    <div class="rp-grid">${[...byScript.entries()].sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `<span class="rp-chip">${esc(s)} <b>${n}</b></span>`).join('')}</div>`;
  return exp;
}

// ---------------- 执行检测 ----------------
$('#run-scan').addEventListener('click', runScan);
$('#cancel-scan').addEventListener('click', () => state.scanHandle && state.scanHandle.cancel());

async function runScan() {
  const font = state.selectedFont;
  if (!font) return alert('请先上传并选择字体');
  const spec = RP.parse($('#range-input').value);
  if (spec.errors.length) return alert('范围有误：\n' + spec.errors.join('\n'));
  const exp = RP.expand(spec, { limit: 120000 });
  if (!exp.codepoints.length) return alert('范围内没有可检测码点');
  if (exp.total > 50000 &&
      !confirm(`范围包含 ${exp.total} 个码点，浏览器实测可能需要几分钟。继续？`)) return;

  const px = Math.max(10, Math.min(72, Number($('#opt-px').value) || 28));
  const identify = $('#opt-probe-fonts').checked;
  const crossCmap = $('#opt-cmap').checked;

  $('#run-scan').disabled = true;
  $('#scan-progress-card').classList.remove('hidden');
  $('#progress-bar').style.width = '0%';

  try {
    const targetFamily = await detector.loadFont(font.id, font.format);

    // 候选字体
    const custom = $('#fallback-stack').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    let candidates = ['serif', 'sans-serif', 'monospace'];
    if (identify) {
      const avail = state.families || await detector.probeAvailableFamilies();
      candidates = [...new Set([...custom.filter(f =>
        ['serif', 'sans-serif', 'monospace'].includes(f) || avail.includes(f)), ...avail])];
    } else {
      candidates = [...new Set([...custom, ...candidates])];
    }

    // cmap 声明集合：检测分类（非标准 notdef 判定）与对照都需要，始终加载
    state.cmapSet = null;
    state.cmapNotdefSet = null;
    {
      const r = await fetch(`/api/fonts/${font.id}/cmap`);
      const j = await r.json();
      state.cmapSet = new Set(j.codepoints);
      state.cmapNotdefSet = new Set(j.notdef_codepoints || []);
    }

    const t0 = performance.now();
    const handle = detector.scan({
      targetFamily,
      codepoints: exp.codepoints,
      px,
      candidates,
      cmap: state.cmapSet,
      cmapNotdef: state.cmapNotdefSet,
      identifyFallback: identify,
      onProgress: (done, total, t) => {
        $('#progress-bar').style.width = (done / total * 100).toFixed(1) + '%';
        $('#progress-text').textContent =
          `${done} / ${total}　覆盖 ${t.covered} · 回退 ${t.fallback} · 缺失 ${t.missing}` +
          (t.blank ? ` · 不可见 ${t.blank}` : '');
        $('#live-stats').innerHTML = statsHtml(t);
      }
    });
    state.scanHandle = handle;

    const out = await handle.done;
    state.scanHandle = null;
    if (out.cancelled) return;

    state.scan = {
      font,
      rangeSpec: $('#range-input').value,
      options: { px, candidates, identifyFallback: identify, crossCmap, truncated: exp.truncated },
      results: out.results,
      totals: out.totals,
      elapsedMs: Math.round(performance.now() - t0),
      cmapSet: state.cmapSet
    };
    state.savedScanId = null;
    $('#save-scan').disabled = false;
    $('#export-json').disabled = false;
    renderResults();
    $$('#tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'results'));
    $$('.panel').forEach(x => x.classList.toggle('active', x.id === 'tab-results'));
  } catch (e) {
    alert('检测失败：' + e.message);
  } finally {
    $('#run-scan').disabled = false;
    $('#scan-progress-card').classList.add('hidden');
  }
}

function statsHtml(t) {
  const total = Math.max(1, t.covered + t.fallback + t.missing);
  return `
    <div class="stat covered"><div class="num">${t.covered}</div><div class="lbl">已覆盖</div></div>
    <div class="stat fallback"><div class="num">${t.fallback}</div><div class="lbl">回退渲染</div></div>
    <div class="stat missing"><div class="num">${t.missing}</div><div class="lbl">缺失</div></div>
    <div class="stat rate"><div class="num">${(t.covered / total * 100).toFixed(1)}%</div><div class="lbl">覆盖率</div></div>`;
}

// ---------------- 结果分组渲染 ----------------
function groupByScript(results, cmapSet) {
  const scripts = new Map();
  for (const r of results) {
    const blk = UB.findBlock(r.codepoint);
    const sName = blk ? blk.script : 'Unassigned';
    const bName = blk ? blk.name : 'Unassigned';
    if (!scripts.has(sName)) scripts.set(sName, new Map());
    const blocks = scripts.get(sName);
    if (!blocks.has(bName)) blocks.set(bName, { total: 0, covered: 0, fallback: 0, missing: 0, items: [] });
    const g = blocks.get(bName);
    g.total++;
    g[r.status === 'covered' ? 'covered' : r.status === 'fallback' ? 'fallback' : 'missing']++;
    const cmap = cmapSet ? cmapSet.has(r.codepoint) : null;
    g.items.push({ ...r, cmap_covered: cmap });
  }
  const out = [];
  for (const [script, blocks] of scripts) {
    const bs = [];
    let total = 0, covered = 0, fallback = 0, missing = 0;
    for (const [block, g] of blocks) {
      total += g.total; covered += g.covered; fallback += g.fallback; missing += g.missing;
      bs.push({ block, ...g });
    }
    out.push({ script, total, covered, fallback, missing,
               rate: covered / total, blocks: bs.sort((a, b) => b.missing - a.missing || b.total - a.total) });
  }
  return out.sort((a, b) => b.missing - a.missing || b.fallback - a.fallback || b.total - a.total);
}

function renderResults() {
  const s = state.scan;
  if (!s) return;
  const t = s.totals;
  $('#results-title').textContent =
    `检测结果：${s.font.family_name}${state.savedScanId ? `（扫描 #${state.savedScanId}，已入库）` : ''}`;
  $('#result-summary').innerHTML = `
    <div class="stat covered"><div class="num">${t.covered}</div><div class="lbl">已覆盖</div></div>
    <div class="stat fallback"><div class="num">${t.fallback}</div><div class="lbl">回退渲染</div></div>
    <div class="stat missing"><div class="num">${t.missing}</div><div class="lbl">缺失</div></div>
    <div class="stat rate"><div class="num">${(t.covered / Math.max(1, t.total) * 100).toFixed(2)}%</div><div class="lbl">覆盖率</div></div>
    <div class="stat"><div class="num">${t.total}</div><div class="lbl">样本码点</div></div>
    <div class="stat"><div class="num">${(s.elapsedMs / 1000).toFixed(1)}s</div><div class="lbl">实测耗时</div></div>`;

  // cmap 冲突告警
  let warn = [];
  if (crossCmap && s.cmapSet) {
    let saysNoMissing = 0, saysNoButCovered = 0;
    for (const r of s.results) {
      if (r.blank) continue;
      const inMap = s.cmapSet.has(r.codepoint);
      if (inMap && r.status !== 'covered') saysNoMissing++;
      if (!inMap && r.status === 'covered') saysNoButCovered++;
    }
    if (saysNoMissing) warn.push(`⚠ ${saysNoMissing} 个码点 cmap 声明覆盖但浏览器实测未由该字体渲染（可能是空 glyph/.notdef 映射）`);
    if (saysNoButCovered) warn.push(`ℹ ${saysNoButCovered} 个码点 cmap 未声明但实测有字形（罕见，可复查）`);
  }
  if (t.blank) warn.push(`ℹ ${t.blank} 个码点无可见墨迹（组合记号/控制符），已按 cmap 归属分类`);
  if (s.options.truncated) warn.push('⚠ 范围超过 120000 码点上限，结果已截断');
  $('#result-warnings').textContent = warn.join('\n');

  renderGroups();
}

$('#show-covered').addEventListener('change', renderGroups);

function renderGroups() {
  const s = state.scan;
  if (!s) return;
  const showCovered = $('#show-covered').checked;
  const groups = groupByScript(s.results, s.cmapSet);
  const maxCells = 400;

  $('#script-groups').innerHTML = groups.map(g => {
    const pct = n => (n / g.total * 100).toFixed(1);
    const blocksHtml = g.blocks.map(b => {
      const gapItems = b.items.filter(r => r.status !== 'covered');
      const shownItems = showCovered ? b.items : gapItems;
      const truncated = shownItems.length > maxCells;
      const cells = shownItems.slice(0, maxCells).map(cellHtml).join('');
      if (!shownItems.length) return `<div class="block-group"><div class="block-name"><span>${esc(b.block)}</span><span>无缺口 ✓</span></div></div>`;
      return `<div class="block-group">
        <div class="block-name">
          <span>${esc(b.block)}</span>
          <span>覆盖 ${b.covered}/${b.total} · 回退 ${b.fallback} · 缺失 ${b.missing}
          ${truncated ? ` · 仅显示前 ${maxCells} 个` : ''}</span>
        </div>
        <div class="glyph-grid">${cells}</div>
      </div>`;
    }).join('');

    return `<div class="script-group ${g.missing + g.fallback > 0 ? 'open' : ''}">
      <div class="script-head">
        <span class="caret">▶</span>
        <span class="script-name">${esc(g.script)}</span>
        <span class="script-bar">
          <i class="c" style="width:${pct(g.covered)}%"></i>
          <i class="f" style="width:${pct(g.fallback)}%"></i>
          <i class="m" style="width:${pct(g.missing)}%"></i>
        </span>
        <span class="script-counts">
          <b>${g.covered}</b> 覆盖 · <b>${g.fallback}</b> 回退 · <b>${g.missing}</b> 缺失 · ${g.total} 总
        </span>
      </div>
      <div class="script-body">${blocksHtml}</div>
    </div>`;
  }).join('');

  $$('.script-head').forEach(h => h.addEventListener('click', () =>
    h.parentElement.classList.toggle('open')));
}

function cellHtml(r) {
  const ch = String.fromCodePoint(r.codepoint);
  const inMap = r.cmap_covered;
  const conflict = inMap === true && r.status !== 'covered';
  const tip = [
    `${hex(r.codepoint)} ${esc(ch)}`,
    r.status === 'covered' ? '已覆盖（目标字体渲染）'
      : r.status === 'fallback' ? `回退字体：${esc(r.detected_font || 'unknown')}`
      : '缺失（所有字体均 .notdef）',
    inMap !== null ? (inMap ? 'cmap：声明覆盖' : 'cmap：未声明') : '',
    conflict ? '⚠ 声明覆盖但实测缺失' : ''
  ].filter(Boolean).join('<br>');
  return `<div class="glyph-cell ${r.status}${conflict ? ' cmap-conflict' : ''}">
    <span class="ch">${esc(ch)}</span>
    <span class="cp">${hex(r.codepoint).replace('U+', '')}</span>
    <span class="tip">${tip}</span>
  </div>`;
}

// ---------------- 保存扫描 / 导出 ----------------
$('#save-scan').addEventListener('click', async () => {
  const s = state.scan;
  if (!s || state.savedScanId) return;
  const label = prompt('为本次检测加个标签（可选）：',
    `${s.font.family_name} @ ${new Date().toLocaleString()}`);
  const r = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      font_id: s.font.id,
      label: label || null,
      range_spec: s.rangeSpec,
      options: s.options,
      results: s.results.map(x => ({
        codepoint: x.codepoint, status: x.status,
        detected_font: x.detected_font || null
      }))
    })
  });
  const j = await r.json();
  if (!r.ok) return alert(j.error || '保存失败');
  state.savedScanId = j.id;
  renderResults();
});

$('#export-json').addEventListener('click', () => {
  const s = state.scan;
  if (!s) return;
  // 已入库则下载服务端完整报告；否则在浏览器本地生成同构报告
  if (state.savedScanId) {
    location.href = `/api/reports/scans/${state.savedScanId}.json`;
    return;
  }
  const report = buildReport(s);
  downloadJson(report, `coverage-${s.font.family_name.replace(/[^\w.-]+/g, '_')}-${Date.now()}.json`);
});

function buildReport(s) {
  const t = s.totals;
  const groups = groupByScript(s.results, s.cmapSet);
  return {
    report: 'font-coverage-scan',
    generated_at: new Date().toISOString(),
    engine: 'browser-canvas-glyph-fingerprint',
    font: {
      id: s.font.id, family_name: s.font.family_name, postscript: s.font.postscript,
      version: s.font.version, format: s.font.format, num_glyphs: s.font.num_glyphs
    },
    scan: {
      label: null, range_spec: s.rangeSpec, options: s.options,
      sample_size: t.total, covered_count: t.covered, fallback_count: t.fallback,
      missing_count: t.missing, blank_count: t.blank || 0,
      coverage_rate: +(t.covered / Math.max(1, t.total) * 100).toFixed(2),
      elapsed_ms: s.elapsedMs
    },
    by_script: groups.map(g => ({
      script: g.script, total: g.total, covered: g.covered,
      fallback: g.fallback, missing: g.missing,
      coverage_rate: +(g.covered / g.total * 100).toFixed(2),
      blocks: g.blocks.map(b => ({
        block: b.block, total: b.total, covered: b.covered,
        fallback: b.fallback, missing: b.missing,
        coverage_rate: +(b.covered / b.total * 100).toFixed(2),
        gaps: b.items.filter(r => r.status !== 'covered').map(r => ({
          codepoint: hex(r.codepoint), char: String.fromCodePoint(r.codepoint),
          status: r.status, detected_font: r.detected_font,
          cmap_covered: r.cmap_covered
        }))
      }))
    })),
    results: s.results.map(r => ({
      codepoint: hex(r.codepoint), decimal: r.codepoint,
      char: String.fromCodePoint(r.codepoint),
      status: r.status, detected_font: r.detected_font,
      blank: !!r.blank,
      cmap_covered: r.cmap_covered !== undefined && r.cmap_covered !== null
        ? r.cmap_covered : null
    }))
  };
}

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- 历史 ----------------
async function loadHistory() {
  const [scans, fonts] = await Promise.all([
    fetch('/api/scans').then(r => r.json()),
    fetch('/api/fonts').then(r => r.json())
  ]);
  state.scans = scans;
  $('#scan-table tbody').innerHTML = scans.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${esc(s.label || '-')}</td>
      <td>${esc(s.font_family || ('#' + s.font_id))}</td>
      <td>${s.sample_size}</td>
      <td style="color:var(--green)">${s.covered_count}</td>
      <td style="color:var(--amber)">${s.fallback_count}</td>
      <td style="color:var(--red)">${s.missing_count}</td>
      <td>${esc(s.created_at)}</td>
      <td>
        <button class="btn small" data-load-scan="${s.id}">查看</button>
        <a class="btn small" href="/api/reports/scans/${s.id}.json">JSON</a>
        <button class="btn small danger" data-del-scan="${s.id}">删</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">暂无记录</td></tr>';

  $('#font-table tbody').innerHTML = fonts.map(f => `
    <tr>
      <td>${f.id}</td>
      <td>${esc(f.family_name || f.name)}</td>
      <td>${esc(f.version || '-')}</td>
      <td>${esc(f.format)}</td>
      <td>${f.num_glyphs || '-'}</td>
      <td>${f.cmap_size}</td>
      <td>${(f.file_size / 1024 / 1024).toFixed(2)} MB</td>
      <td><button class="btn small danger" data-del-font2="${f.id}">删除</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">暂无字体</td></tr>';
}

$('#scan-table').addEventListener('click', async e => {
  const loadId = e.target.dataset.loadScan;
  const delId = e.target.dataset.delScan;
  if (loadId) return loadScanIntoResults(Number(loadId));
  if (delId && confirm('删除该扫描记录？')) {
    await fetch('/api/scans/' + delId, { method: 'DELETE' });
    loadHistory();
  }
});
$('#font-table').addEventListener('click', async e => {
  const id = e.target.dataset.delFont2;
  if (id && confirm('删除该字体及其全部扫描记录？')) {
    await fetch('/api/fonts/' + id, { method: 'DELETE' });
    loadHistory();
    loadFonts();
  }
});

async function loadScanIntoResults(id) {
  const j = await fetch('/api/scans/' + id).then(r => r.json());
  state.scan = {
    font: j.font,
    rangeSpec: j.range_spec,
    options: safeJson(j.options_json),
    results: j.results.map(r => ({
      codepoint: r.codepoint, status: r.status,
      detected_font: r.detected_font,
      cmap_covered: !!r.cmap_covered
    })),
    totals: {
      total: j.sample_size, covered: j.covered_count,
      fallback: j.fallback_count, missing: j.missing_count
    },
    elapsedMs: 0,
    cmapSet: new Set(j.results.filter(r => r.cmap_covered).map(r => r.codepoint))
  };
  state.savedScanId = id;
  $('#save-scan').disabled = true;
  $('#export-json').disabled = false;
  renderResults();
  $$('#tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'results'));
  $$('.panel').forEach(x => x.classList.toggle('active', x.id === 'tab-results'));
}

// ---------------- 对比 ----------------
async function loadCompareOptions() {
  if (!state.scans.length) state.scans = await fetch('/api/scans').then(r => r.json());
  const opts = state.scans.map(s =>
    `<option value="${s.id}">#${s.id} ${esc(s.label || (s.font_family + ' ' + s.created_at))}</option>`).join('');
  $('#compare-a').innerHTML = opts;
  $('#compare-b').innerHTML = opts;
  if (state.scans[1]) $('#compare-a').value = state.scans[1].id;
  if (state.scans[0]) $('#compare-b').value = state.scans[0].id;
}

$('#run-compare').addEventListener('click', async () => {
  const a = $('#compare-a').value, b = $('#compare-b').value;
  if (!a || !b || a === b) return alert('请选择两次不同的扫描');
  const j = await fetch(`/api/compare/${a}/${b}`).then(r => r.json());
  if (j.error) return alert(j.error);
  $('#export-compare').classList.remove('hidden');
  $('#export-compare').href = `/api/reports/compare/${a}/${b}.json`;

  $('#compare-summary').innerHTML = `
    <div class="card">
      <div class="grid-two">
        <div>
          <h3>旧版本：${esc(j.before.font.family_name)} <span class="muted small">#${j.before.scan_id} · ${esc(j.before.font.version || '')}</span></h3>
          ${statsHtml(j.before.counts)}
        </div>
        <div>
          <h3>新版本：${esc(j.after.font.family_name)} <span class="muted small">#${j.after.scan_id} · ${esc(j.after.font.version || '')}</span></h3>
          ${statsHtml(j.after.counts)}
        </div>
      </div>
      <hr style="border-color:var(--border);margin:14px 0">
      <div class="summary">
        <div class="stat covered"><div class="num">+${j.summary.improved}</div><div class="lbl">改善（新覆盖 / 回退变覆盖）</div></div>
        <div class="stat missing"><div class="num">${j.summary.regressed}</div><div class="lbl">退化（新缺失）</div></div>
        <div class="stat fallback"><div class="num">${j.fallback_changed.length}</div><div class="lbl">回退字体发生变化</div></div>
      </div>
    </div>`;

  $('#compare-details').innerHTML = `
    <div class="card compare-col">
      <h3 style="color:var(--green)">改善 ${j.improved.length}</h3>
      <div>${j.improved.slice(0, 800).map(diffHtml('improved')).join('') || '<span class="muted">无</span>'}</div>
      ${j.improved.length > 800 ? `<div class="muted small">其余 ${j.improved.length - 800} 个见 JSON 报告</div>` : ''}
    </div>
    <div class="card compare-col">
      <h3 style="color:var(--red)">退化 ${j.regressed.length}</h3>
      <div>${j.regressed.slice(0, 800).map(diffHtml('regressed')).join('') || '<span class="muted">无</span>'}</div>
      ${j.regressed.length > 800 ? `<div class="muted small">其余 ${j.regressed.length - 800} 个见 JSON 报告</div>` : ''}
      <h3 style="color:var(--amber)">回退字体变化 ${j.fallback_changed.length}</h3>
      <div>${j.fallback_changed.slice(0, 400).map(d => `
        <span class="diff-item"><span class="ch">${esc(String.fromCodePoint(d.codepoint))}</span>
        <span class="cp">${hex(d.codepoint)}</span>
        <span class="diff-flow">${esc(d.before_font || '?')} → ${esc(d.after_font || '?')}</span></span>`).join('')}
      </div>
    </div>`;
});

function diffHtml(kind) {
  return d => `<span class="diff-item ${kind}">
    <span class="ch">${esc(String.fromCodePoint(d.codepoint))}</span>
    <span class="cp">${hex(d.codepoint)}</span>
    <span class="diff-flow">${statusZh(d.before)} → ${statusZh(d.after)}</span>
  </span>`;
}
function statusZh(s) { return { covered: '覆盖', fallback: '回退', missing: '缺失' }[s] || s; }

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// ---------------- 初始化 ----------------
loadFonts();
