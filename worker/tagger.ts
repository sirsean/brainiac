export const TAG_REGEX = /^[A-Za-z0-9_-]+$/

export type TaggingAiResult = {
  tags: string[]
}

export function normalizeAndValidateTags(rawTags: unknown): {
  valid: string[]
  invalid: string[]
} {
  const invalid: string[] = []
  const validSet = new Set<string>()

  const arr = Array.isArray(rawTags) ? rawTags : []

  for (const item of arr) {
    if (typeof item !== 'string') {
      invalid.push(String(item))
      continue
    }

    const tag = item.trim()
    if (tag.length === 0) continue

    if (!TAG_REGEX.test(tag)) {
      invalid.push(tag)
      continue
    }

    validSet.add(tag)
  }

  return { valid: [...validSet], invalid }
}

export function buildTaggerSystemPrompt(): string {
  return [
    'You are a tagging assistant for a personal thought journal.',
    '',
    'You must output ONLY valid JSON (no markdown, no backticks, no prose).',
    'The JSON MUST be an object with exactly one key: "tags".',
    '"tags" MUST be an array of strings.',
    '',
    'Tag format rules (STRICT):',
    '- Every tag MUST match this regex exactly: ^[A-Za-z0-9_-]+$',
    '- Tags are case-sensitive.',
    '- No spaces. No punctuation other than underscore and hyphen.',
    '- No duplicates.',
    '',
    'Tagging guidance:',
    '- Prefer reusing existing tags if applicable.',
    '- You MAY keep or remove currently assigned tags if they are/aren\'t applicable.',
    '- You MAY introduce new tags when needed.',
  ].join('\n')
}

export function buildTaggerUserPrompt(opts: {
  thought: string
  existingTags: string[]
  currentTags: string[]
}): string {
  const { thought, existingTags, currentTags } = opts

  return [
    'THOUGHT:',
    thought,
    '',
    'EXISTING_TAGS (prefer these when applicable):',
    existingTags.join(', '),
    '',
    'CURRENT_TAGS (you may keep/remove):',
    currentTags.join(', '),
  ].join('\n')
}
