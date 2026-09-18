# Tracklist — a Docker-based playlist editor

Paste a list of songs, get an editable playlist. Reorder by dragging, edit
titles/artists inline, keep multiple playlists, and export as `.txt`,
`.m3u`, or `.json`. No account, no external services — everything is
stored in a JSON file inside a Docker volume.

## Run it

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

Data persists in the `playlist-data` Docker volume between restarts. To
reset everything:

```bash
docker compose down -v
```

### Without docker-compose

```bash
docker build -t playlist-editor .
docker run -p 3000:3000 -v playlist-data:/app/data playlist-editor
```

## Using it

1. **Create a playlist** — type a name in the sidebar and hit "+ Create".
2. **Import a list** — paste text into the import box, one track per
   line, then click **Import (replace all)** or **Import (append)**.
   Supported line formats (auto-detected per line):
   - `Artist - Title`
   - `Title (Artist)`
   - `1. Artist - Title` / `1) Title` (leading numbering is stripped)
   - plain `Title` (artist left blank, editable later)
3. **Edit** — click any title/artist field to edit it directly; changes
   autosave.
4. **Reorder** — drag the ⠿ handle (or anywhere in the row) to a new
   position.
5. **Filter** — use the filter box to narrow a long list while editing
   (doesn't remove tracks, just hides ones that don't match).
6. **Rename a playlist** — click the playlist title at the top and edit
   it directly, then click away or press Enter.
7. **Export** — use the Export ▾ menu for `.txt` (plain list), `.m3u`
   (a playlist file most media players can open), or `.json` (structured
   data with stable track IDs).

## Attaching your own MP3 files

If you already have the MP3 files for a playlist on your computer, you
can attach them and export a numbered folder (`0001.mp3`, `0002.mp3`, …)
in playlist order — handy for USB sticks, car stereos, or anything that
plays files in filename order.

1. **Bulk match** — drag a batch of MP3 files onto the dropzone above
   the tracklist (or click "Browse files"). The app compares each
   filename against your track titles/artists and auto-attaches the
   best matches. Anything it isn't confident about lands in an
   "Unassigned audio files" list below, where you pick the right track
   from a dropdown per file.
2. **Attach one at a time** — each track row also has its own "+ mp3"
   button if you'd rather assign files individually.
3. **Export audio (.zip)** — once tracks have audio attached, click
   this button in the header. You'll get a zip containing only the
   tracks with audio, renamed sequentially as `0001.mp3`, `0002.mp3`, …
   in playlist order (padded to at least 4 digits), plus a
   `tracklist.txt` manifest mapping each number back to its title.
   Tracks without audio are skipped — no gaps in the numbering.

Matching is filename-based (not audio analysis), so results like
`Radiohead - Paranoid Android.mp3` or `04 Paranoid Android.mp3` match
well; very different filenames won't auto-match and will need manual
assignment. Uploads are capped at 40MB per file / 300 files per batch —
adjust the `limits` in `server.js` if you need more.

If an MP3 has embedded ID3 tags, they're read on attach: matching uses
them alongside the filename (usually more reliable than the filename
alone), blank title/artist fields get auto-filled from the tags, and
track duration is shown next to the filename. Duration is an
approximation — exact for constant-bitrate files, close for
variable-bitrate ones.

## Everything else

- **Undo / redo** — `Ctrl+Z` / `Ctrl+Shift+Z` (or the ↺ / ↻ buttons)
  cover edits, adds, deletes, and reordering. Scoped to the tracklist
  itself, not audio attach/remove.
- **Reorder with the keyboard** — focus a track's title or artist field
  and press `Alt+↑` / `Alt+↓`.
- **Duplicate detection on import** — tracks matching an existing
  entry (by normalized artist + title) are skipped automatically, with
  a count in the toast. Replacing a tracklist that has audio attached
  asks for confirmation first, since it deletes that audio.
- **Save as copy** — duplicates a playlist, including any attached
  audio, under a new name.
- **Search all playlists** — the sidebar search box (or press `/`)
  searches every playlist at once; clicking a result jumps you there.
- **Preview playback** — click ▶ on any track with audio attached to
  play it in the mini player at the bottom of the screen.
- **Drag a file onto a single row** — in addition to the bulk dropzone,
  you can drag one MP3 straight onto a specific track row to attach it.
- **.cue export** — alongside .txt/.m3u/.json, exports a cue sheet that
  references the numbered files from the audio .zip (download both
  together — the cue sheet is only useful alongside the numbered mp3s).
