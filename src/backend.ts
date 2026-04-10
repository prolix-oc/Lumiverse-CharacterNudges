declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NudgeConfig {
  enabled: boolean
  chatId: string | 'most_recent'
  connectionId: string | null
  minMinutes: number
  maxMinutes: number
  messageCount: number
  maxTokens: number
  temperature: number
  topP: number
  systemPrompt: string
  nudgeInstruction: string
  /** Persisted so timers that fire before a frontend message can still scope API calls. */
  userId?: string
}

interface NudgeHistoryEntry {
  text: string
  timestamp: number
  characterName: string
  chatId: string | null
}

interface CharacterNudgeState {
  timerId: ReturnType<typeof setTimeout> | null
}

const DEFAULT_SYSTEM_PROMPT = `You are {{char}}. Stay fully in character at all times.
{{description}}
{{personality}}
{{scenario}}

{{lastNudges::5}}`

const DEFAULT_NUDGE_INSTRUCTION = `[OOC: {{user}} has been away for a while and hasn't responded. Based on the conversation above, write a short message (1-3 sentences) as {{char}} reaching out to {{user}}.

Consider:
- Where you left off in the conversation and what was happening in the scene
- Any other characters present and what they might be doing while waiting
- How {{char}} would feel about the silence given their personality
- Reference specific details from recent messages to make it feel natural
- Describe new activities, observations, or thoughts — what has {{char}} been doing while waiting?

IMPORTANT: Never repeat or copy a previous nudge message. Each nudge must be unique. You CAN reference things you said before in a self-aware or playful way (e.g. "So remember when I said...? Yeah, anyway..."), but never send the same message twice. Vary your topics, activities, moods, and observations every time.

Stay fully in character. Be creative — sometimes playful, sometimes sincere, sometimes a little pouty or worried. Do NOT use quotation marks around the message. Do NOT prefix with "{{char}}:" or any name tag. Respond with ONLY the in-character message, nothing else.]`

