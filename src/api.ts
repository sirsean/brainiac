export async function apiFetch<T>(opts: {
  path: string
  method?: string
  body?: unknown
  getIdToken: () => Promise<string | null>
}): Promise<T> {
  const { path, method = 'GET', body, getIdToken } = opts

  const token = await getIdToken()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j: unknown = await res.json()
      if (typeof j === 'object' && j !== null && 'error' in j) {
        const e = (j as { error?: unknown }).error
        if (e) msg = String(e)
      }
    } catch {
      // ignore
    }
    throw new Error(msg)
  }

  return (await res.json()) as T
}
