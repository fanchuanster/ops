import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Writable } from 'node:stream'

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.ADMIN_TARGET === 'remote'
const configPath = remote ? 'wrangler.remote.jsonc' : 'wrangler.jsonc'

let rl: ReturnType<typeof createInterface> | null = null

let muted = false
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding as BufferEncoding)
    callback()
  },
})

function prompts() {
  rl ??= createInterface({ input: stdin, output, terminal: true })
  return rl
}

async function ask(question: string): Promise<string> {
  return (await prompts().question(question)).trim()
}

async function askSecret(question: string): Promise<string> {
  const active = prompts()
  stdout.write(question)
  muted = true
  try {
    const answer = await active.question('')
    stdout.write('\n')
    return answer.trim()
  } finally {
    muted = false
  }
}

async function main() {
  if (remote) {
    console.log('\n  Target: PRODUCTION (live D1 via remote bindings)\n')
  } else {
    console.log('\n  Target: local D1 in .wrangler/\n')
  }

  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy({ configPath, envFiles: [] })
  ;(globalThis as Record<symbol, unknown>)[CONTEXT_SYMBOL] = {
    env: proxy.env,
    cf: proxy.cf,
    ctx: proxy.ctx,
  }

  try {
    const email = process.env.ADMIN_EMAIL || (await ask('  Email: '))
    if (!email.includes('@')) throw new Error('That is not an email address.')

    const password = process.env.ADMIN_PASSWORD || (await askSecret('  Password: '))
    const { checkPassword } = await import('../src/domain/password')
    const passwordProblem = checkPassword(password)
    if (passwordProblem) throw new Error(passwordProblem.message)

    console.log('\n  Connecting and looking up the account…')

    const { default: config } = await import('@payload-config')
    const { getPayload } = await import('payload')
    const payload = await getPayload({ config })

    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      const user = existing.docs[0]
      const roles = new Set([...(user.roles ?? []), 'admin'])
      await payload.update({
        collection: 'users',
        id: user.id,
        data: { roles: [...roles] as ('reader' | 'editor' | 'admin')[] },
        overrideAccess: true,
      })
      console.log(`\n  Promoted existing account to admin: ${email}`)
      console.log('  Its existing password is unchanged — sign in with that.\n')
      return
    }

    await payload.create({
      collection: 'users',
      data: {
        email,
        password,
        roles: ['admin'],
      },
      overrideAccess: true,
    })

    console.log(`\n  Created admin: ${email}`)
    console.log(remote ? '  Sign in at https://noblesee.com/admin\n' : '  Sign in at http://localhost:8787/admin\n')
  } finally {
    rl?.close()
    await proxy.dispose()
  }
}

try {
  await main()
} catch (error) {
  console.error(`\n  Failed: ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}
process.exit(0)
