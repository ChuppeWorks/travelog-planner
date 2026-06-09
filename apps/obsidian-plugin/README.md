# Travelog Planner Obsidian Plugin

This is the Obsidian interface for the common Travelog planning dataset.

## Manual install

1. Run `pnpm build` from the repository root.
2. Copy `dist/main.js`, `manifest.json`, and `styles.css` into
   `<vault>/.obsidian/plugins/travelog-planner/`.
3. Enable **Travelog Planner** in Community plugins.
4. Use the map ribbon icon or the `Open planner` command.

By default, raw data is stored at `Travelog/travelog.json` in the vault. The
path is configurable in plugin settings.

Use **Export Notion CSV files** from the command palette or planner toolbar to
write the seven interoperable CSV files beside the canonical JSON dataset.
