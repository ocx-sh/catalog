// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { isEditableTarget } from '../../../src/theme/utils/dom.js'

// WP-03 coverage-gap closure: isEditableTarget had no ported test (source
// repo didn't carry one either). Needs a real HTMLElement — happy-dom,
// scoped to this file only (package default environment stays Node).
describe('isEditableTarget', () => {
  test('false for null', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  test('false for a non-HTMLElement EventTarget', () => {
    expect(isEditableTarget(window)).toBe(false)
  })

  test('true for an <input>', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true)
  })

  test('true for a <textarea>', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
  })

  test('true for a contenteditable element', () => {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    expect(isEditableTarget(div)).toBe(true)
  })

  test('false for a plain, non-editable element', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
  })
})
