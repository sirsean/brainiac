export type ThoughtAnalysisSummary = {
  status: 'queued' | 'processing' | 'done' | 'error'
  total: number
  queued: number
  processing: number
  done: number
  error: number
  last_updated_at: number
}

export function analysisLabel(a: ThoughtAnalysisSummary | null): { text: string; title: string; className: string } | null {
  if (!a) return null

  const progress = `${a.done}/${a.total}`
  const title = `Jobs: ${a.total} (queued ${a.queued}, processing ${a.processing}, done ${a.done}, error ${a.error})`

  if (a.status === 'error') return { text: 'Error', title, className: 'status error' }
  if (a.status === 'processing') return { text: `Processing ${progress}`, title, className: 'status processing' }
  if (a.status === 'queued') return { text: `Queued ${progress}`, title, className: 'status queued' }
  return { text: 'Done', title, className: 'status done' }
}
