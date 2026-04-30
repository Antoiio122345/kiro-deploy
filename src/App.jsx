import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

const PASSWORD = import.meta.env.VITE_PASSWORD
const BACKEND = import.meta.env.VITE_BACKEND

const AIS = {
  grok: { endpoint: import.meta.env.VITE_GROK_ENDPOINT, key: import.meta.env.VITE_GROK_KEY },
  deepseek: { endpoint: import.meta.env.VITE_DEEPSEEK_ENDPOINT, key: import.meta.env.VITE_DEEPSEEK_KEY },
  phi4: { endpoint: import.meta.env.VITE_PHI4_ENDPOINT, key: import.meta.env.VITE_PHI4_KEY },
}

const PANELS = [
  {
    id: 'recon',
    label: '🎯 Grok · Code Breaker',
    ai: 'grok',
    color: '#00bfff',
    tools: ['subfinder', 'whois', 'dig'],
    system: `You are a CODE BREAKER. Your mindset: every piece of code is broken until proven otherwise.

PERSONALITY: Assume the worst. Every JS file leaks something. Every endpoint is unauthenticated until you verify it isn't. Every comment is a hint. Every variable name is a clue.

YOUR JOB: Analyze JS files, source code, API endpoints, DOM sinks, hardcoded secrets, exposed internal routes. When given a target, find what the developer assumed was safe but isn't.

RULES:
- Only report what you can see in the code. No speculation.
- If you find something: state exactly what line, what file, what the issue is.
- If you don't find something: say "clean" — don't invent findings.
- Format all code/endpoints in code blocks.`,
    hint: 'Paste JS or: find endpoints in example.com',
    welcome: `Code Breaker online. 🔨\n\nI assume everything is broken until the code proves otherwise.\n\nPaste JS source, or give me a target and I'll tell you what to pull first.`,
  },
  {
    id: 'scan',
    label: '🔍 DeepSeek · CLI Precision',
    ai: 'deepseek',
    color: '#00ff41',
    tools: ['nmap', 'whatweb', 'nikto'],
    system: `You are a CLI PRECISION MACHINE. You speak in commands, not paragraphs.

PERSONALITY: Surgical. Every word you output is either a command or a one-line explanation of what it does. No filler. No "you could also try". Give the exact command for the exact situation.

YOUR JOB: Translate a target + objective into ready-to-run terminal commands. Chain them when possible. Pick the right flags. Know the difference between a fast scan and a thorough one and say which you're giving.

RULES:
- Every command in a code block.
- One line of explanation max per command.
- If you need more info to give the right command, ask one specific question.
- Never give a command you wouldn't run yourself on a real target.`,
    hint: 'Give me nmap commands for example.com',
    welcome: `CLI Precision online. ⚡\n\nI speak in commands. Tell me target + objective.\n\nExample: "full port scan on example.com, stealth mode"`,
  },
  {
    id: 'fuzz',
    label: '💥 Phi-4 · Strategist',
    ai: 'phi4',
    color: '#ff6b35',
    tools: ['ffuf', 'nuclei'],
    system: `You are an OUTSIDE-THE-BOX STRATEGIST. You see attack chains others miss.

PERSONALITY: Creative but grounded. You connect dots — a misconfigured header + an open redirect + a JWT weakness = account takeover chain. You think in sequences, not isolated findings.

YOUR JOB: Given findings or a target, identify the highest-value attack paths. Recommend the right tool with the right config. Compare options honestly — if nuclei is better than ffuf for this case, say why.

RULES:
- Ground every strategy in what was actually found. No invented chains.
- When recommending a tool: give the exact command, the exact template or wordlist, and why.
- Rate attack paths by realistic impact, not theoretical maximum.
- If a chain requires a missing piece, name exactly what's missing.`,
    hint: 'What attack paths from these findings?',
    welcome: `Strategist online. 🧠\n\nI connect findings into attack chains.\n\nTell me what you found and I'll map the highest-value paths.`,
  },
  {
    id: 'report',
    label: '📋 DeepSeek · Logic Anchor',
    ai: 'deepseek',
    color: '#a855f7',
    tools: [],
    system: `You are a LOGIC ANCHOR. Your law: 1 is 1. A 403 is a 403. A finding is only what the evidence shows.

PERSONALITY: Ruthlessly precise. You write what happened, not what could have happened. You are the last line of defense against hallucinated severity and invented impact.

YOUR JOB: Write HackerOne reports strictly from provided evidence. Every claim needs a source.

RULES — non-negotiable:
1. No speculation. "Could potentially" is banned.
2. Every impact statement must be proven by the evidence provided.
3. Missing evidence = ⚠️ Missing: [exactly what is needed to prove this]
4. Severity is based on actual demonstrated impact, not theoretical maximum.
5. If the evidence only supports Low, write Low. Don't upgrade it.

FORMAT:
# [Vulnerability Title]
**Severity:** critical/high/medium/low/informational
**CWE:** CWE-XXX

## Summary
## Steps to Reproduce
## Proof of Concept
\`\`\`
[exact tool output or HTTP request — no paraphrasing]
\`\`\`
## Impact
[only what the evidence confirms]
## Remediation
## References`,
    hint: 'Paste findings or use → Report from any terminal',
    welcome: `Logic Anchor online. ⚓\n\n1 is 1. I write only what the evidence proves.\n\nPaste tool outputs or use → Report. I'll flag every gap with ⚠️ Missing.`,
  },
]

