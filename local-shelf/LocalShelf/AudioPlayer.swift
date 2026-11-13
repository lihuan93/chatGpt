import AVFoundation
import MediaPlayer
import Combine
import VLCKitSPM

@MainActor
final class AudioPlayer: ObservableObject {
    @Published private(set) var book: Book?
    @Published private(set) var chapterIndex = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var seconds: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var ready = false
    @Published private(set) var loading = false
    @Published var error: String?
    @Published private(set) var speed: Float
    @Published private(set) var repeatMode: PlaybackRepeatMode = .list
    @Published private(set) var stopAfterCurrentFile = false
    @Published private(set) var sleepRemaining: Double?
    @Published private(set) var lastSleepChoice: SleepTimerChoice
    static let speeds = FolderPlaybackSpeedStore.allowedSpeeds
    private let player = AVPlayer()
    private var wma: WMAPlaybackEngine?
    private let progress: ProgressStore
    private let speedStore: FolderPlaybackSpeedStore
    private let modeStore: FolderPlaybackModeStore
    private let defaults: UserDefaults
    private var sleepDeadline: Date?
    private var sleepTimer: Timer?
    private var pausedAtEnd = false
    private var timeObserver: Any?
    private var itemObservation: NSKeyValueObservation?
    private var observers: [NSObjectProtocol] = []
    private var lastSave = Date.distantPast
    private var wantsPlayback = false
    private var interruptedPlayback = false
    private var finished = false
    private var generation = UUID()
    private var seekGeneration = UUID()
    private var seeking = false

    var chapter: Chapter? {
        guard let book, book.chapters.indices.contains(chapterIndex) else { return nil }
        return book.chapters[chapterIndex]
    }

