const https = require('https')
const { URL } = require('url')

const AIS = {
  grok:     { endpoint: process.env.VITE_GROK_ENDPOINT,     key: process.env.VITE_GROK_KEY },
  deepseek: { endpoint: process.env.VITE_DEEPSEEK_ENDPOINT, key: process.env.VITE_DEEPSEEK_KEY },
  phi4:     { endpoint: process.env.VITE_PHI4_ENDPOINT,     key: process.env.VITE_PHI4_KEY },
}

module.exports = async function (context, req) {
  const { model, messages, max_tokens = 2500 } = req.body || {}
  const ai = AIS[model]
  if (!ai) {
    context.res = { status: 400, body: { error: 'unknown model' } }
    return
  }

  const url = new URL(ai.endpoint)
  const body = JSON.stringify({ messages, max_tokens })

  const data = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': ai.key,
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    r.on('error', reject)
    r.write(body)
    r.end()
  })

  context.res = {
    status: data.status,
    headers: { 'Content-Type': 'application/json' },
    body: data.body,
  }
}
