import Foundation
import Combine

struct Chapter: Identifiable, Hashable {
    let id: String // Documents-relative path survives sandbox relocation after re-signing.
    let url: URL
    var title: String { url.deletingPathExtension().lastPathComponent }
}

struct Book: Identifiable, Hashable {
    let id: String
    let title: String
    let chapters: [Chapter]
}

struct FolderLink: Identifiable, Hashable {
    let id: String
    let title: String
}

struct FolderListing: Identifiable, Hashable {
    let id: String
    let title: String
    let url: URL
    let folders: [FolderLink]
    let chapters: [Chapter]
    let otherFiles: [URL]
    var book: Book? {
        chapters.isEmpty ? nil : Book(id: id, title: id == "." ? "未分类音频" : title, chapters: chapters)
    }
}

struct LibrarySnapshot {
    var folders: [String: FolderListing] = [:]
    var books: [Book] = [] // Internal index for progress/continue listening; never flattened in the UI.
}

struct ReadingProgress: Codable {
    var chapterID: String
    var seconds: Double
    var updated: Date
    var finished: Bool = false
}

@MainActor
final class ProgressStore: ObservableObject {
    @Published private(set) var entries: [String: ReadingProgress] = [:]
    @Published var error: String?
    private let file: URL

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = directory.appendingPathComponent("listening-progress.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file.path) {
                entries = try JSONDecoder().decode([String: ReadingProgress].self, from: Data(contentsOf: file))
            }
        } catch { self.error = "读取进度失败：\(error.localizedDescription)" }
    }

    func save(book: String, chapter: String, seconds: Double, finished: Bool = false) {
        guard seconds.isFinite else { return }
        entries[book] = ReadingProgress(chapterID: chapter, seconds: max(0, seconds), updated: Date(), finished: finished)
        do { try JSONEncoder().encode(entries).write(to: file, options: .atomic) }
        catch { self.error = "保存进度失败：\(error.localizedDescription)" }
    }
}

enum LibraryFiles {
    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let audioExtensions: Set<String> = ["m4a", "mp3", "wma"]
    static func relative(_ url: URL) -> String {
        String(url.path.dropFirst(documents.path.count + 1))
    }
    static func sorted(_ urls: [URL]) -> [URL] {
        urls.sorted {
            let result = $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent)
            return result == .orderedSame ? $0.path < $1.path : result == .orderedAscending
        }
    }
    static func children(_ directory: URL) throws -> [URL] {
        sorted(try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]))
    }
    static func scan(in root: URL = documents) throws -> [Book] {
        try snapshot(in: root).books
    }
    static func snapshot(in root: URL = documents) throws -> LibrarySnapshot {
        func identifier(_ url: URL) -> String {
            url == root ? "." : String(url.path.dropFirst(root.path.count + 1))
        }
        var result = LibrarySnapshot()
        func visit(_ directory: URL) throws {
            var folders: [FolderLink] = []
            var chapters: [Chapter] = []
            var otherFiles: [URL] = []
            for url in try children(directory) {
                let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey])
                guard info.isSymbolicLink != true else { continue }
                if info.isDirectory == true {
                    folders.append(FolderLink(id: identifier(url), title: url.lastPathComponent))
                    try visit(url)
                } else if info.isRegularFile == true {
                    if audioExtensions.contains(url.pathExtension.lowercased()) {
                        chapters.append(Chapter(id: identifier(url), url: url))
                    } else { otherFiles.append(url) }
                }
            }
            let listing = FolderListing(id: identifier(directory),
                title: directory == root ? "本地书架" : directory.lastPathComponent,
                url: directory, folders: folders, chapters: chapters, otherFiles: otherFiles)
            result.folders[listing.id] = listing
            if let book = listing.book { result.books.append(book) }
        }
        try visit(root)
        result.books.sort { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        return result
    }

    static func createFolder(named name: String, in directory: URL) throws {
        let folderName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !folderName.isEmpty, !folderName.hasPrefix("."), !folderName.contains("/"), !folderName.contains("\\"), !folderName.contains(":") else {
            throw FolderError.invalidName
        }
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: destination.path) else { throw FolderError.alreadyExists }
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
    }

    enum FolderError: LocalizedError {
        case invalidName, alreadyExists
        var errorDescription: String? {
            switch self {
            case .invalidName: return "请输入有效的文件夹名称，不能以点开头或包含 /、\\、:。"
            case .alreadyExists: return "已存在同名文件或文件夹，请换一个名称。"
            }
        }
    }

    // Stage outside Documents so incomplete imports never appear as books.
    // A batch is committed one item at a time; existing files are never overwritten.
    static func importItems(_ sources: [URL], to directory: URL = documents) throws {
        let manager = FileManager.default
        for source in sources {
            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }
            let staging = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try manager.createDirectory(at: staging, withIntermediateDirectories: true)
            defer { try? manager.removeItem(at: staging) }
            let copy = staging.appendingPathComponent(source.lastPathComponent)
            var coordinationError: NSError?
            var copyError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
                do { try manager.copyItem(at: readable, to: copy) } catch { copyError = error }
            }
            if let error = coordinationError { throw error }
            if let error = copyError { throw error }
            let isDirectory = (try copy.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true
            var destination = directory.appendingPathComponent(source.lastPathComponent)
            var suffix = 2
            while manager.fileExists(atPath: destination.path) {
                let stem = isDirectory ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
                let ext = isDirectory || source.pathExtension.isEmpty ? "" : "." + source.pathExtension
                destination = directory.appendingPathComponent("\(stem) (\(suffix))\(ext)")
                suffix += 1
            }
            try manager.moveItem(at: copy, to: destination)
        }
    }
}

@MainActor
final class Library: ObservableObject {
    @Published private(set) var snapshot = LibrarySnapshot()
    var books: [Book] { snapshot.books }
    func folder(_ id: String) -> FolderListing? { snapshot.folders[id] }
    @Published var importing = false
    @Published var error: String?
    func refresh() async {
        do { snapshot = try await Task.detached(priority: .userInitiated) { try LibraryFiles.snapshot() }.value }
        catch { self.error = "读取文件失败：\(error.localizedDescription)" }
    }
    func createFolder(named name: String, parentID: String) async {
        guard let directory = folder(parentID)?.url else { return }
        do { try LibraryFiles.createFolder(named: name, in: directory) }
        catch { self.error = error.localizedDescription }
        await refresh()
    }
    func importItems(_ urls: [URL], into folderID: String = ".") async {
        guard !importing, let directory = folder(folderID)?.url else { return }
        importing = true
        defer { importing = false }
        do { try await Task.detached(priority: .userInitiated) { try LibraryFiles.importItems(urls, to: directory) }.value }
        catch { self.error = "导入未全部完成（已导入的项目会保留）：\(error.localizedDescription)" }
        await refresh()
    }
}
