// src/frontend.ts
function setup(ctx) {
  let permissions = null;
  let characters = [];
  let configs = {};
  let connections = [];
  let chatsPerCharacter = {};
  let expandedCharacterId = null;
  let activeNudgeTab = "inactive";
  let defaultPrompts = null;
  let draftConfigs = {};
  let activeObserver = null;
  const removeStyle = ctx.dom.addStyle(`
    .cn-panel {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 13px;
      color: var(--lumiverse-text);
    }

    .cn-panel-header {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }

    .cn-panel-desc {
      font-size: 12px;
      color: var(--lumiverse-text-muted);
      margin: 0;
      line-height: 1.45;
    }

    .cn-alert {
      padding: 10px 12px;
      border-radius: var(--lumiverse-radius);
      font-size: 12px;
      line-height: 1.45;
    }

    .cn-alert-warn {
      background: rgba(234, 179, 8, 0.1);
      border: 1px solid rgba(234, 179, 8, 0.25);
      color: rgb(234, 179, 8);
    }

    /* ── Accordion ── */

    .cn-char-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cn-char-item {
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      overflow: hidden;
    }

    .cn-char-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
      transition: background var(--lumiverse-transition-fast);
    }

    .cn-char-header:hover {
      background: var(--lumiverse-fill-subtle);
    }

    .cn-char-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--lumiverse-fill);
    }

    .cn-char-avatar-placeholder {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--lumiverse-fill);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--lumiverse-text-muted);
    }

    .cn-char-info {
      flex: 1;
      min-width: 0;
    }

    .cn-char-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cn-char-status {
      font-size: 11px;
      color: var(--lumiverse-text-dim);
    }

    .cn-char-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 8px;
      flex-shrink: 0;
    }

    .cn-badge-on {
      background: rgba(34, 197, 94, 0.15);
      color: rgb(34, 197, 94);
    }

    .cn-badge-off {
      background: var(--lumiverse-fill);
      color: var(--lumiverse-text-dim);
    }

    .cn-chevron {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      color: var(--lumiverse-text-dim);
      transition: transform var(--lumiverse-transition-fast);
    }

    .cn-chevron-open {
      transform: rotate(90deg);
    }

    /* ── Body ── */

    .cn-char-body {
      padding: 10px;
      border-top: 1px solid var(--lumiverse-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .cn-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .cn-field-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .cn-label {
      font-size: 12px;
      font-weight: 500;
    }

    .cn-sublabel {
      font-size: 11px;
      color: var(--lumiverse-text-dim);
    }

    .cn-select, .cn-input {
      width: 100%;
      padding: 5px 8px;
      background: var(--lumiverse-fill);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      color: var(--lumiverse-text);
      font-size: 12px;
      outline: none;
      transition: border-color var(--lumiverse-transition-fast);
    }

    .cn-select {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      padding-right: 28px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      background-size: 12px;
      cursor: pointer;
    }

    .cn-select option {
      background: var(--lumiverse-fill);
      color: var(--lumiverse-text);
    }

    .cn-select:hover, .cn-input:hover { border-color: var(--lumiverse-border-hover); }
    .cn-select:focus, .cn-input:focus { border-color: var(--lumiverse-accent); }

    .cn-range-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cn-range-row .cn-input {
      width: 60px;
      text-align: center;
    }

    .cn-range-sep {
      color: var(--lumiverse-text-dim);
      font-size: 11px;
      flex-shrink: 0;
    }

    .cn-sampler-row {
      display: flex;
      gap: 6px;
    }

    .cn-sampler-row .cn-field { flex: 1; }
    .cn-sampler-row .cn-input { text-align: center; }

    .cn-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }

    .cn-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }

    .cn-toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--lumiverse-fill-subtle);
      border: 1px solid var(--lumiverse-border);
      border-radius: 10px;
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast),
                  border-color var(--lumiverse-transition-fast);
    }

    .cn-toggle-slider::before {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      transition: transform var(--lumiverse-transition-fast),
                  background var(--lumiverse-transition-fast);
    }

    .cn-toggle input:checked + .cn-toggle-slider {
      background: var(--lumiverse-primary);
      border-color: var(--lumiverse-primary);
    }

    .cn-toggle input:checked + .cn-toggle-slider::before {
      transform: translateX(16px);
      background: #fff;
    }

    .cn-textarea-wrap {
      position: relative;
    }

    .cn-textarea {
      width: 100%;
      min-height: 64px;
      padding: 6px 8px;
      padding-right: 32px;
      background: var(--lumiverse-fill);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      color: var(--lumiverse-text);
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      line-height: 1.45;
      resize: vertical;
      outline: none;
      transition: border-color var(--lumiverse-transition-fast);
    }

    .cn-textarea:hover { border-color: var(--lumiverse-border-hover); }
    .cn-textarea:focus { border-color: var(--lumiverse-accent); }

    .cn-expand-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--lumiverse-fill-subtle);
      border: 1px solid var(--lumiverse-border);
      border-radius: 4px;
      color: var(--lumiverse-text-dim);
      cursor: pointer;
      padding: 0;
      transition: color var(--lumiverse-transition-fast),
                  border-color var(--lumiverse-transition-fast);
    }

    .cn-expand-btn:hover {
      color: var(--lumiverse-text);
      border-color: var(--lumiverse-border-hover);
    }

    .cn-divider {
      border: none;
      border-top: 1px solid var(--lumiverse-border);
      margin: 2px 0;
    }

    .cn-btn-row {
      display: flex;
      gap: 6px;
    }

    .cn-btn {
      padding: 5px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-fill);
      color: var(--lumiverse-text);
      font-size: 11px;
      cursor: pointer;
      transition: border-color var(--lumiverse-transition-fast),
                  background var(--lumiverse-transition-fast);
    }

    .cn-btn:hover { border-color: var(--lumiverse-border-hover); background: var(--lumiverse-fill-subtle); }

    .cn-btn-primary {
      background: var(--lumiverse-accent);
      border-color: var(--lumiverse-accent);
      color: var(--lumiverse-accent-fg);
    }

    .cn-btn-primary:hover { opacity: 0.9; }

    .cn-btn-sm {
      padding: 2px 6px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-fill);
      color: var(--lumiverse-text-dim);
      font-size: 10px;
      cursor: pointer;
    }

    .cn-btn-sm:hover { color: var(--lumiverse-text); border-color: var(--lumiverse-border-hover); }

    .cn-prompt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .cn-search {
      position: relative;
    }

    .cn-search-icon {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--lumiverse-text-dim);
      pointer-events: none;
    }

    .cn-search input {
      width: 100%;
      padding: 6px 8px 6px 28px;
      background: var(--lumiverse-fill);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      color: var(--lumiverse-text);
      font-size: 12px;
      outline: none;
      transition: border-color var(--lumiverse-transition-fast);
    }

    .cn-search input::placeholder {
      color: var(--lumiverse-text-dim);
    }

    .cn-search input:focus {
      border-color: var(--lumiverse-accent);
    }

    .cn-status-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 3px;
      background: var(--lumiverse-fill);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
    }

    .cn-status-tab {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 8px;
      border: 0;
      border-radius: calc(var(--lumiverse-radius) - 2px);
      background: transparent;
      color: var(--lumiverse-text-dim);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast),
                  color var(--lumiverse-transition-fast);
    }

    .cn-status-tab:hover {
      color: var(--lumiverse-text);
      background: var(--lumiverse-fill-subtle);
    }

    .cn-status-tab-active {
      background: var(--lumiverse-fill-subtle);
      color: var(--lumiverse-text);
      box-shadow: inset 0 0 0 1px var(--lumiverse-border);
    }

    .cn-status-tab-count {
      min-width: 18px;
      padding: 1px 5px;
      border-radius: 999px;
      background: var(--lumiverse-fill-subtle);
      color: var(--lumiverse-text-dim);
      font-size: 10px;
      line-height: 1.4;
    }

    .cn-status-tab-active .cn-status-tab-count {
      background: var(--lumiverse-accent);
      color: var(--lumiverse-accent-fg);
    }

    .cn-empty {
      padding: 20px 12px;
      text-align: center;
      color: var(--lumiverse-text-dim);
      font-size: 12px;
    }

    /* ── History Modal (body content only — chrome provided by Spindle) ── */

    .cn-history-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cn-history-entry {
      padding: 10px 12px;
      background: var(--lumiverse-fill-subtle);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
    }

    .cn-history-text {
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--lumiverse-text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .cn-history-meta {
      margin-top: 6px;
      font-size: 11px;
      color: var(--lumiverse-text-dim);
    }

    .cn-history-empty {
      padding: 24px 12px;
      text-align: center;
      color: var(--lumiverse-text-dim);
      font-size: 12px;
    }
  `);
  const bellIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
  const chevronSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const expandSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const searchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const historySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  let searchQuery = "";
  function formatRelativeTime(ts) {
    if (ts === 0)
      return "Unknown date";
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60)
      return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
      return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
      return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)
      return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  }
  let activeHistoryModal = null;
  function dismissHistoryModal() {
    if (activeHistoryModal) {
      activeHistoryModal.dismiss();
      activeHistoryModal = null;
    }
  }
  function showNudgeHistoryModal(characterName, entries) {
    dismissHistoryModal();
    const modal = ctx.ui.showModal({
      title: `${characterName} — Nudge History`
    });
    activeHistoryModal = modal;
    modal.onDismiss(() => {
      activeHistoryModal = null;
    });
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cn-history-empty";
      empty.textContent = "No nudges have been sent yet for this character.";
      modal.root.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "cn-history-list";
    for (const entry of [...entries].reverse()) {
      const card = document.createElement("div");
      card.className = "cn-history-entry";
      const text = document.createElement("div");
      text.className = "cn-history-text";
      text.textContent = entry.text;
      card.appendChild(text);
      const meta = document.createElement("div");
      meta.className = "cn-history-meta";
      meta.textContent = formatRelativeTime(entry.timestamp);
      card.appendChild(meta);
      list.appendChild(card);
    }
    modal.root.appendChild(list);
  }
  const tab = ctx.ui.registerDrawerTab({
    id: "nudges",
    title: "Nudges",
    iconSvg: bellIcon
  });
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function avatarUrl(imageId) {
    return imageId ? `/api/v1/images/${imageId}?size=sm` : null;
  }
  function getDraft(charId) {
    if (!draftConfigs[charId]) {
      const base = configs[charId] ?? getDefaultConfig();
      const defaults = getDefaultConfig();
      draftConfigs[charId] = {
        ...defaults,
        ...base,
        systemPrompt: base.systemPrompt || defaults.systemPrompt,
        nudgeInstruction: base.nudgeInstruction || defaults.nudgeInstruction
      };
    }
    return draftConfigs[charId];
  }
  const FALLBACK_SYSTEM_PROMPT = `You are {{char}}. Stay fully in character at all times.
{{description}}
{{personality}}
{{scenario}}`;
  const FALLBACK_NUDGE_INSTRUCTION = `[OOC: {{user}} has been away for a while and hasn't responded. Based on the conversation above, write a short message (1-3 sentences) as {{char}} reaching out to {{user}}.

Consider:
- Where you left off in the conversation and what was happening in the scene
- Any other characters present and what they might be doing while waiting
- How {{char}} would feel about the silence given their personality
- Reference specific details from recent messages to make it feel natural

Stay fully in character. Be creative — sometimes playful, sometimes sincere, sometimes a little pouty or worried. Do NOT use quotation marks around the message. Do NOT prefix with "{{char}}:" or any name tag. Respond with ONLY the in-character message, nothing else.]`;
  function getDefaultConfig() {
    return {
      enabled: false,
      chatId: "most_recent",
      connectionId: null,
      minMinutes: 15,
      maxMinutes: 60,
      messageCount: 5,
      maxTokens: 8192,
      temperature: 1,
      topP: 0.95,
      systemPrompt: defaultPrompts?.systemPrompt ?? FALLBACK_SYSTEM_PROMPT,
      nudgeInstruction: defaultPrompts?.nudgeInstruction ?? FALLBACK_NUDGE_INSTRUCTION
    };
  }
  function render() {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    tab.root.innerHTML = "";
    if (!permissions) {
      tab.root.innerHTML = '<div class="cn-panel"><p class="cn-panel-desc">Loading...</p></div>';
      return;
    }
    if (!permissions.hasPush || !permissions.hasGeneration || !permissions.hasCharacters || !permissions.hasChats) {
      const missing = [];
      if (!permissions.hasPush)
        missing.push("Push Notifications");
      if (!permissions.hasGeneration)
        missing.push("Generation");
      if (!permissions.hasCharacters)
        missing.push("Characters");
      if (!permissions.hasChats)
        missing.push("Chats");
      if (!permissions.hasChatMutation)
        missing.push("Chat Mutation");
      tab.root.innerHTML = `
        <div class="cn-panel">
          <h3 class="cn-panel-header">Character Nudges</h3>
          <div class="cn-alert cn-alert-warn">
            Missing permissions: <strong>${missing.join(", ")}</strong>.
            Grant them in Settings > Extensions.
          </div>
        </div>`;
      return;
    }
    const panel = document.createElement("div");
    panel.className = "cn-panel";
    const header = document.createElement("h3");
    header.className = "cn-panel-header";
    header.textContent = "Character Nudges";
    panel.appendChild(header);
    const desc = document.createElement("p");
    desc.className = "cn-panel-desc";
    desc.textContent = "Configure characters to send you push notifications when you've been away.";
    panel.appendChild(desc);
    const searchWrap = document.createElement("div");
    searchWrap.className = "cn-search";
    const searchIcon = document.createElement("span");
    searchIcon.className = "cn-search-icon";
    searchIcon.innerHTML = searchSvg;
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search characters...";
    searchInput.value = searchQuery;
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      render();
      const newInput = tab.root.querySelector(".cn-search input");
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
      }
    });
    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);
    if (characters.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cn-empty";
      empty.textContent = "No characters found.";
      panel.appendChild(empty);
      tab.root.appendChild(panel);
      return;
    }
    const query = searchQuery.toLowerCase();
    const matching = [...characters].filter((c) => !query || c.name.toLowerCase().includes(query));
    const activeCount = matching.filter((c) => configs[c.id]?.enabled).length;
    const inactiveCount = matching.length - activeCount;
    const tabs = document.createElement("div");
    tabs.className = "cn-status-tabs";
    for (const tabInfo of [
      { id: "inactive", label: "Inactive", count: inactiveCount },
      { id: "active", label: "Active", count: activeCount }
    ]) {
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = `cn-status-tab ${activeNudgeTab === tabInfo.id ? "cn-status-tab-active" : ""}`;
      tabBtn.setAttribute("aria-pressed", String(activeNudgeTab === tabInfo.id));
      tabBtn.innerHTML = `<span>${tabInfo.label}</span><span class="cn-status-tab-count">${tabInfo.count}</span>`;
      tabBtn.addEventListener("click", () => {
        activeNudgeTab = tabInfo.id;
        expandedCharacterId = null;
        render();
      });
      tabs.appendChild(tabBtn);
    }
    panel.appendChild(tabs);
    const sorted = matching.filter((c) => activeNudgeTab === "active" ? configs[c.id]?.enabled : !configs[c.id]?.enabled).sort((a, b) => a.name.localeCompare(b.name));
    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cn-empty";
      empty.textContent = query ? "No characters match your search in this tab." : activeNudgeTab === "active" ? "No active nudges yet. Enable a character and hit Save to move them here." : "All matching characters already have nudges enabled.";
      panel.appendChild(empty);
      tab.root.appendChild(panel);
      return;
    }
    const list = document.createElement("div");
    list.className = "cn-char-list";
    activeObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting && el.dataset.cnVirt === "placeholder") {
          const idx = parseInt(el.dataset.cnIdx, 10);
          const char = sorted[idx];
          if (!char)
            continue;
          const real = renderCharacterItem(char);
          el.replaceWith(real);
          activeObserver?.observe(real);
        }
      }
    }, { rootMargin: "200px 0px" });
    for (let i = 0;i < sorted.length; i++) {
      if (sorted[i].id === expandedCharacterId) {
        list.appendChild(renderCharacterItem(sorted[i]));
      } else {
        const ph = document.createElement("div");
        ph.className = "cn-char-item";
        ph.style.minHeight = "50px";
        ph.dataset.cnVirt = "placeholder";
        ph.dataset.cnIdx = String(i);
        list.appendChild(ph);
        activeObserver?.observe(ph);
      }
    }
    panel.appendChild(list);
    tab.root.appendChild(panel);
  }
  function renderCharacterItem(char) {
    const config = configs[char.id];
    const isExpanded = expandedCharacterId === char.id;
    const item = document.createElement("div");
    item.className = "cn-char-item";
    const hdr = document.createElement("div");
    hdr.className = "cn-char-header";
    hdr.addEventListener("click", () => {
      expandedCharacterId = isExpanded ? null : char.id;
      if (!isExpanded) {
        draftConfigs[char.id] = { ...configs[char.id] ?? getDefaultConfig() };
        ctx.sendToBackend({ type: "get_chats", characterId: char.id });
      }
      render();
    });
    const url = avatarUrl(char.image_id);
    if (url) {
      const img = document.createElement("img");
      img.className = "cn-char-avatar";
      img.src = url;
      img.alt = char.name;
      hdr.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "cn-char-avatar-placeholder";
      ph.textContent = char.name.charAt(0).toUpperCase();
      hdr.appendChild(ph);
    }
    const info = document.createElement("div");
    info.className = "cn-char-info";
    const name = document.createElement("div");
    name.className = "cn-char-name";
    name.textContent = char.name;
    info.appendChild(name);
    if (config?.enabled) {
      const status = document.createElement("div");
      status.className = "cn-char-status";
      status.textContent = `${config.minMinutes}-${config.maxMinutes}min interval`;
      info.appendChild(status);
    }
    hdr.appendChild(info);
    const badge = document.createElement("span");
    badge.className = `cn-char-badge ${config?.enabled ? "cn-badge-on" : "cn-badge-off"}`;
    badge.textContent = config?.enabled ? "ON" : "OFF";
    hdr.appendChild(badge);
    const chev = document.createElement("span");
    chev.className = `cn-chevron ${isExpanded ? "cn-chevron-open" : ""}`;
    chev.innerHTML = chevronSvg;
    hdr.appendChild(chev);
    item.appendChild(hdr);
    if (isExpanded) {
      item.appendChild(renderCharacterBody(char));
    }
    return item;
  }
  function renderCharacterBody(char) {
    const body = document.createElement("div");
    body.className = "cn-char-body";
    const draft = getDraft(char.id);
    const chats = chatsPerCharacter[char.id] ?? [];
    const enableRow = document.createElement("div");
    enableRow.className = "cn-field-row";
    const enableLabel = document.createElement("div");
    enableLabel.className = "cn-label";
    enableLabel.textContent = "Enable Nudges";
    const toggle = document.createElement("label");
    toggle.className = "cn-toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = draft.enabled;
    toggleInput.addEventListener("change", () => {
      draft.enabled = toggleInput.checked;
      render();
    });
    const slider = document.createElement("span");
    slider.className = "cn-toggle-slider";
    toggle.appendChild(toggleInput);
    toggle.appendChild(slider);
    enableRow.appendChild(enableLabel);
    enableRow.appendChild(toggle);
    body.appendChild(enableRow);
    if (draft.enabled !== Boolean(configs[char.id]?.enabled)) {
      const pending = document.createElement("div");
      pending.className = "cn-sublabel";
      pending.textContent = "This status change will apply when you save.";
      body.appendChild(pending);
    }
    body.appendChild(makeSelect("Chat", "Which chat to pull context from", [{ value: "most_recent", label: "Most Recent" }, ...chats.map((c) => ({ value: c.id, label: c.name || `Chat ${c.id.slice(0, 8)}` }))], draft.chatId, (v) => {
      draft.chatId = v;
    }));
    body.appendChild(makeSelect("Connection", "LLM connection for nudge generation", [{ value: "", label: "(Default)" }, ...connections.map((c) => ({ value: c.id, label: `${c.name} (${c.provider}/${c.model})` }))], draft.connectionId ?? "", (v) => {
      draft.connectionId = v || null;
    }));
    const intervalField = document.createElement("div");
    intervalField.className = "cn-field";
    const intervalLabel = document.createElement("div");
    intervalLabel.className = "cn-label";
    intervalLabel.textContent = "Interval (minutes)";
    intervalField.appendChild(intervalLabel);
    const intRow = document.createElement("div");
    intRow.className = "cn-range-row";
    const minIn = makeNumericInput(draft.minMinutes, 1, 1440, 1, (v) => {
      draft.minMinutes = v;
    });
    const sep = document.createElement("span");
    sep.className = "cn-range-sep";
    sep.textContent = "to";
    const maxIn = makeNumericInput(draft.maxMinutes, 1, 1440, 1, (v) => {
      draft.maxMinutes = v;
    });
    const minLbl = document.createElement("span");
    minLbl.className = "cn-range-sep";
    minLbl.textContent = "min";
    intRow.append(minIn, sep, maxIn, minLbl);
    intervalField.appendChild(intRow);
    body.appendChild(intervalField);
    const msgField = document.createElement("div");
    msgField.className = "cn-field";
    msgField.innerHTML = `<div class="cn-label">Context Messages</div>`;
    msgField.appendChild(makeNumericInput(draft.messageCount, 1, 20, 1, (v) => {
      draft.messageCount = v;
    }, true));
    body.appendChild(msgField);
    body.appendChild(makeDivider());
    const sampLabel = document.createElement("div");
    sampLabel.className = "cn-label";
    sampLabel.textContent = "Generation Parameters";
    body.appendChild(sampLabel);
    const sampRow = document.createElement("div");
    sampRow.className = "cn-sampler-row";
    sampRow.appendChild(makeLabeledInput("Max Tokens", draft.maxTokens, 1, 131072, 1, (v) => {
      draft.maxTokens = v;
    }));
    sampRow.appendChild(makeLabeledInput("Temp", draft.temperature, 0, 2, 0.05, (v) => {
      draft.temperature = v;
    }));
    sampRow.appendChild(makeLabeledInput("Top P", draft.topP, 0, 1, 0.05, (v) => {
      draft.topP = v;
    }));
    body.appendChild(sampRow);
    body.appendChild(makeDivider());
    body.appendChild(makePromptEditor("System Prompt", "Character identity for the system message.", draft.systemPrompt, (v) => {
      draft.systemPrompt = v;
    }, defaultPrompts?.systemPrompt));
    body.appendChild(makePromptEditor("Nudge Instruction", "Final instruction after chat context.", draft.nudgeInstruction, (v) => {
      draft.nudgeInstruction = v;
    }, defaultPrompts?.nudgeInstruction));
    body.appendChild(makeDivider());
    const btnRow = document.createElement("div");
    btnRow.className = "cn-btn-row";
    const saveBtn = document.createElement("button");
    saveBtn.className = "cn-btn cn-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      const d = getDraft(char.id);
      d.minMinutes = clamp(d.minMinutes, 1, 1440);
      d.maxMinutes = clamp(d.maxMinutes, 1, 1440);
      if (d.minMinutes > d.maxMinutes)
        [d.minMinutes, d.maxMinutes] = [d.maxMinutes, d.minMinutes];
      d.messageCount = clamp(d.messageCount, 1, 20);
      d.maxTokens = clamp(d.maxTokens, 1, 131072);
      d.temperature = clamp(d.temperature, 0, 2);
      d.topP = clamp(d.topP, 0, 1);
      ctx.sendToBackend({ type: "save_config", characterId: char.id, config: d });
    });
    const historyBtn = document.createElement("button");
    historyBtn.className = "cn-btn";
    historyBtn.innerHTML = `${historySvg} History`;
    historyBtn.style.display = "inline-flex";
    historyBtn.style.alignItems = "center";
    historyBtn.style.gap = "4px";
    historyBtn.addEventListener("click", () => {
      ctx.sendToBackend({ type: "get_nudge_history", characterId: char.id });
    });
    const testBtn = document.createElement("button");
    testBtn.className = "cn-btn";
    testBtn.textContent = "Test Nudge";
    testBtn.addEventListener("click", () => {
      ctx.sendToBackend({ type: "trigger_test_nudge", characterId: char.id });
    });
    btnRow.append(saveBtn, historyBtn, testBtn);
    body.appendChild(btnRow);
    return body;
  }
  function makeSelect(label, sub, options, current, onChange) {
    const field = document.createElement("div");
    field.className = "cn-field";
    field.innerHTML = `<div class="cn-label">${label}</div><div class="cn-sublabel">${sub}</div>`;
    const sel = document.createElement("select");
    sel.className = "cn-select";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === current)
        opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    field.appendChild(sel);
    return field;
  }
  function makeNumericInput(value, min, max, step, onChange, fullWidth = false) {
    const inp = document.createElement("input");
    inp.className = "cn-input";
    inp.type = "number";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(value);
    if (!fullWidth)
      inp.style.width = "60px";
    inp.style.textAlign = "center";
    inp.addEventListener("change", () => {
      const v = step < 1 ? parseFloat(inp.value) : parseInt(inp.value);
      if (!isNaN(v))
        onChange(clamp(v, min, max));
    });
    return inp;
  }
  function makeLabeledInput(label, value, min, max, step, onChange) {
    const field = document.createElement("div");
    field.className = "cn-field";
    const lbl = document.createElement("div");
    lbl.className = "cn-sublabel";
    lbl.textContent = label;
    field.appendChild(lbl);
    field.appendChild(makeNumericInput(value, min, max, step, onChange, true));
    return field;
  }
  function makePromptEditor(label, sub, value, onChange, defaultValue) {
    const field = document.createElement("div");
    field.className = "cn-field";
    const header = document.createElement("div");
    header.className = "cn-prompt-header";
    const lbl = document.createElement("div");
    lbl.className = "cn-label";
    lbl.textContent = label;
    header.appendChild(lbl);
    if (defaultValue !== undefined) {
      const resetBtn = document.createElement("button");
      resetBtn.className = "cn-btn-sm";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => {
        textarea.value = defaultValue;
        onChange(defaultValue);
      });
      header.appendChild(resetBtn);
    }
    field.appendChild(header);
    const subEl = document.createElement("div");
    subEl.className = "cn-sublabel";
    subEl.textContent = sub + " Supports {{macros}}.";
    field.appendChild(subEl);
    const wrap = document.createElement("div");
    wrap.className = "cn-textarea-wrap";
    const textarea = document.createElement("textarea");
    textarea.className = "cn-textarea";
    textarea.value = value;
    textarea.rows = 4;
    textarea.addEventListener("input", () => onChange(textarea.value));
    const expandBtn = document.createElement("button");
    expandBtn.className = "cn-expand-btn";
    expandBtn.innerHTML = expandSvg;
    expandBtn.title = "Open in expanded editor";
    expandBtn.addEventListener("click", () => {
      ctx.sendToBackend({
        type: "open_text_editor",
        title: label,
        value: textarea.value
      });
    });
    wrap.appendChild(textarea);
    wrap.appendChild(expandBtn);
    field.appendChild(wrap);
    return field;
  }
  function makeDivider() {
    const hr = document.createElement("hr");
    hr.className = "cn-divider";
    return hr;
  }
  const unsubBackend = ctx.onBackendMessage((payload) => {
    switch (payload.type) {
      case "permissions_checked":
        permissions = payload;
        render();
        break;
      case "characters_loaded":
        characters = payload.characters ?? [];
        configs = payload.configs ?? {};
        draftConfigs = {};
        render();
        break;
      case "chats_loaded":
        if (payload.characterId) {
          chatsPerCharacter[payload.characterId] = payload.chats ?? [];
          render();
        }
        break;
      case "connections_loaded":
        connections = payload.connections ?? [];
        render();
        break;
      case "config_loaded":
        configs[payload.characterId] = payload.config;
        draftConfigs[payload.characterId] = { ...payload.config };
        render();
        break;
      case "config_saved":
        configs[payload.characterId] = payload.config;
        draftConfigs[payload.characterId] = { ...payload.config };
        if (expandedCharacterId === payload.characterId) {
          activeNudgeTab = payload.config.enabled ? "active" : "inactive";
        }
        render();
        break;
      case "defaults":
        defaultPrompts = {
          systemPrompt: payload.systemPrompt,
          nudgeInstruction: payload.nudgeInstruction
        };
        break;
      case "globals_loaded":
        globals = payload.globals;
        draftGlobals = { ...payload.globals };
        renderSettings();
        break;
      case "globals_saved":
        globals = payload.globals;
        draftGlobals = { ...payload.globals };
        renderSettings();
        break;
      case "nudge_history_loaded": {
        const charName = characters.find((c) => c.id === payload.characterId)?.name ?? "Character";
        showNudgeHistoryModal(charName, payload.entries ?? []);
        break;
      }
      case "text_editor_result":
        if (payload.cancelled)
          break;
        if (expandedCharacterId) {
          const draft = getDraft(expandedCharacterId);
          if (payload.title === "System Prompt")
            draft.systemPrompt = payload.text;
          else if (payload.title === "Nudge Instruction")
            draft.nudgeInstruction = payload.text;
          render();
        }
        if (payload.title === "Default System Prompt") {
          draftGlobals.systemPrompt = payload.text;
          renderSettings();
        } else if (payload.title === "Default Nudge Instruction") {
          draftGlobals.nudgeInstruction = payload.text;
          renderSettings();
        }
        break;
    }
  });
  const unsubTabActivate = tab.onActivate(() => {
    ctx.sendToBackend({ type: "check_permissions" });
    ctx.sendToBackend({ type: "get_characters" });
    ctx.sendToBackend({ type: "get_connections" });
  });
  const settingsRoot = ctx.ui.mount("settings_extensions");
  let globals = null;
  let draftGlobals = {};
  function renderSettings() {
    settingsRoot.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "cn-panel";
    const header = document.createElement("h3");
    header.className = "cn-panel-header";
    header.textContent = "Character Nudges — Defaults";
    panel.appendChild(header);
    const desc = document.createElement("p");
    desc.className = "cn-panel-desc";
    desc.textContent = "Global defaults applied to characters without custom configuration. Per-character settings always take priority.";
    panel.appendChild(desc);
    if (!globals) {
      const loading = document.createElement("p");
      loading.className = "cn-panel-desc";
      loading.textContent = "Loading...";
      panel.appendChild(loading);
      settingsRoot.appendChild(panel);
      return;
    }
    const g = draftGlobals;
    panel.appendChild(makeSelect("Default Connection", "LLM connection for nudge generation", [{ value: "", label: "(Default)" }, ...connections.map((c) => ({ value: c.id, label: `${c.name} (${c.provider}/${c.model})` }))], g.connectionId ?? globals.connectionId ?? "", (v) => {
      g.connectionId = v || null;
    }));
    const intervalField = document.createElement("div");
    intervalField.className = "cn-field";
    const intervalLabel = document.createElement("div");
    intervalLabel.className = "cn-label";
    intervalLabel.textContent = "Default Interval (minutes)";
    intervalField.appendChild(intervalLabel);
    const intRow = document.createElement("div");
    intRow.className = "cn-range-row";
    intRow.append(makeNumericInput(g.minMinutes ?? globals.minMinutes, 1, 1440, 1, (v) => {
      g.minMinutes = v;
    }), (() => {
      const s = document.createElement("span");
      s.className = "cn-range-sep";
      s.textContent = "to";
      return s;
    })(), makeNumericInput(g.maxMinutes ?? globals.maxMinutes, 1, 1440, 1, (v) => {
      g.maxMinutes = v;
    }), (() => {
      const s = document.createElement("span");
      s.className = "cn-range-sep";
      s.textContent = "min";
      return s;
    })());
    intervalField.appendChild(intRow);
    panel.appendChild(intervalField);
    const msgField = document.createElement("div");
    msgField.className = "cn-field";
    msgField.innerHTML = `<div class="cn-label">Default Context Messages</div>`;
    msgField.appendChild(makeNumericInput(g.messageCount ?? globals.messageCount, 1, 20, 1, (v) => {
      g.messageCount = v;
    }, true));
    panel.appendChild(msgField);
    panel.appendChild(makeDivider());
    const sampLabel = document.createElement("div");
    sampLabel.className = "cn-label";
    sampLabel.textContent = "Default Generation Parameters";
    panel.appendChild(sampLabel);
    const sampRow = document.createElement("div");
    sampRow.className = "cn-sampler-row";
    sampRow.appendChild(makeLabeledInput("Max Tokens", g.maxTokens ?? globals.maxTokens, 1, 131072, 1, (v) => {
      g.maxTokens = v;
    }));
    sampRow.appendChild(makeLabeledInput("Temp", g.temperature ?? globals.temperature, 0, 2, 0.05, (v) => {
      g.temperature = v;
    }));
    sampRow.appendChild(makeLabeledInput("Top P", g.topP ?? globals.topP, 0, 1, 0.05, (v) => {
      g.topP = v;
    }));
    panel.appendChild(sampRow);
    panel.appendChild(makeDivider());
    panel.appendChild(makePromptEditor("Default System Prompt", "Applied to characters without a custom system prompt.", g.systemPrompt ?? globals.systemPrompt, (v) => {
      g.systemPrompt = v;
    }, defaultPrompts?.systemPrompt));
    panel.appendChild(makePromptEditor("Default Nudge Instruction", "Applied to characters without a custom nudge instruction.", g.nudgeInstruction ?? globals.nudgeInstruction, (v) => {
      g.nudgeInstruction = v;
    }, defaultPrompts?.nudgeInstruction));
    panel.appendChild(makeDivider());
    const saveBtn = document.createElement("button");
    saveBtn.className = "cn-btn cn-btn-primary";
    saveBtn.textContent = "Save Defaults";
    saveBtn.addEventListener("click", () => {
      ctx.sendToBackend({ type: "save_globals", globals: { ...globals, ...g } });
    });
    panel.appendChild(saveBtn);
    settingsRoot.appendChild(panel);
  }
  const nudgeAction = ctx.ui.registerInputBarAction({
    id: "open-nudges",
    label: "Nudge Settings",
    iconSvg: bellIcon
  });
  const unsubAction = nudgeAction.onClick(() => {
    tab.activate();
  });
  queueMicrotask(() => {
    ctx.sendToBackend({ type: "check_permissions" });
    ctx.sendToBackend({ type: "get_characters" });
    ctx.sendToBackend({ type: "get_connections" });
    ctx.sendToBackend({ type: "get_defaults" });
    ctx.sendToBackend({ type: "get_globals" });
  });
  render();
  return () => {
    dismissHistoryModal();
    unsubBackend();
    unsubTabActivate();
    unsubAction();
    nudgeAction.destroy();
    tab.destroy();
    removeStyle();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
