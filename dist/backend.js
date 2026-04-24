// @bun
// src/backend.ts
var DEFAULT_SYSTEM_PROMPT = `You are {{char}}. Stay fully in character at all times.
{{description}}
{{personality}}
{{scenario}}

{{lastNudges::5}}`;
var DEFAULT_NUDGE_INSTRUCTION = `[OOC: {{user}} has been away for a while and hasn't responded. Based on the conversation above, write a short message (1-3 sentences) as {{char}} reaching out to {{user}}.

Consider:
- Where you left off in the conversation and what was happening in the scene
- Any other characters present and what they might be doing while waiting
- How {{char}} would feel about the silence given their personality
- Reference specific details from recent messages to make it feel natural
- Describe new activities, observations, or thoughts \u2014 what has {{char}} been doing while waiting?

IMPORTANT: Never repeat or copy a previous nudge message. Each nudge must be unique. You CAN reference things you said before in a self-aware or playful way (e.g. "So remember when I said...? Yeah, anyway..."), but never send the same message twice. Vary your topics, activities, moods, and observations every time.

Stay fully in character. Be creative \u2014 sometimes playful, sometimes sincere, sometimes a little pouty or worried. Do NOT use quotation marks around the message. Do NOT prefix with "{{char}}:" or any name tag. Respond with ONLY the in-character message, nothing else.]`;
var DEFAULT_CONFIG = {
  enabled: false,
  chatId: "most_recent",
  connectionId: null,
  minMinutes: 15,
  maxMinutes: 60,
  messageCount: 5,
  maxTokens: 8192,
  temperature: 1,
  topP: 0.95,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  nudgeInstruction: DEFAULT_NUDGE_INSTRUCTION
};
function toastOptions(userId) {
  return { userId };
}
var nudgeStates = new Map;
function configPath(characterId) {
  return `nudge-config/${characterId}.json`;
}
var GLOBALS_PATH = "globals.json";
async function loadGlobals(userId) {
  return spindle.userStorage.getJson(GLOBALS_PATH, {
    fallback: {},
    userId
  });
}
async function saveGlobals(globals, userId) {
  await spindle.userStorage.setJson(GLOBALS_PATH, globals, { indent: 2, userId });
}
async function loadConfig(characterId, userId) {
  const globals = await loadGlobals(userId);
  const perChar = await spindle.userStorage.getJson(configPath(characterId), {
    fallback: {},
    userId
  });
  return { ...DEFAULT_CONFIG, ...globals, ...perChar };
}
async function saveConfig(characterId, config, userId) {
  await spindle.userStorage.setJson(configPath(characterId), config, { indent: 2, userId });
}
var MAX_HISTORY = 20;
function historyPath(characterId) {
  return `nudge-history/${characterId}.json`;
}
async function getNudgeHistory(characterId, userId) {
  const raw = await spindle.userStorage.getJson(historyPath(characterId), {
    fallback: [],
    userId
  });
  if (raw.length > 0 && typeof raw[0] === "string") {
    const migrated = raw.map((text) => ({
      text,
      timestamp: 0,
      characterName: "",
      chatId: null
    }));
    await spindle.userStorage.setJson(historyPath(characterId), migrated, { userId });
    return migrated;
  }
  return raw;
}
async function getNudgeHistoryTexts(characterId, userId) {
  const entries = await getNudgeHistory(characterId, userId);
  return entries.map((e) => e.text);
}
async function appendNudgeHistory(characterId, text, characterName, chatId, userId) {
  const history = await getNudgeHistory(characterId, userId);
  history.push({ text, timestamp: Date.now(), characterName, chatId });
  const trimmed = history.slice(-MAX_HISTORY);
  await spindle.userStorage.setJson(historyPath(characterId), trimmed, { userId });
}
async function resolveChatId(characterId, configChatId, userId) {
  if (configChatId !== "most_recent") {
    const chat = await spindle.chats.get(configChatId, userId);
    return chat ? chat.id : null;
  }
  const { data } = await spindle.chats.list({ characterId, limit: 1, userId });
  return data.length > 0 ? data[0].id : null;
}
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function nudgeStateKey(characterId, userId) {
  return `${userId}:${characterId}`;
}
function clearNudgeTimer(characterId, userId) {
  const state = nudgeStates.get(nudgeStateKey(characterId, userId));
  if (state?.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
}
async function scheduleNudge(characterId, userId) {
  clearNudgeTimer(characterId, userId);
  const config = { ...await loadConfig(characterId, userId), userId };
  if (!config.enabled)
    return;
  const delayMs = randomBetween(config.minMinutes, config.maxMinutes) * 60 * 1000;
  const key = nudgeStateKey(characterId, userId);
  const state = nudgeStates.get(key) ?? { timerId: null };
  state.timerId = setTimeout(() => executeNudge(characterId, config, userId), delayMs);
  nudgeStates.set(key, state);
  spindle.log.info(`Scheduled nudge for character ${characterId} in ${Math.round(delayMs / 60000)}m`);
}
async function executeNudge(characterId, config, userId) {
  try {
    const visible = await spindle.users.isVisible(userId);
    if (visible) {
      spindle.log.info(`User has app visible, skipping nudge for ${characterId} \u2014 rescheduling`);
      await scheduleNudge(characterId, userId);
      return;
    }
    const pushStatus = await spindle.push.getStatus(userId);
    if (!pushStatus.available) {
      spindle.log.warn("Push notifications not available, skipping nudge");
      return;
    }
    const chatId = await resolveChatId(characterId, config.chatId, userId);
    if (!chatId) {
      spindle.log.warn(`No chat found for character ${characterId}, skipping nudge`);
      await scheduleNudge(characterId, userId);
      return;
    }
    const character = await spindle.characters.get(characterId, userId);
    if (!character) {
      spindle.log.warn(`Character ${characterId} not found, cancelling nudge`);
      return;
    }
    const messages = await spindle.chat.getMessages(chatId);
    const recentMessages = messages.slice(-config.messageCount);
    const generationMessages = await buildNudgeMessages(config, chatId, characterId, recentMessages, userId);
    const genInput = {
      type: "quiet",
      messages: generationMessages,
      parameters: {
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP
      },
      userId
    };
    if (config.connectionId) {
      genInput.connection_id = config.connectionId;
    }
    const result = await spindle.generate.quiet(genInput);
    const content = typeof result?.content === "string" ? result.content : "";
    if (!content) {
      spindle.log.warn("Empty generation result for nudge");
      await scheduleNudge(characterId, userId);
      return;
    }
    let nudgeText = content.trim();
    const namePrefix = `${character.name}:`;
    if (nudgeText.startsWith(namePrefix)) {
      nudgeText = nudgeText.slice(namePrefix.length).trim();
    }
    await spindle.push.send({
      title: character.name,
      body: nudgeText,
      tag: `nudge-${characterId}`,
      url: `/chat/${chatId}`,
      icon: character.image_id ? `/api/v1/images/${character.image_id}?size=sm` : undefined,
      rawTitle: true
    }, userId);
    await appendNudgeHistory(characterId, nudgeText, character.name, chatId, userId);
    spindle.log.info(`Sent nudge from "${character.name}": ${nudgeText.slice(0, 80)}...`);
    await scheduleNudge(characterId, userId);
  } catch (err) {
    spindle.log.error(`Nudge execution failed: ${err.message}`);
    await scheduleNudge(characterId, userId);
  }
}
async function buildNudgeMessages(config, chatId, characterId, recentMessages, userId) {
  const history = await getNudgeHistoryTexts(characterId, userId);
  function resolveLastNudges(text) {
    return text.replace(/\{\{lastNudges(?:::(\d+))?\}\}/g, (_match, countStr) => {
      const count = countStr ? parseInt(countStr, 10) : 5;
      const recent = history.slice(-count);
      if (recent.length === 0)
        return "";
      return `Your previous nudge messages (never copy these, but you may reference them):
` + recent.map((n, i) => `${i + 1}. ${n}`).join(`
`);
    });
  }
  const macroOpts = { chatId, characterId, userId };
  const [systemResult, instructionResult] = await Promise.all([
    spindle.macros.resolve(resolveLastNudges(config.systemPrompt || DEFAULT_SYSTEM_PROMPT), macroOpts),
    spindle.macros.resolve(resolveLastNudges(config.nudgeInstruction || DEFAULT_NUDGE_INSTRUCTION), macroOpts)
  ]);
  const msgs = [];
  msgs.push({ role: "system", content: systemResult.text });
  for (const m of recentMessages) {
    const role = m.role === "user" ? "user" : "assistant";
    const content = m.content.length > 500 ? m.content.slice(0, 497) + "..." : m.content;
    msgs.push({ role, content });
  }
  msgs.push({ role: "user", content: instructionResult.text });
  return msgs;
}
spindle.onFrontendMessage(async (payload, userId) => {
  const reply = (msg) => {
    spindle.sendToFrontend(msg, userId);
  };
  switch (payload.type) {
    case "get_characters": {
      try {
        const PAGE = 200;
        const all = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          const { data, total: t } = await spindle.characters.list({ limit: PAGE, offset, userId });
          all.push(...data);
          total = t;
          offset += data.length;
          if (data.length < PAGE)
            break;
        }
        const configs = {};
        for (const c of all) {
          configs[c.id] = await loadConfig(c.id, userId);
        }
        reply({ type: "characters_loaded", characters: all, configs });
      } catch (err) {
        reply({ type: "characters_loaded", characters: [], configs: {}, error: err.message });
      }
      break;
    }
    case "get_chats": {
      try {
        const { data } = await spindle.chats.list({
          characterId: payload.characterId,
          limit: 50,
          userId
        });
        reply({
          type: "chats_loaded",
          characterId: payload.characterId,
          chats: data
        });
      } catch (err) {
        reply({
          type: "chats_loaded",
          characterId: payload.characterId,
          chats: [],
          error: err.message
        });
      }
      break;
    }
    case "get_config": {
      const config = await loadConfig(payload.characterId, userId);
      reply({
        type: "config_loaded",
        characterId: payload.characterId,
        config
      });
      break;
    }
    case "save_config": {
      try {
        const config = {
          enabled: payload.config.enabled ?? false,
          chatId: payload.config.chatId ?? "most_recent",
          connectionId: payload.config.connectionId ?? null,
          minMinutes: payload.config.minMinutes ?? 15,
          maxMinutes: payload.config.maxMinutes ?? 60,
          messageCount: payload.config.messageCount ?? 5,
          maxTokens: payload.config.maxTokens ?? 8192,
          temperature: payload.config.temperature ?? 1,
          topP: payload.config.topP ?? 0.95,
          systemPrompt: payload.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          nudgeInstruction: payload.config.nudgeInstruction ?? DEFAULT_NUDGE_INSTRUCTION,
          userId
        };
        await saveConfig(payload.characterId, config, userId);
        reply({
          type: "config_saved",
          characterId: payload.characterId,
          config
        });
        await setRegistryEntry(payload.characterId, userId, config.enabled);
        if (config.enabled) {
          await scheduleNudge(payload.characterId, userId);
          spindle.toast.success(`Nudges enabled for this character`, toastOptions(userId));
        } else {
          clearNudgeTimer(payload.characterId, userId);
          spindle.toast.info(`Nudges disabled for this character`, toastOptions(userId));
        }
      } catch (err) {
        spindle.log.error(`Failed to save config: ${err.message}`);
        spindle.toast.error(`Failed to save: ${err.message}`, toastOptions(userId));
      }
      break;
    }
    case "get_connections": {
      try {
        const connections = await spindle.connections.list(userId);
        reply({ type: "connections_loaded", connections });
      } catch (err) {
        reply({ type: "connections_loaded", connections: [], error: err.message });
      }
      break;
    }
    case "check_permissions": {
      const granted = await spindle.permissions.getGranted().catch(() => []);
      let pushAvailable = false;
      let pushDevices = 0;
      if (granted.includes("push_notification")) {
        try {
          const pushStatus = await spindle.push.getStatus(userId);
          pushAvailable = pushStatus.available;
          pushDevices = pushStatus.subscriptionCount;
        } catch {}
      }
      reply({
        type: "permissions_checked",
        hasPush: granted.includes("push_notification"),
        hasGeneration: granted.includes("generation"),
        hasCharacters: granted.includes("characters"),
        hasChats: granted.includes("chats"),
        hasChatMutation: granted.includes("chat_mutation"),
        pushAvailable,
        pushDevices
      });
      break;
    }
    case "get_globals": {
      const globals = await loadGlobals(userId);
      reply({ type: "globals_loaded", globals: { ...DEFAULT_CONFIG, ...globals } });
      break;
    }
    case "save_globals": {
      const globals = {
        connectionId: payload.globals.connectionId ?? null,
        minMinutes: payload.globals.minMinutes ?? 15,
        maxMinutes: payload.globals.maxMinutes ?? 60,
        messageCount: payload.globals.messageCount ?? 5,
        maxTokens: payload.globals.maxTokens ?? 8192,
        temperature: payload.globals.temperature ?? 1,
        topP: payload.globals.topP ?? 0.95,
        systemPrompt: payload.globals.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        nudgeInstruction: payload.globals.nudgeInstruction ?? DEFAULT_NUDGE_INSTRUCTION
      };
      await saveGlobals(globals, userId);
      reply({ type: "globals_saved", globals: { ...DEFAULT_CONFIG, ...globals } });
      spindle.toast.success("Global defaults saved", toastOptions(userId));
      break;
    }
    case "get_defaults": {
      reply({
        type: "defaults",
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        nudgeInstruction: DEFAULT_NUDGE_INSTRUCTION
      });
      break;
    }
    case "open_text_editor": {
      try {
        const result = await spindle.textEditor.open({
          title: payload.title ?? "Edit Text",
          value: payload.value ?? "",
          userId
        });
        reply({
          type: "text_editor_result",
          text: result.text,
          cancelled: result.cancelled,
          title: payload.title
        });
      } catch (err) {
        spindle.log.error(`Text editor failed: ${err.message}`);
      }
      break;
    }
    case "get_nudge_history": {
      if (!payload.characterId)
        break;
      try {
        const entries = await getNudgeHistory(payload.characterId, userId);
        reply({
          type: "nudge_history_loaded",
          characterId: payload.characterId,
          entries
        });
      } catch (err) {
        reply({
          type: "nudge_history_loaded",
          characterId: payload.characterId,
          entries: [],
          error: err.message
        });
      }
      break;
    }
    case "trigger_test_nudge": {
      if (!payload.characterId)
        break;
      const config = await loadConfig(payload.characterId, userId);
      spindle.toast.info("Test nudge will fire in 15 seconds \u2014 switch away from the app to see it.", toastOptions(userId));
      setTimeout(() => {
        executeNudge(payload.characterId, { ...config, enabled: true, userId }, userId);
      }, 15000);
      break;
    }
  }
});
spindle.on("MESSAGE_SENT", async (payload, userId) => {
  const chatId = payload.chatId;
  if (!chatId || !userId)
    return;
  try {
    const chat = await spindle.chats.get(chatId, userId);
    if (!chat)
      return;
    const config = await loadConfig(chat.character_id, userId);
    if (config.enabled)
      await scheduleNudge(chat.character_id, userId);
  } catch {}
});
spindle.on("GENERATION_ENDED", async (payload, userId) => {
  const chatId = payload.chatId;
  if (!chatId || !userId)
    return;
  try {
    const chat = await spindle.chats.get(chatId, userId);
    if (!chat)
      return;
    const config = await loadConfig(chat.character_id, userId);
    if (config.enabled)
      await scheduleNudge(chat.character_id, userId);
  } catch {}
});
var ACTIVE_REGISTRY_PATH = "active-nudges.json";
async function getActiveRegistry() {
  return spindle.storage.getJson(ACTIVE_REGISTRY_PATH, { fallback: {} });
}
async function setRegistryEntry(characterId, userId, enabled) {
  const reg = await getActiveRegistry();
  if (enabled) {
    reg[characterId] = userId;
  } else {
    delete reg[characterId];
  }
  await spindle.storage.setJson(ACTIVE_REGISTRY_PATH, reg);
}
async function resumeEnabledNudges() {
  try {
    const registry = await getActiveRegistry();
    for (const [characterId, userId] of Object.entries(registry)) {
      if (!characterId || !userId)
        continue;
      const config = await loadConfig(characterId, userId);
      if (config.enabled) {
        await scheduleNudge(characterId, userId);
      }
    }
  } catch (err) {
    spindle.log.error(`Failed to resume nudges: ${err.message}`);
  }
}
spindle.registerMacro({
  name: "lastNudges",
  category: "extension:character_nudges",
  description: "Recent nudge messages sent to the user for this character. Accepts an optional count parameter (default 5).",
  returnType: "string",
  args: [{ name: "count", description: "Number of recent nudges to include", required: false }],
  handler: ""
});
resumeEnabledNudges();
spindle.log.info("Character Nudges extension loaded");
