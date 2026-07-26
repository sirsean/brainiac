// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  buildTherapySystemPrompt,
  packTherapyThoughts,
  buildTherapyPreviewMeta,
  type TherapyThoughtInput,
} from './therapyReport'

function thought(partial: Partial<TherapyThoughtInput> & { id: number; body: string }): TherapyThoughtInput {
  return {
    created_at: partial.created_at ?? partial.id,
    tags: partial.tags ?? [],
    mood: partial.mood ?? null,
    localDate: partial.localDate ?? '2026-07-01',
    ...partial,
  }
}

describe('therapyReport prompts', () => {
  it('includes required markdown section headings in the system prompt', () => {
    const system = buildTherapySystemPrompt()
    expect(system).toContain('## What has been on your mind')
    expect(system).toContain('second person')
    expect(system).not.toContain('## What has been on their mind')
    expect(system).toContain('## Green flags')
    expect(system).toContain('## Red flags')
    expect(system).toContain('## Suggested conversation agenda')
    expect(system).toContain('NOT a clinician')
  })

  it('packs thoughts and truncates when over thought cap', () => {
    const thoughts = Array.from({ length: 5 }, (_, i) =>
      thought({ id: i + 1, body: `thought ${i + 1}`, localDate: `2026-07-0${i + 1}` }),
    )
    const pack = packTherapyThoughts({
      from: '2026-07-01',
      to: '2026-07-05',
      thoughtsAsc: thoughts,
      thoughtCap: 3,
      charBudget: 100_000,
    })
    expect(pack.truncated).toBe(true)
    expect(pack.thoughtCount).toBe(3)
    expect(pack.includedThoughtIds).toEqual([3, 4, 5])
    expect(pack.user).toContain('thought 5')
    expect(pack.user).not.toContain('thought 1')
  })

  it('builds preview tag and mood aggregates', () => {
    const meta = buildTherapyPreviewMeta([
      thought({
        id: 1,
        body: 'a',
        tags: ['work', 'sleep'],
        mood: { score: 2, explanation: 'tired' },
        localDate: '2026-07-01',
      }),
      thought({
        id: 2,
        body: 'b',
        tags: ['work'],
        mood: { score: 4, explanation: 'ok' },
        localDate: '2026-07-02',
      }),
    ])
    expect(meta.thought_count).toBe(2)
    expect(meta.mood_avg).toBe(3)
    expect(meta.tag_counts[0]).toEqual({ name: 'work', count: 2 })
  })
})
