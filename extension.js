const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const createIgnore = require("ignore").default;
const { TextDecoder } = require("util");

function activate(context) {
  const helper = new CopyHelper();

  context.subscriptions.push(
    // copy a single file from the explorer context menu
    // register a command to copy a single file from the explorer context menu
    vscode.commands.registerCommand(
      "fetchit.copyFileFromExplorer",
      async (uri) => {
        if (!uri) return;
        const rootPath = helper.findRootPath(uri);
        if (!rootPath) {
          vscode.window.showErrorMessage(
            "fetchit: unable to determine workspace root for this file"
          );
          return;
        }
        await helper.copyFiles([uri], rootPath);
      }
    ),

    // copy an entire folder from the explorer context menu
    // same as above, but for folders
    vscode.commands.registerCommand(
      "fetchit.copyFolderFromExplorer",
      async (uri) => {
        if (!uri) return;
        const rootPath = helper.findRootPath(uri);
        if (!rootPath) {
          vscode.window.showErrorMessage(
            "fetchit: unable to determine workspace root for this folder"
          );
          return;
        }
        const uris = await helper.collectFilesUnder(rootPath, uri);
        if (!uris.length) {
          vscode.window.showInformationMessage(
            "fetchit: folder has no copyable files"
          );
          return;
        }
        await helper.copyFiles(uris, rootPath);
      }
    )
  );
}

function deactivate() {}

// function to ignore binary files

function isBinaryFile(filePath) {
  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
    '.mp3', '.wav', '.flac', '.aac', '.ogg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib',
    '.pyc', '.pyo', '.class'
  ]);
  
  const ext = path.extname(filePath).toLowerCase();
  return binaryExts.has(ext);
}

// helper class for ignore rules and copying operations
// this class is used to collect files under a directory, filtered by ignore rules.
class CopyHelper {
  constructor() {
    this.igByRoot = new Map();
  }

  // FIXED: ensure an 'ignore' matcher exists for a workspace root
  async ensureIgnore(rootPath) {
    if (this.igByRoot.has(rootPath)) {
      return this.igByRoot.get(rootPath);
    }
    const ig = createIgnore();
  
    const cfgExcludes =
      vscode.workspace.getConfiguration().get("fetchit.excludeGlobs") || [];
    cfgExcludes.forEach((p) => ig.add(p));
  
    const addGitignoreToIg = (filePath) => {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const dir = path.dirname(filePath);
        const prefix = path.relative(rootPath, dir).replace(/\\/g, "/");
    
        const rules = [];
        for (const raw of content.split(/\r?\n/)) {
          const trimmed = raw.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
    
          let line = trimmed;
          let neg = false;
    
          if (line.startsWith("!")) {
            neg = true;
            line = line.slice(1);
          }
          if (line.startsWith("/")) {
            line = line.slice(1);
          }
    
          const withPrefix = prefix ? `${prefix}/${line}` : line;
          
          // if pattern ends with /, add both the dir and contents pattern
          if (line.endsWith("/")) {
            rules.push(neg ? `!${withPrefix}` : withPrefix);
            rules.push(neg ? `!${withPrefix}**` : `${withPrefix}**`);
          } else {
            rules.push(neg ? `!${withPrefix}` : withPrefix);
          }
        }
        if (rules.length) ig.add(rules);
      } catch {
        // ignore read errors
      }
    };
  
    // root .gitignore
    const rootGitignore = path.join(rootPath, ".gitignore");
    if (fs.existsSync(rootGitignore)) addGitignoreToIg(rootGitignore);
  
    // nested .gitignore files
    const nested = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootPath, "**/.gitignore"),
      "{**/node_modules/**,**/.git/**}"
    );
    for (const file of nested) {
      addGitignoreToIg(file.fsPath);
    }
  
    this.igByRoot.set(rootPath, ig);
    return ig;
  }

  // collect files under a directory, filtered by ignore rules
  async collectFilesUnder(rootPath, dirUri) {
    const ig = await this.ensureIgnore(rootPath);
    const pattern = new vscode.RelativePattern(dirUri.fsPath, "**/*");
    const candidates = await vscode.workspace.findFiles(pattern, undefined);

    return candidates.filter((uri) => {
      const rel = path.relative(rootPath, uri.fsPath).replace(/\\/g, "/");
      if (ig.ignores(rel)) return false;

      // FIXED: ignore binary files
      if (isBinaryFile(uri.fsPath)) return false;
    });
  }

  // copy a list of uris to clipboard as fenced code blocks or plain text
  async copyFiles(uris, rootPath) {
    const wrap = vscode.workspace
      .getConfiguration()
      .get("fetchit.wrapAsCodeBlock");
    const separator =
      /** @type {string} */ (
        vscode.workspace.getConfiguration().get("fetchit.separator")
      ) || "\n\n---\n\n";
    const parts = [];

    for (const uri of uris) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const content = new TextDecoder("utf-8").decode(data);
        const rel = this.relativeFor(uri, rootPath);
        const lang = languageFromFilename(uri.fsPath);
        const chunk = wrap
          ? `# ${rel}\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`
          : content;
        parts.push(chunk);
      } catch {
        // skip unreadable files.
      }
    }

    if (!parts.length) {
      vscode.window.showInformationMessage("fetchit: nothing copied");
      return;
    }

    await vscode.env.clipboard.writeText(parts.join(separator));
    if (uris.length === 1) {
      const rel = this.relativeFor(uris[0], rootPath);
      vscode.window.showInformationMessage(`fetchit: copied ${rel}`);
    } else {
      vscode.window.showInformationMessage(
        `fetchit: copied ${uris.length} files`
      );
    }
  }

  // produce a clean relative path for display
  relativeFor(uri, rootPath) {
    if (rootPath)
      return path.relative(rootPath, uri.fsPath).replace(/\\/g, "/");
    return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  }

  // determine which workspace root a uri belongs to
  findRootPath(uri) {
    const roots = vscode.workspace.workspaceFolders || [];
    for (const r of roots) {
      const rel = path.relative(r.uri.fsPath, uri.fsPath);
      // if relative path doesn't start with "..", uri is under this root
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        return r.uri.fsPath;
      }
    }
    return undefined;
  }
}

// map file extensions to markdown code block languages
// TODO: add more languages and extensions
function languageFromFilename(fp) {
  const ext = path.extname(fp).toLowerCase();
  const map = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".c": "c",
    ".md": "md",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sql": "sql",
    ".sh": "bash",
    ".bat": "bat",
    ".ps1": "powershell",
    ".ini": "ini",
    ".cfg": "ini",
    ".env": "",
    ".txt": "",
    ".vue": "vue",
    ".svelte": "svelte", 
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift"
  };
  return map[ext] || "";
}

module.exports = { activate, deactivate };