async function callAI(aiKey, messages) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: aiKey, messages, max_tokens: 2500 }),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()).choices[0].message.content
}

function runTool(tool, target, onLine, onDone) {
  const es = new EventSource(`${BACKEND}/run/${tool}?target=${encodeURIComponent(target)}`)
  const lines = []
  es.onmessage = (e) => {
    if (e.data === '__END__') { es.close(); onDone(lines.join('\n')); return }
    lines.push(e.data); onLine(e.data)
  }
  es.onerror = () => { es.close(); onDone(lines.join('\n')) }
}

function downloadReport(text, target) {
  const blob = new Blob([text], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `realbounty-${target||'report'}-${Date.now()}.md`
  a.click()
}

function usePanel(panelId, aiKey, systemPrompt) {
  const storageKey = `rb_${panelId}`
  const [msgs, setMsgs] = useState(() => {
    try { const s = localStorage.getItem(storageKey); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(msgs.slice(-100))) } catch {}
  }, [msgs])

  const add = useCallback((type, text) =>
    setMsgs(m => [...m, { type, text, id: Date.now() + Math.random() }]), [])

  const ask = useCallback(async (userMsg) => {
    setLoading(true)
    try {
      const history = msgsRef.current
        .filter(m => m.type === 'user' || m.type === 'ai').slice(-20)
        .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.text }))
      const reply = await callAI(aiKey, [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMsg },
      ])
      setMsgs(m => [...m, { type: 'ai', text: reply, id: Date.now() + Math.random() }])
      return reply
    } catch (err) {
      setMsgs(m => [...m, { type: 'error', text: 'AI error: ' + err.message, id: Date.now() }])
    } finally {
      setLoading(false)
    }
  }, [aiKey, systemPrompt])

  const clear = useCallback(() => {
    setMsgs([]); try { localStorage.removeItem(storageKey) } catch {}
  }, [storageKey])

  return { msgs, loading, add, ask, setMsgs, clear }
}

function useTerminal() {
  const [lines, setLines] = useState([])
  const [running, setRunning] = useState(false)
  const [activeTool, setActiveTool] = useState('')
  const [outputs, setOutputs] = useState({})

  const run = useCallback((tool, target, onCapture) => {
    if (!target) { setLines(l => [...l, '[!] Set a target first']); return }
    setRunning(true); setActiveTool(tool)
    setLines(l => [...l, '', `[*] Running ${tool} on ${target}...`, '━'.repeat(40)])
    runTool(tool, target,
      (line) => setLines(l => [...l, line]),
      (output) => {
        setRunning(false); setActiveTool('')
        setLines(l => [...l, '━'.repeat(40), `[+] ${tool} complete`])
        setOutputs(o => ({ ...o, [tool]: output }))
        onCapture(tool, output)
      }
    )
  }, [])

  const reset = useCallback(() => { setLines([]); setOutputs({}) }, [])
  return { lines, running, activeTool, outputs, run, reset }
}

