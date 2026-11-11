window.ShixuReady = (async () => {
  "use strict";
  const W = Workspace,
    $ = (id) => document.getElementById(id),
    KEY = "shixu-workspace-v2";
  const titles = {
    tasks: [
      "我的任务",
      "把每一步进展，留下来。",
      "按项目整理任务，把实际进展记下来。",
    ],
    projects: [
      "项目归类",
      "给手头的工作，一个位置。",
      "个人归类独立于来源项目，下次导入会继续保留。",
    ],
    records: [
      "工作记录",
      "做过的事，值得留下。",
      "一句进展也可以成为周报与项目经历的起点。",
    ],
    reports: [
      "每周汇报",
      "让一周的进展，清楚可见。",
      "核对实际工作，整理成团队文档需要的表格。",
    ],
    career: [
      "工作积累",
      "把日常工作，积累成经历。",
      "按项目回顾真实贡献，为简历、述职与面试保留依据。",
    ],
  };
  let state = W.empty(),
    storedRaw = null,
    readOnly = false,
    view = "tasks",
    timer,
    taskEdit = null,
    projectEdit = null,
    recordEdit = null,
    rowEdit = null,
    dialogBase = null,
    importBase = null,
    importPlan = [];
  let query = "",
    projectFilter = "",
    statusFilter = "",
    priorityFilter = "",
    focusOnly = false,
    recordQuery = "",
    recordProject = "",
    recordStart = "",
    recordEnd = "",
    reportId = null;
  let exportBody = "",
    exportName = "",
    exportType = "",
    exportHTML = "",
    reportCandidates = new Set(),
    rowSelection = new Set(),
    showAllCandidates = false;
  function toast(s) {
    $("toast").textContent = s;
    $("toast").hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => ($("toast").hidden = true), 5000);
  }
  function h(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity))
      if (c !== null && c !== undefined)
        n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const btn = (text, fn, cls = "") =>
    h(
      "button",
      {
        type: "button",
        class: cls,
        onclick: async (...args) => {
          if (savePending) await savePending;
          return fn(...args);
        },
      },
      text,
    );
  const badge = (s, cls = "") => h("span", { class: "badge " + cls }, s);
  const projectName = (id) =>
    state.projects.find((p) => p.id === id)?.name || "未归类";
  const taskName = (id) =>
    state.tasks.find((t) => t.id === id)?.title || "未关联任务";
  const today = () => WeeklyReport.today();
  async function download(body, name, type = "text/plain;charset=utf-8") {
    if (ShixuStorage.native) {
      try {
        return await ShixuStorage.exportFile(name, body);
      } catch (e) {
        toast("导出失败：" + String(e.message || e));
        return false;
      }
    }
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = h("a", { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  async function backup() {
    return await download(
      JSON.stringify(state, null, 2),
      "拾序完整备份-" + today() + ".json",
      "application/json",
    );
  }
  let store = null,
    saving = false;
  let savePending = null,
    finishSave = null;
  async function commit(next, base = storedRaw, allowRestore = false) {
    if (saving) {
      toast("正在保存，请稍候再操作。");
      return false;
    }
    try {
      if (readOnly && !allowRestore)
        throw Error("原数据无法读取，已暂停写入。请先恢复有效备份。");
      if (!store) throw Error("数据存储尚未就绪，请重新加载。");
      W.validate(next);
      saving = true;
      savePending = new Promise((resolve) => {
        finishSave = resolve;
      });
      $("saveStatus").textContent = "正在保存…";
      storedRaw = await store.save(next, base, allowRestore);
      state = next;
      if (allowRestore) {
        readOnly = false;
        $("storageError").hidden = true;
      }
      $("saveStatus").textContent = store.native
        ? "已保存到本机 SQLite"
        : "已保存到当前浏览器";
      return true;
    } catch (e) {
      $("saveStatus").textContent = "未能保存，请重试";
      toast(String(e.message || e || "保存失败"));
      return false;
    } finally {
      saving = false;
      finishSave?.();
      savePending = null;
      finishSave = null;
    }
  }
  async function change(fn, base = storedRaw) {
    const next = W.clone(state);
    fn(next);
    if (!(await commit(next, base))) return false;
    render();
    return true;
  }
  try {
    store = await ShixuStorage.open(W);
    state = store.initial;
    storedRaw = store.token;
    if (store.migrated) toast("旧版内容已迁入旧版任务，原始数据仍保留。");
    $("storageMode").textContent = store.native
      ? "离线使用 · 本机 SQLite"
      : "数据保存在当前浏览器";
    $("saveStatus").textContent = store.native
      ? "已连接本机数据库"
      : "请定期导出完整备份";
    $("desktopData").hidden = !store.native;
  } catch (e) {
    readOnly = true;
    $("storageError").hidden = false;
    $("storageError").textContent =
      "无法读取数据，已暂停写入：" +
      String(e.message || e) +
      "。不会使用空数据覆盖原文件。";
  }

  async function confirmAction(title, message) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = message;
    $("confirmDialog").returnValue = "";
    $("confirmDialog").showModal();
    return new Promise((resolve) =>
      $("confirmDialog").addEventListener(
        "close",
        () => resolve($("confirmDialog").returnValue === "yes"),
        { once: true },
      ),
    );
  }
  function options(select, values, emptyLabel) {
    select.replaceChildren();
    if (emptyLabel !== undefined)
      select.append(h("option", { value: "" }, emptyLabel));
    values.forEach((x) =>
      select.append(
        h(
          "option",
          { value: typeof x === "string" ? x : x.id },
          typeof x === "string" ? x : x.name,
        ),
      ),
    );
  }
  function filterSelect(values, value, label, fn) {
    const s = h("select", {
      "aria-label": label,
      onchange: (e) => fn(e.target.value),
    });
    options(s, values, label);
    s.value = value;
    return s;
  }
  function labeled(text, input) {
    return h("label", {}, text, input);
  }
  function navigate(v) {
    view = v;
    render();
  }
  function emptyPanel(title, text, button) {
    return h(
      "div",
      { class: "empty" },
      h("div", { class: "symbol" }, "◇"),
      h("h3", {}, title),
      h("p", {}, text),
      button,
    );
  }
  function render() {
    const t = titles[view];
    $("breadcrumb").textContent = t[0];
    $("pageTitle").textContent = t[1];
    $("pageHint").textContent = t[2];
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("addTask").hidden = !["tasks", "projects"].includes(view);
    const active = state.tasks.filter((t) =>
      ["开发中", "修复中"].includes(t.status),
    ).length;
    const range = WeeklyReport.weekRange(today());
    const stats = [
      ["全部任务", state.tasks.length, `${state.projects.length} 个项目归类`],
      ["正在推进", active, "开发中与修复中的任务"],
      [
        "本周工作记录",
        state.records.filter((r) => W.within(r.date, range.start, range.end))
          .length,
        "北京时间 · 周一至周日",
      ],
      [
        "经历素材",
        state.records.filter((r) => r.career).length,
        "留给未来的项目经历",
      ],
    ];
    $("stats").replaceChildren(
      ...stats.map(([label, num, note]) =>
        h(
          "article",
          { class: "stat" },
          h("span", {}, label),
          h("strong", {}, num),
          h("small", {}, note),
        ),
      ),
    );
    const root = $("viewRoot");
    root.replaceChildren();
    ({
      tasks: renderTasks,
      projects: renderProjects,
      records: (root) => renderRecords(root, false),
      career: (root) => renderRecords(root, true),
      reports: renderReports,
    })[view](root);
  }
  function renderTasks(root) {
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h2", {}, "我的任务"),
        h(
          "div",
          { class: "tools" },
          btn("＋ 新建项目", () => openProject()),
          btn("导入记录", () => {
            showImportHistory(root);
          }),
        ),
      ),
    );
    const search = h("input", {
      type: "search",
      value: query,
      placeholder: "搜索标题、ID、标签、模块…",
      "aria-label": "搜索任务",
      oninput: (e) => {
        query = e.target.value;
        renderTaskTable();
      },
    });
    const filters = h(
      "div",
      { class: "toolbar" },
      search,
      filterSelect(state.projects, projectFilter, "全部项目", (v) => {
        projectFilter = v;
        renderTaskTable();
      }),
      filterSelect(W.STATUS, statusFilter, "全部状态", (v) => {
        statusFilter = v;
        renderTaskTable();
      }),
      filterSelect(W.PRIORITY, priorityFilter, "全部优先级", (v) => {
        priorityFilter = v;
        renderTaskTable();
      }),
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          checked: focusOnly,
          onchange: (e) => {
            focusOnly = e.target.checked;
            renderTaskTable();
          },
        }),
        "本周关注",
      ),
    );
    root.append(filters, h("div", { id: "taskTable" }));
    renderTaskTable();
  }
  function renderTaskTable() {
    const target = $("taskTable");
    if (!target) return;
    const rows = state.tasks
      .filter(
        (t) =>
          (!projectFilter || t.projectId === projectFilter) &&
          (!statusFilter || t.status === statusFilter) &&
          (!priorityFilter || t.priority === priorityFilter) &&
          (!focusOnly || t.focus) &&
          [t.title, t.sourceId, t.tags, t.module, t.description]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(b.focus) - Number(a.focus) ||
          W.PRIORITY.indexOf(a.priority) - W.PRIORITY.indexOf(b.priority),
      );
    if (!rows.length) {
      target.replaceChildren(
        emptyPanel(
          state.tasks.length ? "没有匹配的任务" : "从你的任务文件开始",
          "导入任务 CSV，按 ID 同步；也可以直接创建任务。",
          btn("↥ 导入任务 CSV", openImport, "primary"),
        ),
      );
      return;
    }
    const table = h(
      "table",
      { class: "task-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          [
            "任务 / 来源",
            "项目 / 模块",
            "状态",
            "优先级",
            "截止日期",
            "操作",
          ].map((s) => h("th", {}, s)),
        ),
      ),
      h(
        "tbody",
        {},
        rows.map((t) =>
          h(
            "tr",
            {},
            h(
              "td",
              { class: "title-cell" },
              h(
                "span",
                { class: "task-name" },
                t.focus ? "✦ " + t.title : t.title,
              ),
              h(
                "div",
                { class: "task-meta" },
                `${t.sourceId || "手动任务"} · ${t.assignee || "执行者未填"}${t.tags ? " · " + t.tags : ""}`,
              ),
            ),
            h(
              "td",
              {},
              projectName(t.projectId),
              h("div", { class: "task-meta" }, t.module || ""),
            ),
            h(
              "td",
              {},
              badge(
                t.status,
                ["已完成", "已解决"].includes(t.status) ? "done" : "",
              ),
            ),
            h(
              "td",
              {},
              badge(
                t.priority,
                t.priority === "非常紧急"
                  ? "urgent"
                  : t.priority === "紧急"
                    ? "high"
                    : "gray",
              ),
            ),
            h(
              "td",
              {
                class:
                  t.due &&
                  t.due < today() &&
                  !["已完成", "已解决", "已取消"].includes(t.status)
                    ? "overdue"
                    : "",
              },
              t.due || "—",
            ),
            h(
              "td",
              {},
              h(
                "div",
                { class: "row-actions" },
                btn("记进展", () => openRecord(null, t.id)),
                btn("编辑", () => openTask(t)),
                btn(
                  t.focus ? "取消关注" : "关注",
                  async () =>
                    await change(
                      (n) =>
                        (n.tasks.find((x) => x.id === t.id).focus = !t.focus),
                    ),
                ),
                btn("删除", () => deleteTask(t), "danger-button"),
              ),
            ),
          ),
        ),
      ),
    );
    target.replaceChildren(h("div", { class: "table-wrap" }, table));
  }
  async function deleteTask(t) {
    if (
      state.records.some((r) => r.taskId === t.id) ||
      state.reports.some((r) => r.rows.some((x) => x.taskIds.includes(t.id)))
    ) {
      toast("任务已有工作记录或周报引用，请改为“已取消”保留关联。");
      return;
    }
    if (
      await confirmAction(
        "删除任务？",
        "仅删除这条任务；再次导入相同来源 ID 时会重新新增。",
      )
    )
      await change((n) => (n.tasks = n.tasks.filter((x) => x.id !== t.id)));
  }
  function openTask(t) {
    if (!state.projects.length) {
      openProject(null, true);
      return;
    }
    taskEdit = t?.id || null;
    dialogBase = storedRaw;
    const f = $("taskForm");
    f.reset();
    options(f.elements.projectId, state.projects);
    options(f.elements.status, W.STATUS);
    options(f.elements.priority, W.PRIORITY);
    f.elements.priority.value = "普通";
    if (projectFilter) f.elements.projectId.value = projectFilter;
    for (const k of [
      "title",
      "description",
      "module",
      "projectId",
      "status",
      "priority",
      "due",
      "completedAt",
      "assignee",
      "tags",
      "link",
    ])
      if (t) f.elements[k].value = t[k] || "";
    f.elements.focus.checked = !!t?.focus;
    f.elements.completedAt.max = today();
    $("taskTitle").textContent = t ? "编辑任务" : "新建任务";
    $("taskSource").textContent = t
      ? `来源：${t.source || "手动"} / ${t.sourceId || t.id}。导入会更新来源字段，个人归类与记录保留。`
      : "先建任务，随时追加进展。";
    $("taskDialog").showModal();
    f.elements.title.focus();
  }
  $("taskForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      old = state.tasks.find((t) => t.id === taskEdit);
    const t = {
      ...(old || {}),
      id: taskEdit || W.id(),
      source: old?.source || "手动",
      sourceId: old?.sourceId || "",
      focus: f.elements.focus.checked,
    };
    for (const k of [
      "title",
      "description",
      "module",
      "projectId",
      "status",
      "priority",
      "due",
      "completedAt",
      "assignee",
      "tags",
      "link",
    ])
      t[k] = f.elements[k].value.trim();
    if (!t.title) return toast("请输入任务标题");
    if (!W.safeURL(t.link)) return toast("链接需以 http 或 https 开头");
    if (t.completedAt && t.completedAt > today())
      return toast("完成日期不能晚于今天");
    if (t.status !== "已完成") t.completedAt = "";
    if (
      await change((n) => {
        if (old) n.tasks[n.tasks.findIndex((x) => x.id === old.id)] = t;
        else n.tasks.unshift(t);
      }, dialogBase)
    ) {
      $("taskDialog").close();
      toast("任务已保存");
    }
  };
  let projectThenTask = false;
  function openProject(p, thenTask = false) {
    projectEdit = p?.id || null;
    projectThenTask = thenTask;
    dialogBase = storedRaw;
    const f = $("projectForm");
    f.reset();
    f.elements.name.value = p?.name || "";
    f.elements.description.value = p?.description || "";
    $("projectDialog").showModal();
  }
  $("projectForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      name = f.elements.name.value.trim();
    if (!name) return toast("请输入项目名称");
    if (state.projects.some((p) => p.name === name && p.id !== projectEdit))
      return toast("已有同名项目");
    const p = {
      id: projectEdit || W.id(),
      name,
      description: f.elements.description.value.trim(),
    };
    if (
      await change((n) => {
        if (projectEdit)
          n.projects[n.projects.findIndex((x) => x.id === projectEdit)] = p;
        else n.projects.push(p);
      }, dialogBase)
    ) {
      $("projectDialog").close();
      if (projectThenTask) {
        projectFilter = p.id;
        openTask();
      }
    }
  };
  function renderProjects(root) {
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h2", {}, "按项目回顾进展"),
        btn("＋ 新建项目", () => openProject(), "primary"),
      ),
    );
    if (!state.projects.length) {
      root.append(
        emptyPanel(
          "还没有项目",
          "导入时可以确认项目归类，或者先新建一个项目。",
          btn("新建项目", () => openProject(), "primary"),
        ),
      );
      return;
    }
    const range = WeeklyReport.weekRange(today());
    root.append(
      h(
        "div",
        { class: "cards" },
        state.projects.map((p) => {
          const tasks = state.tasks.filter((t) => t.projectId === p.id),
            completed = tasks.filter((t) =>
              W.within(t.completedAt, range.start, range.end),
            ).length,
            records = state.records.filter((r) =>
              tasks.some((t) => t.id === r.taskId),
            );
          return h(
            "article",
            { class: "card" },
            badge("◇ 项目"),
            h("h3", { style: "margin-top:15px" }, p.name),
            h("p", {}, p.description || "还没有项目说明"),
            h(
              "div",
              { class: "large" },
              tasks.length,
              h("small", { class: "muted" }, " 条任务"),
            ),
            h(
              "p",
              {},
              `推进中 ${tasks.filter((t) => ["开发中", "修复中"].includes(t.status)).length} · 本周确认完成 ${completed} · 经历素材 ${records.filter((r) => r.career).length}`,
            ),
            h(
              "div",
              { class: "tools" },
              btn("查看任务", () => {
                projectFilter = p.id;
                statusFilter = "";
                priorityFilter = "";
                focusOnly = false;
                query = "";
                navigate("tasks");
              }),
              btn("编辑", () => openProject(p)),
              btn("工作记录", () => {
                recordProject = p.id;
                navigate("records");
              }),
              btn(
                "删除",
                async () => {
                  if (tasks.length)
                    return toast("请先把项目下的任务移到其他项目");
                  if (
                    await confirmAction(
                      "删除项目？",
                      "此项目没有任务，删除后不能撤销。",
                    )
                  )
                    await change(
                      (n) =>
                        (n.projects = n.projects.filter((x) => x.id !== p.id)),
                    );
                },
                "danger-button",
              ),
            ),
          );
        }),
      ),
    );
  }
  function openRecord(r, taskId) {
    if (!state.tasks.length) {
      toast("请先导入或新建任务");
      return;
    }
    recordEdit = r?.id || null;
    dialogBase = storedRaw;
    const f = $("recordForm");
    f.reset();
    options(
      f.elements.taskId,
      state.tasks.map((t) => ({
        id: t.id,
        name: `${projectName(t.projectId)} · ${t.title}`,
      })),
    );
    options(f.elements.stage, W.STAGES, "未填写");
    f.elements.date.value = today();
    if (taskId) f.elements.taskId.value = taskId;
    for (const k of [
      "taskId",
      "date",
      "stage",
      "text",
      "background",
      "role",
      "solution",
      "challenge",
      "result",
      "tags",
      "evidence",
    ])
      if (r) f.elements[k].value = r[k] || "";
    f.elements.career.checked = !!r?.career;
    $("careerFields").open = !!r?.career;
    $("recordTitle").textContent = r ? "编辑工作记录" : "记一条进展";
    $("recordDialog").showModal();
    f.elements.text.focus();
  }
  $("recordForm").elements.career.onchange = (e) => {
    $("careerFields").open = e.target.checked;
  };
  $("recordForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      r = { id: recordEdit || W.id(), career: f.elements.career.checked };
    for (const k of [
      "taskId",
      "date",
      "stage",
      "text",
      "background",
      "role",
      "solution",
      "challenge",
      "result",
      "tags",
      "evidence",
    ])
      r[k] = f.elements[k].value.trim();
    if (!r.text) return toast("请填写实际进展");
    if (!W.safeURL(r.evidence)) return toast("证据链接需以 http 或 https 开头");
    if (
      await change((n) => {
        if (recordEdit)
          n.records[n.records.findIndex((x) => x.id === recordEdit)] = r;
        else n.records.push(r);
      }, dialogBase)
    ) {
      $("recordDialog").close();
      toast("工作记录已保存");
    }
  };
  function renderRecords(root, career) {
    const filtered = () =>
      state.records
        .filter(
          (r) =>
            (!career || r.career) &&
            (!recordProject ||
              state.tasks.find((t) => t.id === r.taskId)?.projectId ===
                recordProject) &&
            (!recordStart || r.date >= recordStart) &&
            (!recordEnd || r.date <= recordEnd) &&
            [r.text, r.result, r.tags, taskName(r.taskId)]
              .join(" ")
              .toLowerCase()
              .includes(recordQuery.toLowerCase()),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h2", {}, career ? "值得留下的项目经历" : "工作记录时间线"),
        btn("＋ 记一条进展", () => openRecord(), "primary"),
      ),
    );
    const privateCheck = h("input", { type: "checkbox", checked: true });
    const exportFilters = () => ({
      start: recordStart,
      end: recordEnd,
      projectId: recordProject,
      career,
      privateDetails: privateCheck.checked,
    });
    root.append(
      h(
        "div",
        { class: "export-panel" },
        h(
          "p",
          { class: "muted" },
          career
            ? "按项目汇总跨周素材；缺少职责、方案和成果的记录会保留“待补充”。"
            : "按项目、时间导出原始记录，便于后续整理周报、述职或简历。",
        ),
        h(
          "div",
          { class: "toolbar" },
          filterSelect(state.projects, recordProject, "全部项目", (v) => {
            recordProject = v;
            render();
          }),
          labeled(
            "开始日期",
            h("input", {
              type: "date",
              value: recordStart,
              onchange: (e) => {
                recordStart = e.target.value;
                render();
              },
            }),
          ),
          labeled(
            "结束日期",
            h("input", {
              type: "date",
              value: recordEnd,
              onchange: (e) => {
                recordEnd = e.target.value;
                render();
              },
            }),
          ),
          h(
            "label",
            { class: "check" },
            privateCheck,
            "包含来源 ID 和证据链接",
          ),
          btn(
            "汇总导出 Markdown",
            () => {
              if (recordStart && recordEnd && recordStart > recordEnd)
                return toast("开始日期不能晚于结束日期");
              showExport(
                W.recordsMarkdown(state, exportFilters()),
                (career ? "项目经历素材" : "工作记录汇总") +
                  "-" +
                  today() +
                  ".md",
                "text/markdown;charset=utf-8",
              );
            },
            "primary",
          ),
        ),
      ),
    );
    const search = h("input", {
      type: "search",
      value: recordQuery,
      placeholder: "搜索任务、进展或技术标签",
      "aria-label": "搜索工作记录",
      oninput: (e) => {
        recordQuery = e.target.value;
        drawRecords();
      },
    });
    root.append(
      h("div", { class: "toolbar" }, search),
      h("div", { id: "recordList" }),
    );
    function drawRecords() {
      const rows = filtered(),
        list = $("recordList");
      if (!rows.length) {
        list.replaceChildren(
          emptyPanel(
            career ? "把值得回顾的工作留下来" : "还没有匹配的工作记录",
            "在任务上点“记进展”；勾选“经历素材”后，也会出现在工作积累里。",
            btn("记一条进展", () => openRecord()),
          ),
        );
        return;
      }
      list.replaceChildren(
        ...rows.map((r) => {
          const t = state.tasks.find((t) => t.id === r.taskId);
          const fields = h("dl");
          for (const [key, label] of [
            ["background", "背景"],
            ["role", "我的职责"],
            ["solution", "方案"],
            ["challenge", "难点"],
            ["result", "结果"],
            ["tags", "技术标签"],
          ])
            if (r[key]) fields.append(h("dt", {}, label), h("dd", {}, r[key]));
          const missing = career
            ? ["role", "solution", "result"].filter((k) => !r[k])
            : [];
          return h(
            "article",
            { class: "record" },
            h(
              "div",
              { class: "record-head" },
              h("time", {}, r.date),
              badge(projectName(t.projectId)),
              r.stage ? badge(r.stage) : null,
              r.career ? badge("✧ 经历素材") : null,
            ),
            h("h3", {}, t.title),
            h("p", {}, r.text),
            fields,
            missing.length
              ? h(
                  "p",
                  { class: "muted" },
                  "待补充：" +
                    missing
                      .map(
                        (k) =>
                          ({
                            role: "我的职责",
                            solution: "处理方案",
                            result: "结果",
                          })[k],
                      )
                      .join("、"),
                )
              : null,
            r.evidence
              ? h(
                  "a",
                  {
                    href: r.evidence,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  "查看证据 ↗",
                )
              : null,
            h(
              "div",
              { class: "tools" },
              btn(
                r.career ? "取消素材标记" : "标记为经历素材",
                async () =>
                  await change(
                    (n) =>
                      (n.records.find((x) => x.id === r.id).career = !r.career),
                  ),
              ),
              btn("编辑", () => openRecord(r)),
              btn(
                "删除",
                async () => {
                  if (
                    await confirmAction(
                      "删除工作记录？",
                      "已保存周报的文字快照会保留，此条原始工作记录将删除。",
                    )
                  )
                    await change(
                      (n) =>
                        (n.records = n.records.filter((x) => x.id !== r.id)),
                    );
                },
                "danger-button",
              ),
            ),
          );
        }),
      );
    }
    drawRecords();
  }
  function openImport() {
    importPlan = [];
    importBase = storedRaw;
    $("csvFile").value = "";
    $("importPreview").replaceChildren();
    $("importSummary").textContent =
      "选择任务 CSV 后，先核对新增、更新和项目归类。首次导入不推断完成日期。";
    $("importApply").disabled = true;
    $("importDialog").showModal();
  }
  async function readImport() {
    const file = $("csvFile").files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("单次文件请控制在 5 MB 内");
      const bytes = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
      }
      importPlan = W.planImport(
        state,
        W.parseCSV(text),
        $("importSource").value.trim(),
      );
      importBase = storedRaw;
      drawImport();
    } catch (e) {
      importPlan = [];
      $("importApply").disabled = true;
      $("importPreview").replaceChildren();
      $("importSummary").textContent = e.message || "文件读取失败";
    }
  }
  $("csvFile").onchange = readImport;
  $("importSource").onchange = readImport;
  function drawImport() {
    const counts = {};
    importPlan.forEach((p) => (counts[p.action] = (counts[p.action] || 0) + 1));
    $("importSummary").textContent =
      Object.entries(counts)
        .map(([k, v]) => `${k} ${v} 条`)
        .join(" · ") +
      "。空白字段保留原值；旧版本与异常行跳过。归类建议请确认。";
    $("importApply").disabled = !importPlan.some((p) =>
      ["新增", "更新"].includes(p.action),
    );
    const headers = [
      "导入",
      "动作 / ID",
      "任务",
      "字段变化 / 检查",
      "个人项目归类",
    ];
    $("importPreview").replaceChildren(
      h(
        "table",
        { class: "import-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            headers.map((s) => h("th", {}, s)),
          ),
        ),
        h(
          "tbody",
          {},
          importPlan.map((p) => {
            const enabled = ["新增", "更新"].includes(p.action);
            p.selected = enabled;
            const personal = h("input", {
              value: p.projectName,
              maxLength: 200,
              disabled: p.action !== "新增",
              "aria-label": p.code + "的个人项目归类",
              oninput: (e) => (p.projectName = e.target.value),
            });
            return h(
              "tr",
              {},
              h(
                "td",
                {},
                h("input", {
                  type: "checkbox",
                  checked: enabled,
                  disabled: !enabled,
                  "aria-label": "导入 " + p.code,
                  onchange: (e) => (p.selected = e.target.checked),
                }),
              ),
              h(
                "td",
                {},
                badge(p.action),
                h("div", { class: "task-meta" }, p.code),
              ),
              h(
                "td",
                {},
                p.fields.title,
                h(
                  "div",
                  { class: "task-meta" },
                  `${p.fields.status} · ${p.fields.priority}`,
                ),
              ),
              h(
                "td",
                {},
                p.errors.length
                  ? p.errors.join("；")
                  : p.action === "新增"
                    ? "首次建立底账"
                    : p.action === "旧版本"
                      ? "来源更新时间早于已存版本"
                      : p.changed
                          .map(
                            (k) =>
                              ({
                                title: "标题",
                                status: "状态",
                                priority: "优先级",
                                due: "截止日期",
                                sourceUpdatedAt: "更新时间",
                                tags: "标签",
                                assignee: "执行者",
                                participants: "参与者",
                                business: "业务条线",
                              })[k] || k,
                          )
                          .join("、") || "无变化",
                h("div", { class: "muted" }, p.warning),
              ),
              h("td", {}, personal),
            );
          }),
        ),
      ),
    );
  }
  $("importApply").onclick = async () => {
    if ($("importSource").value.trim() !== importPlan[0]?.source)
      return toast("来源名称已修改，请重新选择文件生成预览");
    const next = W.applyImport(state, importPlan);
    if (
      next.tasks.length === state.tasks.length &&
      next.imports.length === state.imports.length
    )
      return toast("没有选中可导入的变化");
    if (await commit(next, importBase)) {
      $("importDialog").close();
      render();
      toast("任务已同步，实际完成日期仍需确认");
    }
  };
  function showImportHistory() {
    const batches = state.imports.slice().reverse();
    $("historyRoot").replaceChildren(
      ...batches.map((batch) =>
        h(
          "details",
          {},
          h(
            "summary",
            {},
            new Intl.DateTimeFormat("zh-CN", {
              timeZone: "Asia/Shanghai",
              dateStyle: "short",
              timeStyle: "short",
              hour12: false,
            }).format(new Date(batch.at)) +
              " · " +
              batch.source +
              " · " +
              batch.changes.length +
              " 条变更",
          ),
          ...batch.changes.map((c) =>
            h(
              "p",
              { class: "muted" },
              `${c.after.sourceId} · ${c.before ? "更新" : "新增"} · ${c.after.title} · ${c.before ? c.before.status + " → " : ""}${c.after.status}`,
            ),
          ),
        ),
      ),
    );
    if (!batches.length)
      $("historyRoot").append(
        h("p", { class: "muted" }, "还没有 CSV 导入记录。"),
      );
    $("undoImport").disabled = !batches.length;
    $("historyDialog").showModal();
  }
  $("undoImport").onclick = async () => {
    try {
      const next = W.undoImport(state);
      if (await commit(next)) {
        $("historyDialog").close();
        render();
        toast("最近一次导入已撤销");
      }
    } catch (e) {
      toast(e.message);
    }
  };

  function report() {
    return state.reports.find((r) => r.id === reportId);
  }
  async function saveReport(fn) {
    return await change((n) => {
      const r = n.reports.find((r) => r.id === reportId);
      fn(r);
      r.savedAt = new Date().toISOString();
    });
  }
  function renderReports(root) {
    const r = report();
    const choose = h("select", {
      "aria-label": "选择已保存周报",
      onchange: (e) => {
        reportId = e.target.value || null;
        reportCandidates.clear();
        rowSelection.clear();
        render();
      },
    });
    options(
      choose,
      state.reports
        .slice()
        .sort((a, b) => b.start.localeCompare(a.start))
        .map((r) => ({ id: r.id, name: `${r.start} — ${r.end} · ${r.title}` })),
      "选择已保存周报",
    );
    choose.value = reportId || "";
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h2", {}, "周报工作台"),
        h(
          "div",
          { class: "tools" },
          choose,
          btn("＋ 新建周报", () => createReport(), "primary"),
        ),
      ),
    );
    if (!r) {
      root.append(
        emptyPanel(
          "先选一周，整理实际发生的工作",
          "每份周报独立保存，后续任务变化不会改动过去的汇报。支持自定义起止日期。",
          btn("新建本周周报", () => createReport(), "primary"),
        ),
      );
      return;
    }
    const meta = h("div", { class: "report-meta" });
    const set = async (key, value) => {
      if (savePending) await savePending;
      const next = W.clone(state),
        updated = next.reports.find((x) => x.id === reportId);
      updated[key] = value;
      updated.savedAt = new Date().toISOString();
      if (await commit(next)) {
        Object.assign(r, updated);
        if (key === "start" || key === "end" || key === "url") render();
      }
    };
    const start = h("input", {
      type: "date",
      value: r.start,
      required: true,
      onchange: (e) => {
        if (!W.date(e.target.value) || e.target.value > r.end) {
          toast("请选择不晚于结束日期的开始日期");
          render();
          return;
        }
        reportCandidates.clear();
        set("start", e.target.value);
      },
    });
    const end = h("input", {
      type: "date",
      value: r.end,
      required: true,
      onchange: (e) => {
        if (!W.date(e.target.value) || e.target.value < r.start) {
          toast("请选择不早于开始日期的结束日期");
          render();
          return;
        }
        reportCandidates.clear();
        set("end", e.target.value);
      },
    });
    meta.append(
      h(
        "div",
        { class: "form-row" },
        labeled("开始日期", start),
        labeled("结束日期", end),
        labeled(
          "周报标题",
          h("input", {
            value: r.title,
            maxLength: 200,
            onchange: (e) => set("title", e.target.value.trim() || "工作周报"),
          }),
        ),
        labeled(
          "汇报人",
          h("input", {
            value: r.reporter,
            maxLength: 200,
            onchange: (e) => set("reporter", e.target.value),
          }),
        ),
        labeled(
          "组别",
          h("input", {
            value: r.group,
            maxLength: 200,
            onchange: (e) => set("group", e.target.value),
          }),
        ),
        labeled(
          "线上文档地址",
          h("input", {
            type: "url",
            value: r.url,
            placeholder: "粘贴对应语雀文档链接",
            onchange: (e) => {
              if (!W.safeURL(e.target.value)) {
                toast("链接需以 http 或 https 开头");
                return;
              }
              set("url", e.target.value);
            },
          }),
        ),
      ),
    );
    root.append(
      meta,
      h(
        "p",
        { class: "muted" },
        "当前编辑自动保存在本浏览器。日期与任务状态变化不能证明实际工作，请核对后再加入。线上文档需复制表格后手动填写。",
      ),
    );
    const existing = new Set(r.rows.flatMap((row) => row.taskIds));
    let cs = showAllCandidates
      ? state.tasks.map((t) => ({
          task: t,
          records: state.records.filter(
            (x) => x.taskId === t.id && W.within(x.date, r.start, r.end),
          ),
          reasons: ["手动选择，请确认属于本周工作"],
        }))
      : W.candidates(state, r.start, r.end);
    cs = cs.filter((c) => !existing.has(c.task.id));
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h3", {}, "待核对的任务"),
        h(
          "div",
          { class: "tools" },
          h(
            "label",
            { class: "check" },
            h("input", {
              type: "checkbox",
              checked: showAllCandidates,
              onchange: (e) => {
                showAllCandidates = e.target.checked;
                render();
              },
            }),
            "显示全部任务",
          ),
          btn(
            "加入选中任务",
            async () => {
              const ids = [...reportCandidates].filter((id) =>
                cs.some((c) => c.task.id === id),
              );
              if (!ids.length) return toast("请先勾选实际处理的任务");
              if (
                await saveReport((r) =>
                  ids.forEach((id) =>
                    r.rows.push(W.draftRow(state, [id], r.start, r.end)),
                  ),
                )
              ) {
                reportCandidates.clear();
                render();
              }
            },
            "primary",
          ),
        ),
      ),
    );
    const list = h("div", { class: "candidate-list table-wrap" });
    if (!cs.length)
      list.append(
        h(
          "p",
          { class: "muted", style: "padding:15px" },
          "暂无候选任务。可显示全部任务，或直接添加临时工作。",
        ),
      );
    cs.forEach((c) =>
      list.append(
        h(
          "label",
          { class: "candidate" },
          h("input", {
            type: "checkbox",
            checked: reportCandidates.has(c.task.id),
            onchange: (e) => {
              if (e.target.checked) reportCandidates.add(c.task.id);
              else reportCandidates.delete(c.task.id);
            },
          }),
          h(
            "div",
            {},
            h("p", {}, `${projectName(c.task.projectId)} · ${c.task.title}`),
            h(
              "small",
              {},
              `${c.task.sourceId || "手动任务"} · 当前状态：${c.task.status}`,
            ),
            h(
              "small",
              { class: c.records.length ? "evidence" : "" },
              c.reasons.join("；"),
            ),
            c.records.length
              ? h(
                  "p",
                  { class: "muted" },
                  c.records.map((x) => x.result || x.text).join("；"),
                )
              : null,
          ),
        ),
      ),
    );
    root.append(list);
    root.append(
      h(
        "div",
        { class: "section-top" },
        h("h3", {}, `周报事项 · ${r.rows.length} 条`),
        h(
          "div",
          { class: "tools" },
          btn("＋ 临时工作 / 下周计划", () => openRow()),
          btn("合并选中事项", async () => {
            try {
              const rows = W.mergeRows(r.rows, [...rowSelection]);
              if (await saveReport((r) => (r.rows = rows))) {
                rowSelection.clear();
                render();
              }
            } catch (e) {
              toast(e.message);
            }
          }),
        ),
      ),
    );
    if (!r.rows.length)
      root.append(
        h(
          "p",
          { class: "muted" },
          "加入任务后，补充实际结果与完成进度。已有工作记录会作为初稿，任务标题仅作参考。",
        ),
      );
    r.rows.forEach((row, index) =>
      root.append(
        h(
          "article",
          { class: "report-row" },
          h("input", {
            type: "checkbox",
            checked: rowSelection.has(row.id),
            "aria-label": "选择事项 " + (index + 1),
            onchange: (e) => {
              if (e.target.checked) rowSelection.add(row.id);
              else rowSelection.delete(row.id);
            },
          }),
          h(
            "div",
            {},
            h("p", { class: "details" }, row.details),
            h(
              "small",
              {},
              `${row.section} · ${row.stage || "进度待填写"} · ${row.owners || "责任人待填写"}`,
            ),
            row.remarks ? h("p", { class: "muted" }, row.remarks) : null,
            h(
              "div",
              { class: "tools" },
              btn("编辑", () => openRow(row)),
              btn("↑", () => moveRow(index, -1)),
              btn("↓", () => moveRow(index, 1)),
              row.taskIds.length > 1
                ? btn("拆分任务", () => splitRow(row))
                : null,
              btn("移除", async () => {
                if (
                  await confirmAction(
                    "移除周报事项？",
                    "仅移除此周报中的事项，不删除任务或工作记录。",
                  )
                )
                  await saveReport(
                    (r) => (r.rows = r.rows.filter((x) => x.id !== row.id)),
                  );
              }),
            ),
          ),
        ),
      ),
    );
    root.append(
      h(
        "div",
        { class: "section-top" },
        h(
          "div",
          { class: "tools" },
          btn(
            "预览 / 复制表格",
            () =>
              showExport(
                W.reportMarkdown(r),
                r.title + ".md",
                "text/markdown;charset=utf-8",
                W.reportHTML(r),
              ),
            "primary",
          ),
          btn("导出周报素材", () => exportMaterials(r)),
          btn("导出本周完成 CSV", () => exportCompleted(r)),
          btn("导出周报表格 CSV", () =>
            download(
              W.csv([
                ["章节", "序号", "事项详情", "完成进度", "责任人", "备注"],
                ...W.SECTIONS.flatMap((section) =>
                  r.rows
                    .filter((row) => row.section === section)
                    .map((row, i) => [
                      section,
                      i + 1,
                      row.details,
                      row.stage,
                      row.owners,
                      row.remarks,
                    ]),
                ),
              ]),
              r.title + ".csv",
              "text/csv;charset=utf-8",
            ),
          ),
          btn("下载表格（HTML）", () =>
            download(
              '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>工作周报</title>' +
                W.reportHTML(r) +
                "</html>",
              r.title + ".html",
              "text/html;charset=utf-8",
            ),
          ),
          r.url
            ? h(
                "a",
                { href: r.url, target: "_blank", rel: "noopener noreferrer" },
                "打开线上文档 ↗",
              )
            : null,
        ),
        btn(
          r.submitted ? "已填写线上文档 ✓" : "标记已填写线上文档",
          async () => await saveReport((r) => (r.submitted = !r.submitted)),
        ),
      ),
    );
    root.append(
      h(
        "p",
        { class: "muted" },
        "表格按团队模板输出。复制后请在语雀核对格式；也可下载 HTML 后用浏览器打开复制。不会自动写入线上文档。",
      ),
      btn(
        "删除这份周报",
        async () => {
          if (
            await confirmAction(
              "删除周报？",
              "只删除这份汇报快照，任务与工作记录保留。",
            )
          ) {
            const id = reportId;
            if (
              await change(
                (n) => (n.reports = n.reports.filter((x) => x.id !== id)),
              )
            ) {
              reportId = null;
              render();
            }
          }
        },
        "danger-button",
      ),
    );
  }
  async function createReport() {
    const range = WeeklyReport.weekRange(today());
    const r = {
      id: W.id(),
      ...range,
      title: range.end.replaceAll("-", "") + "周报",
      reporter: "",
      group: "",
      url: "",
      rows: [],
      submitted: false,
      savedAt: new Date().toISOString(),
    };
    if (await change((n) => n.reports.unshift(r))) {
      reportId = r.id;
      reportCandidates.clear();
      rowSelection.clear();
      render();
    }
  }
  function openRow(row) {
    rowEdit = row?.id || null;
    dialogBase = storedRaw;
    const f = $("reportRowForm");
    f.reset();
    options(f.elements.section, W.SECTIONS);
    options(f.elements.stage, W.STAGES, "待填写");
    for (const k of ["section", "details", "stage", "owners", "remarks"])
      if (row) f.elements[k].value = row[k] || "";
    $("rowLinks").textContent = row?.taskIds.length
      ? "关联任务：" +
        row.taskIds
          .map(
            (id) =>
              state.tasks.find((t) => t.id === id)?.sourceId || taskName(id),
          )
          .join("、")
      : "临时工作也可以纳入周报，无需创建来源任务。";
    $("reportEditDialog").showModal();
  }
  $("reportRowForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      old = report().rows.find((x) => x.id === rowEdit),
      row = {
        ...(old || {}),
        id: rowEdit || W.id(),
        taskIds: old?.taskIds || [],
      };
    for (const k of ["section", "details", "stage", "owners", "remarks"])
      row[k] = f.elements[k].value.trim();
    if (!row.details) return toast("请填写实际工作内容");
    if (
      await change((n) => {
        const r = n.reports.find((r) => r.id === reportId);
        if (old) r.rows[r.rows.findIndex((x) => x.id === row.id)] = row;
        else r.rows.push(row);
        r.savedAt = new Date().toISOString();
      }, dialogBase)
    )
      $("reportEditDialog").close();
  };
  async function moveRow(i, delta) {
    const r = report();
    if (i + delta < 0 || i + delta >= r.rows.length) return;
    await saveReport((r) => {
      [r.rows[i], r.rows[i + delta]] = [r.rows[i + delta], r.rows[i]];
    });
  }
  async function splitRow(row) {
    if (
      !(await confirmAction(
        "按任务重新拆分？",
        "会为每个关联任务重新生成待核对初稿，合并后的文字会放在每条事项备注中，方便保留核对。",
      ))
    )
      return;
    await saveReport((r) => {
      const i = r.rows.findIndex((x) => x.id === row.id);
      r.rows.splice(
        i,
        1,
        ...row.taskIds.map((id) => ({
          ...W.draftRow(state, [id], r.start, r.end),
          section: row.section,
          remarks: [row.remarks, "拆分前内容：" + row.details]
            .filter(Boolean)
            .join("\n"),
        })),
      );
    });
  }
  function exportMaterials(r) {
    const ids = new Set(r.rows.flatMap((row) => row.taskIds));
    const records = state.records.filter(
      (x) => ids.has(x.taskId) && W.within(x.date, r.start, r.end),
    );
    let body = W.reportMarkdown(r, true) + "\n\n## 关联任务与原始记录\n\n";
    for (const id of ids) {
      const t = state.tasks.find((t) => t.id === id);
      body += `- ${t.sourceId || t.id}：${t.title}；当前任务状态：${t.status}；来源更新时间：${t.sourceUpdatedAt || "未知"}\n`;
      for (const x of records.filter((x) => x.taskId === id))
        body += `  - ${x.date} / ${x.stage || "阶段未填"}：${x.text}；结果：${x.result || "待补充"}\n`;
    }
    showExport(
      body,
      "周报素材-" + r.start + ".md",
      "text/markdown;charset=utf-8",
    );
  }
  function exportCompleted(r) {
    const tasks = state.tasks.filter(
      (t) => W.within(t.completedAt, r.start, r.end) && t.status === "已完成",
    );
    const header = [
      "项目",
      "任务ID",
      "标题",
      "实际完成日期",
      "执行者",
      "本周记录与结果",
    ];
    const rows = tasks.map((t) => [
      projectName(t.projectId),
      t.sourceId || t.id,
      t.title,
      t.completedAt,
      t.assignee || "",
      state.records
        .filter((x) => x.taskId === t.id && W.within(x.date, r.start, r.end))
        .map((x) => x.result || x.text)
        .join("；"),
    ]);
    download(
      W.csv([header, ...rows]),
      "本周完成情况-" + r.start + ".csv",
      "text/csv;charset=utf-8",
    );
    toast(`已导出 ${rows.length} 条：仅含已确认实际完成日期的任务。`);
  }
  function showExport(body, name, type, html = "") {
    exportBody = body;
    exportName = name;
    exportType = type;
    exportHTML = html;
    $("exportTitle").textContent = html ? "周报表格预览" : "汇总导出预览";
    $("exportPreview").hidden = !html;
    $("exportPreview").innerHTML = html; // reportHTML escapes every user-provided cell.
    $("exportText").value = body;
    $("copyExport").textContent = html ? "复制表格" : "复制文字";
    $("exportText").hidden = !!html;
    $("exportDialog").showModal();
  }
  $("copyExport").onclick = async () => {
    try {
      if (ShixuStorage.native) {
        await ShixuStorage.copy(
          exportHTML ? exportBody : $("exportText").value,
          exportHTML,
        );
        toast("已复制，请粘贴到线上文档并核对格式");
        return;
      }
      if (exportHTML) {
        if (
          typeof ClipboardItem !== "undefined" &&
          navigator.clipboard?.write
        ) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([exportHTML], { type: "text/html" }),
              "text/plain": new Blob([exportBody], { type: "text/plain" }),
            }),
          ]);
        } else {
          const range = document.createRange();
          range.selectNodeContents($("exportPreview"));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          toast("已选中表格，请按 Ctrl/Cmd+C 手动复制");
          return;
        }
      } else await navigator.clipboard.writeText($("exportText").value);
      toast("已复制，请粘贴到线上文档并核对格式");
    } catch {
      if (exportHTML) {
        const range = document.createRange();
        range.selectNodeContents($("exportPreview"));
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
      } else {
        $("exportText").focus();
        $("exportText").select();
      }
      toast("自动复制不可用，内容已选中，请手动复制。");
    }
  };
  $("downloadExport").onclick = () =>
    download(
      exportHTML ? exportBody : $("exportText").value,
      exportName,
      exportType,
    );
  $("backup").onclick = backup;
  $("restore").onclick = async () => {
    if (!ShixuStorage.native) {
      $("restoreFile").click();
      return;
    }
    try {
      await restoreJSON(await ShixuStorage.selectFile("json"));
    } catch (e) {
      toast(String(e.message || e));
    }
  };
  $("restoreFile").onchange = () => restoreJSON($("restoreFile").files[0]);
  async function restoreJSON(file) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw Error("备份文件不能超过 20 MB");
      const data = JSON.parse(await file.text());
      const next =
        data.version === 2
          ? W.validate(data)
          : W.migrate(Array.isArray(data) ? data : data.projects);
      const base = storedRaw;
      if (
        !(await confirmAction(
          "恢复备份并替换当前工作台？",
          "将先下载当前数据的备份，然后替换任务、工作记录、周报和导入历史。请保管好备份文件。",
        ))
      )
        return;
      if (!(await backup())) return;
      if (await commit(next, base, true)) {
        reportId = null;
        projectFilter = "";
        recordProject = "";
        render();
        toast("备份已恢复");
      }
    } catch (e) {
      toast(e.message || "备份恢复失败");
    } finally {
      $("restoreFile").value = "";
    }
  }
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
  $("addTask").onclick = () => openTask();
  $("importOpen").onclick = openImport;
  async function reloadNativeData() {
    if (saving) {
      toast("正在保存，请稍候");
      return;
    }
    const reopened = await ShixuStorage.open(W);
    state = reopened.initial;
    storedRaw = reopened.token;
    store = reopened;
    readOnly = false;
    reportId = null;
    projectFilter = "";
    recordProject = "";
    $("storageError").hidden = true;
    render();
    $("saveStatus").textContent = "已连接本机数据库";
  }
  $("desktopData").onclick = async () => {
    try {
      const info = await ShixuStorage.invoke("data_info");
      $("dataInfo").replaceChildren(
        h("p", {}, "数据库：", h("code", {}, info.database)),
        h("p", {}, "自动备份：", h("code", {}, info.backups)),
      );
      if (info.backupWarning)
        $("dataInfo").append(
          h(
            "p",
            { class: "notice danger" },
            "自动备份失败：" + info.backupWarning,
          ),
        );
      $("dataDialog").showModal();
    } catch (e) {
      toast(String(e.message || e));
    }
  };
  $("openDataFolder").onclick = async () => {
    try {
      await ShixuStorage.invoke("open_data_directory");
    } catch (e) {
      toast(String(e));
    }
  };
  $("databaseBackup").onclick = async () => {
    try {
      if (await ShixuStorage.invoke("backup_database"))
        toast("数据库备份已保存");
    } catch (e) {
      toast("备份失败：" + String(e));
    }
  };
  $("databaseRestore").onclick = async () => {
    if (
      !(await confirmAction(
        "恢复 SQLite 数据库？",
        "将替换当前任务、记录和周报。恢复前会自动保存当前数据库快照，所选备份文件保持不变。",
      ))
    )
      return;
    if (saving) {
      toast("正在保存，请稍候");
      return;
    }
    try {
      saving = true;
      const loaded = await ShixuStorage.invoke("restore_database", {
        expectedRevision: storedRaw,
      });
      if (loaded) {
        state = W.validate(loaded.workspace);
        storedRaw = loaded.revision;
        reportId = null;
        projectFilter = "";
        recordProject = "";
        $("dataDialog").close();
        render();
        toast("数据库已恢复，原数据快照保存在 backups 中");
      }
    } catch (e) {
      toast("恢复失败：" + String(e));
    } finally {
      saving = false;
    }
  };
  $("reloadData").onclick = async () => {
    try {
      await reloadNativeData();
      $("dataDialog").close();
      toast("已重新加载本机数据库");
    } catch (e) {
      toast(String(e));
    }
  };
  window.addEventListener("storage", (e) => {
    if (ShixuStorage.native || e.key !== KEY) return;
    try {
      const next = W.validate(JSON.parse(e.newValue));
      state = next;
      storedRaw = e.newValue;
      render();
      toast("已同步其他标签页，打开的编辑框请关闭后重试。");
    } catch {
      toast("其他标签页的数据无法读取，请刷新并检查备份。");
    }
  });
  render();

  if (ShixuStorage.native) {
    document.addEventListener("click", async (e) => {
      const link = e.target.closest("a[href]");
      if (!link || !/^https?:\/\//i.test(link.href)) return;
      e.preventDefault();
      try {
        await ShixuStorage.invoke("open_external", { url: link.href });
      } catch (error) {
        toast(String(error));
      }
    });
    await window.__TAURI__?.window?.getCurrentWindow().onCloseRequested((e) => {
      if (saving) {
        e.preventDefault();
        toast("正在保存，请稍候关闭窗口。");
      }
    });
  }
})();
