export interface RegistryInfo {
  latest: string | null
  versions: string[]
}

const cache = new Map<string, RegistryInfo>()

export function clearRegistryCache(): void {
  cache.clear()
}

export async function fetchRegistryInfo(name: string): Promise<RegistryInfo> {
  const cached = cache.get(name)
  if (cached) return cached

  const url = name.startsWith('@')
    ? `https://registry.npmjs.org/${name.replace('/', '%2F')}`
    : `https://registry.npmjs.org/${encodeURIComponent(name)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    const empty: RegistryInfo = { latest: null, versions: [] }
    cache.set(name, empty)
    return empty
  }

  const data = (await res.json()) as {
    'dist-tags'?: { latest?: string }
    versions?: Record<string, unknown>
  }

  const info: RegistryInfo = {
    latest: data['dist-tags']?.latest ?? null,
    versions: Object.keys(data.versions ?? {}),
  }
  cache.set(name, info)
  return info
}