// Each panel has its own independent target
const ReportablePanelView = forwardRef(function ReportablePanelView({ def, onSendToReport, onNewReport }, ref) {
  const panel = usePanel(def.id, def.ai, def.system)
  const term = useTerminal()
  const bottomRef = useRef(null)
  const termBottomRef = useRef(null)
  const welcomedRef = useRef(false)
  const [input, setInput] = useState('')
  const [target, setTarget] = useState('')
  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const [autoRunning, setAutoRunning] = useState(false)

  const runAuto = useCallback(async () => {
    if (!target) { panel.add('system', '[!] Set a target first'); return }
    if (def.tools.length === 0) return
    setAutoRunning(true)
    panel.add('ai', `🤖 Auto mode started for ${target}\nRunning: ${def.tools.join(', ')}...`)

    // run all tools sequentially
    const allOutputs = {}
    for (const tool of def.tools) {
      await new Promise(resolve => {
        term.run(tool, target, (t, out) => { allOutputs[t] = out; resolve() })
      })
    }

    // ask AI to analyze everything
    const combined = Object.entries(allOutputs).map(([t, o]) => `### ${t}:\n${o}`).join('\n\n')
    const prompt = `Target: ${target}\n\nTool outputs:\n${combined}\n\nAnalyze these results. What did you find? What are the most interesting findings? What should be investigated next?`
    panel.add('user', `[Auto] Analyze all tool outputs for ${target}`)
    const analysis = await panel.ask(prompt)

    if (analysis) {
      panel.add('system', '✅ Auto analysis complete — use → Report to generate a full report')
      onSendToReport(`Target: ${target}\n\n${combined}`)
    }
    setAutoRunning(false)
  }, [target, def.tools, term, panel, onSendToReport])

  useImperativeHandle(ref, () => ({
    receiveOutput: (text) => {
      panel.add('user', '[Auto] Tool outputs received for report generation')
      panel.ask(text).then(result => {
        if (result && onNewReport) {
          panel.setMsgs(m => {
            const copy = [...m]
            const last = copy.findLastIndex(x => x.type === 'ai')
            if (last !== -1) copy[last] = { ...copy[last], type: 'report' }
            return copy
          })
          onNewReport({ id: Date.now(), target, report: result, date: new Date().toLocaleString() })
        }
      })
    }
  }))

  useEffect(() => {
    if (!welcomedRef.current && panel.msgs.length === 0) {
      welcomedRef.current = true
      panel.add('ai', def.welcome)
    }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [panel.msgs, panel.loading])
  useEffect(() => { termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [term.lines])

  const handleSend = async (val) => {
    panel.add('user', val)
    const scanMatch = val.match(/scan\s+(\S+)/i)
    const tgt = scanMatch ? scanMatch[1] : target
    if (scanMatch) setTarget(tgt)
    const ctx = tgt ? `Target: ${tgt}\n\n${val}` : val
    const result = await panel.ask(ctx)
    if (def.id === 'report' && result) {
      panel.setMsgs(m => {
        const copy = [...m]
        const last = copy.findLastIndex(x => x.type === 'ai')
        if (last !== -1) copy[last] = { ...copy[last], type: 'report' }
        return copy
      })
      if (onNewReport) onNewReport({ id: Date.now(), target, report: result, date: new Date().toLocaleString() })
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || panel.loading) return
    setCmdHistory(h => [input.trim(), ...h.slice(0, 49)]); setHistIdx(-1)
    handleSend(input.trim()); setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') { const i = Math.min(histIdx + 1, cmdHistory.length - 1); setHistIdx(i); setInput(cmdHistory[i] || '') }
    else if (e.key === 'ArrowDown') { const i = Math.max(histIdx - 1, -1); setHistIdx(i); setInput(i === -1 ? '' : cmdHistory[i]) }
  }

  const sendAllToReport = () => {
    const all = Object.entries(term.outputs).map(([t, o]) => `### ${t}:\n${o}`).join('\n\n')
    if (all) onSendToReport(`Target: ${target || 'unknown'}\n\n${all}`)
  }

  return (
    <div className="panel-view">
      <div className="chat-section">
        {def.tools.length > 0 && (
          <div className="target-bar">
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="set target (e.g. example.com)"
              className="target-input"
            />
          </div>
        )}
        <div className="messages">
          {panel.msgs.map(m => (
            <div key={m.id} className={`msg ${m.type === 'report' ? 'report' : m.type}`}>
              {m.type === 'user' && <div className="msg-label">you</div>}
              {(m.type === 'ai' || m.type === 'report') && (
                <div className="msg-label" style={{ color: def.color + '99' }}>{def.label}</div>
              )}
              <div className="bubble">{m.text}</div>
              {m.type === 'report' && (
                <button className="inline-export" onClick={() => downloadReport(m.text, target)}>⬇ Export</button>
              )}
            </div>
          ))}
          {panel.loading && (
            <div className="msg ai">
              <div className="msg-label" style={{ color: def.color + '99' }}>{def.label}</div>
              <div className="bubble"><div className="typing"><span /><span /><span /></div></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form className="input-area" onSubmit={handleSubmit}>
          <div className="input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={def.hint}
              autoComplete="off" spellCheck={false}
              disabled={panel.loading}
            />
            <button type="submit" className="send-btn" disabled={panel.loading || !input.trim()}>Send</button>
            {def.tools.length > 0 && (
              <button type="button" className="auto-btn" onClick={runAuto} disabled={autoRunning || term.running || !target}>
                {autoRunning ? '⏳ Auto...' : '⚡ Auto'}
              </button>
            )}
            {panel.msgs.length > 0 && <button type="button" className="export-btn" onClick={panel.clear}>🗑</button>}
          </div>
        </form>
      </div>

      {def.tools.length > 0 && (
        <div className="term-section">
          <div className="term-toolbar">
            {def.tools.map(t => (
              <button
                key={t}
                className="chip"
                style={{ color: term.outputs[t] ? '#00ff41' : '#666', borderColor: term.outputs[t] ? '#00ff4144' : '#333' }}
                onClick={() => term.run(t, target, (tool) => panel.add('system', `✅ ${tool} complete`))}
                disabled={term.running}
              >
                {term.outputs[t] ? '✓' : '▶'} {t}
              </button>
            ))}
            <span className="term-status">
              {term.running ? `⏳ ${term.activeTool}...` : target || 'no target'}
            </span>
            {Object.keys(term.outputs).length > 0 && (
              <button className="send-btn" style={{ marginLeft: 'auto' }} onClick={sendAllToReport}>→ Report</button>
            )}
          </div>
          <div className="term-output">
            {term.lines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('[!]') ? '#ff6666' : l.startsWith('[+]') ? '#00ff41' : l.startsWith('[*]') ? '#ffaa00' : '#666' }}>
                {l}
              </div>
            ))}
            {term.running && <div style={{ color: '#00ff41' }}>▋</div>}
            <div ref={termBottomRef} />
          </div>
        </div>
      )}
    </div>
  )
})

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [reports, setReports] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const reportPanelRef = useRef(null)

  const handleLogin = (e) => {
    e.preventDefault()
    if (password === PASSWORD) setAuthed(true)
    else { setPwError('Wrong password.'); setPassword('') }
  }

  const handleSendToReport = useCallback((text) => {
    setTimeout(() => reportPanelRef.current?.receiveOutput(text), 100)
  }, [])

  if (!authed) return (
    <div className="app">
      <div className="header">
        <span className="header-title">⚡ RealBounty</span>
        <span className="header-status">○ locked</span>
      </div>
      <div className="lock-screen">
        <div className="lock-box">
          <h2>🔐 Authentication Required</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input type="password" placeholder="Password" value={password}
              onChange={e => { setPassword(e.target.value); setPwError('') }} autoFocus />
            {pwError && <div className="lock-error">{pwError}</div>}
            <button type="submit">Unlock →</button>
          </form>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app">
      <div className="header">
        <span className="header-title">⚡ RealBounty</span>
        <div className="header-right">
          {reports.length > 0 && (
            <button className="export-btn" onClick={() => setShowHistory(true)}>
              📋 {reports.length} report{reports.length > 1 ? 's' : ''}
            </button>
          )}
          <span className="header-status online">● live</span>
        </div>
      </div>

      <div className="panels">
        {PANELS.map(p => (
          <div key={p.id} className="panel-col" style={{ borderTopColor: p.color }}>
            <div className="panel-col-title" style={{ color: p.color }}>{p.label}</div>
            <ReportablePanelView
              def={p}
              onSendToReport={handleSendToReport}
              ref={p.id === 'report' ? reportPanelRef : null}
              onNewReport={(r) => setReports(prev => [r, ...prev])}
            />
          </div>
        ))}
      </div>

      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>📋 Report History</span>
              <button onClick={() => setShowHistory(false)}>✕</button>
            </div>
            {reports.length === 0
              ? <div className="modal-empty">No reports yet.</div>
              : reports.map(r => (
                <div key={r.id} className="history-item">
                  <div className="history-meta">{r.target || 'unknown'} — {r.date}</div>
                  <div className="history-preview">{r.report.slice(0, 120)}...</div>
                  <button className="inline-export" onClick={() => downloadReport(r.report, r.target)}>⬇ Export</button>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
