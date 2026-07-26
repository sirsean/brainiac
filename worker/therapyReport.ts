export const DEFAULT_THERAPY_MODEL = '@cf/moonshotai/kimi-k2.6' as const

/** Soft cap on thoughts packed into the therapy prompt. */
export const THERAPY_THOUGHT_CAP = 120

/** Soft cap on characters of journal text packed into the therapy prompt. */
export const THERAPY_CHAR_BUDGET = 48_000

export type TherapyThoughtInput = {
  id: number
  created_at: number
  body: string
  tags: string[]
  mood: { score: number; explanation: string } | null
  localDate: string
}

export type TherapyPromptPack = {
  system: string
  user: string
  includedThoughtIds: number[]
  truncated: boolean
  thoughtCount: number
}

export function buildTherapySystemPrompt(): string {
  return [
    'You are a therapy-session preparation coach for a personal journal app.',
    'You are NOT a clinician and must NOT diagnose, prescribe, or invent clinical labels.',
    '',
    'The reader is the journal author. Address them directly in the second person (you / your).',
    'Do not write about them in the third person (they / their / the client).',
    '',
    'You will receive journal thoughts from a date range (with tags and optional mood scores 1–5).',
    'Help the reader walk into therapy prepared and grounded in what they actually wrote.',
    'Phrase the report as speaking to them — e.g. what has been on your mind, what you are in the middle of.',
    '',
    'Write a clear Markdown report with these sections (use these exact headings):',
    '## What has been on your mind',
    '## Life updates and context',
    '## Recurring themes',
    '## Green flags (improvements / strengths)',
    '## Red flags (dysfunctions / stuck patterns)',
    '## Suggested conversation agenda',
    '## Open loops and follow-ups',
    '',
    'Guidelines:',
    '- Base every claim on the journal content. If something is unclear, say so.',
    '- Prefer concrete themes and quotes/paraphrases over vague advice.',
    '- Mood scores (1=very negative … 5=very positive) are signals, not diagnoses.',
    '- Suggested agenda should be a short bullet list of questions/topics for the therapist conversation.',
    '- Be compassionate and practical. Avoid moralizing.',
    '- Stay in second person throughout the report body, not just the headings.',
    '- Output Markdown only (no surrounding code fence).',
  ].join('\n')
}

export function buildTherapyUserPrompt(opts: {
  from: string
  to: string
  thoughts: TherapyThoughtInput[]
  truncated: boolean
}): string {
  const lines: string[] = [
    `DATE_RANGE (local): ${opts.from} → ${opts.to}`,
    `THOUGHT_COUNT_INCLUDED: ${opts.thoughts.length}`,
  ]

  if (opts.truncated) {
    lines.push(
      'NOTE: The journal range was truncated to fit context limits. Prefer themes from the included thoughts; mention truncation if it may matter.',
    )
  }

  lines.push('', 'JOURNAL (oldest → newest):', '')

  for (const t of opts.thoughts) {
    const tags = t.tags.length > 0 ? t.tags.join(', ') : '(none)'
    const mood =
      t.mood != null
        ? `mood=${t.mood.score}/5 (${t.mood.explanation})`
        : 'mood=(none)'
    lines.push(`---`)
    lines.push(`[${t.localDate}] id=${t.id} tags=[${tags}] ${mood}`)
    lines.push(t.body.trim())
    lines.push('')
  }

  lines.push(
    'Please produce the Markdown therapy-prep report now.',
  )

  return lines.join('\n')
}

/**
 * Pack thoughts chronologically under caps. Returns truncated=true when some were dropped.
 * Dropping prefers keeping the most recent thoughts when over budget.
 */
export function packTherapyThoughts(opts: {
  from: string
  to: string
  thoughtsAsc: TherapyThoughtInput[]
  thoughtCap?: number
  charBudget?: number
}): TherapyPromptPack {
  const thoughtCap = opts.thoughtCap ?? THERAPY_THOUGHT_CAP
  const charBudget = opts.charBudget ?? THERAPY_CHAR_BUDGET

  let selected = opts.thoughtsAsc
  let truncated = false

  if (selected.length > thoughtCap) {
    selected = selected.slice(selected.length - thoughtCap)
    truncated = true
  }

  // Trim from the oldest end until under char budget.
  const measure = (items: TherapyThoughtInput[]) =>
    items.reduce((n, t) => n + t.body.length + 80, 0)

  while (selected.length > 1 && measure(selected) > charBudget) {
    selected = selected.slice(1)
    truncated = true
  }

  return {
    system: buildTherapySystemPrompt(),
    user: buildTherapyUserPrompt({
      from: opts.from,
      to: opts.to,
      thoughts: selected,
      truncated,
    }),
    includedThoughtIds: selected.map((t) => t.id),
    truncated,
    thoughtCount: selected.length,
  }
}

export type TherapyPreviewMeta = {
  thought_count: number
  truncated: boolean
  tag_counts: Array<{ name: string; count: number }>
  mood_by_day: Array<{ date: string; avg: number | null; count: number }>
  mood_avg: number | null
  thought_ids: number[]
}

export function buildTherapyPreviewMeta(thoughts: TherapyThoughtInput[]): TherapyPreviewMeta {
  const tagMap = new Map<string, number>()
  const dayMoods = new Map<string, number[]>()
  let moodSum = 0
  let moodN = 0

  for (const t of thoughts) {
    for (const tag of t.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1)
    }
    if (t.mood) {
      moodSum += t.mood.score
      moodN += 1
      const arr = dayMoods.get(t.localDate) ?? []
      arr.push(t.mood.score)
      dayMoods.set(t.localDate, arr)
    } else if (!dayMoods.has(t.localDate)) {
      dayMoods.set(t.localDate, [])
    }
  }

  const tag_counts = [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const mood_by_day = [...dayMoods.entries()]
    .map(([date, scores]) => ({
      date,
      avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      count: scores.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    thought_count: thoughts.length,
    truncated: false,
    tag_counts,
    mood_by_day,
    mood_avg: moodN > 0 ? moodSum / moodN : null,
    thought_ids: thoughts.map((t) => t.id),
  }
}
