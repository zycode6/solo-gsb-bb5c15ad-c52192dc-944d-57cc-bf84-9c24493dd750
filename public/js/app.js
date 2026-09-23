/**
 * 字体覆盖率实验台 —— 前端主逻辑（原生 ESM，无框架）。
 */
import { api, downloadJson, escapeHtml, fmtNum } from './api.js';
import { GlyphDetector, groupResults, STATUS_LABELS } from './detector.js';
import { parseRangeSpec, formatSegments, toHex, PRESET_NAMES } from '/shared/ranges.js';

const state = {
  fonts: [],
  detector: new GlyphDetector(),
  coverageDoc: null,
  compareDoc: null,
  running: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------------- 通用 UI ---------------- */

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function setProgress(prefixId, done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $(`#${prefixId}-progress-fill`).style.width = pct + '%';
  $(`#${prefixId}-progress-pct`).textContent = pct + '%';
  if (label) $(`#${prefixId}-progress-text`).textContent = label;
}

function statusPill(status) {
  const text = STATUS_LABELS[status] || status;
  return `<span class="pill ${status}">${escapeHtml(text)}</span>`;
}

/* ---------------- Tab 切换 ---------------- */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const view = tab.dataset.view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'reports') loadReports();
  });
});

/* ---------------- 字体选择 ---------------- */

function fontLabel(f) {
  const name = f.fullName || f.familyName || `字体 #${f.id}`;
  return `${name}（#${f.id} · ${f.format}）`;
}

async function loadFonts(selectId) {
  state.fonts = await api.listFonts();
  for (const id of ['coverage-font-select', 'compare-font-a', 'compare-font-b']) {
    const sel = $(`#${id}`);
    const prev = sel.value;
    sel.innerHTML =
      '<option value="">— 选择字体 —</option>' +
      state.fonts.map((f) => `<option value="${f.id}">${escapeHtml(fontLabel(f))}</option>`).join('');
    if (prev) sel.value = prev;
  }
}

function getFont(id) {
  return state.fonts.find((f) => f.id === Number(id));
}

function fontInfoHtml(f) {
  if (!f) return '<span class="muted">未选择</span>';
  const warn = f.parseWarning
    ? `<div class="warnings"><div>⚠ ${escapeHtml(f.parseWarning)}</div></div>` : '';
  return `
    <div class="name">${escapeHtml(f.fullName || f.familyName || '未知字体')}</div>
    <dl>
      <dt>字体 ID</dt><dd>#${f.id}</dd>
      <dt>家族 / 子族</dt><dd>${escapeHtml(f.familyName ?? '—')} / ${escapeHtml(f.subfamilyName ?? '—')}</dd>
      <dt>PostScript</dt><dd>${escapeHtml(f.postscriptName ?? '—')}</dd>
      <dt>版本</dt><dd>${escapeHtml(f.version ?? '—')}</dd>
      <dt>格式 / 大小</dt><dd>${escapeHtml(f.format)} · ${(f.fileSize / 1048576).toFixed(2)} MB</dd>
      <dt>cmap 声明</dt><dd>${fmtNum(f.cmapTotal)} 个码位（${(f.cmapRanges || []).length} 个连续区间）</dd>
    </dl>
    <button class="danger" data-delete-font="${f.id}">删除该字体</button>
    ${warn}`;
}

function bindFontInfo(selectId, infoId) {
  $(`#${selectId}`).addEventListener('change', () => {
    $(`#${infoId}`).innerHTML = fontInfoHtml(getFont($(`#${selectId}`).value));
    $(`#${infoId}`).classList.toggle('empty', !$(`#${selectId}`).value);
  });
}
bindFontInfo('coverage-font-select', 'coverage-font-info');
bindFontInfo('compare-font-a', 'compare-info-a');
bindFontInfo('compare-font-b', 'compare-info-b');

document.addEventListener('click', async (e) => {
  const id = e.target?.dataset?.deleteFont;
  if (!id) return;
  if (!confirm(`确认删除字体 #${id}？引用它的历史报告将解除关联。`)) return;
  await api.deleteFont(Number(id));
  await loadFonts();
  $('#coverage-font-info').className = 'font-info empty';
  $('#coverage-font-info').textContent = '尚未选择字体';
  $('#compare-info-a').innerHTML = '<span class="muted">未选择</span>';
  $('#compare-info-b').innerHTML = '<span class="muted">未选择</span>';
  toast('字体已删除');
});

