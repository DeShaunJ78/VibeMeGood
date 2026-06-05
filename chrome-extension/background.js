const PP_API_URL =
  "https://api.prizepicks.com/projections?per_page=25000&single_stat=true&include=new_player,league";

const ALARM_NAME = "vmg-pp-sync";

// ── Storage helpers ─────────────────────────────────────────────────────────

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { workstationUrl: "", intervalMinutes: 15, enabled: true },
      resolve
    );
  });
}

function getStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      { lastSync: null, lastCount: null, lastError: null, syncing: false },
      resolve
    );
  });
}

function setStatus(patch) {
  return chrome.storage.local.set(patch);
}

// ── Badge helpers ────────────────────────────────────────────────────────────

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ── Core sync ────────────────────────────────────────────────────────────────

async function doSync() {
  const { workstationUrl, enabled } = await getSettings();

  if (!enabled) {
    await setBadge("OFF", "#6b7280");
    return;
  }

  if (!workstationUrl) {
    await setBadge("SET", "#f59e0b");
    await setStatus({ lastError: "Enter your Workstation URL in the extension popup." });
    return;
  }

  // Find an open prizepicks.com tab
  const tabs = await chrome.tabs.query({ url: "*://*.prizepicks.com/*" });

  if (!tabs.length) {
    await setBadge("PP?", "#f59e0b");
    await setStatus({ lastError: "Open prizepicks.com in Chrome to sync." });
    return;
  }

  const tab = tabs[0];
  const importUrl = workstationUrl.replace(/\/$/, "") + "/api/sync/pp-lines-import";

  await setBadge("...", "#6366f1");
  await setStatus({ syncing: true, lastError: null });

  let result;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async function syncPP(ppApiUrl, postUrl) {
        try {
          const ppRes = await fetch(ppApiUrl, { credentials: "include" });
          if (!ppRes.ok) {
            return { ok: false, error: "PrizePicks returned " + ppRes.status + " — are you logged in?" };
          }
          const feed = await ppRes.json();
          if (!feed || !Array.isArray(feed.data) || !Array.isArray(feed.included)) {
            return { ok: false, error: "Unexpected PP response shape — try again." };
          }
          const postRes = await fetch(postUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: feed.data, included: feed.included }),
          });
          const body = await postRes.json().catch(() => ({}));
          if (!postRes.ok) {
            return { ok: false, error: body.error || "Workstation returned " + postRes.status };
          }
          return { ok: true, count: body.recordsProcessed };
        } catch (e) {
          return { ok: false, error: e && e.message ? e.message : String(e) };
        }
      },
      args: [PP_API_URL, importUrl],
    });
    result = results && results[0] && results[0].result;
  } catch (e) {
    result = { ok: false, error: e && e.message ? e.message : "Script injection failed" };
  }

  await setStatus({ syncing: false });

  if (result && result.ok) {
    await setBadge("✓", "#10b981");
    await setStatus({
      lastSync: new Date().toISOString(),
      lastCount: result.count,
      lastError: null,
    });
  } else {
    await setBadge("!", "#ef4444");
    await setStatus({ lastError: (result && result.error) || "Unknown error" });
  }
}

// ── Alarm ────────────────────────────────────────────────────────────────────

async function resetAlarm() {
  const { intervalMinutes, enabled } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  if (enabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalMinutes });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) doSync();
});

// ── Messages from popup ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SYNC_NOW") {
    doSync().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "SETTINGS_SAVED") {
    resetAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(resetAlarm);
chrome.runtime.onStartup.addListener(resetAlarm);