- **Sort & shuffle** — the "Sort:" dropdown is a *view*, not a permanent
  reorder (drag-to-reorder is disabled while it's active, since dragging
  wouldn't map to a meaningful new position); switch back to "Manual
  order" to drag again. **Shuffle** is the opposite — it actually
  randomizes and saves the order.
- **Missing audio only** — a checkbox in the tracks toolbar to filter
  down to tracks that don't have an mp3 attached yet.
- **Find & replace** — the "Find & replace" button opens a small panel
  to bulk-replace text across all titles, artists, or both (e.g. strip
  "(Remastered 2011)" from every track at once).
- **Folders** — group playlists in the sidebar by giving them a folder
  name (set one when creating a playlist, or edit "Folder: ..." under
  the playlist title any time).
- **Import from a file** — "Import file…" next to the paste box accepts
  `.txt`, `.m3u`/`.m3u8`, or `.cue` files. It loads the parsed result
  into the paste box for you to review before importing, rather than
  importing immediately.
- **ID3 tags on export** — the audio `.zip` writes each file's *current*
  title/artist (whatever you've edited in the app) into its ID3 tags,
  even if the original file had none or had something different.
- **Light/dark theme** — the ◐ button in the sidebar toggles it;
  preference is remembered in your browser.
- **Login screen** — on by default; see "Restricting access" below.

## Album art, playback, and backups

- **Cover art** — click "+ cover" under the playlist title to upload a
  JPEG or PNG. It's embedded into every exported MP3's ID3 tags (along
  with title/artist) as a front-cover image, so it shows up in car
  stereos and media players that display artwork.
- **Sequential playback** — clicking ▶ on a track builds a queue from
  every track with audio attached, in whatever order/filter is
  currently applied, and starts there. It auto-advances to the next
  track when one finishes, and the ⏮ / ⏭ buttons skip manually.
- **Backup & restore** — "⬇ Backup all" (bottom of the sidebar)
  downloads every playlist's tracks, order, and folders as one JSON
  file. "⬆ Restore backup" loads one back in, either merging (only adds
  playlists that don't already exist) or replacing everything — you'll
  be asked which. Note: this covers structure, not the attached audio
  files themselves, which live in the Docker volume. Restoring onto the
  *same* volume that made the backup will still have audio linked up;
  restoring onto a fresh one won't (the tracks come back, just without
  audio attached).
- **Recently deleted** — deleting a playlist doesn't destroy it right
  away. It sits in "🗑 Recently deleted" (bottom of the sidebar) for 7
  days — restore it or delete it forever from there — before being
  purged automatically.

## Restricting access

A login screen is **on by default** — `docker-compose.yml` ships with
`APP_PASSWORD=changeme`. **Change this before you run it**; anyone who
knows the password can use the app (and see everything in it). Edit the
`APP_PASSWORD` value in `docker-compose.yml`, then rebuild:

```bash
docker compose up --build
```

If you leave it as `changeme`, the container logs a warning on startup
so it's hard to miss.

To disable the login screen entirely (e.g. on a home network you fully
trust), set `APP_PASSWORD=` (empty) in `docker-compose.yml`.

This is a single shared password behind one session cookie, not real
multi-user accounts — good enough to keep the app off-limits to
"anyone on the network," not a substitute for proper auth if you're
exposing this to the internet.

## Project layout

```
playlist-editor/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js         # Express API + static file server + optional auth
├── mp3-info.js        # dependency-free ID3 tag read/write (+ album art) and duration reader
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js          # all client-side logic, vanilla JS
└── data/                # bind-mount target if you prefer a local folder
```

If you'd rather persist to a local folder instead of a named Docker
volume, swap the `volumes:` entry in `docker-compose.yml` for:

```yaml
volumes:
  - ./data:/app/data
```

## Notes

- No build step for the frontend — it's plain HTML/CSS/JS served
  directly, so editing `public/*` and reloading the container (or
  running `node server.js` locally) is enough to see changes.
- Storage is a single JSON file (`data/playlists.json`). Fine for
  personal use; if you need concurrent multi-user editing or very large
  libraries, swap in SQLite — the API layer in `server.js` would only
  need its storage functions (`readAll`/`writeAll`) touched.
- The mini player's waveform is drawn client-side via the Web Audio API
  (it downloads and decodes the full file, so it's a preview tool for
  individual tracks, not meant for huge files).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

[MIT](./LICENSE)
