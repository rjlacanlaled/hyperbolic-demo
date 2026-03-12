/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { afterEach, beforeEach, jest } from '@jest/globals'
const core = await import('../__fixtures__/core')

jest.unstable_mockModule('@actions/core', () => core)

const main = await import('../src/main')

const mockSuccessResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: 'Test response from AI' } }]
  })
}

const mockFailResponse = {
  ok: false,
  status: 500,
  text: async () => 'Internal Server Error'
}

describe('action', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'api-key': 'test-api-key',
        prompt: 'What can I do in SF?',
        model: 'Qwen/Qwen3-Next-80B-A3B-Thinking',
        'max-tokens': '507',
        temperature: '0.7',
        'top-p': '0.8'
      }
      return inputs[name] || ''
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('calls the model and sets the response output', async () => {
    global.fetch.mockResolvedValueOnce(mockSuccessResponse)

    await main.run()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(core.setOutput).toHaveBeenCalledWith('response', 'Test response from AI')
  })

  it('fails when the API returns an error', async () => {
    global.fetch.mockResolvedValueOnce(mockFailResponse)

    await main.run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('API returned 500')
    )
  })

  it('sends correct request body', async () => {
    global.fetch.mockResolvedValueOnce(mockSuccessResponse)

    await main.run()

    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(callBody.model).toBe('Qwen/Qwen3-Next-80B-A3B-Thinking')
    expect(callBody.messages).toEqual([{ role: 'user', content: 'What can I do in SF?' }])
    expect(callBody.max_tokens).toBe(507)
    expect(callBody.temperature).toBe(0.7)
    expect(callBody.top_p).toBe(0.8)
    expect(callBody.stream).toBe(false)
  })
})
