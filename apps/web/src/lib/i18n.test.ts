import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveInitialLanguage } from './i18n'

test('restores a supported saved language before browser preference', () => {
  assert.equal(resolveInitialLanguage('zh-CN', 'en-US'), 'zh-CN')
  assert.equal(resolveInitialLanguage('en-US', 'zh-CN'), 'en-US')
})

test('falls back to Chinese browser locales and English otherwise', () => {
  assert.equal(resolveInitialLanguage(null, 'zh-Hans-CN'), 'zh-CN')
  assert.equal(resolveInitialLanguage(null, 'en-GB'), 'en-US')
  assert.equal(resolveInitialLanguage('unsupported', 'ja-JP'), 'en-US')
})
