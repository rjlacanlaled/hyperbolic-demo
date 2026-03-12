/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { afterEach, beforeEach, jest } from '@jest/globals'
const core = await import('../__fixtures__/core')

jest.unstable_mockModule('@actions/core', () => core)

const main = await import('../src/hyperbolic/main')

const makeSuccessResponse = (content, reasoningContent = null) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{
      message: {
        role: 'assistant',
        content,
        reasoning_content: reasoningContent,
        tool_calls: null
      }
    }]
  })
})

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
        'max-tokens': '16384',
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
    global.fetch.mockResolvedValueOnce(makeSuccessResponse('Test response'))

    await main.run()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(core.setOutput).toHaveBeenCalledWith('response', 'Test response')
  })

  it('fails when the API returns an error', async () => {
    global.fetch.mockResolvedValueOnce(mockFailResponse)

    await main.run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('API returned 500')
    )
  })

  it('separates reasoning_content from response', async () => {
    global.fetch.mockResolvedValueOnce(
      makeSuccessResponse('Here are things to do in SF.', 'Let me think about this...')
    )

    await main.run()

    expect(core.setOutput).toHaveBeenCalledWith('reasoning', 'Let me think about this...')
    expect(core.setOutput).toHaveBeenCalledWith('response', 'Here are things to do in SF.')
  })

  it('handles response with no reasoning_content', async () => {
    global.fetch.mockResolvedValueOnce(makeSuccessResponse('Plain response', null))

    await main.run()

    expect(core.setOutput).toHaveBeenCalledWith('response', 'Plain response')
    expect(core.setOutput).not.toHaveBeenCalledWith('reasoning', expect.anything())
  })
})