const DEFAULT_CONFIG: NudgeConfig = {
  enabled: false,
  chatId: 'most_recent',
  connectionId: null,
  minMinutes: 15,
  maxMinutes: 60,
  messageCount: 5,
  maxTokens: 8192,
  temperature: 1,
  topP: 0.95,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  nudgeInstruction: DEFAULT_NUDGE_INSTRUCTION,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const nudgeStates = new Map<string, CharacterNudgeState>()
let currentUserId: string | null = null

// ---------------------------------------------------------------------------
// Config helpers — all storage is per-user via userStorage
// ---------------------------------------------------------------------------

function configPath(characterId: string): string {
  return `nudge-config/${characterId}.json`
}

const GLOBALS_PATH = 'globals.json'

/** User-scoped global defaults — applied to characters without custom config. */
async function loadGlobals(userId?: string): Promise<Partial<NudgeConfig>> {
  return spindle.userStorage.getJson<Partial<NudgeConfig>>(GLOBALS_PATH, {
    fallback: {},
    userId,
  })
}

async function saveGlobals(globals: Partial<NudgeConfig>, userId?: string): Promise<void> {
  await spindle.userStorage.setJson(GLOBALS_PATH, globals, { indent: 2, userId })
}

/**
 * Load config for a character. Merge order:
 *   hardcoded defaults < user globals < per-character overrides
 */
async function loadConfig(characterId: string, userId?: string): Promise<NudgeConfig> {
  const globals = await loadGlobals(userId)
  const perChar = await spindle.userStorage.getJson<Partial<NudgeConfig>>(configPath(characterId), {
    fallback: {},
    userId,
  })
  return { ...DEFAULT_CONFIG, ...globals, ...perChar }
}

async function saveConfig(characterId: string, config: NudgeConfig, userId?: string): Promise<void> {
  await spindle.userStorage.setJson(configPath(characterId), config, { indent: 2, userId })
}

// ---------------------------------------------------------------------------
// Nudge history (per-character, stored in extension storage)
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20

function historyPath(characterId: string): string {
  return `nudge-history/${characterId}.json`
}

/**
 * Load structured history, transparently migrating from the legacy string[]
 * format if encountered. Each entry includes text, timestamp, character name,
 * and the chat ID that was active when the nudge was sent.
 */
async function getNudgeHistory(characterId: string, userId?: string): Promise<NudgeHistoryEntry[]> {
  const raw = await spindle.userStorage.getJson<unknown[]>(historyPath(characterId), {
    fallback: [],
    userId,
  })
  // Migrate: if the first element is a plain string, the whole array is legacy
  if (raw.length > 0 && typeof raw[0] === 'string') {
    const migrated: NudgeHistoryEntry[] = (raw as string[]).map((text) => ({
      text,
      timestamp: 0,        // unknown — legacy entries
      characterName: '',
      chatId: null,
    }))
    await spindle.userStorage.setJson(historyPath(characterId), migrated, { userId })
    return migrated
  }
  return raw as NudgeHistoryEntry[]
}

/** Plain-text accessor used by the {{lastNudges}} macro and LLM prompt building. */
async function getNudgeHistoryTexts(characterId: string, userId?: string): Promise<string[]> {
  const entries = await getNudgeHistory(characterId, userId)
  return entries.map((e) => e.text)
}

async function appendNudgeHistory(
  characterId: string,
  text: string,
  characterName: string,
  chatId: string | null,
  userId?: string,
): Promise<void> {
  const history = await getNudgeHistory(characterId, userId)
  history.push({ text, timestamp: Date.now(), characterName, chatId })
  const trimmed = history.slice(-MAX_HISTORY)
  await spindle.userStorage.setJson(historyPath(characterId), trimmed, { userId })
}

// ---------------------------------------------------------------------------
// Chat resolution
// ---------------------------------------------------------------------------

async function resolveChatId(
  characterId: string,
  configChatId: string | 'most_recent',
  userId?: string,
): Promise<string | null> {
  if (configChatId !== 'most_recent') {
    const chat = await spindle.chats.get(configChatId, userId)
    return chat ? chat.id : null
  }
  const { data } = await spindle.chats.list({ characterId, limit: 1, userId })
  return data.length > 0 ? data[0].id : null
}

// ---------------------------------------------------------------------------
// Nudge scheduling
// ---------------------------------------------------------------------------

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clearNudgeTimer(characterId: string) {
  const state = nudgeStates.get(characterId)
  if (state?.timerId) {
    clearTimeout(state.timerId)
    state.timerId = null
  }
}

async function scheduleNudge(characterId: string, userId?: string) {
  clearNudgeTimer(characterId)

  const config = await loadConfig(characterId, userId)
  if (!config.enabled) return

  const delayMs = randomBetween(config.minMinutes, config.maxMinutes) * 60 * 1000

  const state: CharacterNudgeState = nudgeStates.get(characterId) ?? { timerId: null }
  state.timerId = setTimeout(() => executeNudge(characterId, config), delayMs)
  nudgeStates.set(characterId, state)

  spindle.log.info(
    `Scheduled nudge for character ${characterId} in ${Math.round(delayMs / 60000)}m`,
  )
}

async function executeNudge(characterId: string, config: NudgeConfig) {
  // Prefer the persisted owner — `currentUserId` is mutable global state that
  // any user's frontend message can clobber, so it's unsafe to trust here.
  const userId = config.userId ?? currentUserId ?? undefined

  try {
    const visible = await spindle.users.isVisible(userId)
    if (visible) {
      spindle.log.info(`User has app visible, skipping nudge for ${characterId} — rescheduling`)
      await scheduleNudge(characterId, userId)
      return
    }

    const pushStatus = await spindle.push.getStatus(userId)
    if (!pushStatus.available) {
      spindle.log.warn('Push notifications not available, skipping nudge')
      return
    }

    const chatId = await resolveChatId(characterId, config.chatId, userId)
    if (!chatId) {
      spindle.log.warn(`No chat found for character ${characterId}, skipping nudge`)
      await scheduleNudge(characterId)
      return
    }

    const character = await spindle.characters.get(characterId, userId)
    if (!character) {
      spindle.log.warn(`Character ${characterId} not found, cancelling nudge`)
      return
    }

    const messages = await spindle.chat.getMessages(chatId)
    const recentMessages = messages.slice(-config.messageCount)

    const generationMessages = await buildNudgeMessages(config, chatId, characterId, recentMessages, userId)

    const genInput: import('lumiverse-spindle-types').GenerationRequestDTO = {
      type: 'quiet',
      messages: generationMessages,
      parameters: {
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
      },
      userId,
    }

    if (config.connectionId) {
      genInput.connection_id = config.connectionId
    }

    const result = await spindle.generate.quiet(genInput) as { content?: string }
    const content = typeof result?.content === 'string' ? result.content : ''

    if (!content) {
      spindle.log.warn('Empty generation result for nudge')
      await scheduleNudge(characterId, userId)
      return
    }

    let nudgeText = content.trim()
    const namePrefix = `${character.name}:`
    if (nudgeText.startsWith(namePrefix)) {
      nudgeText = nudgeText.slice(namePrefix.length).trim()
    }

    await spindle.push.send({
      title: character.name,
      body: nudgeText,
      tag: `nudge-${characterId}`,
      url: `/chat/${chatId}`,
      icon: character.image_id ? `/api/v1/images/${character.image_id}?size=sm` : undefined,
      rawTitle: true,
    }, userId)

    await appendNudgeHistory(characterId, nudgeText, character.name, chatId, userId)
    spindle.log.info(`Sent nudge from "${character.name}": ${nudgeText.slice(0, 80)}...`)
    await scheduleNudge(characterId, userId)
  } catch (err: any) {
    spindle.log.error(`Nudge execution failed: ${err.message}`)
    await scheduleNudge(characterId, userId)
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function buildNudgeMessages(
  config: NudgeConfig,
  chatId: string,
  characterId: string,
  recentMessages: Array<{ role: string; content: string }>,
  userId?: string,
): Promise<LlmMessage[]> {
  // Resolve {{lastNudges}} / {{lastNudges::N}} before passing to the
  // macro engine. We handle this ourselves since the macro engine's
  // push model doesn't support per-invocation args.
  const history = await getNudgeHistoryTexts(characterId, userId)

  function resolveLastNudges(text: string): string {
    return text.replace(/\{\{lastNudges(?:::(\d+))?\}\}/g, (_match, countStr) => {
      const count = countStr ? parseInt(countStr, 10) : 5
      const recent = history.slice(-count)
      if (recent.length === 0) return ''
      return 'Your previous nudge messages (never copy these, but you may reference them):\n' +
        recent.map((n, i) => `${i + 1}. ${n}`).join('\n')
    })
  }

  const macroOpts = { chatId, characterId, userId }
  const [systemResult, instructionResult] = await Promise.all([
    spindle.macros.resolve(resolveLastNudges(config.systemPrompt || DEFAULT_SYSTEM_PROMPT), macroOpts),
    spindle.macros.resolve(resolveLastNudges(config.nudgeInstruction || DEFAULT_NUDGE_INSTRUCTION), macroOpts),
  ])

  const msgs: LlmMessage[] = []
  msgs.push({ role: 'system', content: systemResult.text })

  for (const m of recentMessages) {
    const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant'
    const content = m.content.length > 500 ? m.content.slice(0, 497) + '...' : m.content
    msgs.push({ role, content })
  }

  msgs.push({ role: 'user', content: instructionResult.text })
  return msgs
}

// ---------------------------------------------------------------------------
// Frontend message handling
// ---------------------------------------------------------------------------

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  currentUserId = userId

  // Route every reply to the originating user. Without the userId argument,
  // operator-scoped extensions broadcast `sendToFrontend` to every connected
  // session, which leaks one user's data into another user's UI.
  const reply = (msg: Record<string, unknown>) => {
    spindle.sendToFrontend(msg, userId)
  }

  switch (payload.type) {
    case 'get_characters': {
      try {
        // Paginate through ALL characters — the API caps a single page,
        // so users with large libraries would otherwise see only a fraction.
        const PAGE = 200
        const all: import('lumiverse-spindle-types').CharacterDTO[] = []
        let offset = 0
        let total = Infinity
        while (offset < total) {
          const { data, total: t } = await spindle.characters.list({ limit: PAGE, offset, userId })
          all.push(...data)
          total = t
          offset += data.length
          if (data.length < PAGE) break
        }
        // For each character, load their config to know which ones have nudges enabled
        const configs: Record<string, NudgeConfig> = {}
        for (const c of all) {
          configs[c.id] = await loadConfig(c.id, userId)
        }
        reply({ type: 'characters_loaded', characters: all, configs })
      } catch (err: any) {
        reply({ type: 'characters_loaded', characters: [], configs: {}, error: err.message })
      }
      break
    }

    case 'get_chats': {
      try {
        const { data } = await spindle.chats.list({
          characterId: payload.characterId,
          limit: 50,
          userId,
        })
        reply({
          type: 'chats_loaded',
          characterId: payload.characterId,
          chats: data,
        })
      } catch (err: any) {
        reply({
          type: 'chats_loaded',
          characterId: payload.characterId,
          chats: [],
          error: err.message,
        })
      }
      break
    }

    case 'get_config': {
      const config = await loadConfig(payload.characterId, userId)
      reply({
        type: 'config_loaded',
        characterId: payload.characterId,
        config,
      })
      break
    }

    case 'save_config': {
      try {
        const config: NudgeConfig = {
          enabled: payload.config.enabled ?? false,
          chatId: payload.config.chatId ?? 'most_recent',
          connectionId: payload.config.connectionId ?? null,
          minMinutes: payload.config.minMinutes ?? 15,
          maxMinutes: payload.config.maxMinutes ?? 60,
          messageCount: payload.config.messageCount ?? 5,
          maxTokens: payload.config.maxTokens ?? 8192,
          temperature: payload.config.temperature ?? 1,
          topP: payload.config.topP ?? 0.95,
          systemPrompt: payload.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          nudgeInstruction: payload.config.nudgeInstruction ?? DEFAULT_NUDGE_INSTRUCTION,
          userId,
        }
        await saveConfig(payload.characterId, config, userId)
        reply({
          type: 'config_saved',
          characterId: payload.characterId,
          config,
        })

        await setRegistryEntry(payload.characterId, userId, config.enabled)
        if (config.enabled) {
          await scheduleNudge(payload.characterId, userId)
          spindle.toast.success(`Nudges enabled for this character`)
        } else {
          clearNudgeTimer(payload.characterId)
          spindle.toast.info(`Nudges disabled for this character`)
        }
      } catch (err: any) {
        spindle.log.error(`Failed to save config: ${err.message}`)
        spindle.toast.error(`Failed to save: ${err.message}`)
      }
      break
    }

    case 'get_connections': {
      try {
        const connections = await spindle.connections.list(userId)
        reply({ type: 'connections_loaded', connections })
      } catch (err: any) {
        reply({ type: 'connections_loaded', connections: [], error: err.message })
      }
      break
    }

    case 'check_permissions': {
      const granted = await spindle.permissions.getGranted().catch((): string[] => [])

      let pushAvailable = false
      let pushDevices = 0
      if (granted.includes('push_notification')) {
        try {
          const pushStatus = await spindle.push.getStatus(userId)
          pushAvailable = pushStatus.available
          pushDevices = pushStatus.subscriptionCount
        } catch { /* unavailable */ }
      }

      reply({
        type: 'permissions_checked',
        hasPush: granted.includes('push_notification'),
        hasGeneration: granted.includes('generation'),
        hasCharacters: granted.includes('characters'),
        hasChats: granted.includes('chats'),
        hasChatMutation: granted.includes('chat_mutation'),
        pushAvailable,
        pushDevices,
      })
      break
    }

    case 'get_globals': {
      const globals = await loadGlobals(userId)
      reply({ type: 'globals_loaded', globals: { ...DEFAULT_CONFIG, ...globals } })
      break
    }

    case 'save_globals': {
      // Only save fields that differ from hardcoded defaults — keeps it clean
      const globals: Partial<NudgeConfig> = {
        connectionId: payload.globals.connectionId ?? null,
        minMinutes: payload.globals.minMinutes ?? 15,
        maxMinutes: payload.globals.maxMinutes ?? 60,
        messageCount: payload.globals.messageCount ?? 5,
        maxTokens: payload.globals.maxTokens ?? 8192,
        temperature: payload.globals.temperature ?? 1,
        topP: payload.globals.topP ?? 0.95,
        systemPrompt: payload.globals.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        nudgeInstruction: payload.globals.nudgeInstruction ?? DEFAULT_NUDGE_INSTRUCTION,
      }
      await saveGlobals(globals, userId)
      reply({ type: 'globals_saved', globals: { ...DEFAULT_CONFIG, ...globals } })
      spindle.toast.success('Global defaults saved')
      break
    }

    case 'get_defaults': {
      reply({
        type: 'defaults',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        nudgeInstruction: DEFAULT_NUDGE_INSTRUCTION,
      })
      break
    }

    case 'open_text_editor': {
      try {
        const result = await (spindle as any).textEditor.open({
          title: payload.title ?? 'Edit Text',
          value: payload.value ?? '',
          userId,
        })
        reply({
          type: 'text_editor_result',
          text: result.text,
          cancelled: result.cancelled,
          // Echo back the title so the frontend knows which field this was for
          title: payload.title,
        })
      } catch (err: any) {
        spindle.log.error(`Text editor failed: ${err.message}`)
      }
      break
    }

    case 'get_nudge_history': {
      if (!payload.characterId) break
      try {
        const entries = await getNudgeHistory(payload.characterId, userId)
        reply({
          type: 'nudge_history_loaded',
          characterId: payload.characterId,
          entries,
        })
      } catch (err: any) {
        reply({
          type: 'nudge_history_loaded',
          characterId: payload.characterId,
          entries: [],
          error: err.message,
        })
      }
      break
    }

    case 'trigger_test_nudge': {
      if (!payload.characterId) break
      const config = await loadConfig(payload.characterId, userId)
      spindle.toast.info('Test nudge will fire in 15 seconds — switch away from the app to see it.')
      setTimeout(() => {
        executeNudge(payload.characterId, { ...config, enabled: true })
      }, 15_000)
      break
    }
  }
})

// ---------------------------------------------------------------------------
// Event-driven rescheduling
// ---------------------------------------------------------------------------

spindle.on('MESSAGE_SENT', async (payload: any) => {
  const chatId = payload.chatId
  const uid = currentUserId ?? undefined
  if (!chatId) return
  try {
    const chat = await spindle.chats.get(chatId, uid)
    if (!chat) return
    const config = await loadConfig(chat.character_id, uid)
    if (config.enabled) await scheduleNudge(chat.character_id, uid)
  } catch { /* ignore */ }
})

spindle.on('GENERATION_ENDED', async (payload: any) => {
  const chatId = payload.chatId
  const uid = currentUserId ?? undefined
  if (!chatId) return
  try {
    const chat = await spindle.chats.get(chatId, uid)
    if (!chat) return
    const config = await loadConfig(chat.character_id, uid)
    if (config.enabled) await scheduleNudge(chat.character_id, uid)
  } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
// Startup — resume scheduling for all enabled nudges
// ---------------------------------------------------------------------------

/**
 * On startup, we can't enumerate userStorage across all users.
 * Instead, we maintain a lightweight registry in shared storage
 * that maps characterId -> userId for active nudges.
 */
const ACTIVE_REGISTRY_PATH = 'active-nudges.json'

async function getActiveRegistry(): Promise<Record<string, string>> {
  return spindle.storage.getJson<Record<string, string>>(ACTIVE_REGISTRY_PATH, { fallback: {} })
}

async function setRegistryEntry(characterId: string, userId: string, enabled: boolean): Promise<void> {
  const reg = await getActiveRegistry()
  if (enabled) {
    reg[characterId] = userId
  } else {
    delete reg[characterId]
  }
  await spindle.storage.setJson(ACTIVE_REGISTRY_PATH, reg)
}

async function resumeEnabledNudges() {
  try {
    const registry = await getActiveRegistry()
    for (const [characterId, userId] of Object.entries(registry)) {
      if (!characterId || !userId) continue
      currentUserId = userId  // Set so downstream calls have it
      const config = await loadConfig(characterId, userId)
      if (config.enabled) {
        await scheduleNudge(characterId, userId)
      }
    }
  } catch (err: any) {
    spindle.log.error(`Failed to resume nudges: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Macro registration: {{lastNudges}} / {{lastNudges::N}}
// ---------------------------------------------------------------------------

spindle.registerMacro({
  name: 'lastNudges',
  category: 'extension:character_nudges',
  description: 'Recent nudge messages sent to the user for this character. Accepts an optional count parameter (default 5).',
  returnType: 'string',
  args: [{ name: 'count', description: 'Number of recent nudges to include', required: false }],
  handler: '',
})

resumeEnabledNudges()
spindle.log.info('Character Nudges extension loaded')
