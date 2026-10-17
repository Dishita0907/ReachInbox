import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarClock, CheckCircle2, LoaderCircle, Mail, RefreshCw, Send } from "lucide-react";

type Sender = {
  id: string;
  from_email: string;
  display_name: string | null;
};
type SenderResponse = { status: string; senders?: Sender[]; message?: string };
type ScheduleResponse = {
  status?: string;
  message?: string;
  emailId?: string;
  scheduledAt?: string;
  emailStatus?: string;
};

const newKey = () => crypto.randomUUID();

function localDateTime(minutesInFuture = 10): string {
  const time = new Date(Date.now() + minutesInFuture * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

export default function ScheduleForm({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(() => localDateTime());
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [loadingSenders, setLoadingSenders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ScheduleResponse | null>(null);

  async function loadSenders() {
    setLoadingSenders(true);
    try {
      const result = await fetch("/api/senders", { credentials: "include" });
      const data = (await result.json()) as SenderResponse;
      if (!result.ok) throw new Error(data.message || `Cannot load senders (${result.status})`);
      const items = Array.isArray(data.senders) ? data.senders : [];
      setSenders(items);
      setSenderId(current => items.some(item => item.id === current) ? current : (items[0]?.id || ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not fetch sending accounts");
    } finally {
      setLoadingSenders(false);
    }
  }

  useEffect(() => { void loadSenders(); }, []);
  const minScheduleDate = useMemo(() => localDateTime(1), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSuccess(null);
    const scheduleDate = new Date(scheduledLocal);
    if (!senderId) { setError("Please select a sender account."); return; }
    if (!Number.isFinite(scheduleDate.getTime()) || scheduleDate.getTime() <= Date.now()) {
      setError("Choose a future date and time."); return;
    }

    setSubmitting(true);
    try {
      const isoTime = scheduleDate.toISOString();
      const response = await fetch("/api/schedule", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId,
          recipientEmail: recipientEmail.trim(),
          subject: subject.trim(),
          body,
          scheduledAt: isoTime,
          scheduledTime: isoTime,
          idempotencyKey
        })
      });
      const data = (await response.json().catch(() => ({}))) as ScheduleResponse;
      if (!response.ok || data.status === "error") {
        throw new Error(data.message || `Scheduling failed (HTTP ${response.status})`);
      }
      setSuccess(data);
      setIdempotencyKey(newKey());
      setRecipientEmail("");
      setSubject("");
      setBody("");
      setScheduledLocal(localDateTime(10));
      // Search is backed by Elasticsearch; a separate sync may still be needed.
      void Promise.resolve(onCreated()).catch(() => undefined);
    } catch (cause) {
      // Keep idempotency key on failed/ambiguous requests to avoid duplicates on retry.
      setError(cause instanceof Error ? cause.message : "Unable to schedule email");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="panel native-schedule-panel">
    <div className="native-schedule-heading"><div className="native-schedule-logo"><CalendarClock size={26} /></div><div>
      <h2>Compose a scheduled email</h2><p>Choose your sender, write your message and choose a future delivery time.</p>
    </div></div>
    {error && <div role="alert" className="native-form-error">{error}</div>}
    {success && <div role="status" className="native-form-success"><CheckCircle2 size={18}/><span>
      {success.message || "Email scheduled successfully."} {success.emailId ? `Reference: ${success.emailId}` : ""}
    </span></div>}
    <form className="native-schedule-form" onSubmit={handleSubmit}>
      <label>Sender account <span className="required-field">*</span>
        <div className="sender-control"><select required value={senderId} onChange={event => setSenderId(event.target.value)} disabled={loadingSenders || submitting}>
          {!senders.length && <option value="">{loadingSenders ? "Loading senders..." : "No sender accounts available"}</option>}
          {senders.map(sender => <option key={sender.id} value={sender.id}>{sender.display_name ? `${sender.display_name} — ` : ""}{sender.from_email}</option>)}
        </select><button type="button" title="Refresh sender accounts" aria-label="Refresh sender accounts" onClick={() => void loadSenders()}><RefreshCw size={16}/></button></div>
      </label>
      <label>Recipient <span className="required-field">*</span><input type="email" required maxLength={254} placeholder="recipient@example.com" value={recipientEmail} onChange={event => setRecipientEmail(event.target.value)} disabled={submitting}/></label>
      <label>Subject <span className="required-field">*</span><input required maxLength={200} placeholder="Email subject" value={subject} onChange={event => setSubject(event.target.value)} disabled={submitting}/></label>
      <label>Message <span className="required-field">*</span><textarea required maxLength={10000} rows={6} placeholder="Write your message..." value={body} onChange={event => setBody(event.target.value)} disabled={submitting}/></label>
      <label>Schedule for <span className="required-field">*</span><input required type="datetime-local" min={minScheduleDate} value={scheduledLocal} onChange={event => setScheduledLocal(event.target.value)} disabled={submitting}/></label>
      <p className="native-time-note">Times are entered in your computer's local time zone and sent to the API in UTC.</p>
      <button className="button primary-button native-submit" type="submit" disabled={submitting || loadingSenders || !senders.length}>
        {submitting ? <LoaderCircle size={18} className="spin"/> : <Send size={18}/>} {submitting ? "Scheduling…" : "Schedule email"}
      </button>
    </form>
    <div className="native-form-footer"><Mail size={16}/> Email will be queued through the existing PostgreSQL + BullMQ scheduler. Ethereal SMTP is a test service.</div>
  </section>;
}