    init(progress: ProgressStore, defaults: UserDefaults = .standard) {
        self.progress = progress
        speedStore = FolderPlaybackSpeedStore(defaults: defaults)
        modeStore = FolderPlaybackModeStore(defaults: defaults)
        self.defaults = defaults
        lastSleepChoice = SleepTimerPreferences.lastChoice(in: defaults)
        speed = 1
        player.automaticallyWaitsToMinimizeStalling = false
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        observe(.AVPlayerItemDidPlayToEndTime) { owner, notification in
            guard let item = notification.object as? AVPlayerItem, item === owner.player.currentItem else { return }
            owner.ended()
        }
        observe(.AVPlayerItemFailedToPlayToEndTime) { owner, notification in
            guard let item = notification.object as? AVPlayerItem, item === owner.player.currentItem else { return }
            owner.fail("音频播放中断，请检查文件是否完整。")
        }
        observe(AVAudioSession.interruptionNotification) { owner, notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                owner.interruptedPlayback = owner.wantsPlayback
                owner.pause()
            } else {
                let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if owner.interruptedPlayback && AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume) {
                    owner.play()
                }
                owner.interruptedPlayback = false
            }
        }
        observe(AVAudioSession.routeChangeNotification) { owner, notification in
            if let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable { owner.pause() }
        }
        configureRemoteCommands()
    }

    private func observe(_ name: Notification.Name, action: @escaping (AudioPlayer, Notification) -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
            Task { @MainActor in if let self { action(self, notification) } }
        })
    }

    func resume(_ book: Book) {
        if self.book?.id == book.id { play(); return }
        let saved = progress.entries[book.id]
        let index = saved?.finished == true ? 0 : book.chapters.firstIndex { $0.id == saved?.chapterID } ?? 0
        load(book, index: index, offset: saved?.finished == true ? 0 : saved?.seconds ?? 0)
    }

    func load(_ book: Book, index: Int, offset: Double = 0) {
        guard book.chapters.indices.contains(index) else { return }
        save()
        player.pause()
        player.replaceCurrentItem(with: nil)
        wma?.stop()
        wma = nil
        generation = UUID()
        seeking = false
        let token = generation
        itemObservation = nil
        self.book = book
        speed = speedStore.speed(for: book.id)
        repeatMode = modeStore.mode(for: book.id)
        pausedAtEnd = false
        chapterIndex = index
        seconds = max(0, offset)
        duration = 0
        ready = false
        loading = true
        finished = false
        isPlaying = false
        wantsPlayback = true
        save()
        updateNowPlaying()
        let url = book.chapters[index].url
        if url.pathExtension.lowercased() == "wma" {
            loadWMA(url, token: token)
            return
        }
        let item = AVPlayerItem(url: url)
        item.audioTimePitchAlgorithm = .timeDomain
        player.replaceCurrentItem(with: item)
        save() // Store selected chapter before it is ready; don't sample stale player time.
        updateNowPlaying()
        itemObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self, self.generation == token else { return }
                switch item.status {
                case .readyToPlay:
                    guard !self.ready else { return }
                    self.ready = true
                    self.loading = false
                    let length = item.duration.seconds
                    self.duration = length.isFinite ? max(0, length) : 0
                    let target = self.duration > 0 ? min(self.seconds, max(0, self.duration - 0.1)) : self.seconds
                    self.seek(to: target)
                case .failed: self.fail(item.error?.localizedDescription ?? "无法打开音频文件。")
                default: break
                }
            }
        }
    }

    func play() {
        guard let currentBook = book else { return }
        if checkSleepTimer() { return }
        if pausedAtEnd {
            let index = repeatMode.nextIndex(after: chapterIndex, count: currentBook.chapters.count) ?? chapterIndex
            load(currentBook, index: index)
            return
        }
        if !ready && !loading, let book {
            load(book, index: chapterIndex, offset: seconds)
            return
        }
        if finished, let book { load(book, index: 0); return }
        wantsPlayback = true
        guard ready || wma != nil else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            if let wma { wma.play(rate: speed) }
            else { player.playImmediately(atRate: speed) }
            isPlaying = true
            updateNowPlaying()
        } catch { fail("无法启动音频：\(error.localizedDescription)") }
    }

    func pause() {
        wantsPlayback = false
        player.pause()
        wma?.pause()
        isPlaying = false
        save()
        updateNowPlaying()
    }
    func toggle() { wantsPlayback ? pause() : play() }
    func setSpeed(_ value: Float) {
        guard let book, Self.speeds.contains(value) else { return }
        speedStore.setSpeed(value, for: book.id)
        speed = value
        if let wma { wma.setRate(value) }
        else if isPlaying { player.rate = value }
        updateNowPlaying()
    }
    func skip(_ delta: Double) { seek(to: seconds + delta) }
    func seek(to value: Double) {
        guard ready, value.isFinite else { return }
        let target = min(max(0, value), duration > 0 ? duration : max(0, value))
        if let wma {
            guard wma.seek(to: target) else {
                error = "这个 WMA 文件暂时无法定位，请稍后重试或检查文件是否完整。"
                return
            }
            seconds = target
            finished = false
            save()
            updateNowPlaying()
            return
        }
        let token = generation
        seekGeneration = UUID()
        let seekToken = seekGeneration
        seeking = true
        seconds = target
        finished = false
        save()
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
            Task { @MainActor in
                guard let self, self.generation == token, self.seekGeneration == seekToken else { return }
                self.seeking = false
                guard completed else { return }
                if self.wantsPlayback { self.play() }
                self.updateNowPlaying()
            }
        }
    }
    var canGoNext: Bool { book != nil && (chapterIndex + 1 < (book?.chapters.count ?? 0) || repeatMode == .list) }
    var canGoPrevious: Bool { book != nil && (chapterIndex > 0 || repeatMode == .list) }
    func next() {
        guard let book, !book.chapters.isEmpty else { return }
        if chapterIndex + 1 < book.chapters.count { load(book, index: chapterIndex + 1) }
        else if repeatMode == .list { load(book, index: 0) }
    }
    func previous() {
        guard let book, !book.chapters.isEmpty else { return }
        if chapterIndex > 0 { load(book, index: chapterIndex - 1) }
        else if repeatMode == .list { load(book, index: book.chapters.count - 1) }
    }
    func setRepeatMode(_ mode: PlaybackRepeatMode) {
        guard let book else { return }
        repeatMode = mode
        modeStore.setMode(mode, for: book.id)
    }

    var hasSleepTimer: Bool { sleepDeadline != nil || stopAfterCurrentFile }
    var sleepTimerLabel: String {
        if stopAfterCurrentFile { return "本文件结束后暂停" }
        if let remaining = sleepRemaining {
            let total = max(0, Int(ceil(remaining)))
            return String(format: "还剩 %d:%02d", total / 60, total % 60)
        }
        return "睡眠定时"
    }
    func startSleepTimer(_ choice: SleepTimerChoice) {
        guard choice.isValid else { return }
        cancelSleepTimer()
        lastSleepChoice = choice
        SleepTimerPreferences.save(choice, in: defaults)
        switch choice {
        case .endOfTrack: stopAfterCurrentFile = true
        case .minutes(let minutes):
            sleepDeadline = Date().addingTimeInterval(Double(minutes) * 60)
            sleepRemaining = Double(minutes) * 60
            let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in _ = self?.checkSleepTimer() }
            }
            sleepTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }
    func cancelSleepTimer() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleepDeadline = nil
        sleepRemaining = nil
        stopAfterCurrentFile = false
    }
    @discardableResult
    private func checkSleepTimer() -> Bool {
        guard let sleepDeadline else { return false }
        let remaining = max(0, sleepDeadline.timeIntervalSinceNow)
        sleepRemaining = remaining
        if remaining <= 0 {
            cancelSleepTimer()
            pause()
            return true
        }
        return false
    }
    func save() {
        guard let book, let chapter else { return }
        progress.save(book: book.id, chapter: chapter.id, seconds: seconds, finished: finished)
        lastSave = Date()
    }
    private func tick() {
        if checkSleepTimer() { return }
        guard wma == nil, ready, !seeking else { return }
        let time = player.currentTime().seconds
        if time.isFinite { seconds = max(0, time) }
        let length = player.currentItem?.duration.seconds ?? 0
        if length.isFinite { duration = max(0, length) }
        isPlaying = player.rate > 0
        if Date().timeIntervalSince(lastSave) >= 5 { save() }
        updateNowPlaying()
    }
    private func ended() {
        guard let book else { return }
        seconds = duration
        pausedAtEnd = true
        if checkSleepTimer() { return }
        let action = repeatMode.completion(after: chapterIndex, count: book.chapters.count,
            wantsPlayback: wantsPlayback, stopAfterCurrentFile: stopAfterCurrentFile)
        switch action {
        case .pause:
            if stopAfterCurrentFile { cancelSleepTimer() }
            pause()
        case .play(let index):
            pausedAtEnd = false
            load(book, index: index)
        case .finish:
            pausedAtEnd = false
            finished = true
            pause()
        }
    }
    private func fail(_ message: String) {
        loading = false
        ready = false
        pause()
        error = message
    }
    private func loadWMA(_ url: URL, token: UUID) {
        let engine = WMAPlaybackEngine()
        wma = engine
        engine.onUpdate = { [weak self, weak engine] time, length, playing in
            guard let self, self.generation == token, self.wma === engine else { return }
            if self.checkSleepTimer() { return }
            self.ready = true
            self.loading = false
            self.seconds = time
            self.duration = length
            if !self.wantsPlayback { engine?.pause() }
            self.isPlaying = self.wantsPlayback && playing
            if Date().timeIntervalSince(self.lastSave) >= 5 { self.save() }
            self.updateNowPlaying()
        }
        engine.onEnd = { [weak self] in
            guard let self, self.generation == token else { return }
            self.ended()
        }
        engine.onError = { [weak self] message in
            guard let self, self.generation == token else { return }
            self.ready = false
            self.fail(message)
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            engine.load(url, offset: seconds, rate: speed)
        } catch { fail("无法启动 WMA 音频：\(error.localizedDescription)") }
    }

    private func updateNowPlaying() {
        guard let book, let chapter else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: chapter.title,
            MPMediaItemPropertyAlbumTitle: book.title,
            MPMediaItemPropertyArtist: "本地书架",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: seconds,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? speed : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: speed,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
    }
    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.play() }; return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }; return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }; return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(-15) }; return .success
        }
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(30) }; return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }; return .success
        }
        center.changePlaybackRateCommand.supportedPlaybackRates = Self.speeds.map { NSNumber(value: $0) }
        center.changePlaybackRateCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackRateCommandEvent else { return .commandFailed }
            let rate = event.playbackRate
            Task { @MainActor in self?.setSpeed(rate) }; return .success
        }
    }
}

