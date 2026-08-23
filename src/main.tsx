import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentRunResponse, Payment, ServiceSummary } from '../shared/types.js';
import { BUDGET, NETWORK_LABEL, SERVICE_DEFINITIONS } from '../shared/services.js';
import { errorToMessage, explorerTxUrl, formatUsdcAmount, shortenSignature } from '../shared/utils.js';
import './styles.css';
import './interaction.css';
import './hologram.css';

const defaultPrompt = 'Find the best Malaysian solar supplier under RM50,000 and evaluate its ESG profile.';

// A crashed API or a proxy can answer with HTML, so the body is only parsed after it is known to be JSON.
async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  try { return JSON.parse(body); }
  catch { throw new Error(`The AgentPay API returned a non-JSON response (HTTP ${response.status}).`); }
}
function App() {
  const [prompt, setPrompt] = useState(defaultPrompt), [services, setServices] = useState<ServiceSummary[]>([]), [demo, setDemo] = useState(true);
  const [run, setRun] = useState<AgentRunResponse | null>(null), [ledger, setLedger] = useState<Payment[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [apiStatus, setApiStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  async function loadConfig() {
    setApiStatus('loading'); setError('');
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`The AgentPay API returned HTTP ${response.status}.`);
      const c = await readJson(response) as { services?: ServiceSummary[]; demoMode?: boolean };
      if (!Array.isArray(c.services)) throw new Error('The AgentPay API returned a configuration without any services.');
      setServices(c.services); setDemo(c.demoMode !== false); setApiStatus('ready');
    } catch (e) {
      // The underlying failure is kept in the console: the banner only carries the recovery instruction.
      console.error('[config] load failed:', e);
      setApiStatus('error');
      setError(`${errorToMessage(e, 'The AgentPay API is unreachable.')} Run npm run dev from the project folder, then select Retry connection.`);
    }
  }
  useEffect(() => { void loadConfig(); }, []);
  const total = run?.spent || 0, remaining = BUDGET - total;
  const allLedger = useMemo(() => run?.payments || ledger, [run, ledger]);
  async function start() {
    if (apiStatus !== 'ready') { void loadConfig(); return; }
    setLoading(true); setError(''); setRun(null);
    try {
      const response = await fetch('/api/agent/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const data = await readJson(response) as Partial<AgentRunResponse> & { error?: string };
      if (!response.ok) throw new Error(data.error || `Agent run failed (HTTP ${response.status}).`);
      if (!Array.isArray(data.activities) || !Array.isArray(data.payments) || !data.result) throw new Error('The agent run returned an incomplete result.');
      setRun(data as AgentRunResponse); setLedger(data.payments);
    } catch (e) {
      console.error('[agent/run] failed:', e);
      setError(errorToMessage(e, 'Agent run failed.'));
    } finally { setLoading(false); }
  }
  return <><div className="space" aria-hidden="true"><div className="holo-grid"/><div className="holo-core"><span/><span/><span/></div><span className="star s1"/><span className="star s2"/><span className="star s3"/><span className="star s4"/><span className="star s5"/><span className="star s6"/><span className="star s7"/><span className="star s8"/></div><main>
    <header><div><span className="logo">A</span><div><h1>AgentPay <em>SEA</em></h1><p>Autonomous AI Commerce</p></div></div><div className="header-badges"><span className="pill">● Solana {NETWORK_LABEL}</span>{demo && <span className="pill demo">Demo data</span>}</div></header>
    <section className="hero"><div><span className="eyebrow">AGENT WORKSPACE</span><h2>Give AI agents a wallet.<br/><span>Let them buy what they need.</span></h2><p>Each capability is unlocked by a 402 payment and settled independently.</p></div><div className="wallet"><small>AGENT WALLET</small><strong>${formatUsdcAmount(BUDGET)} <i>USDC</i></strong><div><span>Budget <b>${formatUsdcAmount(BUDGET)}</b></span><span>Spent <b>${formatUsdcAmount(total)}</b></span><span>Remaining <b className="green">${formatUsdcAmount(remaining)}</b></span></div></div></section>
    <section className="console"><div className="section-title"><div><span className="eyebrow">AGENT CONSOLE</span><h3>What should the agent do?</h3></div><span className="guardrail">AUTO-APPROVE ≤ $0.010</span></div><label className="sr-only" htmlFor="agent-task">Agent task</label><textarea id="agent-task" value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="Agent task"/>
      <button onClick={() => void start()} disabled={loading || apiStatus === 'loading'} aria-busy={loading}>{loading ? 'RUNNING AGENT…' : apiStatus === 'loading' ? 'CONNECTING TO API…' : 'START AGENT'} <span>→</span></button>
      {error && <div className="error" role="alert"><span>{error}</span>{apiStatus === 'error' && <button className="retry" onClick={() => void loadConfig()}>Retry connection</button>}</div>}
    </section>
    <div className="grid">
      <section className="panel activity"><div className="section-title"><div><span className="eyebrow">LIVE TRACE</span><h3>Agent Activity</h3></div>{loading && <span className="running">● LIVE</span>}</div>
        {!run && !loading && <div className="empty">Start a task to inspect the 402 → payment → unlock flow.</div>}
        {run?.activities.map((a, i) => <div className={`event ${a.tone}`} key={i}><span className="dot"/><div><b>{a.label}</b>{a.detail && <p>{a.signature ? <a href={explorerTxUrl(a.signature)} target="_blank">{shortenSignature(a.detail)}</a> : a.detail}</p>}</div></div>)}
      </section>
      <section className="panel"><span className="eyebrow">MARKETPLACE</span><h3>Paid capabilities</h3><div className="services">{services.map(s => <article key={s.id}><div><b>{s.name}</b><p>{s.description}</p></div><strong>${formatUsdcAmount(s.price)}<small>/request</small></strong><footer>x402 / USDC <span>Solana</span></footer></article>)}</div></section>
    </div>
    <section className="panel ledger"><div className="section-title"><div><span className="eyebrow">SETTLEMENT</span><h3>Payment Ledger</h3></div><span>{allLedger.length} transactions</span></div>{allLedger.length ? <table><thead><tr><th>TIME</th><th>SERVICE</th><th>AMOUNT</th><th>STATUS</th><th>SOLANA TRANSACTION</th></tr></thead><tbody>{allLedger.map(p => <tr key={p.id}><td>{new Date(p.createdAt).toLocaleTimeString()}</td><td>{SERVICE_DEFINITIONS[p.service].name}</td><td>${formatUsdcAmount(p.amount)} USDC</td><td><span className={p.status === 'confirmed' ? 'status confirmed' : 'status'}>{p.status === 'confirmed' ? 'Confirmed' : 'Demo receipt'}</span></td><td>{p.signature ? <a href={explorerTxUrl(p.signature)} target="_blank">{shortenSignature(p.signature)} ↗</a> : <span className="muted">Transaction unavailable</span>}</td></tr>)}</tbody></table> : <div className="empty">No payments yet.</div>}</section>
    {run && <section className="result"><span className="eyebrow">TASK COMPLETE · SYNTHETIC DATA</span><h2>Recommended supplier</h2><h3>{run.result.supplier}</h3><div className="metrics"><Metric label="PROJECT COST" value={`RM${run.result.cost.toLocaleString()}`}/><Metric label="RATING" value={`${run.result.rating}/5`}/><Metric label="VERIFICATION" value={run.result.verification}/><Metric label="ESG SCORE" value={`${run.result.esg}/100`}/><Metric label="RENEWABLE" value={`${run.result.renewable}%`}/><Metric label="TOTAL SPENT" value={`$${formatUsdcAmount(run.spent)}`}/></div></section>}
  </main></>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
createRoot(document.getElementById('root')!).render(<App />);
