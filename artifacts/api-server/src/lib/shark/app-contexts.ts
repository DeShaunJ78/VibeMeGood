import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

// The server process runs with CWD = artifacts/api-server (where package.json is).
// Knowledge files live at the workspace root.
// Try CWD/knowledge first (workspace-root case), then CWD/../../knowledge (package-dir case).
function resolveKnowledgeRoot(): string {
  const candidates = [
    join(process.cwd(), "knowledge"),
    join(process.cwd(), "../../knowledge"),
    join(process.cwd(), "../../../knowledge"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to the last candidate even if it doesn't exist — loadKnowledge handles missing dir gracefully
  return candidates[1];
}

const KNOWLEDGE_ROOT = resolveKnowledgeRoot();

export function loadKnowledge(folders: string[]): string {
  const sections: string[] = [];

  for (const folder of folders) {
    const dir = join(KNOWLEDGE_ROOT, folder);
    if (!existsSync(dir)) continue;

    let files: string[] = [];
    try {
      files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const path = join(dir, file);
      try {
        const content = readFileSync(path, "utf-8");
        sections.push(`### ${folder}/${file}\n${content}`);
      } catch {
        // skip unreadable files
      }
    }
  }

  return sections.join("\n\n---\n\n");
}

export interface AppContext {
  appName: string;
  knowledgeFolders: string[];
  systemPromptPrefix: string;
}

const APP_CONTEXTS: Record<string, AppContext> = {
  vibemegood: {
    appName: "VibeMeGood",
    knowledgeFolders: ["vibemegood", "shared"],
    systemPromptPrefix: `ACTIVE APP: VibeMeGood
SCOPE: PrizePicks pick'em analytics only.
Do not explain PropEdge sportsbook betting in this session.
Do not explain DraftDuel DFS lineup building in this session.
If asked about other apps say: "That is a separate app. I am focused on VibeMeGood right now. What do you need help with here?"`,
  },
};

export function getAppContext(app: string): AppContext {
  return APP_CONTEXTS[app] ?? APP_CONTEXTS.vibemegood;
}
