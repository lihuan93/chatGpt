# WMA dependency

WMA playback uses VLCKit / libvlc by VideoLAN, via the community Swift Package wrapper:

- Package: https://github.com/tylerjonesio/vlckit-spm
- Exact tag: 3.6.0
- Commit: e932bbd488872fdb74f6654d28c2f291eae03daf
- Binary SHA-256 from that tag's Package.swift: 5da4747e001900bbb4153f58db2be4695096c9c2350aea00376ad67b39c053f6
- Upstream library source: https://code.videolan.org/videolan/VLCKit
- Wrapper exports MobileVLCKit on iOS. The binary is downloaded and checksum-verified by Swift Package Manager; it is not included in this source archive.
- LGPL 2.1 license text from the wrapper repository is included alongside this file. Underlying library components retain their original licenses and notices.

The app passes local file URLs to the decoder and does not transcode or upload audio.
