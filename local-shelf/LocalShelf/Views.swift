import SwiftUI
import UniformTypeIdentifiers
import QuickLook

func clockText(_ seconds: Double) -> String {
    guard seconds.isFinite else { return "0:00" }
    let total = max(0, Int(seconds))
    if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
    return String(format: "%d:%02d", total / 60, total % 60)
}

@MainActor
struct ShelfView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var progress: ProgressStore
    @EnvironmentObject private var audio: AudioPlayer
    @State private var showingPlayer = false
    @State private var preview: PreviewFile?
    private var recent: Book? {
        library.books.filter { progress.entries[$0.id] != nil }
            .max { progress.entries[$0.id]!.updated < progress.entries[$1.id]!.updated }
    }
    private var errorBinding: Binding<Bool> {
        Binding(get: { library.error != nil || audio.error != nil || progress.error != nil },
                set: { if !$0 { library.error = nil; audio.error = nil; progress.error = nil } })
    }
    var body: some View {
        NavigationStack {
            List {
                if library.importing {
                    HStack { ProgressView(); Text("正在复制文件，请保持 App 在前台…") }
                }
                if let recent, let saved = progress.entries[recent.id] {
                    Section("继续收听") {
                        Button {
                            audio.resume(recent)
                            showingPlayer = true
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(recent.title).font(.headline)
                                    Text(saved.finished ? "已听完 · 从头播放" : "\(recent.chapters.first { $0.id == saved.chapterID }?.title ?? "章节已变更") · \(clockText(saved.seconds))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "play.circle.fill").font(.title) }
                        }.buttonStyle(.plain)
                    }
                }
                FolderRows(folderID: ".", showingPlayer: $showingPlayer, preview: $preview)
                Section {} footer: {
                    Text("离线使用 · 无广告 · 无会员\n按原文件夹逐层浏览，播放列表只包含当前文件夹内的音频。")
                }
            }
            .navigationTitle("本地书架")
            .refreshable { await library.refresh() }
            .toolbar { ToolbarItem(placement: .primaryAction) { FolderActions(folderID: ".") } }
        }
        .safeAreaInset(edge: .bottom) {
            if let chapter = audio.chapter {
                HStack(spacing: 14) {
                    Button { showingPlayer = true } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(chapter.title).font(.subheadline).lineLimit(1)
                            Text("\(audio.book?.title ?? "") · \(clockText(audio.seconds))")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain)
                    Button { audio.toggle() } label: {
                        Image(systemName: audio.isPlaying ? "pause.fill" : "play.fill").font(.title2).frame(width: 44, height: 44)
                    }.accessibilityLabel(audio.isPlaying ? "暂停" : "播放")
                }.padding(.horizontal).padding(.vertical, 8).background(.regularMaterial)
            }
        }
        .sheet(isPresented: $showingPlayer) { PlayerView() }
        .sheet(item: $preview) { QuickPreview(url: $0.url) }
        .alert("提示", isPresented: errorBinding) {
            Button("好", role: .cancel) { library.error = nil; audio.error = nil; progress.error = nil }
        } message: { Text(library.error ?? audio.error ?? progress.error ?? "") }
    }
}

@MainActor
struct FolderView: View {
    let folderID: String
    @Binding var showingPlayer: Bool
    @EnvironmentObject private var library: Library
    @State private var preview: PreviewFile?
    var body: some View {
        List {
            if library.importing { HStack { ProgressView(); Text("正在导入，请保持 App 在前台…") } }
            FolderRows(folderID: folderID, showingPlayer: $showingPlayer, preview: $preview)
        }
            .navigationTitle(library.folder(folderID)?.title ?? "文件夹")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .primaryAction) { FolderActions(folderID: folderID) } }
            .refreshable { await library.refresh() }
            .sheet(item: $preview) { QuickPreview(url: $0.url) }
    }
}

