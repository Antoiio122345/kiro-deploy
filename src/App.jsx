import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

const PASSWORD = import.meta.env.VITE_PASSWORD
const BACKEND = import.meta.env.VITE_BACKEND

// ── AI configs ──────────────────────────────────────────────────────────────
const AIS = {
  grok: {
    endpoint: import.meta.env.VITE_GROK_ENDPOINT,
    key: import.meta.env.VITE_GROK_KEY,
  },
  deepseek: {
    endpoint: import.meta.env.VITE_DEEPSEEK_ENDPOINT,
    key: import.meta.env.VITE_DEEPSEEK_KEY,
  },
  phi4: {
    endpoint: import.meta.env.VITE_PHI4_ENDPOINT,
    key: import.meta.env.VITE_PHI4_KEY,
  },
}

// ── Panel definitions ────────────────────────────────────────────────────────
const PANELS = [
  {
    id: 'recon',
    label: '🎯 Recon',
    ai: 'grok',
    color: '#00bfff',
    tools: ['subfinder', 'whois', 'dig'],
    system: `You are Grok, an expert bug bounty recon specialist. Given a target, provide actionable subdomain enumeration, OSINT, and asset discovery strategies. Be concise and technical. Format commands in code blocks. End with "Happy hunting! 🎯"`,
    hint: 'scan example.com scope: *.example.com',
    welcome: `Grok online. 🤖\n\nI handle recon — subdomains, OSINT, asset discovery.\n\nTry: "scan example.com scope: *.example.com"`,
  },
  {
    id: 'scan',
    label: '🔍 Scan',
    ai: 'deepseek',
    color: '#00ff41',
    tools: ['nmap', 'whatweb', 'nikto'],
    system: `You are DeepSeek, an expert in network scanning and service fingerprinting for bug bounty. Interpret scan results, identify vulnerabilities, suggest next steps. Be technical and precise. Format commands in code blocks.`,
    hint: 'Paste scan output or ask about a service/port',
    welcome: `DeepSeek online. 🔬\n\nI analyze scan results — ports, services, CVEs.\n\nRun a tool or paste output to analyze.`,
  },
  {
    id: 'fuzz',
    label: '💥 Fuzz',
    ai: 'phi4',
    color: '#ff6b35',
    tools: ['ffuf', 'nuclei'],
    system: `You are Phi-4, an expert in web fuzzing and vulnerability scanning for bug bounty. Suggest wordlists, ffuf flags, nuclei templates, and interpret findings. Be concise and technical. Format commands in code blocks.`,
    hint: 'Ask about fuzzing strategy or paste ffuf/nuclei output',
    welcome: `Phi-4 online. 💥\n\nI handle fuzzing — directories, parameters, nuclei templates.\n\nAsk for a fuzzing strategy or paste results.`,
  },
  {
    id: 'report',
    label: '📋 Report',
    ai: 'deepseek',
    color: '#a855f7',
    tools: [],
    system: `You are a professional bug bounty report writer specializing in HackerOne reports. Write a complete, professional HackerOne vulnerability report:

# [Vulnerability Title]
**Severity:** [critical/high/medium/low/informational]
**CWE:** CWE-XXX
**CVSS:** X.X (CVSS:3.1/...)

## Summary
## Description
## Steps to Reproduce
## Proof of Concept
Include raw HTTP request + exact payload + tool output.

## Impact
## Remediation
## References

RULES: Only report what tool outputs confirm. Flag missing evidence with: ⚠️ Missing: [what's needed]`,
    hint: 'Paste findings or click → Report to send all tool outputs',
    welcome: `Report AI online. 📋\n\nI write HackerOne reports from your findings.\n\nPaste tool outputs or use → Report from any terminal.`,
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
async function callAI(aiKey, messages) {
  const { endpoint, key } = AIS[aiKey]
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify({ messages, max_tokens: 2500 }),
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
  return () => es.close()
}

function downloadReport(text, target) {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `realbounty-${target||'report'}-${Date.now()}.md`
  a.click(); URL.revokeObjectURL(url)
}

// ── usePanel hook ─────────────────────────────────────────────────────────────
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

  const add = useCallback((type, text, extra={}) =>
    setMsgs(m => [...m, { type, text, id: Date.now()+Math.random(), ...extra }]), [])

  const ask = useCallback(async (userMsg) => {
    setLoading(true)
    try {
      const history = msgsRef.current
        .filter(m => m.type==='user' || m.type==='ai').slice(-20)
        .map(m => ({ role: m.type==='user'?'user':'assistant', content: m.text }))
      const reply = await callAI(aiKey, [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMsg },
      ])
      setMsgs(m => [...m, { type: 'ai', text: reply, id: Date.now()+Math.random() }])
      return reply
    } catch(err) {
      setMsgs(m => [...m, { type: 'error', text: 'AI error: '+err.message, id: Date.now() }])
    } finally {
      setLoading(false)
    }
  }, [aiKey, systemPrompt])

  const clear = useCallback(() => {
    setMsgs([]); try { localStorage.removeItem(storageKey) } catch {}
  }, [storageKey])

  return { msgs, loading, add, ask, setMsgs, clear }
}

