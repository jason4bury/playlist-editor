# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.5.0] - 2026-07-25

### Added
- Login screen, on by default (`APP_PASSWORD` in `docker-compose.yml`, ships
  with a `changeme` placeholder and a startup warning if left unchanged; set
  it to an empty string to disable the login screen entirely)
- Show/hide toggle on the login screen's password field
- Optional "paste tracks" box in the New Playlist form, so a playlist can be
  created fully populated with track names in one step (audio remains
  optional either way)

### Changed
- Various dark/light theme contrast fixes (Create button, Export menu items,
  sidebar footer buttons now solid white in both themes)
- Sidebar footer spacing/icon polish (Log out button, section spacing)

## [0.4.0] - 2026-07-24

### Added
- Album art: upload a JPEG/PNG per playlist, embedded as ID3 front-cover art
  (APIC frame) into every exported MP3
- Sequential playback: the preview player now builds a real queue from the
  current sort/filter order, with prev/next controls and auto-advance
- Whole-library backup/restore: download every playlist's tracks, order, and
  folders as one JSON file; restore with a merge or replace option
- Soft-delete: deleting a playlist moves it to "Recently deleted" for 7 days
  (restore or permanently delete from there) instead of destroying it
  immediately

## [0.3.0] - 2026-07-24

### Added
- Playlist folders (group playlists in the sidebar)
- Sort view (title/artist/duration/date added) and a real Shuffle action
- "Missing audio only" filter
- Find & replace across titles/artists
- Import from a `.txt`, `.m3u`/`.m3u8`, or `.cue` file (parsed into the
  existing paste box for review before importing)
- ID3 tags written on export reflect current title/artist, even if the
  original file had none
- Total playlist duration shown in the header
- Waveform preview + click-to-seek in the mini player
- Light/dark theme toggle
- Optional single-password auth (`APP_PASSWORD`, off by default at this
  point — see 0.5.0 for the default-on change)

## [0.2.0] - 2026-07-24

### Added
- Undo/redo for track edits, adds, deletes, and reordering
- Duplicate detection on import (skips tracks matching an existing entry)
- Keyboard shortcuts: undo/redo, `/` to focus search, `Alt+↑/↓` to reorder
- "Save as copy" playlist duplication (including attached audio)
- ID3 tag reading on attach (auto-fills blank title/artist, improves the
  filename-matching algorithm, shows track duration)
- Drag a single MP3 directly onto a track row to attach it
- Cross-playlist search from the sidebar
- Inline preview playback (▶ on any track with audio attached)
- `.cue` sheet export (pairs with the numbered audio `.zip`)

## [0.1.0] - 2026-07-23

### Added
- Attach your own MP3 files to tracks: bulk drag-and-drop with automatic
  filename matching, or attach one at a time per track
- Unassigned-file pool with manual track assignment for files that didn't
  auto-match
- Export a `.zip` of attached audio, renamed sequentially (`0001.mp3`,
  `0002.mp3`, …) in playlist order, with a `tracklist.txt` manifest

## [0.0.1] - 2026-07-23

### Added
- Initial release: Docker-based playlist editor
- Paste a text list to import tracks (handles "Artist - Title",
  "Title (Artist)", numbered lists, or plain titles)
- Multiple playlists, inline editing, drag-and-drop reordering
- Export as `.txt`, `.m3u`, or `.json`
