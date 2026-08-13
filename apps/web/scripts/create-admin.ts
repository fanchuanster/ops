/**
 * Creates (or promotes) an administrator.
 *
 * Payload only offers its "create first user" screen while the users
 * collection is empty, so the moment any reader registers — including a
 * smoke-test reader — that door closes for good. This script is the way
 * in afterwards, and the only supported way to make the first admin on a
 * live deployment.
 *
 *   npm run create-admin          # local D1, for development
 *   npm run create-admin:remote   # the live production database
 *
 * The target is chosen by ADMIN_TARGET rather than a command-line flag
 * because `payload run` replaces argv before the script sees it — a
 * `--remote` argument silently vanishes and the script would act on the
 * wrong database while reporting success.
 *
 * The password is read from ADMIN_PASSWORD or prompted for with echo
 * off. It is deliberately not accepted as an argument: argv is visible
 * to every other process on the host via /proc, and shell history keeps
 * it long after the terminal closes.
 *
 * Existing users are promoted rather than duplicated, so re-running this
 * to add the admin role to an established account is safe. A promotion
 * never touches the password.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Writable } from 'node:stream'

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.ADMIN_TARGET === 'remote'
const configPath = remote ? 'wrangler.remote.jsonc' : 'wrangler.jsonc'

/**
 * One readline interface for the whole run, closed once at the end.
 *
 * Not two. Closing an interface leaves `stdin` paused, so a second
 * `createInterface` on the same stream never receives a keystroke and
 * the next prompt hangs with no error — which is exactly what happens
 * if the email and the password each open their own.
 */
let rl: ReturnType<typeof createInterface> | null = null

/**
 * Created on first prompt, not at module load: an interface starts
 * consuming stdin the moment it exists, so one built up front drains a
 * piped input and reaches EOF during the several seconds
 * `getPlatformProxy` takes, leaving the first question to fail with
 * "readline was closed".
 */
/**
 * Readline's own output, with a switch on it.
 *
 * Echo is suppressed by routing readline through a stream that can be
 * told to drop what it is given, rather than by overriding the private
 * `_writeToOutput`. That override silently does nothing on
 * `readline/promises` in Node 22 — it looks correct, runs without
 * error, and prints the password anyway.
 */
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

/** Prompts without echoing, so the password never appears on screen. */
async function askSecret(question: string): Promise<string> {
  const active = prompts()
  // The prompt goes straight to stdout so it survives the mute; only
  // what readline echoes back is dropped.
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

  // Bindings must be in place before the Payload config is evaluated —
  // it reads env.DB at module scope. Seeding the context global lets
  // getCloudflareContext short-circuit before it looks for a config file
  // of its own, which is what lets this script choose local vs remote.
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

    // Both prompts happen before Payload starts, so the two questions
    // come one after the other. Asking for the password after the
    // lookup instead leaves a silent multi-second gap mid-prompt that
    // reads as a hang.
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
      // The roles field is admin-only by design, and there is no admin
      // yet to satisfy it — that is precisely the bootstrap problem this
      // script exists to solve.
      overrideAccess: true,
    })

    console.log(`\n  Created admin: ${email}`)
    console.log(remote ? '  Sign in at https://noblesee.com/admin\n' : '  Sign in at http://localhost:8787/admin\n')
  } finally {
    rl?.close()
    await proxy.dispose()
  }
}

// Top-level await, not `main().catch()`: `payload run` finishes with the
// module evaluation, so a floating promise leaves the script exiting 0
// having done nothing.
try {
  await main()
} catch (error) {
  console.error(`\n  Failed: ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}
process.exit(0)