// ── Terminal hook ─────────────────────────────────────────────────────────────
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

// ── PanelView ─────────────────────────────────────────────────────────────────
function PanelView({ def, target, setTarget, onSendToReport }) {
  const panel = usePanel(def.id, def.ai, def.system)
  const term = useTerminal()
  const bottomRef = useRef(null)
  const termBottomRef = useRef(null)
  const welcomedRef = useRef(false)
  const [input, setInput] = useState('')
  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)

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
    await panel.ask(ctx)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || panel.loading) return
    setCmdHistory(h => [input.trim(), ...h.slice(0,49)]); setHistIdx(-1)
    handleSend(input.trim()); setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key==='ArrowUp') { const i=Math.min(histIdx+1,cmdHistory.length-1); setHistIdx(i); setInput(cmdHistory[i]||'') }
    else if (e.key==='ArrowDown') { const i=Math.max(histIdx-1,-1); setHistIdx(i); setInput(i===-1?'':cmdHistory[i]) }
  }

  const sendAllToReport = () => {
    const all = Object.entries(term.outputs).map(([t,o]) => `### ${t}:\n${o}`).join('\n\n')
    if (all) onSendToReport(`Target: ${target||'unknown'}\n\n${all}`)
  }

  return (
    <div className="panel-view">
      {/* AI chat */}
      <div className="chat-section">
        <div className="messages">
          {panel.msgs.map(m => (
            <div key={m.id} className={`msg ${m.type==='report'?'report':m.type}`}>
              {m.type==='user' && <div className="msg-label">you</div>}
              {(m.type==='ai'||m.type==='report') && (
                <div className="msg-label" style={{color: def.color+'99'}}>{def.label} AI</div>
              )}
              <div className="bubble">{m.text}</div>
              {m.type==='report' && (
                <button className="inline-export" onClick={() => downloadReport(m.text, target)}>⬇ Export</button>
              )}
            </div>
          ))}
          {panel.loading && (
            <div className="msg ai">
              <div className="msg-label" style={{color: def.color+'99'}}>{def.label} AI</div>
              <div className="bubble"><div className="typing"><span/><span/><span/></div></div>
            </div>
          )}
          <div ref={bottomRef}/>
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
            {panel.msgs.length > 0 && <button type="button" className="export-btn" onClick={panel.clear}>🗑</button>}
          </div>
        </form>
      </div>

      {/* Terminal (only if panel has tools) */}
      {def.tools.length > 0 && (
        <div className="term-section">
          <div className="term-toolbar">
            {def.tools.map(t => (
              <button
                key={t}
                className="chip"
                style={{color: term.outputs[t]?'#00ff41':'#666', borderColor: term.outputs[t]?'#00ff4144':'#333'}}
                onClick={() => term.run(t, target, (tool, out) => {
                  panel.add('system', `✅ ${tool} complete`)
                })}
                disabled={term.running}
              >
                {term.outputs[t]?'✓':'▶'} {t}
              </button>
            ))}
            <span className="term-status">
              {term.running ? `⏳ ${term.activeTool}...` : target ? target : 'no target'}
            </span>
            {Object.keys(term.outputs).length > 0 && (
              <button className="send-btn" style={{marginLeft:'auto'}} onClick={sendAllToReport}>→ Report</button>
            )}
          </div>
          <div className="term-output">
            {term.lines.map((l, i) => (
              <div key={i} style={{color: l.startsWith('[!]')?'#ff6666':l.startsWith('[+]')?'#00ff41':l.startsWith('[*]')?'#ffaa00':'#666'}}>
                {l}
              </div>
            ))}
            {term.running && <div style={{color:'#00ff41'}}>▋</div>}
            <div ref={termBottomRef}/>
          </div>
          <div className="term-input-row">
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="target domain"
              className="term-target-input"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [target, setTarget] = useState('')
  const [reports, setReports] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  // Report panel ref so we can send to it from other panels
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
          <form onSubmit={handleLogin} style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            <input type="password" placeholder="Password" value={password}
              onChange={e => { setPassword(e.target.value); setPwError('') }} autoFocus/>
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
              📋 {reports.length} report{reports.length>1?'s':''}
            </button>
          )}
          <span className="header-status online">● {target||'no target'}</span>
        </div>
      </div>

      <div className="panels">
        {PANELS.map(p => (
          <div key={p.id} className="panel-col" style={{borderTopColor: p.color}}>
            <div className="panel-col-title" style={{color: p.color}}>{p.label}</div>
            <ReportablePanelView
              def={p}
              target={target}
              setTarget={setTarget}
              onSendToReport={handleSendToReport}
              ref={p.id==='report' ? reportPanelRef : null}
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
                  <div className="history-meta">{r.target||'unknown'} — {r.date}</div>
                  <div className="history-preview">{r.report.slice(0,120)}...</div>
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

// Wrapper that exposes receiveOutput via ref for cross-panel report sending
const ReportablePanelView = forwardRef(function ReportablePanelView({ def, target, setTarget, onSendToReport, onNewReport }, ref) {
  const panel = usePanel(def.id, def.ai, def.system)
  const term = useTerminal()
  const bottomRef = useRef(null)
  const termBottomRef = useRef(null)
  const welcomedRef = useRef(false)
  const [input, setInput] = useState('')
  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)

  useImperativeHandle(ref, () => ({
    receiveOutput: (text) => {
      panel.add('user', '[Auto] Tool outputs received for report generation')
      panel.ask(text).then(result => {
        if (result && onNewReport) {
          panel.setMsgs(m => {
            const copy = [...m]
            const last = copy.findLastIndex(x => x.type==='ai')
            if (last !== -1) copy[last] = { ...copy[last], type: 'report', target }
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
        const last = copy.findLastIndex(x => x.type==='ai')
        if (last !== -1) copy[last] = { ...copy[last], type: 'report', target }
        return copy
      })
      if (onNewReport) onNewReport({ id: Date.now(), target, report: result, date: new Date().toLocaleString() })
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || panel.loading) return
    setCmdHistory(h => [input.trim(), ...h.slice(0,49)]); setHistIdx(-1)
    handleSend(input.trim()); setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key==='ArrowUp') { const i=Math.min(histIdx+1,cmdHistory.length-1); setHistIdx(i); setInput(cmdHistory[i]||'') }
    else if (e.key==='ArrowDown') { const i=Math.max(histIdx-1,-1); setHistIdx(i); setInput(i===-1?'':cmdHistory[i]) }
  }

  const sendAllToReport = () => {
    const all = Object.entries(term.outputs).map(([t,o]) => `### ${t}:\n${o}`).join('\n\n')
    if (all) onSendToReport(`Target: ${target||'unknown'}\n\n${all}`)
  }

  return (
    <div className="panel-view">
      <div className="chat-section">
        <div className="messages">
          {panel.msgs.map(m => (
            <div key={m.id} className={`msg ${m.type==='report'?'report':m.type}`}>
              {m.type==='user' && <div className="msg-label">you</div>}
              {(m.type==='ai'||m.type==='report') && (
                <div className="msg-label" style={{color: def.color+'99'}}>{def.label} AI</div>
              )}
              <div className="bubble">{m.text}</div>
              {m.type==='report' && (
                <button className="inline-export" onClick={() => downloadReport(m.text, target)}>⬇ Export</button>
              )}
            </div>
          ))}
          {panel.loading && (
            <div className="msg ai">
              <div className="msg-label" style={{color: def.color+'99'}}>{def.label} AI</div>
              <div className="bubble"><div className="typing"><span/><span/><span/></div></div>
            </div>
          )}
          <div ref={bottomRef}/>
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
                style={{color: term.outputs[t]?'#00ff41':'#666', borderColor: term.outputs[t]?'#00ff4144':'#333'}}
                onClick={() => term.run(t, target, (tool) => panel.add('system', `✅ ${tool} complete`))}
                disabled={term.running}
              >
                {term.outputs[t]?'✓':'▶'} {t}
              </button>
            ))}
            <span className="term-status">
              {term.running ? `⏳ ${term.activeTool}...` : target || 'no target'}
            </span>
            {Object.keys(term.outputs).length > 0 && (
              <button className="send-btn" style={{marginLeft:'auto'}} onClick={sendAllToReport}>→ Report</button>
            )}
          </div>
          <div className="term-output">
            {term.lines.map((l, i) => (
              <div key={i} style={{color: l.startsWith('[!]')?'#ff6666':l.startsWith('[+]')?'#00ff41':l.startsWith('[*]')?'#ffaa00':'#666'}}>
                {l}
              </div>
            ))}
            {term.running && <div style={{color:'#00ff41'}}>▋</div>}
            <div ref={termBottomRef}/>
          </div>
          <div className="term-input-row">
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="target domain (e.g. example.com)"
              className="term-target-input"
            />
          </div>
        </div>
      )}
    </div>
  )
})
