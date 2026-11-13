import XCTest
@testable import LocalShelf

final class LibraryTests: XCTestCase {
    func testWMAReadinessSurvivesCachedStateBeingReplacedByBuffering() {
        // No cached .playing event is required when libvlc is actually playing.
        XCTAssertTrue(WMAStartupReadiness.hasStarted(isPlaying: true, seconds: 0, isPaused: false))
        // A time callback remains evidence of startup even during a later buffering event.
        XCTAssertTrue(WMAStartupReadiness.hasStarted(isPlaying: false, seconds: 1.25, isPaused: false))
        // Pausing immediately after startup must not leave the input stuck in loading state.
        XCTAssertTrue(WMAStartupReadiness.hasStarted(isPlaying: false, seconds: 0, isPaused: true))
        XCTAssertFalse(WMAStartupReadiness.hasStarted(isPlaying: false, seconds: 0, isPaused: false))
        XCTAssertFalse(WMAStartupReadiness.hasStarted(isPlaying: false, seconds: .nan, isPaused: false))
    }

    func testFolderSpeedsStayIndependentAndSurviveStoreRecreation() throws {
        let name = "LocalShelfTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let store = FolderPlaybackSpeedStore(defaults: defaults)
        store.setSpeed(1.5, for: "分类A/同名小说")
        store.setSpeed(2.5, for: "分类B/同名小说")
        store.setSpeed(2, for: ".")
        let restored = FolderPlaybackSpeedStore(defaults: defaults)
        XCTAssertEqual(restored.speed(for: "分类A/同名小说"), 1.5)
        XCTAssertEqual(restored.speed(for: "分类B/同名小说"), 2.5)
        XCTAssertEqual(restored.speed(for: "."), 2)
        XCTAssertEqual(restored.speed(for: "新小说"), 1)
        restored.setSpeed(99, for: "分类A/同名小说")
        XCTAssertEqual(restored.speed(for: "分类A/同名小说"), 1.5)
        // A legacy global rate must not leak into previously unconfigured folders.
        defaults.set(3, forKey: "playbackSpeed")
        XCTAssertEqual(restored.speed(for: "另一部新小说"), 1)
    }

