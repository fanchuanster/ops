import { getCloudflareContext } from '@opennextjs/cloudflare'

import {
  FIRST_PAGE_TEXT_CHARS,
  IDENTIFY_SYSTEM,
  identifyPrompt,
  parseIdentity,
  type BookIdentity,
  type FirstPage,
  type ShelfChoice,
} from '../domain/bookIdentity'
import { coverCandidateKey } from '../domain/cover'
import { bytesToBinaryString } from '../domain/metadata'
import { createChatClient, identifyConfigFromEnv } from './conversion/llm'
import { logWarn } from './logError'
import { artifactBytes, objectRange } from './storage'

const TEXT_HEAD_BYTES = FIRST_PAGE_TEXT_CHARS * 4

export interface FirstPageSource {
  filenames: readonly string[]
  sourceKind?: string | null
  sourceKey?: string | null
  coverKey?: string | null
  shelves: readonly ShelfChoice[]
}

async function firstPageImage(coverKey: string): Promise<string | null> {
  const bytes = await artifactBytes(coverCandidateKey(coverKey, 1))
  if (!bytes || bytes.length === 0) return null
  return `data:image/jpeg;base64,${btoa(bytesToBinaryString(bytes))}`
}

async function firstPageText(sourceKey: string): Promise<string | null> {
  const bytes = await objectRange(sourceKey, 0, TEXT_HEAD_BYTES)
  if (!bytes || bytes.length === 0) return null
  const text = new TextDecoder().decode(bytes).trim()
  return text ? text.slice(0, FIRST_PAGE_TEXT_CHARS) : null
}

async function readFirstPage(
  source: FirstPageSource,
): Promise<{ page: FirstPage; images: string[] }> {
  if (source.coverKey) {
    const image = await firstPageImage(source.coverKey)
    if (image) return { page: { kind: 'image' }, images: [image] }
  }
  if (source.sourceKind === 'text' && source.sourceKey) {
    const text = await firstPageText(source.sourceKey)
    if (text) return { page: { kind: 'text', text }, images: [] }
  }
  return { page: { kind: 'none' }, images: [] }
}

export async function identifyFromFirstPage(source: FirstPageSource): Promise<BookIdentity | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const client = createChatClient(identifyConfigFromEnv(env as unknown as Record<string, unknown>))
    const { page, images } = await readFirstPage(source)

    const answer = await client.complete(
      IDENTIFY_SYSTEM,
      identifyPrompt(source.filenames, source.shelves, page),
      images.length > 0 ? images : undefined,
    )
    return parseIdentity(answer, source.shelves)
  } catch (error) {
    logWarn('identifyFromFirstPage', error)
    return null
  }
}
