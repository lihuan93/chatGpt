const { test } = require("node:test");
const assert = require("node:assert/strict");
const report = require("../dist/weekly-report.js");
test("北京时间跨日及周一至周日边界", () => {
  assert.equal(report.today(new Date("2026-11-08T16:30:00Z")), "2026-11-09");
  assert.deepEqual(report.weekRange("2026-11-15"), {
    start: "2026-11-09",
    end: "2026-11-15",
  });
  assert.deepEqual(report.weekRange("2027-01-01"), {
    start: "2026-12-28",
    end: "2027-01-03",
  });
  assert.equal(report.validDate("2026-02-30"), false);
  assert.throws(() => report.weekRange("bad"));
});
test("状态切换记录完成日期，重开清除日期，不猜测旧项目的日期", () => {
  assert.equal(
    report.completedDate({ status: "active" }, "done", "2026-11-09"),
    "2026-11-09",
  );
  assert.equal(
    report.completedDate(
      { status: "done", completedAt: "2026-11-02" },
      "done",
      "2026-11-09",
    ),
    "2026-11-02",
  );
  assert.equal(
    report.completedDate({ status: "done" }, "done", "2026-11-09"),
    null,
  );
  assert.equal(
    report.completedDate(
      { status: "done", completedAt: "2026-11-02" },
      "active",
    ),
    null,
  );
});
test("仅统计周内完成，旧数据单列，进行中和计划标明当前快照", () => {
  const projects = [
    { name: "周一完成", status: "done", completedAt: "2026-11-09" },
    { name: "周日完成", status: "done", completedAt: "2026-11-15" },
    { name: "上周完成", status: "done", completedAt: "2026-11-08" },
    { name: "下周完成", status: "done", completedAt: "2026-11-16" },
    { name: "旧项目", status: "done" },
    { name: "开发中", status: "active", description: "下一步实现导出" },
    { name: "准备开工", status: "todo" },
  ];
  const output = report.generate(projects, "2026-11-09");
  assert.match(output, /本周完成 2 项；当前进行中 1 项；当前待开始 1 项/);
  assert.match(output, /周一完成/);
  assert.match(output, /周日完成/);
  assert.doesNotMatch(output, /上周完成|下周完成/);
  assert.match(output, /待补充完成日期\n\n- 旧项目/);
  assert.match(output, /不代表所选周的历史快照/);
});
test("空看板生成可用草稿，文本不能注入 Markdown 标题或链接", () => {
  assert.match(report.generate([], "2026-11-09"), /本周完成 0 项/);
  const output = report.generate(
    [
      {
        name: "标题\n# 假标题",
        description: "[点我](https://example.com)",
        status: "active",
      },
    ],
    "2026-11-09",
  );
  assert.match(output, /标题 \\# 假标题/);
  assert.ok(output.includes("\\[点我\\]\\(https://example.com\\)"));
});
