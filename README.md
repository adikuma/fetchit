
# fetchit :)

fetch project context fast. a sidebar lists files and folders (respecting `.gitignore` + extra excludes). copy a neat, fenced snippet with language and relative path.

## features

- activity bar view with folders + files
- multi-select → copy selected files
- copy a single file, an entire folder, or the whole workspace
- explorer right-click: “fetchit: copy file” / “fetchit: copy folder”
- respects `.gitignore` and `fetchit.excludeGlobs`

## usage

1) open the **fetchit** icon in the activity bar
2) multi-select files (ctrl/cmd-click) → **copy selected**
3) click a folder’s inline action → **copy folder**
4) use the title action → **copy all**
5) from the normal explorer, right-click any file/folder → **fetchit: copy …**

## settings

- `fetchit.excludeGlobs` (array): extra excludes in addition to `.gitignore`
- `fetchit.wrapAsCodeBlock` (boolean): wrap output with code fences
- `fetchit.separator` (string): separator between multiple files

## notes

- binary/huge files are skipped; text files are copied with their relative path as a header.
- language fences are inferred from file extensions.