/* 覆盖检测页上传 */
$('#coverage-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const bar = $('#coverage-upload-progress');
  bar.classList.remove('hidden');
  try {
    const saved = await api.uploadFont(file, (done, total) => {
      $('#coverage-upload-fill').style.width = Math.round((done / total) * 100) + '%';
    });
    await loadFonts();
    $('#coverage-font-select').value = saved.id;
    $('#coverage-font-select').dispatchEvent(new Event('change'));
    toast(saved.deduped ? '字体已存在，已复用记录' : `字体上传成功：${saved.fullName || saved.familyName}`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    bar.classList.add('hidden');
    $('#coverage-upload-fill').style.width = '0';
    e.target.value = '';
  }
});

/* 预设下拉 */
function fillPresets(selectId, targetId) {
  const sel = $(`#${selectId}`);
  sel.innerHTML += PRESET_NAMES.map((p) => `<option value="${p}">${p}</option>`).join('');
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const target = $(`#${targetId}`);
    target.value = target.value.trim() ? `${target.value.replace(/[,，]\s*$/, '')}, ${sel.value}` : sel.value;
    sel.value = '';
  });
}
fillPresets('coverage-preset', 'coverage-range');
fillPresets('compare-preset', 'compare-range');

/* ---------------- 覆盖检测 ---------------- */

const CAVEATS = [
  '检测在当前浏览器 / 操作系统中执行，回退字体取决于本机已安装的字体集合。',
  '回退字体名由「候选字体探针位图比对」启发式推断，极少数相似字体会产生误判。',
  '声明有码位但渲染为豆腐块 / 空白 / 回退的字形已标记为「声明异常 discrepancy」。',
];
const CAVEATS_CMAP = ['cmap 快速模式仅读取字体 cmap 表声明，不验证字形是否可正常渲染。'];

$('#coverage-run').addEventListener('click', () => runCoverage());

async function runCoverage() {
  if (state.running) return;
  const font = getFont($('#coverage-font-select').value);
  const rangeInput = $('#coverage-range').value;
  const mode = $('input[name="coverage-mode"]:checked').value;
  const warnBox = $('#coverage-warnings');
  warnBox.innerHTML = '';

  if (!font) return toast('请先选择或上传字体', true);
  let parsed;
  try {
    parsed = parseRangeSpec(rangeInput);
  } catch (err) {
    return toast(err.message, true);
  }
  warnBox.innerHTML = parsed.warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('');

  state.running = true;
  $('#coverage-run').disabled = true;
  $('#coverage-result').classList.add('hidden');
  const card = $('#coverage-progress-card');
  card.classList.remove('hidden');
  setProgress('coverage', 0, 1, '初始化…');

  try {
    const t0 = performance.now();
    const { results, summary, environment } = await state.detector.run(font, parsed.segments, {
      mode,
      onProgress: (done, total) =>
        setProgress('coverage', done, total, `检测中（${fmtNum(done)} / ${fmtNum(total)}）`),
    });
    const elapsedMs = Math.round(performance.now() - t0);

    const groups = groupResults(results)
      .map((g) => ({
        ...g,
        entries: g.entries
          .slice()
          .sort((a, b) => a.cp - b.cp)
          .map((r) => ({ ...r, hex: toHex(r.cp) })),
      }));

    summary.rate = summary.total
      ? Number((summary.covered / summary.total) * 100).toFixed(2) : 0;

    const doc = {
      reportType: 'font-coverage',
      schemaVersion: 1,
      title: `${font.familyName || font.fullName || `字体#${font.id}`} 覆盖检测 ${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date().toISOString(),
      elapsedMs,
      environment,
      font: pickFontDoc(font),
      request: {
        rangeInput,
        mode,
        segments: parsed.segments,
        rangesText: formatSegments(parsed.segments),
        count: parsed.count,
      },
      summary,
      groups,
      caveats: mode === 'cmap' ? CAVEATS_CMAP : CAVEATS,
    };
    state.coverageDoc = doc;
    renderCoverage(doc, $('#coverage-result'), { editable: true });
    $('#coverage-result').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    toast('检测失败：' + err.message, true);
  } finally {
    state.running = false;
    $('#coverage-run').disabled = false;
    card.classList.add('hidden');
  }
}

