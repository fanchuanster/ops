function canonicalHost(): string | null {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  if (!configured) return null
  try {
    return new URL(configured).host.toLowerCase()
  } catch {
    return null
  }
}

export function analyticsMeasurementId(host: string | null): string | null {
  const id = process.env.GA_MEASUREMENT_ID?.trim()
  if (!id) return null

  if (!/^G-[A-Z0-9]+$/i.test(id)) return null

  const canonical = canonicalHost()
  if (!canonical || !host || host.toLowerCase() !== canonical) return null

  return id
}
