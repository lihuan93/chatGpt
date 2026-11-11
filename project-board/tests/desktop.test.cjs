const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const W = require("../dist/workspace.js");
const dist = path.join(__dirname, "../dist");
const tick = () => new Promise((r) => setImmediate(r));
async function setup(t) {
  const dom = new JSDOM(
      fs.readFileSync(path.join(dist, "index.html"), "utf8"),
      { url: "http://tauri.localhost/", runScripts: "outside-only" },
    ),
    w = dom.window;
  t.after(() => w.close());
  const calls = [],
    control = {
      workspace: W.empty(),
      revision: 0,
      fail: false,
      hold: null,
      exportOK: true,
      file: null,
    };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  w.TextDecoder = TextDecoder;
  Object.defineProperty(w, "localStorage", {
    get() {
      throw Error("Native mode must not touch browser storage");
    },
  });
  w.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "load_workspace")
          return {
            workspace: structuredClone(control.workspace),
            revision: control.revision,
          };
        if (command === "save_workspace") {
          if (control.hold) await control.hold;
          if (control.fail) throw "模拟磁盘写入失败";
          if (args.expectedRevision !== control.revision) throw "数据已变化";
          control.workspace = structuredClone(args.payload);
          return ++control.revision;
        }
        if (command === "export_file") return control.exportOK;
        if (command === "select_import_file") return control.file;
        if (command === "copy_content") return;
        if (command === "data_info")
          return { database: "/data/shixu.sqlite", backups: "/data/backups" };
        if (command === "backup_database") return true;
        throw Error("Unexpected native command " + command);
      },
    },
    window: { getCurrentWindow: () => ({ onCloseRequested: async () => {} }) },
  };
  for (const f of ["weekly-report.js", "workspace.js", "storage.js", "app.js"])
    w.eval(fs.readFileSync(path.join(dist, f), "utf8"));
  await w.ShixuReady;
  const $ = (id) => w.document.getElementById(id);
  const submit = async (id) => {
    $(id).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
  };
  const click = async (text) => {
    [...w.document.querySelectorAll("button")]
      .find((b) => b.textContent === text)
      .click();
    await tick();
  };
  return { w, $, control, calls, submit, click };
}
test("native writes wait for SQLite acknowledgement; failures keep form open and data unchanged", async (t) => {
  const c = await setup(t);
  assert.equal(c.$("storageError").hidden, true);
  assert.equal(c.$("desktopData").hidden, false);
  assert.match(c.$("storageMode").textContent, /SQLite/);
  c.$("addTask").click();
  c.$("projectForm").elements.name.value = "本机项目";
  let release;
  c.control.hold = new Promise((r) => (release = r));
  await c.submit("projectForm");
  assert.equal(c.control.workspace.projects.length, 0);
  assert.equal(c.$("projectDialog").open, true);
  assert.match(c.$("saveStatus").textContent, /正在保存/);
  release();
  c.control.hold = null;
  await tick();
  assert.equal(c.control.workspace.projects.length, 1);
  assert.equal(c.$("projectDialog").open, false);
  c.$("taskForm").elements.title.value = "待保存任务";
  c.control.fail = true;
  await c.submit("taskForm");
  assert.equal(c.control.workspace.tasks.length, 0);
  assert.equal(c.$("taskDialog").open, true);
  assert.match(c.$("toast").textContent, /磁盘写入失败/);
  c.control.fail = false;
  await c.submit("taskForm");
  assert.equal(c.control.workspace.tasks.length, 1);
  assert.equal(c.$("taskDialog").open, false);
  assert.match(c.$("saveStatus").textContent, /已保存到本机 SQLite/);
  const saves = c.calls.filter((c) => c.command === "save_workspace");
  assert.equal(saves.at(-1).args.expectedRevision, 1);
});
test("native JSON migration cancellation leaves SQLite unchanged; successful replacement requests safety backup", async (t) => {
  const c = await setup(t);
  const next = W.empty();
  next.projects.push({ id: "p", name: "网页迁入", description: "" });
  c.control.file = {
    name: "backup.json",
    bytes: [...new TextEncoder().encode(JSON.stringify(next))],
  };
  c.control.exportOK = false;
  c.$("restore").click();
  await tick();
  c.$("confirmDialog").returnValue = "yes";
  c.$("confirmDialog").close();
  await tick();
  assert.equal(c.control.revision, 0);
  c.control.exportOK = true;
  c.$("restore").click();
  await tick();
  c.$("confirmDialog").returnValue = "yes";
  c.$("confirmDialog").close();
  await tick();
  assert.equal(c.control.workspace.projects[0].name, "网页迁入");
  assert.equal(
    c.calls.filter((c) => c.command === "save_workspace").at(-1).args
      .protectRestore,
    true,
  );
});
test("native report copy uses HTML clipboard and native export uses save dialog", async (t) => {
  const c = await setup(t);
  c.w.document.querySelector("[data-view=reports]").click();
  await c.click("新建本周周报");
  await c.click("＋ 临时工作 / 下周计划");
  c.$("reportRowForm").elements.details.value = "实际完成内容";
  await c.submit("reportRowForm");
  await c.click("预览 / 复制表格");
  c.$("copyExport").click();
  await tick();
  const call = c.calls.find((c) => c.command === "copy_content");
  assert.match(call.args.html, /<table/);
  assert.match(call.args.text, /实际完成内容/);
  c.$("downloadExport").click();
  await tick();
  assert.ok(
    c.calls.some(
      (c) => c.command === "export_file" && c.args.name.endsWith(".md"),
    ),
  );
});
test("a broken native bridge cannot silently fall back to browser storage", async (t) => {
  const dom = new JSDOM(
    fs.readFileSync(path.join(dist, "index.html"), "utf8"),
    { url: "http://tauri.localhost/", runScripts: "outside-only" },
  );
  t.after(() => dom.window.close());
  const w = dom.window;
  let browserWrites = 0;
  Object.defineProperty(w, "localStorage", {
    get() {
      browserWrites++;
      throw Error("browser storage forbidden");
    },
  });
  w.__TAURI_INTERNALS__ = {};
  for (const f of ["weekly-report.js", "workspace.js", "storage.js", "app.js"])
    w.eval(fs.readFileSync(path.join(dist, f), "utf8"));
  await w.ShixuReady;
  assert.equal(browserWrites, 0);
  assert.equal(w.document.getElementById("storageError").hidden, false);
  assert.match(
    w.document.getElementById("storageError").textContent,
    /暂停写入/,
  );
});
