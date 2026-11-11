const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const dist = path.join(__dirname, "../dist");
const key = "shixu-workspace-v2";
async function setup(t, legacy) {
  const dom = new JSDOM(
    fs.readFileSync(path.join(dist, "index.html"), "utf8"),
    { url: "https://shixu.test/", runScripts: "outside-only" },
  );
  const w = dom.window;
  t.after(() => w.close());
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  w.URL.createObjectURL = () => "blob:test";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  w.TextDecoder = TextDecoder;
  w.ClipboardItem = undefined;
  if (legacy)
    w.localStorage.setItem("shixu-projects-v1", JSON.stringify(legacy));
  for (const f of ["weekly-report.js", "workspace.js", "storage.js", "app.js"])
    w.eval(fs.readFileSync(path.join(dist, f), "utf8"));
  await w.ShixuReady;
  const $ = (id) => w.document.getElementById(id);
  const get = () => JSON.parse(w.localStorage.getItem(key));
  const submit = async (id) => {
    $(id).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
  };
  const nav = (v) => w.document.querySelector(`[data-view="${v}"]`).click();
  return { w, $, get, submit, nav };
}
async function createTask(c, title = "测试任务") {
  c.$("addTask").click();
  await tick();
  if (c.$("projectDialog").open) {
    c.$("projectForm").elements.name.value = "测试项目";
    await c.submit("projectForm");
  }
  const f = c.$("taskForm");
  f.elements.title.value = title;
  await c.submit("taskForm");
  return c.get().tasks[0];
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("task CRUD, project navigation, work records and career export run through the DOM", async (t) => {
  const c = await setup(t),
    task = await createTask(c);
  assert.equal(c.get().tasks.length, 1);
  assert.equal(c.$("taskDialog").open, false);
  const row = c.w.document.querySelector("#taskTable tbody tr");
  row.querySelector("button").click();
  await tick();
  const f = c.$("recordForm");
  f.elements.text.value = "定位并处理查询超时，等待验证";
  f.elements.career.checked = true;
  f.elements.role.value = "负责后端排查";
  await c.submit("recordForm");
  assert.equal(c.get().records.length, 1);
  c.nav("career");
  assert.match(c.$("viewRoot").textContent, /负责后端排查/);
  assert.match(c.$("viewRoot").textContent, /待补充/);
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "汇总导出 Markdown")
    .click();
  await tick();
  assert.match(c.$("exportText").value, /定位并处理查询超时/);
  assert.equal(c.$("exportDialog").open, true);
  c.$("exportDialog").close();
  c.nav("projects");
  assert.match(c.$("viewRoot").textContent, /测试项目/);
  c.nav("tasks");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "删除")
    .click();
  await tick();
  assert.match(c.$("toast").textContent, /已有工作记录/);
  assert.equal(c.get().tasks[0].id, task.id);
});
test("CSV upload previews and upserts without duplication or fabricated completion dates", async (t) => {
  const c = await setup(t);
  c.$("importOpen").click();
  await tick();
  let text =
    "标题,任务ID,任务状态,优先级,更新时间,执行者\r\n【省厅治超】修复工单,HJOK-1,待处理,紧急,2026-11-05 09:41,我";
  const upload = async () => {
    Object.defineProperty(c.$("csvFile"), "files", {
      configurable: true,
      value: [
        {
          size: text.length,
          arrayBuffer: async () => new TextEncoder().encode(text).buffer,
        },
      ],
    });
    c.$("csvFile").dispatchEvent(new c.w.Event("change"));
    await tick();
  };
  await upload();
  assert.match(c.$("importSummary").textContent, /新增 1 条/);
  assert.equal(c.$("importApply").disabled, false);
  c.$("importApply").click();
  await tick();
  assert.equal(c.get().tasks.length, 1);
  assert.equal(c.get().tasks[0].completedAt, "");
  c.$("importOpen").click();
  await tick();
  await upload();
  assert.match(c.$("importSummary").textContent, /未变化 1 条/);
  assert.equal(c.$("importApply").disabled, true);
  text = text.replace("待处理", "已完成").replace("2026-11-05", "2026-11-06");
  await upload();
  assert.match(c.$("importSummary").textContent, /更新 1 条/);
  c.$("importApply").click();
  await tick();
  assert.equal(c.get().tasks.length, 1);
  assert.equal(c.get().tasks[0].status, "已完成");
  assert.equal(c.get().tasks[0].completedAt, "");
});
test("weekly report keeps independent snapshots and outputs an escaped five-column table", async (t) => {
  const c = await setup(t);
  await createTask(c, "<img src=x onerror=alert(1)>");
  const row = c.w.document.querySelector("#taskTable tbody tr");
  row.querySelector("button").click();
  await tick();
  const f = c.$("recordForm");
  f.elements.text.value = "完成接口修复，已提测";
  f.elements.stage.value = "已提测";
  await c.submit("recordForm");
  c.nav("reports");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "新建本周周报")
    .click();
  await tick();
  const candidate = c.w.document.querySelector(".candidate input");
  assert.ok(candidate);
  candidate.click();
  await tick();
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "加入选中任务")
    .click();
  await tick();
  assert.equal(c.get().reports[0].rows.length, 1);
  assert.equal(c.get().reports[0].rows[0].stage, "已提测");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "编辑")
    .click();
  await tick();
  const rf = c.$("reportRowForm");
  rf.elements.details.value = "<script>alert(1)</script>\n接口修复";
  rf.elements.stage.value = "已发布";
  rf.elements.owners.value = "我";
  await c.submit("reportRowForm");
  assert.equal(c.$("reportEditDialog").open, false);
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "预览 / 复制表格")
    .click();
  await tick();
  assert.equal(c.$("exportPreview").querySelectorAll("th").length, 10);
  assert.equal(c.$("exportPreview").querySelectorAll("script,img").length, 0);
  assert.match(c.$("exportPreview").textContent, /已发布/);
  c.$("exportDialog").close();
  const snapshot = c.get().reports[0].rows[0].details;
  c.nav("tasks");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "编辑")
    .click();
  await tick();
  c.$("taskForm").elements.title.value = "后来改过的标题";
  await c.submit("taskForm");
  assert.equal(c.get().reports[0].rows[0].details, snapshot);
});
test("legacy data migrates once and stays intact; storage conflicts block stale edits", async (t) => {
  const legacy = [
    {
      id: "old",
      name: "旧任务",
      description: "原始说明",
      status: "done",
      priority: "high",
      tags: [],
    },
  ];
  const c = await setup(t, legacy);
  assert.equal(c.get().tasks[0].title, "旧任务");
  assert.deepEqual(
    JSON.parse(c.w.localStorage.getItem("shixu-projects-v1")),
    legacy,
  );
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "编辑")
    .click();
  await tick();
  const raw = c.w.localStorage.getItem(key),
    other = JSON.parse(raw);
  other.tasks[0].title = "其他标签页修改";
  c.w.localStorage.setItem(key, JSON.stringify(other));
  c.$("taskForm").elements.title.value = "我的过期编辑";
  await c.submit("taskForm");
  assert.match(c.$("toast").textContent, /其他标签页/);
  assert.equal(c.get().tasks[0].title, "其他标签页修改");
});
test("backup restore preserves full records and reports; invalid backups do not replace data", async (t) => {
  const c = await setup(t);
  await createTask(c);
  const saved = c.get();
  const upload = async (obj) => {
    Object.defineProperty(c.$("restoreFile"), "files", {
      configurable: true,
      value: [{ size: 1000, text: async () => JSON.stringify(obj) }],
    });
    c.$("restoreFile").dispatchEvent(new c.w.Event("change"));
    await tick();
  };
  await upload({ version: 2, projects: [] });
  assert.equal(c.get().tasks.length, 1);
  assert.match(c.$("toast").textContent, /结构无效/);
  const next = JSON.parse(JSON.stringify(saved));
  next.tasks[0].title = "备份中的任务";
  await upload(next);
  assert.equal(c.$("confirmDialog").open, true);
  c.$("confirmDialog").returnValue = "yes";
  c.$("confirmDialog").close();
  await tick();
  assert.equal(c.get().tasks[0].title, "备份中的任务");
});
test("report metadata persists without replacing the focused form; temporary work can be saved", async (t) => {
  const c = await setup(t);
  c.nav("reports");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "新建本周周报")
    .click();
  await tick();
  const input = [...c.$("viewRoot").querySelectorAll("input")].find((el) =>
    el.value.endsWith("周报"),
  );
  input.value = "我的周报";
  input.dispatchEvent(new c.w.Event("change"));
  await tick();
  assert.equal(c.get().reports[0].title, "我的周报");
  assert.equal(input.isConnected, true);
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "＋ 临时工作 / 下周计划")
    .click();
  await tick();
  c.$("reportRowForm").elements.details.value =
    "临时处理生产环境问题，等待验证";
  await c.submit("reportRowForm");
  assert.equal(c.get().reports[0].rows[0].taskIds.length, 0);
  assert.equal(c.get().reports[0].rows[0].stage, "");
});
test("report merge and split retain task references and original text; import history is accessible", async (t) => {
  const c = await setup(t);
  await createTask(c, "任务甲");
  await createTask(c, "任务乙");
  c.nav("reports");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "新建本周周报")
    .click();
  await tick();
  const all =
    c.w.document.querySelector(".section-top .check input") ||
    [...c.$("viewRoot").querySelectorAll("input[type=checkbox]")][0];
  all.click();
  await tick();
  for (const checkbox of c.w.document.querySelectorAll(".candidate input"))
    checkbox.click();
  await tick();
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "加入选中任务")
    .click();
  await tick();
  assert.equal(c.get().reports[0].rows.length, 2);
  for (const checkbox of c.w.document.querySelectorAll(".report-row>input"))
    checkbox.click();
  await tick();
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "合并选中事项")
    .click();
  await tick();
  assert.equal(c.get().reports[0].rows.length, 1);
  assert.equal(c.get().reports[0].rows[0].taskIds.length, 2);
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "拆分任务")
    .click();
  await tick();
  c.$("confirmDialog").returnValue = "yes";
  c.$("confirmDialog").close();
  await tick();
  assert.equal(c.get().reports[0].rows.length, 2);
  assert.match(c.get().reports[0].rows[0].remarks, /拆分前内容/);
  c.nav("tasks");
  [...c.$("viewRoot").querySelectorAll("button")]
    .find((b) => b.textContent === "导入记录")
    .click();
  await tick();
  assert.equal(c.$("historyDialog").open, true);
  assert.equal(c.$("undoImport").disabled, true);
});