    func testFoldersStayNestedAndQueuesContainOnlyDirectAudio() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let singer = root.appendingPathComponent("音乐/陈慧娴")
        let second = root.appendingPathComponent("音乐/娃排除的歌")
        try fm.createDirectory(at: singer, withIntermediateDirectories: true)
        try fm.createDirectory(at: second, withIntermediateDirectories: true)
        try fm.createDirectory(at: root.appendingPathComponent("空文件夹"), withIntermediateDirectories: true)
        try Data().write(to: singer.appendingPathComponent("第2首.mp3"))
        try Data().write(to: singer.appendingPathComponent("第10首.wma"))
        try Data().write(to: second.appendingPathComponent("单曲.m4a"))
        try Data().write(to: root.appendingPathComponent("音乐/直属歌曲.mp3"))
        let snapshot = try LibraryFiles.snapshot(in: root)
        let home = try XCTUnwrap(snapshot.folders["."])
        XCTAssertEqual(Set(home.folders.map(\.id)), Set(["音乐", "空文件夹"]))
        XCTAssertTrue(home.chapters.isEmpty)
        let music = try XCTUnwrap(snapshot.folders["音乐"])
        XCTAssertEqual(Set(music.folders.map(\.id)), Set(["音乐/陈慧娴", "音乐/娃排除的歌"]))
        XCTAssertEqual(music.book?.chapters.map(\.title), ["直属歌曲"])
        XCTAssertEqual(snapshot.folders["音乐/陈慧娴"]?.book?.chapters.map(\.title), ["第2首", "第10首"])
        XCTAssertNotNil(snapshot.folders["空文件夹"])
        // Existing relative IDs stay unchanged by the new hierarchical UI.
        XCTAssertEqual(snapshot.folders["音乐/陈慧娴"]?.chapters.first?.id, "音乐/陈慧娴/第2首.mp3")
    }

    func testCreateFolderRejectsTraversalAndCollisions() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try LibraryFiles.createFolder(named: " 新分类 ", in: root)
        XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("新分类").path))
        XCTAssertThrowsError(try LibraryFiles.createFolder(named: "../越界", in: root))
        XCTAssertThrowsError(try LibraryFiles.createFolder(named: ".隐藏", in: root))
        XCTAssertThrowsError(try LibraryFiles.createFolder(named: "新分类", in: root))
    }

    func testImportTargetsCurrentDirectoryAndPreservesExistingFiles() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let source = root.appendingPathComponent("来源/歌曲.mp3")
        let destination = root.appendingPathComponent("音乐")
        try fm.createDirectory(at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        let original = Data([1, 2, 3])
        try original.write(to: source)
        try LibraryFiles.importItems([source], to: destination)
        try Data([4, 5]).write(to: source)
        try LibraryFiles.importItems([source], to: destination)
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("歌曲.mp3")), original)
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("歌曲 (2).mp3")), Data([4, 5]))
        XCTAssertTrue(fm.fileExists(atPath: source.path))
        XCTAssertFalse(fm.fileExists(atPath: root.appendingPathComponent("歌曲.mp3").path))
    }

    func testRepeatAndSleepPriorityAtTrackEnd() {
        XCTAssertEqual(PlaybackRepeatMode.sequential.nextIndex(after: 0, count: 3), 1)
        XCTAssertNil(PlaybackRepeatMode.sequential.nextIndex(after: 2, count: 3))
        XCTAssertEqual(PlaybackRepeatMode.list.nextIndex(after: 2, count: 3), 0)
        XCTAssertEqual(PlaybackRepeatMode.single.nextIndex(after: 1, count: 3), 1)
        XCTAssertEqual(PlaybackRepeatMode.list.nextIndex(after: 0, count: 1), 0)
        XCTAssertNil(PlaybackRepeatMode.list.nextIndex(after: 0, count: 0))
        for mode in PlaybackRepeatMode.allCases {
            XCTAssertEqual(mode.completion(after: 2, count: 3, wantsPlayback: true, stopAfterCurrentFile: true), .pause)
            XCTAssertEqual(mode.completion(after: 2, count: 3, wantsPlayback: false, stopAfterCurrentFile: false), .pause)
        }
        XCTAssertEqual(PlaybackRepeatMode.list.completion(after: 2, count: 3, wantsPlayback: true, stopAfterCurrentFile: false), .play(0))
        XCTAssertEqual(PlaybackRepeatMode.single.completion(after: 2, count: 3, wantsPlayback: true, stopAfterCurrentFile: false), .play(2))
        XCTAssertEqual(PlaybackRepeatMode.sequential.completion(after: 2, count: 3, wantsPlayback: true, stopAfterCurrentFile: false), .finish)
    }

    func testCustomSleepSelectionAndFolderModesPersistIndependently() throws {
        let name = "LocalShelfTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        SleepTimerPreferences.save(.minutes(37), in: defaults)
        XCTAssertEqual(SleepTimerPreferences.lastChoice(in: defaults), .minutes(37))
        SleepTimerPreferences.save(.minutes(0), in: defaults)
        XCTAssertEqual(SleepTimerPreferences.lastChoice(in: defaults), .minutes(37))
        SleepTimerPreferences.save(.endOfTrack, in: defaults)
        XCTAssertEqual(SleepTimerPreferences.lastChoice(in: defaults), .endOfTrack)
        XCTAssertFalse(SleepTimerChoice.minutes(1441).isValid)
        XCTAssertTrue(SleepTimerChoice.minutes(1440).isValid)
        let store = FolderPlaybackModeStore(defaults: defaults)
        store.setMode(.list, for: "音乐")
        store.setMode(.single, for: "音乐/陈慧娴")
        let restored = FolderPlaybackModeStore(defaults: defaults)
        XCTAssertEqual(restored.mode(for: "音乐"), .list)
        XCTAssertEqual(restored.mode(for: "音乐/陈慧娴"), .single)
        XCTAssertEqual(restored.mode(for: "小说"), .list)
        restored.setMode(.sequential, for: "手动顺序播放")
        XCTAssertEqual(FolderPlaybackModeStore(defaults: defaults).mode(for: "手动顺序播放"), .sequential)
    }

    func testNaturalChapterOrder() {
        let names = ["第10章.m4a", "第2章.m4a", "第1章.m4a"]
        let sorted = LibraryFiles.sorted(names.map { URL(fileURLWithPath: "/books/\($0)") })
        XCTAssertEqual(sorted.map(\.lastPathComponent), ["第1章.m4a", "第2章.m4a", "第10章.m4a"])
    }

    func testWMAIsRecognizedWithoutChangingExistingChapterIDs() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let folder = root.appendingPathComponent("同一本书")
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data().write(to: folder.appendingPathComponent("01.m4a"))
        let before = try XCTUnwrap(LibraryFiles.scan(in: root).first)
        try Data().write(to: folder.appendingPathComponent("02.wma"))
        let after = try XCTUnwrap(LibraryFiles.scan(in: root).first)
        XCTAssertEqual(before.id, after.id)
        XCTAssertEqual(before.chapters.first?.id, after.chapters.first?.id)
        XCTAssertEqual(after.chapters.last?.id, "同一本书/02.wma")
        XCTAssertEqual(after.chapters.count, 2)
    }

    func testRecursiveBooksAndStableRelativeIDs() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let book = root.appendingPathComponent("小说/第一卷")
        try fm.createDirectory(at: book, withIntermediateDirectories: true)
        for name in ["第10章.M4A", "第2章.mp3", "第3章.WMA", "说明.pdf", ".隐藏.m4a"] {
            try Data().write(to: book.appendingPathComponent(name))
        }
        try Data().write(to: root.appendingPathComponent("散篇.m4a"))
        try fm.createDirectory(at: book.appendingPathComponent("不是章节.wma"), withIntermediateDirectories: true)
        let books = try LibraryFiles.scan(in: root)
        XCTAssertEqual(books.count, 2)
        let found = try XCTUnwrap(books.first { $0.id == "小说/第一卷" })
        XCTAssertEqual(found.chapters.map(\.title), ["第2章", "第3章", "第10章"])
        XCTAssertEqual(found.chapters.first?.id, "小说/第一卷/第2章.mp3")
        XCTAssertEqual(books.first { $0.id == "." }?.title, "未分类音频")
    }
}