function pickFontDoc(f) {
  return {
    id: f.id,
    familyName: f.familyName,
    subfamilyName: f.subfamilyName,
    fullName: f.fullName,
    postscriptName: f.postscriptName,
    version: f.version,
    format: f.format,
    fileSize: f.fileSize,
    cmapTotal: f.cmapTotal,
  };
}

function renderCoverage(doc, container, { editable = false } = {}) {
  const s = doc.summary;
  const isCmap = doc.request.mode === 'cmap';

  const stat = (cls, num, lbl) =>
    `<div class="stat ${cls}"><div class="num">${fmtNum(num)}</div><div class="lbl">${lbl}</div></div>`;

  const missingTotal = s.missingTofu + s.missingBlank + s.missing;
  void missingTotal;
  container.innerHTML = `
    <div class="card result-head">
      <div class="row-between">
        <h2 style="margin:0">
          检测结果：${escapeHtml(doc.font.fullName || doc.font.familyName || `字体#${doc.font.id}`)}
          <span class="badge">${isCmap ? '仅 cmap 声明' : '真实渲染'}</span>
        </h2>
        <div class="actions" style="margin:0">
          <button class="ghost" data-export-coverage>导出 JSON</button>
          ${editable ? '<button class="primary" data-save-coverage>保存到报告库</button>' : ''}
        </div>
      </div>
      ${editable ? `<label class="select-label">报告标题
        <input type="text" id="coverage-title" value="${escapeHtml(doc.title)}" /></label>` : ''}
      <div class="rate-line">
        <strong>覆盖率</strong>
        <div class="bar"><div class="bar-fill" style="width:${s.rate}%"></div></div>
        <span class="pct">${s.rate}%</span>
      </div>
      <div class="stat-grid">
        ${stat('blue', s.total, '检测码位')}
        ${stat('green', s.covered, '已覆盖')}
        ${isCmap ? stat('red', s.missing, '未声明缺字') : stat('amber', s.fallback, '回退渲染')}
        ${isCmap ? '' : stat('red', s.missingTofu, '豆腐块缺字')}
        ${isCmap ? '' : stat('red', s.missingBlank, '空白缺字')}
        ${stat('purple', s.discrepancy, '声明异常')}
      </div>
      ${renderFallbackSummary(s, isCmap)}
      <div class="env-box">
        范围：${escapeHtml(doc.request.rangesText.slice(0, 400))}${doc.request.rangesText.length > 400 ? ' …' : ''}
        ｜ 共 ${fmtNum(doc.request.count)} 码位
        ｜ 耗时 ${fmtNum(doc.elapsedMs ?? 0)} ms
        ｜ 环境：${escapeHtml((doc.environment?.userAgent || '').slice(0, 90))}
      </div>
      ${renderCaveats(doc.caveats)}
    </div>

    <div class="legend">
      <span><i class="dot green"></i>已覆盖</span>
      <span><i class="dot amber"></i>回退渲染</span>
      <span><i class="dot red"></i>缺字</span>
      <span>点击分组标题可折叠</span>
    </div>
    <div class="filter-row" id="coverage-filters">
      <button class="chip active" data-filter="all">全部缺口</button>
      ${isCmap ? '' : '<button class="chip" data-filter="fallback">仅回退</button>'}
      <button class="chip" data-filter="missing">仅缺字</button>
      ${isCmap ? '' : '<button class="chip" data-filter="discrepancy">仅声明异常</button>'}
    </div>
    <div id="coverage-groups">${doc.groups.map(renderScriptGroup).join('') || emptyGap()}</div>
  `;

  container.querySelector('[data-export-coverage]')?.addEventListener('click', () => {
    downloadJson(doc, `${doc.title.replace(/[^\w一-龥.-]+/g, '_')}.json`);
    toast('JSON 已导出');
  });
  container.querySelector('[data-save-coverage]')?.addEventListener('click', async () => {
    const title = $('#coverage-title')?.value?.trim() || doc.title;
    doc.title = title;
    try {
      const { id } = await api.saveReport({
        kind: 'coverage',
        title,
        fontId: doc.font.id,
        rangeInput: doc.request.rangeInput,
        rangeCount: doc.request.count,
        segments: doc.request.segments,
        mode: doc.request.mode,
        document: doc,
      });
      toast(`已保存到报告库（#${id}）`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('.script-head').forEach((head) => {
    head.addEventListener('click', () => {
      head.nextElementSibling.classList.toggle('collapsed');
    });
  });

  container.querySelector('#coverage-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    container.querySelectorAll('#coverage-filters .chip').forEach((c) =>
      c.classList.toggle('active', c === btn));
    const filter = btn.dataset.filter;
    container.querySelectorAll('.glyph-cell').forEach((cell) => {
      const st = cell.dataset.status;
      const discrepancy = cell.dataset.discrepancy === '1';
      let show = st !== 'covered';
      if (filter === 'fallback') show = st === 'fallback';
      if (filter === 'missing') show = st.startsWith('missing');
      if (filter === 'discrepancy') show = discrepancy;
      cell.style.display = show ? '' : 'none';
    });
  });
}