// VLC 3.x state is the last cached event, which may be buffering/ES-added after
// playback begins. Readiness must use live signals too, not only state == .playing.
enum WMAStartupReadiness {
    static func hasStarted(isPlaying: Bool, seconds: Double, isPaused: Bool) -> Bool {
        isPlaying || (seconds.isFinite && seconds > 0) || isPaused
    }
}

// WMA only: keep native AVPlayer behavior for M4A/MP3. No transcoding or extra audio copy.
// This class owns one VLC instance per chapter; stop() detaches it before a chapter switch.
@MainActor
private final class WMAPlaybackEngine: NSObject, VLCMediaPlayerDelegate {
    var onUpdate: ((Double, Double, Bool) -> Void)?
    var onEnd: (() -> Void)?
    var onError: ((String) -> Void)?
    private let player = VLCMediaPlayer()
    private var timer: Timer?
    private var active = false
    private var opened = false
    private var wantsPlayback = true
    private var terminalHandled = false
    private var rate: Float = 1
    private var openedAt = Date()
    private var pendingStart: Double = 0
    private var seekTarget: Double?
    private var seekStarted = Date.distantPast
    private var sourceSize: Int64 = 0

    func load(_ url: URL, offset: Double, rate: Float) {
        self.rate = rate
        pendingStart = max(0, offset)
        active = true
        openedAt = Date()
        player.delegate = self
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            sourceSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            guard sourceSize > 0, FileManager.default.isReadableFile(atPath: url.path) else {
                reportError("WMA 文件为空或不可读取，请确认文件已完整复制到本地书架。")
                return
            }
        } catch {
            reportError("无法读取本地 WMA：\(error.localizedDescription)")
            return
        }
        let media = VLCMedia(url: url)
        media.addOption(":no-video")
        media.addOption(":audio-filter=scaletempo")
        if pendingStart > 0 { media.addOption(":start-time=\(pendingStart)") }
        player.media = media
        player.play()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    func play(rate: Float) {
        wantsPlayback = true
        if !opened { openedAt = Date() }
        self.rate = rate
        player.play()
        player.rate = rate
    }
    func pause() {
        wantsPlayback = false
        if player.isPlaying { player.pause() }
    }
    func setRate(_ rate: Float) {
        self.rate = rate
        if player.isPlaying { player.rate = rate }
    }
    @discardableResult
    func seek(to seconds: Double) -> Bool {
        guard opened, player.isSeekable, seconds.isFinite else { return false }
        let milliseconds = min(max(0, seconds * 1000), Double(Int32.max))
        player.time = VLCTime(int: Int32(milliseconds))
        seekTarget = milliseconds / 1000
        seekStarted = Date()
        return true
    }
    func stop() {
        active = false
        timer?.invalidate()
        timer = nil
        player.delegate = nil
        player.stop()
        onUpdate = nil
        onEnd = nil
        onError = nil
    }
    // VLCKit invokes Obj-C delegate methods; hop to the UI actor without passing notifications.
    nonisolated func mediaPlayerStateChanged(_ aNotification: Notification) {
        Task { @MainActor [weak self] in self?.poll() }
    }
    nonisolated func mediaPlayerTimeChanged(_ aNotification: Notification) {
        Task { @MainActor [weak self] in self?.poll() }
    }
    private func poll() {
        guard active, !terminalHandled else { return }
        if !wantsPlayback && player.isPlaying { player.pause() }
        switch player.state {
        case .error:
            reportError("WMA 解码器报告错误。\(diagnosticDetails())")
            return
        case .ended:
            terminalHandled = true
            timer?.invalidate()
            timer = nil
            onEnd?()
            return
        default: break
        }
        let length = max(0, Double(player.media?.length.intValue ?? 0) / 1000)
        let actual = max(0, Double(player.time.intValue) / 1000)
        let hasStarted = WMAStartupReadiness.hasStarted(
            isPlaying: player.isPlaying, seconds: actual, isPaused: player.state == .paused)
        if !opened && hasStarted {
            opened = true
            player.rate = rate
        }
        guard opened else {
            if wantsPlayback && Date().timeIntervalSince(openedAt) > 30 {
                reportError("WMA 未能启动。\(diagnosticDetails())")
            }
            return
        }
        if pendingStart > 0 {
            if player.isSeekable {
                let target = length > 0 ? min(pendingStart, max(0, length - 0.1)) : pendingStart
                seek(to: target)
                pendingStart = 0
                // Sample the requested position until libvlc confirms the seek.
                onUpdate?(target, length, player.isPlaying)
                return
            }
            if wantsPlayback && Date().timeIntervalSince(openedAt) > 30 {
                reportError("WMA 已启动，但无法恢复到保存位置；请从章节列表重新播放。\(diagnosticDetails())")
            }
            // Do not overwrite the saved resume position with the opening clock.
            return
        }
        if let target = seekTarget {
            // Avoid saving the pre-seek clock over the requested resume position.
            if abs(actual - target) < 1.5 { seekTarget = nil }
            else if Date().timeIntervalSince(seekStarted) < 5 {
                onUpdate?(target, length, player.isPlaying)
                return
            } else {
                seekTarget = nil
                reportError("这个 WMA 文件未能准确跳转，请重新选择章节后重试。")
                return
            }
        }
        onUpdate?(actual, length, player.isPlaying)
    }
    private func diagnosticDetails() -> String {
        let clock = max(0, Double(player.time.intValue) / 1000)
        let duration = max(0, Double(player.media?.length.intValue ?? 0) / 1000)
        return "状态=\(player.state.rawValue)，播放=\(player.isPlaying)，时间=\(String(format: "%.1f", clock))/\(String(format: "%.1f", duration))秒，文件=\(sourceSize)字节。"
    }
    private func reportError(_ message: String) {
        terminalHandled = true
        timer?.invalidate()
        timer = nil
        player.pause()
        onError?(message)
    }
}

