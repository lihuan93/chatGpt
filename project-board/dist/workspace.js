/* Shared, dependency-free data rules for the browser and Node tests. */
(function (root) {
  "use strict";
  const STATUS = ["待处理", "开发中", "修复中", "已解决", "已完成", "已取消"];
  const PRIORITY = ["非常紧急", "紧急", "普通", "较低"];
  const STAGES = [
    "待处理",
    "处理中",
    "待提测",
    "已提测",
    "联调中",
    "待验证",
    "已完成",
    "已发布",
    "受阻",
  ];
  const SECTIONS = ["本周完成事项及存在问题", "下周工作计划"];
  const id = () => root.crypto.randomUUID();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const empty = () => ({
    version: 2,
    projects: [],
    tasks: [],
    records: [],
    reports: [],
    imports: [],
  });
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const d = new Date(value + "T00:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
  }
  function timestamp(value) {
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value) &&
      date(value.slice(0, 10)) &&
      +value.slice(11, 13) < 24 &&
      +value.slice(14, 16) < 60
    );
  }
  const safeURL = (value) => !value || /^https?:\/\//i.test(value);
  const beijingDate = (value) => {
    const d = new Date(value);
    return Number.isFinite(+d)
      ? new Date(+d + 8 * 3600000).toISOString().slice(0, 10)
      : "";
  };
  const within = (value, start, end) =>
    date(value) && value >= start && value <= end;
  function parseCSV(input) {
    const text = input.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [],
      field = "",
      quoted = false,
      closed = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          quoted = false;
          closed = true;
        } else field += c;
      } else if (c === '"') {
        if (field || closed) throw Error("CSV 引号位置不正确");
        quoted = true;
      } else if (c === "," || c === "\r" || c === "\n") {
        row.push(field.trim());
        field = "";
        closed = false;
        if (c !== ",") {
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (c === "\r" && text[i + 1] === "\n") i++;
        }
      } else {
        if (closed && c.trim()) throw Error("CSV 引号后存在多余内容");
        if (!closed) field += c;
      }
    }
    if (quoted) throw Error("CSV 存在未闭合的引号");
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) throw Error("CSV 没有任务数据");
    if (rows.length > 5001) throw Error("单次最多导入 5000 条任务");
    const headers = rows.shift();
    if (new Set(headers).size !== headers.length)
      throw Error("CSV 存在重复表头");
    for (const h of ["标题", "任务ID", "任务状态", "优先级"])
      if (!headers.includes(h)) throw Error("缺少字段：" + h);
    return rows.map((r, i) => {
      if (r.length !== headers.length)
        throw Error(`第 ${i + 2} 行列数与表头不符`);
      return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
    });
  }
  function suggestProject(r) {
    const t = r["标题"] || "";
    if (/龙泉/.test(t)) return "龙泉一路一档";
    if (/嵊州/.test(t)) return "嵊州综合巡查";
    if (/桐庐.*(源头|赋码|码上管|三端)/.test(t)) return "桐庐源头码上管";
    if (/省厅农村路/.test(t)) return "省厅农村路";
    if (
      /省厅治超|浙江治超/.test(t) ||
      (r["业务条线"] === "治超" && /浙江/.test(t))
    )
      return "省厅治超";
    const prefix = t.match(/^【([^】]+)】/);
    return prefix ? prefix[1] : "待归类";
  }
  function sourceFields(r) {
    return {
      title: r["标题"],
      status: r["任务状态"],
      priority: r["优先级"],
      type: r["类型"] || "任务",
      due: (r["截止时间"] || "").slice(0, 10),
      tags: r["标签"] || "",
      assignee: r["执行者"] || "",
      sourceCreatedAt: r["创建时间"] || "",
      sourceUpdatedAt: r["更新时间"] || "",
      business: r["业务条线"] || "",
      sourceProject: r["项目"] || "",
      participants: r["参与者"] || "",
      creator: r["创建者"] || "",
    };
  }
  function planImport(state, rows, source = "我的任务") {
    if (!source.trim()) throw Error("请填写来源名称");
    const counts = new Map();
    rows.forEach((r) =>
      counts.set(r["任务ID"], (counts.get(r["任务ID"]) || 0) + 1),
    );
    const titles = new Map();
    rows.forEach((r) =>
      titles.set(r["标题"], (titles.get(r["标题"]) || 0) + 1),
    );
    return rows.map((r, index) => {
      const code = r["任务ID"] || "";
      const old = state.tasks.find(
        (t) => t.source === source && t.sourceId === code,
      );
      const errors = [];
      if (!code || !r["标题"]) errors.push("缺少任务 ID 或标题");
      if (code.length > 100 || (r["标题"] || "").length > 2000)
        errors.push("ID 或标题过长");
      if (counts.get(code) > 1) errors.push("文件内 ID 重复");
      if (!STATUS.includes(r["任务状态"])) errors.push("不认识的任务状态");
      if (!PRIORITY.includes(r["优先级"])) errors.push("不认识的优先级");
      for (const k of ["创建时间", "更新时间", "截止时间"])
        if (r[k] && !timestamp(r[k]))
          errors.push(k + "格式应为 YYYY-MM-DD HH:mm");
      let fields = sourceFields(r);
      // A blank in a partial export does not clear the stored value.
      if (old)
        fields = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, v || old[k] || ""]),
        );
      const changed = old
        ? Object.keys(fields).filter((k) => fields[k] !== (old[k] || ""))
        : Object.keys(fields);
      let action = old ? (changed.length ? "更新" : "未变化") : "新增";
      if (
        old?.sourceUpdatedAt &&
        fields.sourceUpdatedAt &&
        fields.sourceUpdatedAt < old.sourceUpdatedAt
      )
        action = "旧版本";
      if (errors.length) action = "异常";
      return {
        index,
        source,
        code,
        oldId: old?.id,
        fields,
        changed,
        action,
        errors,
        projectName: old
          ? state.projects.find((p) => p.id === old.projectId)?.name || "待归类"
          : suggestProject(r),
        warning: titles.get(r["标题"]) > 1 ? "同名任务，按不同 ID 保留" : "",
      };
    });
  }
  function applyImport(state, plan, at = new Date().toISOString()) {
    const next = clone(state),
      changes = [],
      newProjects = [];
    for (const p of plan) {
      if (!["新增", "更新"].includes(p.action) || p.selected === false)
        continue;
      const personalName = p.projectName.trim() || "待归类";
      let project = next.projects.find((x) => x.name === personalName);
      if (!project) {
        project = {
          id: id(),
          name: personalName,
          description: "",
        };
        next.projects.push(project);
        newProjects.push(project.id);
      }
      const before = next.tasks.find((t) => t.id === p.oldId) || null;
      const task = {
        ...(before || {}),
        ...p.fields,
        id: before?.id || id(),
        source: p.source,
        sourceId: p.code,
        projectId: before?.projectId || project.id,
        module: before?.module || "",
        link: before?.link || "",
        focus: before?.focus || false,
        completedAt: before?.completedAt || "",
        importedAt: at,
      };
      // Import time / source update time is never treated as an actual completion date.
      if (task.status !== "已完成") task.completedAt = "";
      if (before)
        next.tasks[next.tasks.findIndex((t) => t.id === task.id)] = task;
      else next.tasks.push(task);
      changes.push({ id: task.id, before, after: clone(task) });
    }
    if (changes.length)
      next.imports.push({
        id: id(),
        at,
        source: plan[0]?.source || "",
        changes,
        newProjects,
      });
    return next;
  }
  function undoImport(state) {
    const next = clone(state),
      batch = next.imports.at(-1);
    if (!batch) throw Error("没有可以撤销的导入");
    for (const c of batch.changes) {
      const current = next.tasks.find((t) => t.id === c.id);
      if (JSON.stringify(current) !== JSON.stringify(c.after))
        throw Error("导入后有任务修改，不能直接撤销。请先导出备份。");
      if (
        !c.before &&
        (next.records.some((r) => r.taskId === c.id) ||
          next.reports.some((r) =>
            r.rows.some((row) => row.taskIds.includes(c.id)),
          ))
      )
        throw Error("新增任务已关联记录或周报，不能直接撤销");
    }
    for (const c of batch.changes) {
      if (c.before)
        next.tasks[next.tasks.findIndex((t) => t.id === c.id)] = c.before;
      else next.tasks = next.tasks.filter((t) => t.id !== c.id);
    }
    next.projects = next.projects.filter(
      (p) =>
        !batch.newProjects.includes(p.id) ||
        next.tasks.some((t) => t.projectId === p.id),
    );
    next.imports.pop();
    return next;
  }
  function migrate(legacy) {
    if (!Array.isArray(legacy)) throw Error("旧版数据格式不正确");
    const next = empty();
    if (!legacy.length) return next;
    next.projects.push({
      id: "legacy-project",
      name: "旧版任务",
      description: "从旧版项目看板迁入，可重新归类。",
    });
    next.tasks = legacy.map((p) => ({
      id: p.id || id(),
      projectId: "legacy-project",
      title: String(p.name || "未命名"),
      description: p.description || "",
      status:
        { todo: "待处理", active: "开发中", done: "已完成" }[p.status] ||
        "待处理",
      priority:
        { low: "较低", medium: "普通", high: "紧急" }[p.priority] || "普通",
      tags: (p.tags || []).join(", "),
      due: p.due || "",
      completedAt: date(p.completedAt) ? p.completedAt : "",
      link: p.link || "",
      module: "",
      focus: false,
      source: "旧版看板",
      sourceId: p.id || id(),
      sourceCreatedAt: "",
      sourceUpdatedAt: "",
      assignee: "",
      type: "任务",
    }));
    return next;
  }
  function candidates(state, start, end) {
    return state.tasks
      .map((t) => {
        const records = state.records.filter(
          (r) => r.taskId === t.id && within(r.date, start, end),
        );
        const changes = state.imports.flatMap((b) =>
          within(beijingDate(b.at), start, end)
            ? b.changes
                .filter(
                  (c) =>
                    c.id === t.id &&
                    c.before &&
                    c.before.status !== c.after.status,
                )
                .map((c) => `${c.before.status} → ${c.after.status}`)
            : [],
        );
        const reasons = [];
        if (records.length) reasons.push("本周工作记录");
        if (within(t.completedAt, start, end)) reasons.push("已确认完成日期");
        if (changes.length) reasons.push("导入观察到状态变化（日期待核对）");
        if (within((t.sourceUpdatedAt || "").slice(0, 10), start, end))
          reasons.push("来源更新时间在本周（需核对）");
        if (t.focus) reasons.push("本周关注（需核对）");
        return { task: t, records, changes, reasons };
      })
      .filter((c) => c.reasons.length);
  }
  function draftRow(state, taskIds, start, end) {
    const tasks = taskIds
      .map((i) => state.tasks.find((t) => t.id === i))
      .filter(Boolean);
    const records = state.records.filter(
      (r) => taskIds.includes(r.taskId) && within(r.date, start, end),
    );
    const names = [
      ...new Set(
        tasks.map(
          (t) =>
            state.projects.find((p) => p.id === t.projectId)?.name || "未归类",
        ),
      ),
    ];
    return {
      id: id(),
      taskIds: [...taskIds],
      section: SECTIONS[0],
      details:
        names.join("、") +
        "：\n" +
        tasks
          .map((t) => {
            const rs = records.filter((r) => r.taskId === t.id);
            return rs.length
              ? rs.map((r) => r.result || r.text).join("；")
              : t.title + "（待补充本周实际进展）";
          })
          .join("\n"),
      stage: records.length === 1 ? records[0].stage || "" : "",
      owners: [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].join(
        "、",
      ),
      remarks: "",
    };
  }
  function mergeRows(rows, ids) {
    const selected = rows.filter((r) => ids.includes(r.id));
    if (selected.length < 2) throw Error("请选择至少两条事项");
    if (new Set(selected.map((r) => r.section)).size > 1)
      throw Error("不同章节的事项不能合并");
    const merged = {
      ...selected[0],
      taskIds: [...new Set(selected.flatMap((r) => r.taskIds))],
      details: selected.map((r) => r.details).join("\n"),
      stage:
        new Set(selected.map((r) => r.stage)).size === 1
          ? selected[0].stage
          : "",
      owners: [...new Set(selected.map((r) => r.owners).filter(Boolean))].join(
        "；",
      ),
      remarks: selected
        .map((r) => r.remarks)
        .filter(Boolean)
        .join("\n"),
    };
    return rows.flatMap((r) =>
      r.id === merged.id ? [merged] : ids.includes(r.id) ? [] : [r],
    );
  }
  const escapeHTML = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const md = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/[|`*_<>\[\]#]/g, "\\$&")
      .replace(/\r?\n/g, "<br>");
  function reportHTML(report) {
    const cell = (s) => escapeHTML(s).replace(/\r?\n/g, "<br>");
    return (
      `<h1>${cell(report.title)}</h1><p>${report.start} — ${report.end}</p><p>汇报人：${cell(report.reporter)}　|　组别：${cell(report.group)}</p>` +
      SECTIONS.map(
        (section) =>
          `<h2>${section}</h2><table border="1" style="border-collapse:collapse;width:100%"><thead><tr>${["序号", "事项详情", "完成进度", "责任人", "备注（成果链接/关联资源/进度节点）"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${report.rows
            .filter((r) => r.section === section)
            .map(
              (r, i) =>
                `<tr><td>${i + 1}</td><td>${cell(r.details)}</td><td>${cell(r.stage)}</td><td>${cell(r.owners)}</td><td>${cell(r.remarks)}</td></tr>`,
            )
            .join("")}</tbody></table>`,
      ).join("")
    );
  }
  function reportMarkdown(report, materials = false) {
    const out = [
      `# ${md(report.title)}`,
      "",
      `${report.start} — ${report.end}`,
      `汇报人：${md(report.reporter)} | 组别：${md(report.group)}`,
      "",
    ];
    for (const section of SECTIONS) {
      out.push(
        "## " + section,
        "",
        "| 序号 | 事项详情 | 完成进度 | 责任人 | 备注 |",
        "| --- | --- | --- | --- | --- |",
      );
      report.rows
        .filter((r) => r.section === section)
        .forEach((r, i) =>
          out.push(
            `| ${i + 1} | ${md(r.details)} | ${md(r.stage)} | ${md(r.owners)} | ${md(r.remarks)} |`,
          ),
        );
      out.push("");
    }
    if (materials) {
      out.push(
        "## 事实核对说明",
        "",
        "仅根据下方素材润色，不推断完成、发布或量化成果。空白信息请保留待补充。",
        "",
      );
      report.rows.forEach((r) =>
        out.push(
          `- 事项 ${md(r.details)}；关联内部 ID：${r.taskIds.join(", ")}`,
        ),
      );
    }
    return out.join("\n");
  }
  function csv(rows) {
    const cell = (s) => {
      let v = String(s ?? "");
      if (/^[\s]*[=+@-]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    };
    return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  }
  function recordsMarkdown(
    state,
    {
      start = "",
      end = "",
      projectId = "",
      career = false,
      privateDetails = true,
    } = {},
  ) {
    const records = state.records.filter(
      (r) =>
        (!start || r.date >= start) &&
        (!end || r.date <= end) &&
        (!career || r.career) &&
        (!projectId ||
          state.tasks.find((t) => t.id === r.taskId)?.projectId === projectId),
    );
    const out = [
      career ? "# 项目经历素材" : "# 工作记录汇总",
      "",
      `范围：${start || "不限"} — ${end || "不限"}`,
      "",
      "事实材料；未填写的职责、技术方案或成果不得自行推断。",
      "",
    ];
    for (const p of state.projects) {
      const rs = records
        .filter(
          (r) => state.tasks.find((t) => t.id === r.taskId)?.projectId === p.id,
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!rs.length) continue;
      out.push("## " + md(p.name), "");
      for (const r of rs) {
        const t = state.tasks.find((t) => t.id === r.taskId);
        out.push(`### ${r.date} · ${md(t.title)}`, "", md(r.text), "");
        for (const [k, label] of [
          ["stage", "交付阶段"],
          ["background", "背景与问题"],
          ["role", "我的职责"],
          ["solution", "处理方案"],
          ["challenge", "难点"],
          ["result", "结果"],
          ["tags", "技术标签"],
        ])
          out.push(`- ${label}：${md(r[k] || "待补充")}`);
        if (privateDetails)
          out.push(
            `- 来源：${md(t.source || "手动")} / ${md(t.sourceId || t.id)}`,
            `- 证据链接：${md(r.evidence || "待补充")}`,
          );
        out.push("");
      }
    }
    if (!records.length) out.push("暂无符合条件的记录。");
    return out.join("\n");
  }
  function validate(state) {
    const str = (v, max = 20000) => typeof v === "string" && v.length <= max;
    const unique = (rows) =>
      new Set(rows.map((r) => r.id)).size === rows.length;
    if (!state || state.version !== 2) throw Error("不是第二版工作台备份");
    for (const k of ["projects", "tasks", "records", "reports", "imports"])
      if (
        !Array.isArray(state[k]) ||
        state[k].length > 20000 ||
        !unique(state[k]) ||
        !state[k].every((r) => r && str(r.id, 200) && r.id)
      )
        throw Error("备份结构无效：" + k);
    const projects = new Set(state.projects.map((p) => p.id)),
      tasks = new Set(state.tasks.map((t) => t.id));
    if (
      !state.projects.every(
        (p) => str(p.name, 200) && p.name.trim() && str(p.description || ""),
      )
    )
      throw Error("项目格式无效");
    if (
      !state.tasks.every(
        (t) =>
          [
            "description",
            "module",
            "tags",
            "assignee",
            "source",
            "sourceId",
            "sourceCreatedAt",
            "sourceUpdatedAt",
            "business",
            "sourceProject",
            "participants",
            "creator",
          ].every((k) => str(t[k] || "")) &&
          projects.has(t.projectId) &&
          str(t.title, 2000) &&
          t.title.trim() &&
          STATUS.includes(t.status) &&
          PRIORITY.includes(t.priority) &&
          (!t.completedAt || date(t.completedAt)) &&
          (!t.due || date(t.due)) &&
          str(t.link || "") &&
          safeURL(t.link),
      )
    )
      throw Error("任务格式或关联无效");
    const keys = state.tasks
      .filter((t) => t.source && t.sourceId)
      .map((t) => JSON.stringify([t.source, t.sourceId]));
    if (new Set(keys).size !== keys.length) throw Error("来源任务 ID 重复");
    if (
      !state.records.every(
        (r) =>
          tasks.has(r.taskId) &&
          date(r.date) &&
          str(r.text) &&
          [
            "stage",
            "background",
            "role",
            "solution",
            "challenge",
            "result",
            "evidence",
            "tags",
          ].every((k) => str(r[k] || "")) &&
          safeURL(r.evidence),
      )
    )
      throw Error("工作记录格式或关联无效");
    if (
      !state.reports.every(
        (r) =>
          date(r.start) &&
          date(r.end) &&
          r.start <= r.end &&
          str(r.title) &&
          str(r.reporter || "") &&
          str(r.group || "") &&
          str(r.url || "") &&
          safeURL(r.url) &&
          Array.isArray(r.rows) &&
          unique(r.rows) &&
          r.rows.every(
            (row) =>
              str(row.id) &&
              Array.isArray(row.taskIds) &&
              row.taskIds.every((t) => tasks.has(t)) &&
              SECTIONS.includes(row.section) &&
              ["details", "stage", "owners", "remarks"].every((k) =>
                str(row[k] || ""),
              ),
          ),
      )
    )
      throw Error("周报格式或关联无效");
    if (
      !state.imports.every(
        (b) =>
          str(b.at) &&
          Number.isFinite(+new Date(b.at)) &&
          Array.isArray(b.changes) &&
          Array.isArray(b.newProjects) &&
          b.changes.every((c) => str(c.id) && c.after && c.after.id === c.id),
      )
    )
      throw Error("导入历史无效");
    return state;
  }
  const api = {
    STATUS,
    PRIORITY,
    STAGES,
    SECTIONS,
    id,
    clone,
    empty,
    date,
    within,
    safeURL,
    parseCSV,
    suggestProject,
    planImport,
    applyImport,
    undoImport,
    migrate,
    candidates,
    draftRow,
    mergeRows,
    reportHTML,
    reportMarkdown,
    csv,
    recordsMarkdown,
    validate,
    escapeHTML,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Workspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