function renderFallbackSummary(s, isCmap) {
  if (isCmap || !s.fallbackFonts?.length) return '';
  const top = s.fallbackFonts.slice(0, 8);
  return `<div class="fallback-summary">主要回退字体：
    ${top.map((f) => `<code>${escapeHtml(f.family)}</code> × ${fmtNum(f.count)}`).join('，')}
  </div>`;
}

function renderCaveats(caveats) {
  if (!caveats?.length) return '';
  return `<div class="env-box" style="margin-top:10px">
    ${caveats.map((c) => `· ${escapeHtml(c)}`).join('<br>')}</div>`;
}

function renderScriptGroup(g) {
  const rate = g.total ? Math.round((g.covered / g.total) * 100) : 0;
  const cells = g.entries.map((r) => {
    const tip = [
      r.hex,
      STATUS_LABELS[r.status] || r.status,
      r.fallbackFont ? `回退：${r.fallbackFont}` : '',
      r.discrepancy ? '⚠ 声明异常：cmap 有声明但实际未由该字体渲染' : '',
    ].filter(Boolean).join('\n');
    return `<div class="glyph-cell status-${r.status}" data-status="${r.status}"
      data-discrepancy="${r.discrepancy ? 1 : 0}" title="${escapeHtml(tip)}">${escapeHtml(r.ch)}</div>`;
  }).join('');
  return `
    <div class="script-group">
      <div class="script-head">
        <span class="script-name">${escapeHtml(g.scriptName)}
          <span class="badge">${escapeHtml(g.script)}</span></span>
        <span class="script-meta">缺口 ${fmtNum(g.gap)} / ${fmtNum(g.total)} · 覆盖率 ${rate}%</span>
      </div>
      <div class="script-body"><div class="glyph-grid">${cells}</div></div>
    </div>`;
}

function emptyGap() {
  return '<div class="card" style="text-align:center;color:var(--green)">🎉 所选范围内没有发现缺口</div>';
}

/* ---------------- 双字体对比 ---------------- */

$('#compare-run').addEventListener('click', () => runCompare());

