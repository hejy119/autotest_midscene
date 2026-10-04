import fs from 'fs';
import path from 'path';
import { CaseResult, RunSummary } from './runner';

/**
 * 生成自包含的 HTML 测试报告，输出到 midscene-run/report/index.html。
 *
 * 布局：左侧固定导航栏 + 右侧内容区。
 *   - 侧边栏：顶部「总览」+ 目录/文件树（可折叠，默认展开）；有失败用例的目录/文件用红色标记；
 *   - 总览：5 张汇总卡（含总耗时）+ 整体通过率条；
 *   - 侧边栏点目录/文件/单条用例可平滑滚动定位；点单条用例后只给该条高亮描边。
 * 现有「目录→文件→用例」树形、折叠、步骤表、失败截图全部保留。
 */

/** 一个目录节点的统计 */
interface DirStat {
  dir: string; // 相对 test_case 的目录路径（'' 表示根目录下的文件）
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  avgDurationMs: number;
  passRate: number; // 0~1
}

/** 按「目录 → 文件名 → 用例」聚合的树 */
interface ReportTree {
  dirs: Map<string, DirStat>;
  /** dir -> file -> cases */
  files: Map<string, Map<string, CaseResult[]>>;
  /** 各目录下的直接文件（不含子目录），用于树形排序展示 */
  dirOrder: string[];
}

function buildTree(results: CaseResult[]): ReportTree {
  const dirs = new Map<string, DirStat>();
  const files = new Map<string, Map<string, CaseResult[]>>();
  const dirOrder: string[] = [];

  const ensureDir = (dir: string) => {
    if (!dirs.has(dir)) {
      dirs.set(dir, { dir, total: 0, passed: 0, failed: 0, totalDurationMs: 0, avgDurationMs: 0, passRate: 0 });
      files.set(dir, new Map());
      dirOrder.push(dir);
    }
  };

  for (const c of results) {
    // file 已归一化为 / 分隔；根目录下文件 dirname 是 '.'，统一归一化成 ''（根目录）
    const rawDir = path.posix.dirname(c.file);
    const dir = rawDir === '.' ? '' : rawDir;
    const base = path.posix.basename(c.file);
    ensureDir(dir);
    const stat = dirs.get(dir)!;
    stat.total++;
    if (c.status === 'pass') stat.passed++;
    else stat.failed++;
    stat.totalDurationMs += c.durationMs;
    if (!files.get(dir)!.has(base)) files.get(dir)!.set(base, []);
    files.get(dir)!.get(base)!.push(c);
  }

  for (const s of dirs.values()) {
    s.avgDurationMs = s.total > 0 ? Math.round(s.totalDurationMs / s.total) : 0;
    s.passRate = s.total > 0 ? s.passed / s.total : 0;
  }

  return { dirs, files, dirOrder };
}

/** 目录相对路径 → 展示名（根目录显示为「test_case」） */
function dirDisplayName(dir: string): string {
  return dir === '' ? '📁 test_case' : `📁 ${dir}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}min${sec > 0 ? ` ${sec}s` : ''}`;
}

export function generateReport(
  runDir: string,
  results: CaseResult[],
  summary: RunSummary,
  startedAt: string,
  officialReportPath?: string,
): string {
  const reportDir = path.join(runDir, 'report');
  fs.mkdirSync(reportDir, { recursive: true });
  const file = path.join(reportDir, 'index.html');
  // 官方报告与本报告同目录（如 report/autotest.html），转成相对链接
  const officialReportLink = officialReportPath
    ? path.relative(reportDir, officialReportPath).replace(/\\/g, '/')
    : undefined;
  fs.writeFileSync(file, buildHtml(results, summary, startedAt, officialReportLink), 'utf-8');
  return file;
}

