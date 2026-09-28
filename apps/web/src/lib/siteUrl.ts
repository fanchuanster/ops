export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  return (configured || 'https://noblesee.com').replace(/\/+$/, '')
}
