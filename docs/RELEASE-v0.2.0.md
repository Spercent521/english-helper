# English Helper v0.2.0

- Show each configured dictionary in a source tab: Free Dictionary API and Youdao.
- Display fast results immediately and add slower results when they arrive.
  Keep the reader's selection and audio playback when another source completes.
- Save all successful sources independently under one word in SQLite.
- Show loading, available, not-found and connection-error statuses per source.
  Retry unavailable sources separately.
- Read existing words offline, including older single-source entries. A missing
  source can be fetched explicitly without replacing existing definitions or
  changing the original collection timestamp.
- Audio remains online and memory-only; no permanent audio storage.

Only the two integrated providers are queried. This does not search all
dictionaries on the Internet. The app remains ad-hoc signed and not notarized;
public-provider availability and permission limitations still apply.
