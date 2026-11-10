(function (root) {
  'use strict';
  const zone = 'Asia/Shanghai';
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function weekRange(date) {
    if (!validDate(date)) throw new Error('请选择有效日期');
    const monday = new Date(date + 'T00:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
  }
  function completedDate(project, nextStatus, date = today()) {
    if (nextStatus !== 'done') return null;
    return project?.status === 'done' ? project.completedAt || null : date;
  }
  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]()<>#|!~]/g, '\\$&');
  }
  function generate(projects, selectedDate = today()) {
    const { start, end } = weekRange(selectedDate);
    const completed = projects.filter(p => p.status === 'done' && validDate(p.completedAt) && p.completedAt >= start && p.completedAt <= end);
    const active = projects.filter(p => p.status === 'active');
    const pending = projects.filter(p => p.status === 'todo');
    const unknown = projects.filter(p => p.status === 'done' && !validDate(p.completedAt));
    const section = (title, rows, empty, dated = false) => [
      `## ${title}`, '',
      ...(rows.length ? rows.map(p => `- ${text(p.name)}${dated ? `（${p.completedAt}）` : ''}${p.description ? `：${text(p.description)}` : ''}${p.due && !dated ? `；截止 ${text(p.due)}` : ''}`) : [empty]), ''
    ];
    return [
      '# 个人项目周报', '', `${start} — ${end}（北京时间，周一至周日）`, '',
      `本周完成 ${completed.length} 项；当前进行中 ${active.length} 项；当前待开始 ${pending.length} 项。`, '',
      ...section('本周完成', completed, '暂无有完成日期的本周完成项目。', true),
      ...section('当前进行中', active, '暂无进行中的项目。'),
      ...section('待开始 · 下周计划候选', pending, '暂无待开始项目。'),
      ...(unknown.length ? [...section('待补充完成日期', unknown, ''), '> 这些项目缺少完成日期，未计入本周完成。可在编辑项目时补填。', ''] : []),
      '> 进行中和待开始来自当前看板状态，不代表所选周的历史快照。项目描述仅作整理，不会自动推断实际进展；请按需修改计划。'
    ].join('\n');
  }
  const api = { today, validDate, weekRange, completedDate, generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeeklyReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