@MainActor
struct FolderRows: View {
    let folderID: String
    @Binding var showingPlayer: Bool
    @Binding var preview: PreviewFile?
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var progress: ProgressStore
    @EnvironmentObject private var audio: AudioPlayer
    var body: some View {
        if let folder = library.folder(folderID) {
            if !folder.folders.isEmpty {
                Section("文件夹") {
                    ForEach(folder.folders) { child in
                        NavigationLink {
                            FolderView(folderID: child.id, showingPlayer: $showingPlayer)
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(child.title).font(.headline)
                                    if let listing = library.folder(child.id) {
                                        Text("\(listing.folders.count) 个子文件夹 · \(listing.chapters.count) 个音频")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            } icon: { Image(systemName: "folder.fill").foregroundStyle(.indigo) }
                        }
                    }
                }
            }
            if let book = folder.book {
                Section {
                    Button {
                        audio.resume(book); showingPlayer = true
                    } label: {
                        Label(progress.entries[book.id] == nil ? "播放本文件夹" : "继续收听本文件夹", systemImage: "play.circle.fill")
                    }
                }
                Section("音频 · \(book.chapters.count) 个") {
                    ForEach(Array(book.chapters.enumerated()), id: \.element.id) { index, chapter in
                        Button {
                            audio.load(book, index: index); showingPlayer = true
                        } label: {
                            HStack {
                                Text("\(index + 1)").monospacedDigit().foregroundStyle(.secondary).frame(minWidth: 28)
                                Text(chapter.title).foregroundStyle(.primary)
                                Spacer()
                                if audio.chapter?.id == chapter.id { Image(systemName: "speaker.wave.2.fill") }
                                else if progress.entries[book.id]?.chapterID == chapter.id { Image(systemName: "bookmark.fill") }
                            }.padding(.vertical, 3)
                        }
                    }
                }
            }
            if !folder.otherFiles.isEmpty {
                Section("其他文件") {
                    ForEach(folder.otherFiles, id: \.self) { file in
                        Button { preview = PreviewFile(url: file) } label: {
                            Label(file.lastPathComponent, systemImage: "doc").foregroundStyle(.primary)
                        }
                    }
                }
            }
            if folder.folders.isEmpty && folder.chapters.isEmpty && folder.otherFiles.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "folder").font(.largeTitle).foregroundStyle(.indigo)
                        Text("这个文件夹还是空的").font(.headline)
                        Text("点右上角 ＋ 新建文件夹或导入文件，也可以用 Finder 传入整文件夹。")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical, 20)
                }
            }
        } else {
            Section { Text("文件夹暂不可用，请下拉刷新。").foregroundStyle(.secondary) }
        }
    }
}

@MainActor
struct FolderActions: View {
    let folderID: String
    @EnvironmentObject private var library: Library
    @State private var importing = false
    @State private var importFolder = true
    @State private var creatingFolder = false
    @State private var name = ""
    var body: some View {
        Menu {
            Button { name = ""; creatingFolder = true } label: { Label("新建文件夹", systemImage: "folder.badge.plus") }
            Button { importFolder = true; importing = true } label: { Label("导入文件夹到此处", systemImage: "folder") }
            Button { importFolder = false; importing = true } label: { Label("导入文件到此处", systemImage: "doc.badge.plus") }
        } label: { Image(systemName: "plus").accessibilityLabel("文件夹操作") }
        .disabled(library.importing || library.folder(folderID) == nil)
        .fileImporter(isPresented: $importing, allowedContentTypes: importFolder ? [.folder] : [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await library.importItems(urls, into: folderID) }
            case .failure(let error): library.error = error.localizedDescription
            }
        }
        .alert("新建文件夹", isPresented: $creatingFolder) {
            TextField("文件夹名称", text: $name)
            Button("取消", role: .cancel) {}
            Button("创建") { Task { await library.createFolder(named: name, parentID: folderID) } }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: { Text("将在当前目录创建文件夹。") }
    }
}