function buildHtml(
  results: CaseResult[],
  summary: RunSummary,
  startedAt: string,
  officialReportLink?: string,
): string {
  const tree = buildTree(results);
  const overallDuration = results.reduce((s, c) => s + c.durationMs, 0);
  const overallPassRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
  const overallAvg = summary.total > 0 ? Math.round(overallDuration / summary.total) : 0;

  // 目录渲染顺序：子目录按拼音序，根目录（''）放最后
  const orderedDirs = [...tree.dirOrder].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh'),
  );

  // —— 内容区目录卡 + 侧边栏目录树，一次遍历同时生成 ——
  let dirCardsHtml = '';
  let navDirsHtml = '';
  orderedDirs.forEach((dir, idx) => {
    const s = tree.dirs.get(dir)!;
    const pct = (s.passRate * 100).toFixed(1);
    const barW = Math.round(s.passRate * 100);
    const barColor = s.failed === 0 ? '#1a7f37' : s.passed === 0 ? '#cf222e' : '#d4a72c';
    const filesInDir = tree.files.get(dir)!;
    const fileCount = filesInDir.size;
    const filesSummary = [...filesInDir.entries()]
      .map(([f, cases]) => {
        const pass = cases.filter((c) => c.status === 'pass').length;
        return `${escapeHtml(f)}：${pass}/${cases.length} 通过`;
      })
      .join('；');
    // 用目录序号做 id（中文目录名转成 html id 不可读且有撞 id 风险）
    const dirId = `d${idx}`;
    const viewId = `view-dir-${idx}`;
    const dirLabel = dir === '' ? 'test_case' : dir;

    // 侧边栏目录徽标：有失败 → 红色失败数；全过 → 绿色通过数
    const dirBadge = s.failed > 0
      ? `<span class="nav-badge fail">${s.failed}</span>`
      : `<span class="nav-badge ok">${s.passed}/${s.total}</span>`;

    // 遍历该目录下的文件（同时生成内容区文件节点 + 侧边栏文件项 + 用例子项）
    let navFiles = '';
    let fi = 0;
    const filesHtml = [...filesInDir.entries()]
      .map(([f, cases]) => {
        const fileId = `${dirId}_f${fi++}`;
        const pass = cases.filter((c) => c.status === 'pass').length;
        const fail = cases.length - pass;
        const sub = `${pass}/${cases.length} 通过`;
        // 侧边栏用例子项：点哪条就滚到哪条；✅/❌ 标记通过失败
        let navCases = '';
        const casesHtml = cases
          .map((c, n) => {
            const cid = `case-${fileId}-${n}`;
            navCases += `
          <a class="nav-case ${c.status === 'pass' ? 'pass' : 'fail'}" data-target="#${cid}">
            <span class="nc-mark">${c.status === 'pass' ? '✅' : '❌'}</span>
            <span class="nc-name">${escapeHtml(c.name)}</span>
          </a>`;
            return renderCase(c, cid);
          })
          .join('');
        // 文件行：折叠按钮 + 跳转链接并列；用例列表默认展开（id 供折叠用）
        navFiles += `
        <div class="nav-file-row">
          <button class="nav-fold" data-fold="#nav-file-cases-${fileId}">▾</button>
          <a class="nav-file ${fail > 0 ? 'fail' : ''}" data-target="#file-node-${fileId}">
            <span class="nf-name">${escapeHtml(f)}</span>${fail > 0 ? `<span class="nav-badge fail">${fail}</span>` : ''}
          </a>
        </div>
        <div class="nav-cases" id="nav-file-cases-${fileId}">${navCases}</div>`;
        return `
        <div class="file-node" id="file-node-${fileId}">
          <div class="file-head" data-toggle="#file-cases-${fileId}">
            <button class="fold-btn">▸</button>
            <span class="file-name">📄 ${escapeHtml(f)}</span>
            <span class="file-sub">${sub}</span>
          </div>
          <div class="file-cases" id="file-cases-${fileId}">${casesHtml}</div>
        </div>`;
      })
      .join('');

    // 目录行：折叠按钮 + 跳转链接并列；文件列表默认展开（id 供折叠用）
    navDirsHtml += `
      <div class="nav-dir-row">
        <button class="nav-fold" data-fold="#nav-dir-cases-${dirId}">▾</button>
        <a class="nav-dir ${s.failed > 0 ? 'fail' : ''}" data-target="#${viewId}" data-nav-for="#${viewId}">
          <span class="nd-name">${escapeHtml(dirLabel)}</span>${dirBadge}
        </a>
      </div>
      <div class="nav-files" id="nav-dir-cases-${dirId}">${navFiles}</div>`;

    dirCardsHtml += `
      <div class="dir-card" id="${viewId}">
        <div class="dir-card-head" data-toggle="#dir-cases-${dirId}">
          <button class="fold-btn">▸</button>
          <span class="dir-name">${dirDisplayName(dir)}</span>
          <span class="dir-sub">${fileCount} 个文件 · ${filesSummary}</span>
        </div>
        <div class="dir-stats">
          <div class="stat"><b>${s.total}</b>用例</div>
          <div class="stat pass"><b>${s.passed}</b>通过</div>
          <div class="stat fail"><b>${s.failed}</b>失败</div>
          <div class="stat"><b>${pct}%</b>通过率</div>
          <div class="stat"><b>${formatMs(s.avgDurationMs)}</b>平均耗时</div>
        </div>
        <div class="rate-bar"><div class="rate-fill" style="width:${barW}%;background:${barColor}"></div></div>
        <div class="dir-cases" id="dir-cases-${dirId}">
          ${filesHtml}
        </div>
      </div>`;
  });

  // 侧边栏：总览 + 目录树（目录/文件可折叠，默认展开）
  const sidebarNav = `
    <a class="nav-item" data-target="#view-overview" data-nav-for="#view-overview">📊 总览</a>
    <div class="nav-group-title">目录</div>
    ${navDirsHtml}`;

  // 总览区块：5 张汇总卡 + 整体通过率条
  const overviewHtml = `
    <div class="sec" id="view-overview">
      <h2 class="sec-title">📊 总览</h2>
      <div class="cards">
        <div class="card total">总用例<b>${summary.total}</b></div>
        <div class="card pass">通过<b>${summary.passed}</b></div>
        <div class="card fail">失败<b>${summary.failed}</b></div>
        <div class="card avg">平均耗时<b>${formatMs(overallAvg)}</b></div>
        <div class="card dur">总耗时<b>${formatMs(overallDuration)}</b></div>
      </div>
      <div class="overall-bar">
        <div class="lbl">整体通过率：${overallPassRate.toFixed(1)}%</div>
        <div class="bar"><div class="fill" style="width:${Math.round(overallPassRate)}%"></div></div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 自动化测试报告</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f6f8; color: #24292f; }
  .content { margin-left: 232px; min-width: 0; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 20px 24px 60px; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 16px; }
  .sec-title { font-size: 18px; margin: 4px 0 12px; }
  .sec { margin-bottom: 18px; }

  /* 侧边栏（白灰亮色） */
  .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 232px; overflow-y: auto; background: #ffffff; color: #24292f; padding: 16px 10px 24px; border-right: 1px solid #e1e4e8; z-index: 10; }
  .sidebar::-webkit-scrollbar { width: 8px; }
  .sidebar::-webkit-scrollbar-thumb { background: #c1c9d1; border-radius: 4px; }
  .nav-title { font-size: 15px; font-weight: 700; color: #24292f; padding: 0 8px 2px; }
  .nav-sub { font-size: 11px; color: #57606a; padding: 0 8px 14px; border-bottom: 1px solid #eaeef2; margin-bottom: 8px; word-break: break-all; }
  .nav-item { display: flex; align-items: center; gap: 6px; padding: 8px 10px; margin: 2px 0; border-radius: 6px; color: #24292f; text-decoration: none; font-size: 13px; cursor: pointer; }
  .nav-item:hover { background: #eaeef2; }
  .nav-item.active { background: #ddf4ff; color: #0969da; font-weight: 600; }
  .nav-badge { display: inline-block; min-width: 18px; text-align: center; border-radius: 10px; padding: 1px 6px; font-size: 11px; font-weight: 600; margin-left: auto; flex-shrink: 0; }
  .nav-badge.fail { background: #cf222e; color: #fff; }
  .nav-badge.ok { background: #1a7f37; color: #fff; }
  .nav-group-title { font-size: 11px; color: #57606a; padding: 12px 8px 4px; }
  /* 侧边栏折叠行：小箭头按钮 + 跳转链接并列；默认全部展开 */
  .nav-dir-row, .nav-file-row { display: flex; align-items: center; gap: 2px; }
  .nav-fold { background: none; border: none; font-size: 11px; color: #57606a; cursor: pointer; padding: 4px 2px; flex-shrink: 0; line-height: 1; transition: transform .15s; }
  .nav-fold.collapsed { transform: rotate(-90deg); }
  .nav-dir { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 7px 8px; border-radius: 6px; color: #24292f; text-decoration: none; font-size: 13px; cursor: pointer; }
  .nav-dir:hover { background: #eaeef2; }
  .nav-dir.active { background: #ddf4ff; color: #0969da; font-weight: 600; }
  .nav-dir.fail { color: #cf222e; font-weight: 600; }
  .nav-dir.fail.active { background: #ffebe9; color: #cf222e; }
  .nd-name { word-break: break-all; }
  .nav-files { padding-left: 12px; margin-bottom: 6px; }
  .nav-file { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 4px 8px; border-radius: 5px; color: #57606a; text-decoration: none; font-size: 12px; cursor: pointer; }
  .nav-file:hover { color: #24292f; background: #eaeef2; }
  .nav-file.active { color: #0969da; background: #ddf4ff; }
  .nav-file.fail { color: #cf222e; }
  .nav-file.fail.active { background: #ffebe9; color: #cf222e; }
  .nav-cases { padding-left: 12px; margin-bottom: 4px; }
  .nav-case { display: flex; align-items: center; gap: 6px; padding: 3px 10px 3px 14px; border-radius: 5px; color: #57606a; text-decoration: none; font-size: 12px; cursor: pointer; }
  .nav-case:hover { color: #24292f; background: #eaeef2; }
  .nav-case.pass .nc-mark { color: #1a7f37; }
  .nav-case.fail { color: #cf222e; font-weight: 600; }
  .nav-case.fail .nc-mark { color: #cf222e; }
  .nf-name, .nc-name { word-break: break-all; }

  /* 汇总卡 */
  .cards { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 130px; background: #fff; border-radius: 10px; padding: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card b { font-size: 26px; display: block; }
  .card.total b { color: #0969da; }
  .card.pass b { color: #1a7f37; }
  .card.fail b { color: #cf222e; }
  .card.avg b { color: #8250df; }
  .card.dur b { color: #bf8700; }
  .overall-bar { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .overall-bar .lbl { font-size: 13px; color: #57606a; margin-bottom: 6px; }
  .bar { height: 14px; background: #eaeef2; border-radius: 7px; overflow: hidden; }
  .bar .fill { height: 100%; background: #1a7f37; border-radius: 7px; }

  /* 目录卡 */
  .dir-card { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .dir-card-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .fold-btn { background: none; border: none; font-size: 12px; color: #57606a; cursor: pointer; padding: 0 2px; transition: transform .15s; }
  .fold-btn.collapsed { transform: rotate(-90deg); }
  .dir-name { font-size: 16px; font-weight: 600; }
  .dir-sub { font-size: 12px; color: #57606a; }
  .dir-stats { display: flex; gap: 14px; margin: 10px 0 6px; flex-wrap: wrap; }
  .stat { font-size: 13px; color: #57606a; }
  .stat b { font-size: 16px; margin-right: 4px; }
  .stat.pass b { color: #1a7f37; }
  .stat.fail b { color: #cf222e; }
  .rate-bar { height: 8px; background: #eaeef2; border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
  .rate-fill { height: 100%; border-radius: 4px; }
  .dir-cases { border-top: 1px solid #eaeef2; }

  /* 文件节点 */
  .file-node { margin: 10px 0 4px; }
  .file-head { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 8px; background: #f6f8fa; border-radius: 6px; }
  .file-name { font-size: 14px; font-weight: 600; color: #24292f; }
  .file-sub { font-size: 12px; color: #57606a; }
  .file-cases { margin-top: 8px; }

  /* 用例 */
  .case { padding: 12px; margin: 8px 0; border: 1px solid #eaeef2; border-radius: 8px; }
  .case.fail { border-left: 4px solid #cf222e; background: #fffbfb; }
  .case.pass { border-left: 4px solid #1a7f37; }
  .case.current { outline: 3px solid #0969da; outline-offset: 2px; }
  .case h3 { margin: 0 0 10px; font-size: 14px; }
  .file { color: #57606a; font-weight: normal; font-size: 12px; }
  .time { float: right; color: #57606a; font-size: 12px; font-weight: normal; }
  .retry { color: #9a6700; font-size: 12px; font-weight: normal; margin-left: 8px; }
  .case-error { background: #ffebe9; border: 1px solid #ff8182; color: #cf222e; padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #eaeef2; padding: 8px 10px; text-align: left; }
  th { background: #f6f8fa; }
  tr.pass td { background: #f0fff4; }
  tr.fail td { background: #fff0f0; }
  .err-row td { background: #fff5f5; color: #cf222e; white-space: pre-wrap; word-break: break-all; }
  img { max-width: 100%; border: 1px solid #eaeef2; border-radius: 6px; }
  code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; }

  .footer { margin-top: 24px; text-align: center; color: #57606a; font-size: 13px; }
  .footer a { color: #0969da; text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  /* 窄屏：侧边栏收为顶部横条 */
  @media (max-width: 820px) {
    .sidebar { position: static; width: 100%; max-height: 220px; border-right: none; border-bottom: 1px solid #e1e4e8; }
    .content { margin-left: 0; }
  }
</style>
</head>
<body>
<aside class="sidebar">
  <div class="nav-title">🤖 AI 自动化测试报告</div>
  <div class="nav-sub">执行时间：${escapeHtml(startedAt)}</div>
  ${sidebarNav}
</aside>
<main class="content">
  <div class="wrap">
    ${overviewHtml}
    ${dirCardsHtml}
    ${
      officialReportLink
        ? `<div class="footer">📊 每步 AI 推理细节见 <a href="${escapeHtml(officialReportLink)}" target="_blank">Midscene 官方报告</a>（排障用）</div>`
        : ''
    }
  </div>
</main>
<script>
  // 折叠/展开：内容区目录与文件两级
  document.querySelectorAll('.dir-card-head, .file-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var btn = head.querySelector('.fold-btn');
      var target = document.querySelector(head.getAttribute('data-toggle'));
      if (btn && target) {
        btn.classList.toggle('collapsed');
        target.style.display = target.style.display === 'none' ? '' : 'none';
      }
    });
  });

  // 折叠/展开：侧边栏目录 / 文件（默认全部展开，点 ▾/▸ 切换其下列表）
  document.querySelectorAll('.nav-fold').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-fold'));
      if (!target) return;
      btn.classList.toggle('collapsed');
      target.style.display = target.style.display === 'none' ? '' : 'none';
    });
  });

  // 展开目标元素的所有父级目录/文件（保证跳转后内容可见）
  function expandAncestors(el) {
    var node = el;
    while (node && node !== document.body) {
      var head = null;
      if (node.classList && node.classList.contains('dir-card')) head = node.querySelector('.dir-card-head');
      else if (node.classList && node.classList.contains('file-node')) head = node.querySelector('.file-head');
      if (head) {
        var btn = head.querySelector('.fold-btn');
        var t = document.querySelector(head.getAttribute('data-toggle'));
        if (btn && btn.classList.contains('collapsed')) btn.classList.remove('collapsed');
        if (t && t.style.display === 'none') t.style.display = '';
      }
      node = node.parentNode;
    }
  }

  function scrollToEl(el, block) {
    if (!el) return;
    expandAncestors(el);
    el.scrollIntoView({ behavior: 'smooth', block: block || 'start' });
  }

  // 导航高亮：区块 id -> 对应导航项（只有总览和目录挂了 data-nav-for）
  var navFor = {};
  document.querySelectorAll('[data-nav-for]').forEach(function (a) {
    navFor[a.getAttribute('data-nav-for').slice(1)] = a;
  });
  function setActive(id) {
    document.querySelectorAll('.nav-item, .nav-dir').forEach(function (n) { n.classList.remove('active'); });
    var nav = navFor[id];
    if (nav) nav.classList.add('active');
  }

  // 跳转后的短暂窗口内不让滚动监听抢侧边栏高亮
  var suppressScrollspyUntil = 0;

  // 侧边栏导航点击：总览 / 目录 / 文件 / 单条用例。
  // 点单条用例：滚到该条，且只给这一条常驻高亮描边（点下一条才切换）；
  // 点目录/文件/总览：只做滚动 + 侧边栏区块高亮，不动用例描边。
  document.querySelectorAll('.nav-item, .nav-dir, .nav-file, .nav-case').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var target = document.querySelector(a.getAttribute('data-target'));
      scrollToEl(target, a.classList.contains('nav-case') ? 'center' : 'start');
      if (target) {
        if (a.classList.contains('nav-case')) {
          document.querySelectorAll('.case.current').forEach(function (c) { c.classList.remove('current'); });
          target.classList.add('current');
          suppressScrollspyUntil = Date.now() + 800;
        } else {
          setActive(target.id);
        }
      }
    });
  });

  // 滚动监听：当前所在区块 → 高亮对应导航项
  var sections = [];
  document.querySelectorAll('[data-nav-for]').forEach(function (a) {
    var s = document.querySelector(a.getAttribute('data-nav-for'));
    if (s) sections.push(s);
  });
  sections.sort(function (x, y) { return x.offsetTop - y.offsetTop; });
  function onScroll() {
    // 跳转瞬间的平滑滚动会短暂改变 offsetTop，先让位，等定位稳定
    if (Date.now() < suppressScrollspyUntil) return;
    var pos = window.scrollY + 80;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= pos) current = sections[i];
    }
    if (current) setActive(current.id);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
</script>
</body>
</html>`;
}

