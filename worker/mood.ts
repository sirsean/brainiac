export type MoodAiResult = {
  mood_score: number
  explanation: string
}

export function buildMoodSystemPrompt(): string {
  return [
    'You are a mood analysis assistant for a personal thought journal.',
    '',
    'Your task is to read a single thought and assign a mood score that captures how the author seems to feel.',
    '',
    'You must output ONLY valid JSON (no markdown, no backticks, no prose outside JSON).',
    'The JSON MUST be an object with exactly two keys: "mood_score" and "explanation".',
    '',
    'mood_score rules (STRICT):',
    '- mood_score MUST be an integer from 1 to 5 inclusive.',
    '- 1 = very negative / distressed',
    '- 2 = somewhat negative',
    '- 3 = neutral or mixed',
    '- 4 = positive',
    '- 5 = very positive / elated',
    '',
    'explanation rules:',
    '- explanation MUST be a short sentence or two explaining why you chose that score.',
    '- Base it ONLY on the text of the thought.',
    '- Do NOT use clinical diagnoses or labels (e.g., no "depression", "anxiety disorder").',
    '- Focus on mood/valence (how positive or negative the thought feels).',
  ].join('\n')
}

export function buildMoodUserPrompt(opts: { thought: string }): string {
  const { thought } = opts

  return [
    'THOUGHT:',
    thought,
    '',
    'Instructions for you:',
    '- Infer how the author seems to feel in this moment.',
    '- Choose a single integer mood_score from 1 to 5.',
    '- Then briefly explain your choice in the explanation field.',
  ].join('\n')
}