@MainActor
struct PlayerView: View {
    @EnvironmentObject private var audio: AudioPlayer
    @Environment(\.dismiss) private var dismiss
    @State private var scrubbing = false
    @State private var draft: Double = 0
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 76)).foregroundStyle(.indigo)
                        .frame(maxWidth: .infinity).frame(height: 190)
                        .background(.indigo.opacity(0.09), in: RoundedRectangle(cornerRadius: 24))
                        .accessibilityHidden(true)
                    VStack(spacing: 8) {
                        Text(audio.book?.title ?? "").font(.subheadline).foregroundStyle(.secondary)
                        Text(audio.chapter?.title ?? "请选择章节").font(.title2.bold()).multilineTextAlignment(.center)
                        if let book = audio.book { Text("第 \(audio.chapterIndex + 1) / \(book.chapters.count) 章").foregroundStyle(.secondary) }
                    }
                    VStack {
                        Slider(value: Binding(get: { scrubbing ? draft : min(audio.seconds, max(audio.duration, 1)) },
                                              set: { draft = $0 }), in: 0...max(audio.duration, 1)) { editing in
                            scrubbing = editing
                            if editing { draft = audio.seconds } else { audio.seek(to: draft) }
                        }.disabled(!audio.ready || audio.duration <= 0).accessibilityLabel("章节进度")
                        HStack { Text(clockText(scrubbing ? draft : audio.seconds)); Spacer(); Text(clockText(audio.duration)) }
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 30) {
                        Button { audio.skip(-15) } label: { Image(systemName: "gobackward.15").font(.title) }.accessibilityLabel("快退15秒")
                        Button { audio.toggle() } label: {
                            Image(systemName: audio.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 68))
                        }.accessibilityLabel(audio.isPlaying ? "暂停" : "播放")
                        Button { audio.skip(30) } label: { Image(systemName: "goforward.30").font(.title) }.accessibilityLabel("快进30秒")
                    }
                    HStack {
                        Button("上一章") { audio.previous() }.disabled(!audio.canGoPrevious)
                        Spacer()
                        Menu {
                            ForEach(AudioPlayer.speeds, id: \.self) { speed in
                                Button { audio.setSpeed(speed) } label: {
                                    if speed == audio.speed { Label("\(speed.formatted())×", systemImage: "checkmark") }
                                    else { Text("\(speed.formatted())×") }
                                }
                            }
                        } label: { Text("\(audio.speed.formatted())× 倍速").bold() }
                        Spacer()
                        Button("下一章") { audio.next() }
                            .disabled(!audio.canGoNext)
                    }
                    HStack {
                        PlaybackModeMenu()
                        Spacer()
                        SleepTimerMenu()
                    }
                    if audio.hasSleepTimer {
                        Text("\(audio.sleepTimerLabel) · 到时暂停，不受循环模式影响")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if audio.loading {
                        ProgressView("正在打开音频…")
                    }
                    Text("锁屏后继续播放 · 自动保存收听进度").font(.caption).foregroundStyle(.secondary)
                }.padding(24)
            }
            .navigationTitle("正在收听").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}

struct PreviewFile: Identifiable { let url: URL; var id: URL { url } }
@MainActor
struct QuickPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}


@MainActor
struct PlaybackModeMenu: View {
    @EnvironmentObject private var audio: AudioPlayer
    var body: some View {
        Menu {
            ForEach(PlaybackRepeatMode.allCases) { mode in
                Button { audio.setRepeatMode(mode) } label: {
                    Label(mode.title, systemImage: mode == audio.repeatMode ? "checkmark" : mode.icon)
                }
            }
        } label: { Label(audio.repeatMode.title, systemImage: audio.repeatMode.icon).font(.subheadline) }
    }
}

@MainActor
struct SleepTimerMenu: View {
    @EnvironmentObject private var audio: AudioPlayer
    @State private var custom = false
    var body: some View {
        Menu {
            Button("按上次选择：\(audio.lastSleepChoice.title)") { audio.startSleepTimer(audio.lastSleepChoice) }
            Divider()
            ForEach([15, 30, 45, 60], id: \.self) { minutes in
                Button("\(minutes) 分钟") { audio.startSleepTimer(.minutes(minutes)) }
            }
            Button("自定义时间…") { custom = true }
            Button("本文件播完后停止") { audio.startSleepTimer(.endOfTrack) }
            if audio.hasSleepTimer {
                Divider()
                Button("取消定时", role: .destructive) { audio.cancelSleepTimer() }
            }
        } label: { Label("定时", systemImage: audio.hasSleepTimer ? "moon.zzz.fill" : "moon.zzz").font(.subheadline) }
        .sheet(isPresented: $custom) {
            CustomSleepTimerView(initial: audio.lastSleepChoice) { audio.startSleepTimer(.minutes($0)) }
                .presentationDetents([.medium])
        }
    }
}

@MainActor
struct CustomSleepTimerView: View {
    let onStart: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var minutes: String
    init(initial: SleepTimerChoice, onStart: @escaping (Int) -> Void) {
        self.onStart = onStart
        if case .minutes(let value) = initial { _minutes = State(initialValue: String(value)) }
        else { _minutes = State(initialValue: "30") }
    }
    private var validMinutes: Int? {
        guard let value = Int(minutes.trimmingCharacters(in: .whitespacesAndNewlines)), (1...1440).contains(value) else { return nil }
        return value
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("分钟数", text: $minutes).keyboardType(.numberPad)
                        Text("分钟").foregroundStyle(.secondary)
                    }
                } footer: { Text("可设置 1～1440 分钟。会记住本次选择，下次可一键使用。") }
                Button("开始定时") {
                    if let value = validMinutes { onStart(value); dismiss() }
                }.disabled(validMinutes == nil)
            }
            .navigationTitle("自定义定时").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
    }
}
