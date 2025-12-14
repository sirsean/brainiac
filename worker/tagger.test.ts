// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { TAG_REGEX, normalizeAndValidateTags } from './tagger'

describe('tagger', () => {
  it('TAG_REGEX enforces ^[A-Za-z0-9_-]+$', () => {
    const valid = ['foo', 'Foo', 'foo_bar', 'foo-bar', 'A1_B2-3']
    const invalid = ['foo bar', 'foo.bar', 'foo:bar', 'foo/bar', '', '   ', '💥']

    for (const t of valid) expect(TAG_REGEX.test(t)).toBe(true)
    for (const t of invalid) expect(TAG_REGEX.test(t)).toBe(false)
  })

  it('normalizeAndValidateTags trims, de-dupes, and drops invalid values', () => {
    const { valid, invalid } = normalizeAndValidateTags([
      ' Foo',
      'Foo',
      'foo bar',
      'foo-bar',
      123,
      null,
      '💥',
      ' ',
      'foo_bar',
    ])

    expect(valid.sort()).toEqual(['Foo', 'foo-bar', 'foo_bar'].sort())
    expect(invalid).toEqual(['foo bar', '123', 'null', '💥'])
  })
})
