import * as core from '@actions/core'

const HYPERBOLIC_API_URL = 'https://api.hyperbolic.xyz/v1/chat/completions'

function parseResponse(content) {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch) {
    const reasoning = thinkMatch[1].trim()
    const response = content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
    return { reasoning, response }
  }
  return { reasoning: '', response: content }
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    const apiKey = core.getInput('api-key', { required: true })
    const prompt = core.getInput('prompt', { required: true })
    const model = core.getInput('model', { required: true })
    const maxTokens = parseInt(core.getInput('max-tokens'), 10)
    const temperature = parseFloat(core.getInput('temperature'))
    const topP = parseFloat(core.getInput('top-p'))

    core.info(`Calling Hyperbolic API with model: ${model}`)

    const response = await fetch(HYPERBOLIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: false
      })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`API returned ${response.status}: ${body}`)
    }

    const json = await response.json()
    const rawContent = json.choices[0].message.content
    const { reasoning, response: answer } = parseResponse(rawContent)

    if (reasoning) {
      core.info(`Reasoning: ${reasoning}`)
      core.setOutput('reasoning', reasoning)
    }

    core.info(`Response: ${answer}`)
    core.setOutput('response', answer)
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
