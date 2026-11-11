const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("../dist/workspace.js");
function row(extra = {}) {
  return {
    标题: "【省厅治超】工单名称修复",
    任务ID: "HJOK-1",
    任务状态: "待处理",
    优先级: "紧急",
    更新时间: "2026-11-05 09:41",
    创建时间: "2026-10-01 10:00",
    截止时间: "",
    执行者: "我",
    项目: "综合项目组",
    ...extra,
  };
}
function imported(rows = [row()]) {
  return W.applyImport(
    W.empty(),
    W.planImport(W.empty(), rows),
    "2026-11-10T08:00:00Z",
  );
}
test("CSV supports BOM, CRLF, comma, quoted newline and escaped quote; rejects malformed input", () => {
  const csv =
    '\uFEFF标题,任务ID,任务状态,优先级\r\n"多行\n带逗号,与""引号""",HJOK-1,已完成,普通\r\n';
  const rows = W.parseCSV(csv);
  assert.equal(rows[0]["标题"], '多行\n带逗号,与"引号"');
  assert.throws(() => W.parseCSV("标题,任务ID\na,b"), /缺少字段/);
  assert.throws(
    () => W.parseCSV('标题,任务ID,任务状态,优先级\n"a,b,c,d'),
    /未闭合/,
  );
  assert.throws(
    () => W.parseCSV("标题,任务ID,任务状态,优先级\na,b,c,d,e"),
    /列数/,
  );
});
test("upsert is idempotent, namespace-aware and never merges same titles with distinct IDs", () => {
  const s = imported([row(), row({ 任务ID: "HJOK-2" })]);
  assert.equal(s.tasks.length, 2);
  assert.equal(s.projects.length, 1);
  assert.deepEqual(
    W.planImport(s, [row(), row({ 任务ID: "HJOK-2" })]).map((p) => p.action),
    ["未变化", "未变化"],
  );
  assert.equal(W.planImport(s, [row()], "其他来源")[0].action, "新增");
  assert.equal(W.planImport(s, [row(), row()])[0].action, "异常");
  assert.equal(
    W.planImport(s, [row({ 任务状态: "不存在" })])[0].action,
    "异常",
  );
  assert.equal(
    W.planImport(s, [row({ 更新时间: "2026-02-30 12:00" })])[0].action,
    "异常",
  );
});
test("import preserves personal classification, notes and actual completion dates; skips stale data and blank fields", () => {
  const s = imported();
  s.projects.push({ id: "mine", name: "自定义项目", description: "" });
  s.tasks[0].projectId = "mine";
  s.tasks[0].focus = true;
  s.tasks[0].link = "https://example.com";
  s.tasks[0].tags = "保留";
  const t = s.tasks[0];
  s.records.push({
    id: "r",
    taskId: t.id,
    date: "2026-11-05",
    text: "定位空值问题",
    career: true,
  });
  assert.equal(
    W.planImport(s, [row({ 更新时间: "2026-11-04 10:00" })])[0].action,
    "旧版本",
  );
  const p = W.planImport(s, [
    row({ 任务状态: "已完成", 更新时间: "2026-11-10 12:00", 标签: "" }),
  ]);
  const next = W.applyImport(s, p);
  assert.equal(next.tasks[0].id, t.id);
  assert.equal(next.tasks[0].projectId, "mine");
  assert.equal(next.tasks[0].tags, "保留");
  assert.equal(next.tasks[0].focus, true);
  assert.equal(next.tasks[0].completedAt, "");
  assert.deepEqual(next.records, s.records);
  next.tasks[0].completedAt = "2026-11-06";
  const reopened = W.applyImport(
    next,
    W.planImport(next, [
      row({ 任务状态: "开发中", 更新时间: "2026-11-11 12:00" }),
    ]),
  );
  assert.equal(reopened.tasks[0].completedAt, "");
  assert.equal(s.tasks[0].status, "待处理", "input is immutable");
});
test("undo restores prior tasks without removing records; later edits or new references prevent undo", () => {
  const s = imported();
  const n = W.applyImport(
    s,
    W.planImport(s, [
      row({ 任务状态: "已解决", 更新时间: "2026-11-10 12:00" }),
    ]),
  );
  assert.deepEqual(W.undoImport(n), s);
  n.tasks[0].focus = true;
  assert.throws(() => W.undoImport(n), /后有任务修改/);
  const first = imported();
  first.records.push({
    id: "r",
    taskId: first.tasks[0].id,
    date: "2026-11-05",
    text: "记录",
  });
  assert.throws(() => W.undoImport(first), /关联记录/);
  assert.deepEqual(W.undoImport(imported()), W.empty());
});
test("legacy task migration preserves title, description and known dates, never guesses dates", () => {
  const s = W.migrate([
    {
      id: "old",
      name: "旧项目",
      description: "实际描述",
      status: "done",
      priority: "high",
      tags: ["后端"],
    },
  ]);
  assert.equal(s.tasks[0].completedAt, "");
  assert.equal(s.tasks[0].description, "实际描述");
  assert.equal(s.tasks[0].status, "已完成");
  assert.equal(s.tasks[0].priority, "紧急");
  assert.equal(s.projects[0].name, "旧版任务");
  assert.equal(W.validate(s), s);
});
test("weekly candidates preserve evidence distinctions; import time is not completion evidence", () => {
  const s = imported([
    row({ 任务状态: "已完成", 更新时间: "2026-10-20 09:00" }),
  ]);
  assert.equal(W.candidates(s, "2026-11-09", "2026-11-15").length, 0);
  s.records.push({
    id: "r",
    taskId: s.tasks[0].id,
    date: "2026-11-10",
    text: "验证通过，待发布",
    stage: "待验证",
    result: "",
  });
  const cs = W.candidates(s, "2026-11-09", "2026-11-15");
  assert.deepEqual(cs[0].reasons, ["本周工作记录"]);
  const draft = W.draftRow(s, [s.tasks[0].id], "2026-11-09", "2026-11-15");
  assert.match(draft.details, /验证通过，待发布/);
  assert.equal(draft.stage, "待验证");
  const untouched = W.draftRow(s, [s.tasks[0].id], "2026-11-02", "2026-11-08");
  assert.equal(untouched.stage, "");
  assert.match(untouched.details, /待补充本周实际进展/);
});
test("report merging preserves source IDs and clears inconsistent delivery stages; snapshots do not change with tasks", () => {
  const s = imported([row(), row({ 任务ID: "HJOK-2" })]);
  const a = W.draftRow(s, [s.tasks[0].id], "2026-11-02", "2026-11-08"),
    b = W.draftRow(s, [s.tasks[1].id], "2026-11-02", "2026-11-08");
  a.stage = "已发布";
  b.stage = "已提测";
  const merged = W.mergeRows([a, b], [a.id, b.id]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stage, "");
  assert.equal(merged[0].taskIds.length, 2);
  s.tasks[0].title = "后来的标题";
  assert.doesNotMatch(a.details, /后来的标题/);
  b.section = W.SECTIONS[1];
  assert.throws(() => W.mergeRows([a, b], [a.id, b.id]), /不同章节/);
});
test("exports escape HTML and spreadsheet formulas; career export filters by project/date and private-details choice", () => {
  const s = imported(),
    t = s.tasks[0];
  s.records = [
    {
      id: "r",
      taskId: t.id,
      date: "2026-11-05",
      text: "<script>alert(1)</script>",
      career: true,
      result: "耗时待验证",
      evidence: "https://internal.example",
      role: "负责查询优化",
    },
  ];
  const md = W.recordsMarkdown(s, { career: true, privateDetails: false });
  assert.match(md, /负责查询优化/);
  assert.match(md, /待补充/);
  assert.doesNotMatch(md, /internal.example|HJOK-1/);
  assert.match(
    W.recordsMarkdown(s, { start: "2026-11-06", career: true }),
    /暂无符合条件/,
  );
  const r = {
    title: "<img src=x>",
    start: "2026-11-02",
    end: "2026-11-08",
    reporter: "我",
    group: "组",
    rows: [
      {
        ...W.draftRow(s, [t.id], "2026-11-02", "2026-11-08"),
        details: "<script>x</script>\n第二行",
      },
    ],
  };
  assert.doesNotMatch(W.reportHTML(r), /<script>|<img/);
  assert.match(W.reportHTML(r), /&lt;script&gt;/);
  assert.match(W.reportHTML(r), /<br>/);
  assert.match(W.csv([["=1+1", "@SUM(A1)", "正常"]]), /"'=1\+1","'@SUM/);
});
test("backup validator rejects orphan references, duplicate IDs and malicious links", () => {
  const s = imported();
  assert.equal(W.validate(s), s);
  const n = W.clone(s);
  n.tasks[0].projectId = "missing";
  assert.throws(() => W.validate(n), /任务格式/);
  const dup = W.clone(s);
  dup.tasks.push(dup.tasks[0]);
  assert.throws(() => W.validate(dup), /结构无效/);
  const link = W.clone(s);
  link.tasks[0].link = "javascript:alert(1)";
  assert.throws(() => W.validate(link), /任务格式/);
});
test("import observation week uses Beijing time at UTC midnight boundary", () => {
  const s = imported([row({ 更新时间: "2026-10-01 10:00" })]);
  const n = W.applyImport(
    s,
    W.planImport(s, [
      row({ 任务状态: "开发中", 更新时间: "2026-10-02 10:00" }),
    ]),
    "2026-11-08T16:30:00Z",
  );
  const cs = W.candidates(n, "2026-11-09", "2026-11-15");
  assert.equal(cs.length, 1);
  assert.match(cs[0].reasons.join(""), /状态变化/);
  assert.equal(W.candidates(n, "2026-11-02", "2026-11-08").length, 0);
});