async function runCompare() {
  if (state.running) return;
  const fontA = getFont($('#compare-font-a').value);
  const fontB = getFont($('#compare-font-b').value);
  const rangeInput = $('#compare-range').value;
  const mode = $('input[name="compare-mode"]:checked').value;

  if (!fontA || !fontB) return toast('请选择字体 A 与字体 B', true);
  if (fontA.id === fontB.id) return toast('请选择两个不同的字体', true);
  let parsed;
  try {
    parsed = parseRangeSpec(rangeInput);
  } catch (err) {
    return toast(err.message, true);
  }

  state.running = true;
  $('#compare-run').disabled = true;
  $('#compare-result').classList.add('hidden');
  const card = $('#compare-progress-card');
  card.classList.remove('hidden');
  setProgress('compare', 0, 1, '初始化…');

  try {
    const cmp = await state.detector.compare(fontA, fontB, parsed.segments, {
      mode,
      onProgress: (done, total, label) => setProgress('compare', done, total, label),
    });

    const doc = {
      reportType: 'font-comparison',
      schemaVersion: 1,
      title: `${fontA.familyName || '字体A'} → ${fontB.familyName || '字体B'} 对比 ${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date().toISOString(),
      environment: cmp.environment,
      fontA: pickFontDoc(fontA),
      fontB: pickFontDoc(fontB),
      request: {
        rangeInput,
        mode,
        segments: parsed.segments,
        rangesText: formatSegments(parsed.segments),
        count: parsed.count,
      },
      summaryA: cmp.summaryA,
      summaryB: cmp.summaryB,
      delta: cmp.delta,
      groups: cmp.groups.map((g) => ({
        ...g,
        entries: g.entries
          .slice()
          .sort((x, y) => x.cp - y.cp)
          .map((r) => ({ ...r, hex: toHex(r.cp) })),
      })),
      caveats: mode === 'cmap'
        ? CAVEATS_CMAP
        : [...CAVEATS, '对比仅记录两版字体判定结果不同的码位。'],
    };
    state.compareDoc = doc;
    renderCompare(doc, $('#compare-result'), { editable: true });
    $('#compare-result').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    toast('对比失败：' + err.message, true);
  } finally {
    state.running = false;
    $('#compare-run').disabled = false;
    card.classList.add('hidden');
  }
}

function fontRateBlock(title, f, s) {
  return `
    <div class="card">
      <h2>${title}：${escapeHtml(f.fullName || f.familyName || `字体#${f.id}`)}</h2>
      <div class="rate-line">
        <strong>覆盖率</strong>
        <div class="bar"><div class="bar-fill" style="width:${s.rate}%"></div></div>
        <span class="pct">${s.rate}%</span>
      </div>
      <div class="stat-grid" style="margin-bottom:0">
        <div class="stat green"><div class="num">${fmtNum(s.covered)}</div><div class="lbl">已覆盖</div></div>
        <div class="stat amber"><div class="num">${fmtNum(s.fallback)}</div><div class="lbl">回退</div></div>
        <div class="stat red"><div class="num">${fmtNum(s.missingTofu + s.missingBlank + s.missing)}</div><div class="lbl">缺字</div></div>
        <div class="stat purple"><div class="num">${fmtNum(s.discrepancy)}</div><div class="lbl">声明异常</div></div>
      </div>
    </div>`;
}

function renderCompare(doc, container, { editable = false } = {}) {
  const d = doc.delta;
  const stat = (cls, num, lbl) =>
    `<div class="stat ${cls}"><div class="num">${fmtNum(num)}</div><div class="lbl">${lbl}</div></div>`;

  container.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">对比结论</h2>
        <div class="actions" style="margin:0">
          <button class="ghost" data-export-compare>导出 JSON</button>
          ${editable ? '<button class="primary" data-save-compare>保存到报告库</button>' : ''}
        </div>
      </div>
      ${editable ? `<label class="select-label">报告标题
        <input type="text" id="compare-title" value="${escapeHtml(doc.title)}" /></label>` : ''}
      <div class="stat-grid">
        ${stat('green', d.improved, 'B 修复（A缺 → B有）')}
        ${stat('red', d.regressed, 'B 回归（A有 → B缺）')}
        ${stat('blue', d.changed, '状态变化总数')}
        ${stat('amber', d.fallbackChanged, '回退字体变化')}
        ${stat('green', d.bothCovered, '两版均覆盖')}
        ${stat('red', d.bothMissing, '两版均缺失')}
      </div>
      <div class="env-box">
        范围：${escapeHtml(doc.request.rangesText.slice(0, 400))}${doc.request.rangesText.length > 400 ? ' …' : ''}
        ｜ ${fmtNum(doc.request.count)} 码位
        ｜ 模式：${doc.request.mode === 'cmap' ? '仅 cmap 声明' : '真实渲染'}
      </div>
      ${renderCaveats(doc.caveats)}
    </div>

    <div class="grid two" style="margin-top:18px">
      ${fontRateBlock('A · 基线', doc.fontA, doc.summaryA)}
      ${fontRateBlock('B · 新版本', doc.fontB, doc.summaryB)}
    </div>

    <h2 style="margin:22px 0 10px;font-size:15px">按脚本分组的差异（${doc.groups.reduce((n, g) => n + g.entries.length, 0)} 项）</h2>
    ${doc.groups.map(renderCompareGroup).join('') || emptyGap()}
  `;

  container.querySelector('[data-export-compare]')?.addEventListener('click', () => {
    downloadJson(doc, `${doc.title.replace(/[^\w一-龥.-]+/g, '_')}.json`);
    toast('JSON 已导出');
  });
  container.querySelector('[data-save-compare]')?.addEventListener('click', async () => {
    const title = $('#compare-title')?.value?.trim() || doc.title;
    doc.title = title;
    try {
      const { id } = await api.saveReport({
        kind: 'comparison',
        title,
        fontId: doc.fontA.id,
        fontBId: doc.fontB.id,
        rangeInput: doc.request.rangeInput,
        rangeCount: doc.request.count,
        segments: doc.request.segments,
        mode: doc.request.mode,
        document: doc,
      });
      toast(`已保存到报告库（#${id}）`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('.script-head').forEach((head) => {
    head.addEventListener('click', () => head.nextElementSibling.classList.toggle('collapsed'));
  });
}

function renderCompareGroup(g) {
  const rows = g.entries.map((r) => `
    <tr>
      <td class="ch">${escapeHtml(r.ch)}</td>
      <td><code>${r.hex}</code></td>
      <td>${statusPill(r.a)}${r.fallbackA ? `<div class="muted">↳ ${escapeHtml(r.fallbackA)}</div>` : ''}</td>
      <td>${statusPill(r.b)}${r.fallbackB ? `<div class="muted">↳ ${escapeHtml(r.fallbackB)}</div>` : ''}</td>
    </tr>`).join('');
  return `
    <div class="script-group">
      <div class="script-head">
        <span class="script-name">${escapeHtml(g.scriptName)} <span class="badge">${escapeHtml(g.script)}</span></span>
        <span class="script-meta">${fmtNum(g.entries.length)} 个差异码位</span>
      </div>
      <div class="script-body collapsed">
        <div class="table-wrap">
          <table class="diff-table">
            <thead><tr><th>字形</th><th>码位</th><th>A · 基线</th><th>B · 新版本</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ---------------- 报告库 ---------------- */

$('#reports-refresh').addEventListener('click', loadReports);

async function loadReports() {
  const tbody = $('#reports-table tbody');
  try {
    const reports = await api.listReports();
    if (!reports.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">暂无报告，完成一次检测后可保存到这里。</td></tr>';
      return;
    }
    tbody.innerHTML = reports.map((r) => {
      const s = r.summary || {};
      let brief = '';
      if (r.kind === 'coverage') {
        brief = `覆盖 ${s.rate ?? 0}% · 缺 ${fmtNum((s.missingTofu || 0) + (s.missingBlank || 0) + (s.missing || 0))}`;
      } else {
        brief = `修复 ${s.improved || 0} · 回归 ${s.regressed || 0}`;
      }
      return `
      <tr>
        <td>#${r.id}</td>
        <td><span class="kind-tag ${r.kind}">${r.kind === 'coverage' ? '覆盖' : '对比'}</span></td>
        <td>${escapeHtml(r.title || '—')}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escapeHtml(r.rangeInput || '')}">${escapeHtml((r.rangeInput || '—').slice(0, 40))}</td>
        <td>${escapeHtml(r.mode || '—')}</td>
        <td class="muted">${escapeHtml(brief)}</td>
        <td class="muted">${escapeHtml(r.createdAt)}</td>
        <td>
          <button class="link-btn" data-view-report="${r.id}" data-kind="${r.kind}">查看</button>
          <a class="link-btn" href="${api.exportUrl(r.id)}">下载</a>
          <button class="link-btn" data-delete-report="${r.id}" style="color:var(--red)">删除</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

$('#reports-table').addEventListener('click', async (e) => {
  const viewId = e.target?.dataset?.viewReport;
  const delId = e.target?.dataset?.deleteReport;
  if (viewId) {
    const full = await api.getReport(Number(viewId));
    const detail = $('#report-detail');
    detail.classList.remove('hidden');
    if (full.document.reportType === 'font-comparison') {
      renderCompare(full.document, detail, { editable: false });
    } else {
      renderCoverage(full.document, detail, { editable: false });
    }
    detail.scrollIntoView({ behavior: 'smooth' });
  } else if (delId) {
    if (!confirm(`确认删除报告 #${delId}？`)) return;
    await api.deleteReport(Number(delId));
    $('#report-detail').classList.add('hidden');
    loadReports();
    toast('报告已删除');
  }
});

/* ---------------- 启动 ---------------- */

(async function init() {
  try {
    await api.health();
    await loadFonts();
  } catch (err) {
    toast('服务不可用：' + err.message, true);
  }
})();
