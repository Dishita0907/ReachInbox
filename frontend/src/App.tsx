import ScheduleForm from "./ScheduleForm";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, CalendarClock, Check, CheckCircle2, ChevronRight,
  Clock3, ExternalLink, Inbox, LayoutDashboard, Link2, LoaderCircle,
  Mail, Menu, Plus, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, X, XCircle, Zap
} from "lucide-react";

type Section = "overview" | "emails" | "schedule" | "integrations";
type EmailStatus = "all" | "scheduled" | "processing" | "sent" | "failed";
type User = { id: string; email: string; display_name?: string; avatar_url?: string };
type Email = {
  id: string;
  recipientEmail: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
};
type MeResponse = { status: string; user?: User };
type SearchResponse = { status: string; count: number; emails: Email[] };
type SlackResponse = { connected: boolean; workspace?: string | null; channel?: string | null };

const slackUrl = "http://localhost:4000/auth/slack/start";
const boardUrl = "http://localhost:4001/admin/queues";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
  });
}

function StatusPill({ status }: { status: string }) {
  const variant = status.toLowerCase();
  return <span className={`status status-${variant}`}><span className="status-dot" />{status}</span>;
}

const navItems = [
  { key: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { key: "emails" as const, label: "Email history", icon: Mail },
  { key: "schedule" as const, label: "Schedule email", icon: CalendarClock },
  { key: "integrations" as const, label: "Integrations", icon: Link2 }
];

function Logo() {
  return <div className="brand"><div className="brand-symbol"><Mail size={23} strokeWidth={2.1} /></div>
    <span>reach<span className="brand-accent">inbox</span></span></div>;
}

function EmptyState({ message, detail }: { message: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={24} /></div>
    <strong>{message}</strong><span>{detail}</span></div>;
}

function EmailTable({ emails, loading }: { emails: Email[]; loading: boolean }) {
  if (loading && !emails.length) return <div className="loading-state"><LoaderCircle size={23} className="spin" /> Loading your emails...</div>;
  if (!emails.length) return <EmptyState message="No emails found" detail="Try another search or schedule your first email." />;
  return <div className="table-scroll"><table className="emails-table">
    <thead><tr><th>EMAIL</th><th>RECIPIENT</th><th>STATUS</th><th>SCHEDULED</th><th>SENT</th></tr></thead>
    <tbody>{emails.map(email => <tr key={email.id}>
      <td><div className="email-subject">{email.subject}</div><div className="email-id">{email.id.slice(0, 8)}…</div></td>
      <td className="muted-cell">{email.recipientEmail}</td>
      <td><StatusPill status={email.status} /></td>
      <td className="muted-cell">{dateText(email.scheduledAt)}</td>
      <td className="muted-cell">{dateText(email.sentAt)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function StatCard({ icon: Icon, label, number, detail, tone }: {
  icon: typeof Mail; label: string; number: number; detail: string; tone: string;
}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={19}/></span></div>
    <div className="stat-number">{number}</div><span className="stat-detail">{detail}</span></div>;
}

export default function App() {
  const [section, setSection] = useState<Section>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");
  const [slack, setSlack] = useState<SlackResponse | null>(null);
  const [slackError, setSlackError] = useState("");
  const [emails, setEmails] = useState<Email[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EmailStatus>("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadProfile = useCallback(async () => {
    setCheckingAuth(true);
    setAuthError("");
    try {
      const data = await getJson<MeResponse>("/api/me");
      setUser(data.user ?? null);
    } catch (error) {
      setUser(null);
      if (!(error instanceof Error && error.message.includes("401"))) {
        setAuthError("Cannot reach the ReachInbox backend. Make sure it is running on port 4000.");
      }
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  const loadSlack = useCallback(async () => {
    try {
      const data = await getJson<SlackResponse>("/auth/slack/status");
      setSlack(data);
      setSlackError("");
    } catch {
      setSlackError("Slack connection status unavailable.");
    }
  }, []);

  const loadEmails = useCallback(async () => {
    if (!user) return;
    setLoadingEmails(true);
    setEmailError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      const data = await getJson<SearchResponse>(`/api/emails/search?${params.toString()}`);
      setEmails(data.emails ?? []);
      setLastRefresh(new Date());
    } catch {
      setEmailError("Couldn't load emails. Check that the backend and Elasticsearch are running.");
    } finally {
      setLoadingEmails(false);
    }
  }, [user, query, status]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => { if (user) void loadSlack(); }, [user, loadSlack]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => { void loadEmails(); }, query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [user, loadEmails, query]);

  const counts = useMemo(() => ({
    total: emails.length,
    sent: emails.filter(e => e.status === "sent").length,
    scheduled: emails.filter(e => e.status === "scheduled").length,
    failed: emails.filter(e => e.status === "failed").length
  }), [emails]);
  const displayName = user?.display_name?.split(" ")[0] || user?.email?.split("@")[0] || "there";
  const currentTitle = navItems.find(item => item.key === section)?.label ?? "Overview";

  if (checkingAuth) return <div className="auth-screen"><div className="auth-card"><Logo/><LoaderCircle className="spin" size={28} /><p>Connecting to your workspace…</p></div></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card auth-card-wide"><Logo/>
    <div className="auth-glow"><Sparkles size={34}/></div>
    <span className="eyebrow">YOUR EMAIL COMMAND CENTER</span>
    <h1>Make every send<br/><em>feel effortless.</em></h1>
    <p>Schedule, search and monitor your email workflows in one beautiful workspace.</p>
    {authError && <div className="inline-error">{authError}</div>}
    <a className="button primary-button wide-button" href="http://localhost:4000/auth/google">Continue with Google <ArrowRight size={18}/></a>
    <p className="hint">After signing in, return to <strong>http://localhost:5173</strong>.</p>
  </div></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "sidebar-visible" : ""}`}>
      <div className="side-header"><Logo/><button aria-label="Close navigation" className="icon-button mobile-close" onClick={() => setSidebarOpen(false)}><X size={20}/></button></div>
      <div className="side-workspace"><div className="workspace-avatar">R</div><div><strong>My Workspace</strong><small>Personal workspace</small></div><ChevronRight size={16}/></div>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{navItems.map(item => <button key={item.key} className={`nav-link ${section === item.key ? "nav-active" : ""}`} onClick={() => { setSection(item.key); setSidebarOpen(false); }}>
        <item.icon size={19} strokeWidth={1.9}/><span>{item.label}</span>{section === item.key && <span className="nav-indicator"/>}
      </button>)}</nav>
      <div className="side-label side-label-tools">TOOLS</div>
      <a className="nav-link tool-link" href={boardUrl} target="_blank" rel="noreferrer"><Activity size={19}/>Queue monitor<ExternalLink size={14} className="ml-auto"/></a>
      <div className="side-bottom"><div className="side-bottom-icon"><Zap size={18}/></div><strong>Automate with confidence</strong><p>Your email workflow, streamlined from start to finish.</p></div>
      <div className="side-footer"><span className="online-indicator"/> Local development <span className="version">v1.0</span></div>
    </aside>
    {sidebarOpen && <button className="backdrop" aria-label="Close menu" onClick={() => setSidebarOpen(false)}/>}
    <div className="main-area">
      <header className="topbar"><div className="topbar-left"><button aria-label="Open navigation" className="icon-button menu-btn" onClick={() => setSidebarOpen(true)}><Menu size={22}/></button><span>Workspace</span><ChevronRight size={15}/><strong>{currentTitle}</strong></div>
        <div className="topbar-right"><span className="api-live"><span/> API connected</span><div className="profile"><div className="profile-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="Profile"/> : displayName.charAt(0).toUpperCase()}</div><div className="profile-name"><strong>{user.display_name || user.email}</strong><small>Workspace owner</small></div></div></div>
      </header>
      <main className="content">
        {section === "overview" && <>
          <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> EMAIL COMMAND CENTER</div><h1>Good to see you, {displayName}<span className="wave">✳</span></h1><p>Here's what's happening across your email workflows.</p></div><button className="button primary-button" onClick={() => setSection("schedule")}><Plus size={18}/> Schedule email</button></div>
          <div className="hero-banner"><div className="hero-content"><span className="hero-tag"><Sparkles size={14}/> WORK SMARTER</span><h2>Every message.<br/>Right on time.</h2><p>Plan ahead, stay organized, and keep your outreach moving effortlessly.</p><button onClick={() => setSection("schedule")} className="hero-cta">Create a schedule <ArrowRight size={17}/></button></div><div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-a"/><div className="hero-orbit orbit-b"/><div className="hero-mail"><Mail size={55} strokeWidth={1.3}/></div><div className="hero-bubble"><Check size={16}/></div><div className="hero-spark one">✦</div><div className="hero-spark two">✧</div></div></div>
          <div className="section-heading"><div><h2>At a glance</h2><p>Based on the currently loaded search results</p></div><button className="subtle-button" onClick={() => void loadEmails()}><RefreshCw size={16} className={loadingEmails ? "spin" : ""}/> Refresh</button></div>
          <div className="stats-grid"><StatCard icon={Inbox} label="Loaded emails" number={counts.total} detail="Up to 25 indexed results" tone="purple"/><StatCard icon={CheckCircle2} label="Sent" number={counts.sent} detail="In loaded results" tone="green"/><StatCard icon={Clock3} label="Scheduled" number={counts.scheduled} detail="In loaded results" tone="amber"/><StatCard icon={XCircle} label="Failed" number={counts.failed} detail="In loaded results" tone="red"/></div>
          <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><h2>Recent email activity</h2><p>Your latest indexed messages</p></div><button className="text-action" onClick={() => setSection("emails")}>View all <ArrowRight size={15}/></button></div>{emailError && <div className="inline-error">{emailError}</div>}{emails.slice(0,5).length ? <div className="activity-list">{emails.slice(0,5).map(email => <div className="activity-item" key={email.id}><span className="activity-icon"><Mail size={18}/></span><div className="activity-details"><strong>{email.subject}</strong><small>To {email.recipientEmail}</small></div><StatusPill status={email.status}/></div>)}</div> : <EmptyState message="No indexed emails yet" detail="Schedule or sync emails to see them here."/>}</section>
          <section className="panel connections-panel"><div className="panel-heading"><div><h2>Connected services</h2><p>Your workflow integrations</p></div></div><div className="integration-mini"><span className="integration-mini-icon green"><ShieldCheck size={20}/></span><div><strong>Google account</strong><small>Signed in and authenticated</small></div><span className="mini-check"><Check size={15}/></span></div><div className="integration-mini"><span className="integration-mini-icon purple"><Link2 size={20}/></span><div><strong>Slack notifications</strong><small>{slack?.connected ? `${slack.workspace} • ${slack.channel}` : "Connect your workspace"}</small></div><span className={`mini-check ${slack?.connected ? "" : "mini-unlinked"}`}>{slack?.connected ? <Check size={15}/> : <ChevronRight size={15}/>}</span></div><div className="integration-mini"><span className="integration-mini-icon blue"><Search size={20}/></span><div><strong>Elasticsearch</strong><small>Search endpoint connected</small></div><span className="mini-check"><Check size={15}/></span></div><button className="integration-footer" onClick={() => setSection("integrations")}>Manage integrations <ArrowRight size={16}/></button></section></div>
        </>}
        {section === "emails" && <><div className="page-heading"><div className="eyebrow">YOUR EMAILS</div><h1>Email history</h1><p>Find messages by keyword, recipient or delivery status.</p></div><section className="panel email-panel"><div className="search-controls"><label className="search-field"><Search size={18}/><input aria-label="Search emails" placeholder="Search subject, message or recipient..." value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16}/></button>}</label><label className="filter-control"><SlidersHorizontal size={17}/><select aria-label="Filter by status" value={status} onChange={e=>setStatus(e.target.value as EmailStatus)}><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="processing">Processing</option><option value="sent">Sent</option><option value="failed">Failed</option></select></label><button className="icon-button refresh-button" onClick={() => void loadEmails()} title="Refresh"><RefreshCw size={18} className={loadingEmails ? "spin" : ""}/></button></div><div className="results-header"><strong>{emails.length} {emails.length === 1 ? "email" : "emails"} shown</strong><span>{lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "Not refreshed"}</span></div>{emailError && <div className="inline-error">{emailError}</div>}<EmailTable emails={emails} loading={loadingEmails}/><div className="table-footer">Showing up to 25 matching records from your Elasticsearch index. Data may need resyncing after new sends.</div></section></>}
        {section === "schedule" && <>
          <div className="page-heading"><div className="eyebrow">PLAN AHEAD</div><h1>Schedule an email</h1><p>Compose and schedule a message directly from ReachInbox.</p></div>
          <ScheduleForm onCreated={loadEmails} />
        </>}
        {section === "integrations" && <><div className="page-heading"><div className="eyebrow">CONNECTED WORKSPACE</div><h1>Integrations</h1><p>Manage the services that power your outreach.</p></div><div className="integrations-grid"><section className="panel service-card"><span className="service-icon purple"><Link2 size={26}/></span><div className="service-copy"><h2>Slack notifications</h2><p>Send workflow alerts to a channel in your Slack workspace.</p></div><div className="service-details"><span>Connection</span><strong>{slack?.connected ? "Connected" : "Not connected"}</strong></div>{slack?.connected && <div className="service-details"><span>Destination</span><strong>{slack.channel || "Unknown channel"}</strong></div>}{slackError && <div className="inline-error">{slackError}</div>}<a href={slackUrl} className="button outline-button" target="_blank" rel="noreferrer">{slack?.connected ? "Reconnect Slack" : "Connect Slack"} <ExternalLink size={16}/></a><button className="subtle-button service-refresh" onClick={() => void loadSlack()}><RefreshCw size={15}/> Refresh connection</button></section><section className="panel service-card"><span className="service-icon blue"><Search size={26}/></span><div className="service-copy"><h2>Elasticsearch</h2><p>Fast full-text searching and delivery status filtering.</p></div><div className="service-details"><span>Endpoint</span><strong>/api/emails/search</strong></div><div className="service-details"><span>Search mode</span><strong>Authenticated</strong></div><button className="button outline-button" onClick={() => setSection("emails")}>Explore indexed emails <ArrowRight size={16}/></button></section><section className="panel service-card"><span className="service-icon green"><ShieldCheck size={26}/></span><div className="service-copy"><h2>Google authentication</h2><p>Your ReachInbox account is protected by Google login.</p></div><div className="service-details"><span>Signed in as</span><strong>{user.email}</strong></div><div className="service-details"><span>Status</span><strong>Authenticated</strong></div><span className="service-connected"><CheckCircle2 size={17}/> Account linked</span></section><section className="panel service-card"><span className="service-icon amber"><Activity size={26}/></span><div className="service-copy"><h2>BullMQ monitor</h2><p>Inspect queued, delayed, completed and failed background jobs.</p></div><div className="service-details"><span>Dashboard</span><strong>Port 4001</strong></div><a href={boardUrl} target="_blank" rel="noreferrer" className="button outline-button">Open Bull Board <ExternalLink size={16}/></a></section></div></>}
        <footer className="page-footer"><span><span className="online-indicator"/> ReachInbox · Development workspace</span><span>Built for better sending <span aria-hidden="true">✦</span></span></footer>
      </main>
    </div>
  </div>;
}
