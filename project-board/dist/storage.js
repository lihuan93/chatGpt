/* Persistence boundary: native SQLite is authoritative in Tauri. The web
   version retains its browser storage; native failures never fall back to it. */
(function (root) {
  "use strict";
  const KEY = "shixu-workspace-v2";
  const native =
    !!root.__TAURI_INTERNALS__ ||
    !!root.__TAURI__ ||
    root.location.protocol === "tauri:" ||
    root.location.hostname.endsWith("tauri.localhost");
  const invoke = (command, args) => root.__TAURI__.core.invoke(command, args);
  async function open(W) {
    if (native) {
      const snapshot = await invoke("load_workspace");
      W.validate(snapshot.workspace);
      return {
        native: true,
        initial: snapshot.workspace,
        token: snapshot.revision,
        save: (payload, expectedRevision, protectRestore) =>
          invoke("save_workspace", {
            payload,
            expectedRevision,
            protectRestore,
          }),
        reload: () => invoke("load_workspace"),
      };
    }
    const raw = localStorage.getItem(KEY),
      legacy = raw === null ? localStorage.getItem("shixu-projects-v1") : null;
    const initial =
      raw !== null
        ? W.validate(JSON.parse(raw))
        : legacy
          ? W.migrate(JSON.parse(legacy))
          : W.empty();
    W.validate(initial);
    let token = raw;
    if (raw === null) {
      token = JSON.stringify(initial);
      localStorage.setItem(KEY, token);
    }
    return {
      native: false,
      initial,
      token,
      migrated: !!legacy,
      async save(payload, expected) {
        if (localStorage.getItem(KEY) !== expected)
          throw Error("其他标签页已修改数据，请关闭编辑框并刷新后重试。");
        const next = JSON.stringify(payload);
        localStorage.setItem(KEY, next);
        return next;
      },
      async reload() {
        const raw = localStorage.getItem(KEY);
        return { workspace: W.validate(JSON.parse(raw)), revision: raw };
      },
    };
  }
  root.ShixuStorage = {
    native,
    open,
    invoke,
    async selectFile(kind) {
      const selected = await invoke("select_import_file", { kind });
      if (!selected) return null;
      const bytes = new Uint8Array(selected.bytes);
      return {
        name: selected.name,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer,
        text: async () =>
          new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, ""),
      };
    },
    exportFile: (name, content) => invoke("export_file", { name, content }),
    copy: (text, html) => invoke("copy_content", { text, html: html || null }),
  };
})(globalThis);
