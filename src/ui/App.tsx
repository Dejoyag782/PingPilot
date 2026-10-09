import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, ExternalLink, Globe2, History, LogOut, Plus, RefreshCw, ShieldCheck, Trash2, Zap } from "lucide-react";

type Target = { id:string; name:string; url:string; interval_minutes:number; enabled:number; next_run_at:string; last_run_at:string|null; last_status:number|null; last_duration_ms:number|null; last_error:string|null; created_at:string };
type Log = { id:string; target_id:string; target_name:string; target_url:string; requested_at:string; finished_at:string; status_code:number|null; duration_ms:number; success:number; error:string|null };
const intervals = [{value:1,label:"Every minute"},{value:5,label:"Every 5 minutes"},{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"}];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api<T = any>(path:string, options:RequestInit={}): Promise<T> {
  const res = await fetch(path,{...options,credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})}});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(()=>({}));
  if(res.status===401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("pp:unauthorized"));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function date(value:string|null|undefined) { if(!value) return "Never"; return new Date(value).toLocaleString(); }
function duration(ms:number|null|undefined) { return ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms/1000).toFixed(2)} s`; }
function Status({ok}:{ok:boolean}) { return <span className={`status ${ok?"status-ok":"status-bad"}`}><i/>{ok?"Operational":"Issue detected"}</span>; }

export default function App() {
  const [authenticated,setAuthenticated] = useState<boolean|null>(null);
  const [username,setUsername] = useState("");
  const [password,setPassword] = useState("");
  const [loginError,setLoginError] = useState("");
  const [targets,setTargets] = useState<Target[]>([]);
  const [logs,setLogs] = useState<Log[]>([]);
  const [stats,setStats] = useState({total:0,active:0,failing:0});
  const [tab,setTab] = useState<"overview"|"targets"|"history">("overview");
  const [modal,setModal] = useState(false);
  const [name,setName] = useState("");
  const [targetUrl,setTargetUrl] = useState("");
  const [interval,setInterval] = useState(5);
  const [formError,setFormError] = useState("");
  const [busy,setBusy] = useState(false);
  const [toast,setToast] = useState("");
  const [filter,setFilter] = useState("all");

  async function refresh() {
    const [t,d,l] = await Promise.all([api("/api/targets"),api("/api/dashboard"),api("/api/logs?limit=100")]);
    setTargets(t.targets); setStats(d.totals); setLogs(l.logs);
  }
  useEffect(()=>{ const onUnauth=()=>{ setAuthenticated(false); setLoginError("Your session expired or was not saved. Please sign in again."); }; window.addEventListener("pp:unauthorized",onUnauth); return ()=>window.removeEventListener("pp:unauthorized",onUnauth); },[]);
  useEffect(()=>{ api("/api/auth/me").then(()=>setAuthenticated(true)).catch(()=>setAuthenticated(false)); },[]);
  useEffect(()=>{ if(authenticated){ refresh().catch(e=>setToast(e.message)); } },[authenticated]);
  const filteredLogs = useMemo(()=>filter==="all"?logs:logs.filter(l=>String(l.target_id)===filter),[logs,filter]);

  async function login(e:React.FormEvent) {
    e.preventDefault(); setLoginError("");
    try {
      await api("/api/auth/login",{method:"POST",body:JSON.stringify({username,password})});
      // Confirm the browser kept the session cookie; some mobile/in-app browsers silently drop it.
      try { await api("/api/auth/me"); }
      catch { setLoginError("Signed in, but this browser blocked the session cookie. Allow cookies for this site or open it in Chrome/Safari (not an in-app browser)."); return; }
      setAuthenticated(true); setPassword("");
    }
    catch(e){setLoginError(e instanceof Error?e.message:"Login failed");}
  }
  async function logout() { await api("/api/auth/logout",{method:"POST",body:"{}"}); setAuthenticated(false); setTargets([]); setLogs([]); }
  async function addTarget(e:React.FormEvent) {
    e.preventDefault(); setFormError(""); setBusy(true);
    try { await api("/api/targets",{method:"POST",body:JSON.stringify({name,url:targetUrl,interval_minutes:interval})}); setModal(false); setName(""); setTargetUrl(""); setInterval(5); await refresh(); setToast("URL added to your monitor."); }
    catch(e){setFormError(e instanceof Error?e.message:"Could not add URL");} finally{setBusy(false);}
  }
  async function toggle(t:Target) { try { await api(`/api/targets/${t.id}`,{method:"PATCH",body:JSON.stringify({enabled:!t.enabled})}); await refresh(); } catch(e){setToast(e instanceof Error?e.message:"Update failed");} }
  async function runNow(t:Target) { setToast(`Pinging ${t.name}…`); try { const r=await api(`/api/targets/${t.id}/run`,{method:"POST",body:"{}"}); await refresh(); setToast(r.ok?`${t.name} responded (${r.status_code}).`:`${t.name} returned an error.`); } catch(e){setToast(e instanceof Error?e.message:"Ping failed");} }
  async function remove(t:Target) { if(!confirm(`Delete "${t.name}" and its monitoring configuration? Existing history is retained for up to 7 days.`)) return; try{await api(`/api/targets/${t.id}`,{method:"DELETE"}); await refresh();setToast("Monitor deleted.");}catch(e){setToast(e instanceof Error?e.message:"Delete failed");} }

  if(authenticated===null) return <div className="loading-screen"><div className="brand-mark"><Activity/></div><p>Preparing your dashboard…</p></div>;
  if(!authenticated) return <main className="login-shell">
    <section className="login-art"><div className="brand"><div className="brand-mark"><Activity size={22}/></div><span>PingPilot</span></div><div className="art-copy"><span className="eyebrow">YOUR URL OPERATIONS CENTER</span><h1>Know when your<br/><em>services are up.</em></h1><p>Reliable scheduled checks for the endpoints that matter to you.</p><div className="art-orbit"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit-core"><Activity size={38}/></div><span className="orbit-dot dot-a"/><span className="orbit-dot dot-b"/><span className="orbit-dot dot-c"/></div></div><div className="login-foot">PRIVATE MONITORING · BUILT ON CLOUDFLARE</div></section>
    <section className="login-panel"><form className="login-form" onSubmit={login}><div className="mobile-brand"><div className="brand-mark"><Activity/></div><b>PingPilot</b></div><div className="login-icon"><ShieldCheck/></div><h2>Welcome back</h2><p className="subtle">Sign in to manage your URL monitors.</p><label>Admin username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={40} placeholder="Your username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} placeholder="Your password"/></label>{loginError&&<div className="error-box">{loginError}</div>}<button className="btn btn-primary btn-wide" type="submit">Sign in <ArrowUpRight size={17}/></button><div className="secure-note"><ShieldCheck size={15}/> Protected administrator access</div></form><span className="copyright">PINGPILOT · URL MONITORING</span></section>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Activity size={21}/></div><span>PingPilot</span><span className="brand-beta">ADMIN</span></div><div className="side-label">WORKSPACE</div><nav>
      <button className={tab==="overview"?"nav-item active":"nav-item"} onClick={()=>setTab("overview")}><Activity size={18}/>Overview</button>
      <button className={tab==="targets"?"nav-item active":"nav-item"} onClick={()=>setTab("targets")}><Globe2 size={18}/>URL monitors <span className="nav-count">{targets.length}</span></button>
      <button className={tab==="history"?"nav-item active":"nav-item"} onClick={()=>setTab("history")}><History size={18}/>Ping history</button>
    </nav><div className="sidebar-bottom"><div className="side-health"><span className="pulse-dot"/><div><b>Scheduler enabled</b><small>Checks run every minute</small></div></div><button className="nav-item logout" onClick={logout}><LogOut size={17}/>Sign out</button><div className="version">PINGPILOT V1.0.0</div></div></aside>
    <main className="main-area"><header className="topbar"><div><div className="breadcrumb">Workspace <span>/</span> {tab==="overview"?"Overview":tab==="targets"?"URL monitors":"Ping history"}</div><h1>{tab==="overview"?"Monitoring overview":tab==="targets"?"URL monitors":"Ping history"}</h1></div><div className="top-actions"><div className="live-label"><span className="pulse-dot"/> Live system</div><button className="icon-button" title="Refresh dashboard" onClick={()=>refresh().catch(e=>setToast(e.message))}><RefreshCw size={17}/></button><button className="btn btn-primary" onClick={()=>{setModal(true);setFormError("");}}><Plus size={17}/> Add URL</button></div></header>
    {tab==="overview"&&<><section className="welcome-row"><div><span className="eyebrow blue">MONITORING AT A GLANCE</span><h2>Your endpoints, <span>under watch.</span></h2><p className="subtle">A real-time view of your scheduled GET checks and service health.</p></div><div className="refresh-note"><Clock3 size={15}/> Scheduler checks every minute</div></section><section className="stats-grid">
      <Stat icon={<Globe2/>} label="Total monitors" value={stats.total} note="Configured endpoints" tone="blue"/>
      <Stat icon={<Zap/>} label="Active monitors" value={stats.active} note="Scheduled for checks" tone="green"/>
      <Stat icon={<Activity/>} label="Currently failing" value={stats.failing} note="Based on latest check" tone="red"/>
      <Stat icon={<History/>} label="Checks recorded" value={logs.length} note="Recent 7-day history" tone="violet"/>
    </section><section className="content-grid"><div className="panel"><div className="panel-head"><div><h3>Monitored endpoints</h3><p>Latest known status for each URL</p></div><button className="text-button" onClick={()=>setTab("targets")}>View all <ArrowDownRight size={15}/></button></div>{targets.length===0?<Empty title="No URLs monitored yet" text="Add your first endpoint to start scheduling GET checks." action={()=>setModal(true)}/>:<div className="target-list">{targets.slice(0,5).map(t=><TargetRow key={t.id} t={t} runNow={runNow} toggle={toggle} remove={remove}/>)}</div>}</div><div className="panel activity-panel"><div className="panel-head"><div><h3>Recent activity</h3><p>Latest ping executions</p></div><button className="icon-button small" onClick={()=>refresh()}><RefreshCw size={15}/></button></div>{logs.length===0?<Empty title="No activity yet" text="Ping results will appear here."/>:<div className="activity-list">{logs.slice(0,7).map(l=><div className="activity-item" key={l.id}><span className={`activity-icon ${l.success?"good":"bad"}`}>{l.success?<ArrowUpRight size={15}/>:<ArrowDownRight size={15}/>}</span><div className="activity-main"><b>{l.target_name}</b><span>{l.status_code?`HTTP ${l.status_code}`:l.error||"Request failed"} · {duration(l.duration_ms)}</span></div><time>{new Date(l.requested_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></div>)}</div>}</div></section></>}
    {tab==="targets"&&<section className="panel full-panel"><div className="panel-head"><div><h3>All URL monitors</h3><p>Configure your endpoints and check cadence.</p></div><button className="btn btn-primary" onClick={()=>setModal(true)}><Plus size={16}/> Add URL</button></div>{targets.length===0?<Empty title="Nothing here yet" text="Add an HTTP or HTTPS URL to start monitoring." action={()=>setModal(true)}/>:<div className="table-wrap"><table><thead><tr><th>ENDPOINT</th><th>STATUS</th><th>INTERVAL</th><th>LAST CHECK</th><th>LATENCY</th><th>ACTIONS</th></tr></thead><tbody>{targets.map(t=><tr key={t.id}><td><div className="endpoint-cell"><span className="endpoint-favicon"><Globe2 size={16}/></span><div><b>{t.name}</b><a href={t.url} target="_blank" rel="noreferrer">{t.url} <ExternalLink size={11}/></a></div></div></td><td>{t.last_run_at?<Status ok={!!t.last_status&&t.last_status>=200&&t.last_status<400&&!t.last_error}/>:<span className="status status-pending"><i/>Awaiting check</span>}</td><td><span className="interval-chip"><Clock3 size={13}/>{intervals.find(i=>i.value===t.interval_minutes)?.label}</span></td><td className="muted-cell">{date(t.last_run_at)}</td><td className="latency">{duration(t.last_duration_ms)}</td><td><div className="row-actions"><button className="icon-button small" title="Ping now" onClick={()=>runNow(t)}><Zap size={15}/></button><button className="icon-button small" title={t.enabled?"Pause monitor":"Enable monitor"} onClick={()=>toggle(t)}>{t.enabled?<span className="pause-icon">Ⅱ</span>:<ArrowUpRight size={15}/>}</button><button className="icon-button small danger-hover" title="Delete monitor" onClick={()=>remove(t)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>}</section>}
    {tab==="history"&&<section className="panel full-panel"><div className="panel-head"><div><h3>Execution history</h3><p>Results are automatically retained for 7 days.</p></div><select className="filter-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All endpoints</option>{targets.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></div>{filteredLogs.length===0?<Empty title="No ping records" text="Your scheduled and manual checks will appear here."/>:<div className="table-wrap"><table><thead><tr><th>ENDPOINT</th><th>RESULT</th><th>HTTP</th><th>RESPONSE TIME</th><th>REQUESTED AT</th></tr></thead><tbody>{filteredLogs.map(l=><tr key={l.id}><td><div className="endpoint-cell"><span className={`mini-dot ${l.success?"green-dot":"red-dot"}`}/><div><b>{l.target_name}</b><span className="url-sub">{l.target_url}</span></div></div></td><td><Status ok={!!l.success}/></td><td><span className={`http-code ${l.success?"http-good":"http-bad"}`}>{l.status_code??"ERR"}</span>{l.error&&<div className="error-inline">{l.error}</div>}</td><td className="latency">{duration(l.duration_ms)}</td><td className="muted-cell">{date(l.requested_at)}</td></tr>)}</tbody></table></div>}</section>}
    <footer className="page-footer"><span>© {new Date().getFullYear()} PingPilot</span><span><ShieldCheck size={14}/> Private by design <i/> Cloudflare Workers + D1</span></footer></main>
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false)}}><form className="modal" onSubmit={addTarget}><div className="modal-top"><div className="modal-icon"><Globe2/></div><button type="button" className="icon-button" onClick={()=>setModal(false)}>×</button></div><h2>Add a URL monitor</h2><p className="subtle">PingPilot will send a GET request on your selected schedule.</p><label>Monitor name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={100} placeholder="e.g. GearUp production"/></label><label>Endpoint URL<input type="url" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)} required maxLength={2048} placeholder="https://example.com/health"/></label><label>Check interval<select value={interval} onChange={e=>setInterval(Number(e.target.value))}>{intervals.map(i=><option key={i.value} value={i.value}>{i.label}</option>)}</select></label><div className="notice"><ShieldCheck size={16}/><span>Use only URLs you own or are authorized to check. Each request times out after 10 seconds.</span></div>{formError&&<div className="error-box">{formError}</div>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Adding…":<><Plus size={16}/> Add monitor</>}</button></div></form></div>}
    {toast&&<button className="toast" onClick={()=>setToast("")}>{toast}<span>×</span></button>}
  </div>;
}
function Stat({icon,label,value,note,tone}:{icon:React.ReactNode;label:string;value:number;note:string;tone:string}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong>{value}</strong><small>{note}</small></div>; }
function Empty({title,text,action}:{title:string;text:string;action?:()=>void}) { return <div className="empty-state"><span className="empty-icon"><Globe2 size={22}/></span><b>{title}</b><p>{text}</p>{action&&<button className="btn btn-secondary" onClick={action}><Plus size={15}/> Add first URL</button>}</div>; }
function TargetRow({t,runNow,toggle,remove}:{t:Target;runNow:(t:Target)=>void;toggle:(t:Target)=>void;remove:(t:Target)=>void}) { return <div className="target-row"><span className="target-bullet"><Globe2 size={17}/></span><div className="target-info"><div className="target-name">{t.name}<span className={t.enabled?"enabled-tag":"paused-tag"}>{t.enabled?"ACTIVE":"PAUSED"}</span></div><a href={t.url} target="_blank" rel="noreferrer">{t.url}</a><div className="target-meta"><span><Clock3 size={12}/>{intervals.find(i=>i.value===t.interval_minutes)?.label}</span><span>Last check: {date(t.last_run_at)}</span></div></div><div className="target-status">{t.last_run_at?<Status ok={!!t.last_status&&t.last_status>=200&&t.last_status<400&&!t.last_error}/>:<span className="status status-pending"><i/>Pending</span>}<div className="target-quick"><button onClick={()=>runNow(t)} title="Ping now"><Zap size={14}/></button><button onClick={()=>toggle(t)} title={t.enabled?"Pause":"Enable"}>{t.enabled?"Ⅱ":"▶"}</button><button onClick={()=>remove(t)} title="Delete"><Trash2 size={14}/></button></div></div></div>; }
