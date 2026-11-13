import SwiftUI

@main
@MainActor
struct LocalShelfApp: App {
    @StateObject private var library: Library
    @StateObject private var progress: ProgressStore
    @StateObject private var audio: AudioPlayer
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let progress = ProgressStore()
        _progress = StateObject(wrappedValue: progress)
        _library = StateObject(wrappedValue: Library())
        _audio = StateObject(wrappedValue: AudioPlayer(progress: progress))
    }
    var body: some Scene {
        WindowGroup {
            ShelfView()
                .environmentObject(library)
                .environmentObject(progress)
                .environmentObject(audio)
                .tint(.indigo)
                .task { await library.refresh() }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { Task { await library.refresh() } }
                    else { audio.save() }
                }
        }
    }
}