/** 渲染一条用例。cid 是其稳定 id，供侧边栏用例项跳转定位 */
function renderCase(c: CaseResult, cid: string): string {
  const stepsHtml = c.steps
    .map((s) => {
      const errRow = s.error
        ? `<tr class="err-row"><td colspan="5">${escapeHtml(s.error)}</td></tr>`
        : '';
      const shotRow = s.screenshot
        ? `<tr><td colspan="5"><img src="data:image/png;base64,${s.screenshot}" alt="失败截图"/></td></tr>`
        : '';
      return `
        <tr class="${s.status}">
          <td>${s.index + 1}</td>
          <td><code>${escapeHtml(s.action)}</code></td>
          <td>${escapeHtml(s.prompt || '')}</td>
          <td>${s.status === 'pass' ? '✅ 通过' : '❌ 失败'}</td>
          <td>${s.durationMs}ms</td>
        </tr>
        ${errRow}
        ${shotRow}`;
    })
    .join('');
  return `
    <div class="case ${c.status}" id="${cid}">
      <h3>${c.status === 'pass' ? '✅' : '❌'} ${escapeHtml(c.name)}
        ${c.attempts > 1 ? `<span class="retry">${c.status === 'pass' ? `⚡ 重试 ${c.attempts - 1} 次后通过` : `🔁 重试 ${c.attempts - 1} 次仍失败`}</span>` : ''}
        <span class="time">${c.durationMs}ms</span>
      </h3>
      ${c.error ? `<div class="case-error">${escapeHtml(c.error)}</div>` : ''}
      <table>
        <thead><tr><th>#</th><th>动作</th><th>描述</th><th>结果</th><th>耗时</th></tr></thead>
        <tbody>${stepsHtml}</tbody>
      </table>
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
