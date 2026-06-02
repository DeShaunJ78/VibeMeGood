---
name: Shark Chat knowledge injection
description: Where Shark Chat's persona/premise text actually lives — editing UI+prompt alone is not enough
---

# Shark Chat knowledge injection

Shark Chat's system prompt is assembled from THREE sources, not one:
1. the prompt builder (shark.ts)
2. the UI welcome/banner (shark-chat.tsx, SharkChatContext.tsx)
3. **markdown knowledge files loaded at runtime** — app-contexts.ts maps each app to
   knowledgeFolders (e.g. ["vibemegood","shared"]) and loadKnowledge reads EVERY *.md in
   those folders into the prompt.

**Why this matters:** removing a premise (e.g. the obsolete "paper trading" framing) from the
prompt builder and UI is insufficient — the framing also lives in knowledge/shared/*.md and
knowledge/vibemegood/*.md and silently re-enters the prompt. **How to apply:** when changing
the assistant's premise/persona, grep ALL of knowledge/ for the old framing and fix every
hit, then verify the loaded folders are clean. Filenames appear in the injected prompt as
section headers, so rename files when the concept changes, don't just edit the body.