// Book IDs are Documents-relative folder paths. Separate paths with the same
// folder name stay independent, and sandbox relocation does not change the key.
struct FolderPlaybackSpeedStore {
    static let allowedSpeeds: [Float] = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]
    private static let key = "folderPlaybackSpeeds.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private var saved: [String: Float] {
        guard let data = defaults.data(forKey: Self.key),
              let entries = try? JSONDecoder().decode([String: Float].self, from: data) else { return [:] }
        return entries
    }
    func speed(for folderID: String) -> Float {
        guard let value = saved[folderID], Self.allowedSpeeds.contains(value) else { return 1 }
        return value
    }
    func setSpeed(_ value: Float, for folderID: String) {
        guard Self.allowedSpeeds.contains(value) else { return }
        var entries = saved
        entries[folderID] = value
        if let data = try? JSONEncoder().encode(entries) { defaults.set(data, forKey: Self.key) }
    }
}


enum PlaybackRepeatMode: String, CaseIterable, Identifiable {
    case sequential, list, single
    var id: String { rawValue }
    var title: String {
        switch self {
        case .sequential: return "顺序播放"
        case .list: return "列表循环"
        case .single: return "单曲循环"
        }
    }
    var icon: String {
        switch self {
        case .sequential: return "arrow.right"
        case .list: return "repeat"
        case .single: return "repeat.1"
        }
    }
    func completion(after index: Int, count: Int, wantsPlayback: Bool, stopAfterCurrentFile: Bool) -> PlaybackEndAction {
        // A queued end notification must never restart playback after a timer/user pause.
        guard wantsPlayback && !stopAfterCurrentFile else { return .pause }
        if let next = nextIndex(after: index, count: count) { return .play(next) }
        return .finish
    }
    func nextIndex(after index: Int, count: Int) -> Int? {
        guard count > 0, (0..<count).contains(index) else { return nil }
        switch self {
        case .single: return index
        case .list: return (index + 1) % count
        case .sequential: return index + 1 < count ? index + 1 : nil
        }
    }
}

