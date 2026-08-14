/**
 * Guards on the avatar mirror.
 *
 * `mirrorAvatar` is the one place NobleSee fetches a URL that came from
 * outside and re-serves the bytes from its own origin. That is a small
 * feature with a disproportionate blast radius — an SVG accepted here
 * is script on our domain — so the refusals are worth pinning down.
 *
 * R2 is stubbed rather than run: the questions are what we accept and
 * what we store, not whether Miniflare works.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const put = vi.fn()
const get = vi.fn()
let bucket: unknown = { put, get }

vi.mock('./storage', () => ({
  objectBucket: async () => bucket,
}))

const { mirrorAvatar, readAvatar } = await import('./avatars')

const SOURCE = 'https://lh3.googleusercontent.com/a/EXAMPLE=s96-c'

function imageResponse(contentType: string, bytes = 1024, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': contentType, ...headers },
  })
}

beforeEach(() => {
  bucket = { put, get }
  put.mockReset()
  get.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mirroring a profile picture', () => {
  it('stores the bytes and returns a path on this site', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/jpeg')))

    const path = await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })

    // Never Google's URL: that is the entire point of the module.
    expect(path).toMatch(/^\/avatar\?v=[0-9a-f]{12}$/)
    expect(path).not.toContain('googleusercontent')
    expect(put).toHaveBeenCalledWith(
      'avatars/7',
      expect.any(Uint8Array),
      { httpMetadata: { contentType: 'image/jpeg' } },
    )
  })

  it('refuses SVG, which would be script on our own origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/svg+xml')))

    expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it('refuses anything that is not an image format we allow', async () => {
    for (const type of ['text/html', 'application/json', 'image/x-icon', '']) {
      vi.stubGlobal('fetch', vi.fn(async () => imageResponse(type)))
      expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).toBeNull()
    }
    expect(put).not.toHaveBeenCalled()
  })

  it('ignores parameters on the content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/png; charset=binary')))
    expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).not.toBeNull()
  })

  it('refuses a body over the size cap even when the header lies about it', async () => {
    // Content-Length is advisory; the cap that matters is on the bytes
    // actually read.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse('image/png', 3 * 1024 * 1024, { 'content-length': '10' })),
    )

    expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it('refuses an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/png', 0)))
    expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).toBeNull()
  })

  it('does not refetch a picture it already has', async () => {
    const fetchSpy = vi.fn(async () => imageResponse('image/jpeg'))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const again = await mirrorAvatar({
      userId: 7,
      sourceUrl: SOURCE,
      currentAvatarUrl: first!,
    })
    expect(again).toBe(first)
    // Signing in is common; changing your photo is not.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('gives a different path when the picture changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/jpeg')))

    const before = await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })
    const after = await mirrorAvatar({
      userId: 7,
      sourceUrl: 'https://lh3.googleusercontent.com/a/DIFFERENT=s96-c',
      currentAvatarUrl: before!,
    })

    // A changed URL must produce a changed path, or the browser serves
    // the old face out of cache forever.
    expect(after).not.toBe(before)
  })

  it('never throws when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network is down')
    }))

    // Sign-in must not depend on googleusercontent.com being reachable.
    await expect(mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).resolves.toBeNull()
  })

  it('never throws when the response is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).resolves.toBeNull()
  })

  it('does nothing when there is no bucket', async () => {
    bucket = null
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('image/png')))
    expect(await mirrorAvatar({ userId: 7, sourceUrl: SOURCE })).toBeNull()
  })
})

describe('reading a mirrored picture back', () => {
  it('returns the stored bytes and content type', async () => {
    get.mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: 'image/png' },
    })

    const avatar = await readAvatar(7)
    expect(get).toHaveBeenCalledWith('avatars/7')
    expect(avatar?.contentType).toBe('image/png')
  })

  it('is null when the reader has none', async () => {
    get.mockResolvedValue(null)
    expect(await readAvatar(7)).toBeNull()
  })
})
