// ── Element refs ─────────────────────────────────────────────────────────────
const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const statusCount  = document.getElementById("statusCount");
const statusError  = document.getElementById("statusError");
const statusNext   = document.getElementById("statusNext");
const syncBtn      = document.getElementById("syncBtn");
const urlInput     = document.getElementById("urlInput");
const urlHint      = document.getElementById("urlHint");
const intervalSel  = document.getElementById("intervalSelect");
const enabledChk   = document.getElementById("enabledToggle");
const saveBtn      = document.getElementById("saveBtn");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((now - d) / 1000);
  if (diff < 60)  return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function setDot(state) {
  statusDot.className = "status-dot " + state;
}

// ── Render status ─────────────────────────────────────────────────────────────

async function renderStatus() {
  const [settings, status] = await Promise.all([
    new Promise(r => chrome.storage.sync.get({ workstationUrl: "", intervalMinutes: 15, enabled: true }, r)),
    new Promise(r => chrome.storage.local.get({ lastSync: null, lastCount: null, lastError: null, syncing: false }, r)),
  ]);

  const { workstationUrl, intervalMinutes, enabled } = settings;
  const { lastSync, lastCount, lastError, syncing } = status;

  // Populate settings fields
  urlInput.value = workstationUrl || "";
  intervalSel.value = String(intervalMinutes);
  enabledChk.checked = Boolean(enabled);

  // Show URL hint if empty
  urlHint.style.display = workstationUrl ? "none" : "block";

  if (!enabled) {
    setDot("gray");
    statusText.innerHTML = "<strong>Auto-sync off</strong>";
    statusCount.textContent = "";
    statusError.style.display = "none";
    statusNext.textContent = "Toggle on to enable scheduled syncing.";
    return;
  }

  if (syncing) {
    setDot("pulse");
    statusText.innerHTML = "<strong>Syncing…</strong>";
    statusCount.textContent = "";
    statusError.style.display = "none";
    statusNext.textContent = "";
    return;
  }

  if (!workstationUrl) {
    setDot("yellow");
    statusText.innerHTML = "<strong>Setup required</strong>";
    statusCount.textContent = "";
    statusError.style.display = "none";
    statusNext.textContent = "Enter your Workstation URL below.";
    return;
  }

  if (lastError) {
    setDot("red");
    statusText.innerHTML = "<strong>Last sync failed</strong>" + (lastSync ? " · " + fmtTime(lastSync) : "");
    statusCount.textContent = "";
    statusError.style.display = "block";
    statusError.textContent = lastError;
  } else if (lastSync) {
    setDot("green");
    statusText.innerHTML = "<strong>Synced</strong> · " + fmtTime(lastSync);
    statusCount.textContent = lastCount != null ? lastCount + " lines" : "";
    statusError.style.display = "none";
  } else {
    setDot("gray");
    statusText.innerHTML = "<strong>Never synced</strong>";
    statusCount.textContent = "";
    statusError.style.display = "none";
  }

  if (intervalMinutes > 0 && lastSync) {
    const nextMs = new Date(lastSync).getTime() + intervalMinutes * 60 * 1000;
    const diffMin = Math.round((nextMs - Date.now()) / 60000);
    statusNext.textContent = diffMin > 0
      ? "Next auto-sync in ~" + diffMin + "m"
      : "Auto-sync due soon";
  } else if (intervalMinutes > 0) {
    statusNext.textContent = "Auto-sync every " + intervalMinutes + " min";
  } else {
    statusNext.textContent = "Manual sync only";
  }
}

// ── Sync Now button ───────────────────────────────────────────────────────────

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  setDot("pulse");
  statusText.innerHTML = "<strong>Syncing…</strong>";
  statusError.style.display = "none";

  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async () => {
    syncBtn.disabled = false;
    syncBtn.textContent = "⚡ Sync Now";
    // Give background a moment to write storage before re-rendering
    await new Promise(r => setTimeout(r, 300));
    renderStatus();
  });
});

// ── Save settings ─────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const workstationUrl = urlInput.value.trim().replace(/\/$/, "");
  const intervalMinutes = parseInt(intervalSel.value, 10);
  const enabled = enabledChk.checked;

  await chrome.storage.sync.set({ workstationUrl, intervalMinutes, enabled });

  // Update alarm via background
  chrome.runtime.sendMessage({ type: "SETTINGS_SAVED", intervalMinutes, enabled });

  urlHint.style.display = workstationUrl ? "none" : "block";

  saveBtn.textContent = "✓ Saved";
  saveBtn.classList.add("saved");
  setTimeout(() => {
    saveBtn.textContent = "Save Settings";
    saveBtn.classList.remove("saved");
  }, 2000);

  renderStatus();
});

// ── URL input hint ────────────────────────────────────────────────────────────

urlInput.addEventListener("input", () => {
  urlHint.style.display = urlInput.value.trim() ? "none" : "block";
});

// ── Init ─────────────────────────────────────────────────────────────────────

renderStatus();
// Refresh status every 5s while popup is open (handles syncing state)
setInterval(renderStatus, 5000);