enum PlaybackEndAction: Equatable { case pause, play(Int), finish }

struct FolderPlaybackModeStore {
    private static let key = "folderPlaybackModes.v1"
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    func mode(for folderID: String) -> PlaybackRepeatMode {
        let saved = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        return saved[folderID].flatMap(PlaybackRepeatMode.init(rawValue:)) ?? .list
    }
    func setMode(_ mode: PlaybackRepeatMode, for folderID: String) {
        var saved = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        saved[folderID] = mode.rawValue
        defaults.set(saved, forKey: Self.key)
    }
}

enum SleepTimerChoice: Codable, Equatable {
    case minutes(Int)
    case endOfTrack
    var isValid: Bool {
        switch self {
        case .minutes(let value): return (1...1440).contains(value)
        case .endOfTrack: return true
        }
    }
    var title: String {
        switch self {
        case .minutes(let value): return "\(value) 分钟"
        case .endOfTrack: return "本文件播完后停止"
        }
    }
}

enum SleepTimerPreferences {
    private static let key = "lastSleepTimerChoice.v1"
    static func lastChoice(in defaults: UserDefaults) -> SleepTimerChoice {
        guard let data = defaults.data(forKey: key),
              let choice = try? JSONDecoder().decode(SleepTimerChoice.self, from: data),
              choice.isValid else { return .minutes(30) }
        return choice
    }
    static func save(_ choice: SleepTimerChoice, in defaults: UserDefaults) {
        guard choice.isValid, let data = try? JSONEncoder().encode(choice) else { return }
        defaults.set(data, forKey: key)
    }
}
