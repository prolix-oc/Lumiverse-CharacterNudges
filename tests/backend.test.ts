import { beforeAll, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

let backendSource: string

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [new URL('../src/backend.ts', import.meta.url).pathname],
    target: 'bun',
    write: false,
  })
  if (!build.success) throw new AggregateError(build.logs, 'Backend build failed')
  backendSource = await build.outputs[0].text()
})

function loadBackend(api: Record<string, unknown>) {
  let handler: (payload: Record<string, unknown>, userId: string) => Promise<void>
  const replies: Array<{ message: any; userId: string }> = []
  const timers: Array<{ callback: () => void; delay: number }> = []
  const errors: string[] = []
  const spindle = {
    onFrontendMessage(callback: typeof handler) { handler = callback },
    on() {},
    registerMacro() {},
    storage: { async getJson(_path: string, options: any) { return options.fallback } },
    userStorage: { async getJson(_path: string, options: any) { return options.fallback } },
    sendToFrontend(message: unknown, userId: string) {
      replies.push({ message: JSON.parse(JSON.stringify(message)), userId })
    },
    log: { info() {}, warn() {}, error(message: string) { errors.push(message) } },
    ...api,
  }
  runInNewContext(backendSource, {
    spindle,
    setTimeout(callback: () => void, delay: number) {
      timers.push({ callback, delay })
      return timers.length
    },
    clearTimeout() {},
  }, { timeout: 1000 })
  return { handle: (payload: Record<string, unknown>, userId: string) => handler(payload, userId), replies, timers, errors }
}

test('all paginated characters are sent as summaries, preserving scoped configs', async () => {
  const userId = 'summary-user'
  const characters = Array.from({ length: 403 }, (_, index) => ({
    id: `character-${index}`,
    name: `Character ${index}`,
    image_id: index % 2 ? `image-${index}` : null,
    description: 'Full card description',
    personality: 'Full card personality',
    extensions: { scripts: ['Unneeded frontend script'], payload: 'Private full card payload' },
  }))
  const pages: number[] = []
  const storageReads: string[] = []
  const backend = loadBackend({
    characters: {
      async list(options: { limit: number; offset: number; userId: string }) {
        expect(options.userId).toBe(userId)
        expect(options.limit).toBe(200)
        pages.push(options.offset)
        return { data: characters.slice(options.offset, options.offset + options.limit), total: characters.length }
      },
    },
    userStorage: {
      async getJson(path: string, options: { userId: string }) {
        expect(options.userId).toBe(userId)
        storageReads.push(path)
        if (path === 'globals.json') return { minMinutes: 20, systemPrompt: 'User default prompt' }
        return path === 'nudge-config/character-402.json' ? { enabled: true, minMinutes: 7 } : {}
      },
    },
  })

  await backend.handle({ type: 'get_characters' }, userId)
  expect(backend.errors).toEqual([])
  expect(pages).toEqual([0, 200, 400])
  expect(backend.replies).toHaveLength(1)
  const { message, userId: recipient } = backend.replies[0]
  expect(recipient).toBe(userId)
  expect(message.type).toBe('characters_loaded')
  expect(message.characters).toEqual(characters.map(({ id, name, image_id }) => ({ id, name, image_id })))
  expect(Object.keys(message.configs)).toHaveLength(403)
  expect(message.configs['character-0']).toMatchObject({ enabled: false, minMinutes: 20, systemPrompt: 'User default prompt' })
  expect(message.configs['character-402']).toMatchObject({ enabled: true, minMinutes: 7, systemPrompt: 'User default prompt' })
  expect(storageReads).toContain('nudge-config/character-402.json')
  expect(JSON.stringify(message)).not.toContain('Private full card payload')
})

test('nudge generation fetches current full character data and resolves prompts on the backend', async () => {
  const userId = 'generation-user'
  let character = { id: 'character-1', name: 'Aster', image_id: 'avatar-1', description: 'Original description' }
  const reads: unknown[][] = []
  const prompts: any[] = []
  const generated: any[] = []
  const pushes: any[] = []
  let finishPush: () => void
  const pushSent = new Promise<void>(resolve => { finishPush = resolve })
  const backend = loadBackend({
    characters: {
      async list() { return { data: [character], total: 1 } },
      async get(id: string, owner: string) { reads.push([id, owner]); return character },
    },
    users: { async isVisible(owner: string) { expect(owner).toBe(userId); return false } },
    chats: {
      async list(options: any) {
        expect(options).toMatchObject({ characterId: character.id, userId })
        return { data: [{ id: 'chat-1' }] }
      },
    },
    chat: { async getMessages(id: string) { expect(id).toBe('chat-1'); return [{ role: 'user', content: 'Recent context' }] } },
    macros: {
      async resolve(text: string, options: any) {
        prompts.push({ text, options })
        expect(options).toMatchObject({ chatId: 'chat-1', characterId: character.id, userId })
        return { text: text.replaceAll('{{char}}', character.name).replaceAll('{{description}}', character.description) }
      },
    },
    generate: {
      async quiet(input: any) {
        generated.push(JSON.parse(JSON.stringify(input)))
        return { content: 'Aster: A fresh nudge' }
      },
    },
    push: {
      async getStatus(owner: string) { expect(owner).toBe(userId); return { available: true } },
      async send(input: any, owner: string) {
        pushes.push({ input, owner })
        finishPush()
        return { sent: 1 }
      },
    },
    toast: { info() {} },
  })

  await backend.handle({ type: 'get_characters' }, userId)
  expect(backend.replies[0].message.characters[0]).not.toHaveProperty('description')
  character = { ...character, description: 'Updated character data, loaded only on the backend' }
  await backend.handle({ type: 'trigger_test_nudge', characterId: character.id }, userId)
  expect(backend.timers).toHaveLength(1)
  expect(backend.timers[0].delay).toBe(15_000)
  backend.timers[0].callback()
  await pushSent

  expect(backend.errors).toEqual([])
  expect(reads).toEqual([[character.id, userId]])
  expect(prompts).toHaveLength(2)
  expect(prompts[0].text).toContain('{{description}}')
  expect(generated).toHaveLength(1)
  expect(generated[0]).toMatchObject({ type: 'quiet', userId })
  expect(generated[0].messages[0].content).toContain(character.description)
  expect(generated[0].messages[1]).toEqual({ role: 'user', content: 'Recent context' })
  expect(pushes[0]).toMatchObject({ owner: userId, input: { title: 'Aster', body: 'A fresh nudge' } })
}, 2000)
