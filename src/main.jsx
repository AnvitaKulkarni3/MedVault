import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = "/api";
const sections = [
  ["dashboard", "Overview", "⌂"],
  ["records", "Health records", "▤"],
  ["prescriptions", "Prescriptions", "▧"],
  ["medications", "Medications", "✚"],
  ["dose-logs", "Dose log", "◷"],
  ["appointments", "Appointments", "▦"],
  ["expenses", "Expenses", "＄"],
  ["diet", "Diet planner", "◉"],
  ["notes", "Doctor notes", "✎"],
  ["groceries", "Grocery list", "☷"]
];
const config = {
  records: { title: "Health records", description: "Keep visits, test results, and important health documents together.", fields: [["title", "Record title", "text", true], ["date", "Date", "date"], ["provider", "Provider or clinic", "text"], ["details", "Notes or result details", "textarea"]] },
  medications: { title: "Medications", description: "Track only medicines and schedules you have verified.", fields: [["title", "Medicine name", "text", true], ["strength", "Strength", "text"], ["instructions", "Instructions as prescribed", "text"], ["frequency", "Frequency", "text"], ["stock", "Current stock (units)", "number"], ["refillThreshold", "Refill alert at (units)", "number"], ["reminderEnabled", "Enable reminder", "checkbox"]] },
  appointments: { title: "Appointments", description: "Keep upcoming care visits and follow-ups in view.", fields: [["title", "Appointment", "text", true], ["date", "Date", "date"], ["time", "Time", "time"], ["provider", "Doctor or clinic", "text"], ["location", "Location", "text"], ["recurrence", "Repeat", "select", false, ["Does not repeat", "Daily", "Weekly", "Monthly"]], ["notes", "Notes", "textarea"]] },
  expenses: { title: "Healthcare expenses", description: "Record costs and review your spending at a glance.", fields: [["title", "Expense", "text", true], ["amount", "Amount", "number"], ["currency", "Currency", "text"], ["category", "Category", "select", false, ["Consultation", "Medicine", "Lab test", "Hospital", "Emergency", "Equipment", "Other"]], ["date", "Date", "date"], ["details", "Notes", "textarea"]] },
  diet: { title: "Diet planner", description: "Organize your own meal plan. This is a planning tool, not medical nutrition advice.", fields: [["title", "Meal or plan", "text", true], ["date", "Date", "date"], ["meal", "Meal", "select", false, ["Breakfast", "Lunch", "Dinner", "Snack"]], ["ingredients", "Ingredients", "textarea"], ["notes", "Notes", "textarea"]] },
  notes: { title: "Doctor notes", description: "Save visit notes and follow-up dates for your own reference.", fields: [["title", "Note title", "text", true], ["date", "Date", "date"], ["provider", "Doctor or clinic", "text"], ["followUpDate", "Follow-up date", "date"], ["details", "Notes", "textarea"]] },
  groceries: { title: "Grocery list", description: "Estimate your grocery budget using prices you enter.", fields: [["title", "Item", "text", true], ["quantity", "Quantity", "number"], ["unit", "Unit", "text"], ["price", "Estimated price", "number"], ["available", "Already have it", "checkbox"]] },
  "dose-logs": { title: "Dose log", description: "Review dose events you recorded. These are personal tracking notes, not medical instructions.", fields: [["title", "Dose entry", "text", true], ["status", "Status", "select", false, ["taken", "skipped", "missed"]], ["loggedAt", "Date and time", "datetime-local"], ["details", "Notes", "textarea"]] }
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "include", ...options, headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers } });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}
async function logDose(entry) {
  const status = window.prompt("Log this dose as taken, skipped, or missed:", "taken")?.trim().toLowerCase();
  if (!status) return;
  if (!["taken", "skipped", "missed"].includes(status)) { notify("Choose taken, skipped, or missed."); return; }
  try {
    await request("/entries/dose-logs", {
      method: "POST",
      body: JSON.stringify({ data: { title: `${status[0].toUpperCase()}${status.slice(1)} · ${entry.data.title}`, medicationId: entry._id, status, loggedAt: new Date().toISOString() } })
    });
    notify(`Dose marked ${status}.`);
  } catch (err) { notify(err.message); }
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("dashboard");
  const [toast, setToast] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [adminPage, setAdminPage] = useState("overview");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    request("/auth/me").then(({ user: current }) => setUser(current)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  async function signOut() {
    await request("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }

  if (loading) return <div className="loading-screen"><span className="brand-mark">M</span><p>Opening your private workspace…</p></div>;
  if (!user) return <AuthScreen onSignedIn={setUser} error={authError} setError={setAuthError} />;

  const current = sections.find(([id]) => id === section);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setSection("dashboard"); }}>
        <span className="brand-mark">M</span><span>medvault<span className="brand-dot">.</span><small>YOUR CARE, ORGANIZED</small></span>
      </a>
      <p className="nav-label">WORKSPACE</p>
      <nav>{sections.map(([id, label, icon]) => <button key={id} className={`nav-item ${section === id ? "active" : ""}`} onClick={() => setSection(id)}><span className="nav-icon">{icon}</span>{label}{id === "medications" && <span className="nav-count">•</span>}</button>)}</nav>
      {user.role === "admin" && <><p className="nav-label admin-label">ADMINISTRATION</p><button className={`nav-item ${section === "admin" ? "active" : ""}`} onClick={() => { setSection("admin"); setAdminPage("overview"); }}><span className="nav-icon">▦</span>Admin console</button></>}
      <div className="sidebar-footer"><div className="privacy-badge"><span>◈</span><div><strong>Your data is private</strong><small>Only you can view your health info</small></div></div><div className="profile-row"><div className="avatar">{user.displayName[0]?.toUpperCase()}</div><div className="profile-text"><strong>{user.displayName}</strong><small>{user.role === "admin" ? "Administrator" : "Patient account"}</small></div><button className="icon-button" title="Sign out" onClick={signOut}>↗</button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> {section === "admin" ? "Admin console" : current?.[1] || "Overview"}</div><div className="topbar-right"><span className="secure-label"><span className="secure-dot"></span> PRIVATE SESSION</span><div className="avatar avatar-small">{user.displayName[0]?.toUpperCase()}</div></div></header>
      <div className="content">
        {section === "dashboard" ? <Dashboard user={user} onNavigate={setSection} refresh={refresh} /> :
          section === "prescriptions" ? <Prescriptions notify={notify} refresh={() => setRefresh((n) => n + 1)} /> :
          section === "admin" && user.role === "admin" ? <AdminConsole page={adminPage} setPage={setAdminPage} notify={notify} /> :
          config[section] ? <EntryPage category={section} refresh={refresh} notify={notify} /> :
          <Dashboard user={user} onNavigate={setSection} refresh={refresh} />}
      </div>
      <footer className="app-disclaimer">MedVault helps organize information; it does not provide medical advice or replace your clinician.</footer>
    </main>
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </div>;
}

function AuthScreen({ onSignedIn, error, setError }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(form.entries());
      const { user } = await request(register ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(payload) });
      onSignedIn(user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="auth-page">
    <div className="auth-visual">
      <a className="brand auth-brand" href="#"><span className="brand-mark">M</span><span>medvault<span className="brand-dot">.</span></span></a>
      <div className="visual-copy"><span className="eyebrow light">A CLEARER WAY TO CARE</span><h1>Your health,<br /><em>all in one place.</em></h1><p>Keep your records, appointments, medications, and care notes organized in a private, personal space.</p>
        <div className="visual-card"><div className="visual-card-icon">✚</div><div><strong>Care, made simpler</strong><small>Little details, brought together.</small></div><span className="visual-check">✓</span></div>
      </div>
      <span className="visual-foot">BUILT AROUND YOUR PRIVACY</span>
    </div>
    <div className="auth-panel"><div className="auth-form-wrap"><span className="eyebrow">{register ? "GET STARTED" : "WELCOME BACK"}</span><h2>{register ? "Create your account" : "Sign in to MedVault"}</h2><p className="auth-subtitle">{register ? "A calmer place to keep track of your care." : "Your care workspace is ready when you are."}</p>
      <form onSubmit={submit} className="form-stack">
        {register && <label>Your name<input name="displayName" required minLength="2" maxLength="80" placeholder="How should we address you?" /></label>}
        <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" required minLength={register ? 10 : 1} autoComplete={register ? "new-password" : "current-password"} placeholder={register ? "At least 10 characters" : "Enter your password"} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary full-width" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}<span>→</span></button>
      </form>
      <p className="auth-toggle">{register ? "Already have an account?" : "New to MedVault?"} <button onClick={() => { setRegister(!register); setError(""); }}>{register ? "Sign in" : "Create an account"}</button></p>
      <p className="auth-privacy">◈ &nbsp; Your health information belongs to you. We keep it private.</p>
    </div></div>
  </div>;
}

function useEntries(category, refresh) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    request(`/entries/${category}`).then(({ entries: result }) => live && setEntries(result)).catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, [category, refresh]);
  return { entries, setEntries, error };
}

function Dashboard({ user, onNavigate, refresh }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { request("/dashboard").then(setSummary).catch((err) => setError(err.message)); }, [refresh]);
  const entries = summary?.entries || {};
  const medicationCount = entries.medications?.length || 0;
  const appointments = (entries.appointments || []).filter((entry) => entry.data.date && new Date(entry.data.date) >= new Date(new Date().toDateString())).slice(0, 3);
  const totalSpent = (entries.expenses || []).reduce((sum, entry) => sum + (Number(entry.data.amount) || 0), 0);
  const lowStock = (entries.medications || []).filter((entry) => Number(entry.data.stock) <= Number(entry.data.refillThreshold || 0));
  const firstName = user.displayName.split(" ")[0];
  return <div className="dashboard">
    <div className="welcome-row"><div><span className="eyebrow">YOUR PERSONAL HEALTH SPACE</span><h1>Good day, {firstName}<span className="wave">✳</span></h1><p>Here’s a little overview of what’s happening with your care.</p></div><div className="date-chip"><span>◷</span>{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date())}</div></div>
    {error && <div className="form-error">{error}</div>}
    <div className="summary-grid">
      <SummaryCard icon="✚" label="MEDICATIONS" value={medicationCount} note={medicationCount ? "in your care list" : "none added yet"} tone="mint" onClick={() => onNavigate("medications")} />
      <SummaryCard icon="▦" label="UPCOMING VISITS" value={appointments.length} note="appointments ahead" tone="lavender" onClick={() => onNavigate("appointments")} />
      <SummaryCard icon="＄" label="RECORDED SPENDING" value={`${totalSpent.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} note="all saved expenses" tone="peach" onClick={() => onNavigate("expenses")} />
      <SummaryCard icon="◈" label="HEALTH RECORDS" value={entries.records?.length || 0} note="personal records saved" tone="blue" onClick={() => onNavigate("records")} />
    </div>
    <div className="dashboard-grid">
      <section className="panel appointment-panel"><div className="panel-heading"><div><span className="eyebrow">ON YOUR CALENDAR</span><h2>Upcoming appointments</h2></div><button className="text-button" onClick={() => onNavigate("appointments")}>See all <span>→</span></button></div>
        {appointments.length ? appointments.map((entry) => <div className="appointment-row" key={entry._id}><div className="appointment-date"><strong>{new Date(entry.data.date).getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(entry.data.date))}</small></div><div className="appointment-info"><strong>{entry.data.title}</strong><small>{[entry.data.time, entry.data.provider].filter(Boolean).join(" · ") || "Appointment"}</small></div><span className="appointment-arrow">↗</span></div>) : <EmptyState icon="▦" title="Nothing on the calendar" text="Appointments you add will show up here." action="Add an appointment" onClick={() => onNavigate("appointments")} />}
      </section>
      <section className="panel medication-panel"><div className="panel-heading"><div><span className="eyebrow">A LITTLE HEADS-UP</span><h2>Medicine stock</h2></div><button className="text-button" onClick={() => onNavigate("medications")}>View list <span>→</span></button></div>
        {lowStock.length ? lowStock.slice(0, 4).map((entry) => <div className="stock-row" key={entry._id}><span className="stock-icon">✚</span><div className="stock-info"><strong>{entry.data.title}</strong><small>{entry.data.stock || 0} units left</small></div><span className="stock-warning">Check stock</span></div>) : <EmptyState icon="✚" title="You’re all set" text="We’ll flag medicines that reach your refill threshold." />}
      </section>
    </div>
    <div className="section-heading quick-heading"><div><span className="eyebrow">MAKE IT A LITTLE EASIER</span><h2>Quick access</h2></div></div>
    <div className="quick-grid">{[["records", "Add a health record", "Save a visit, result, or important detail.", "＋", "mint"], ["prescriptions", "Scan a prescription", "Turn an image into a reviewable draft.", "▧", "lavender"], ["appointments", "Plan a visit", "Keep your next appointment in view.", "▦", "peach"]].map(([id, title, text, icon, tone]) => <button key={id} className="quick-card" onClick={() => onNavigate(id)}><span className={`quick-icon ${tone}`}>{icon}</span><strong>{title}</strong><small>{text}</small><span className="quick-arrow">↗</span></button>)}</div>
  </div>;
}

function SummaryCard({ icon, label, value, note, tone, onClick }) {
  return <button className="summary-card" onClick={onClick}><span className={`summary-icon ${tone}`}>{icon}</span><span className="summary-label">{label}</span><strong className="summary-value">{value}</strong><small>{note}</small></button>;
}

function EmptyState({ icon, title, text, action, onClick }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{text}</p>{action && <button className="button button-soft" onClick={onClick}>{action} <span>→</span></button>}</div>;
}

function EntryPage({ category, refresh, notify }) {
  const { entries, setEntries, error } = useEntries(category, refresh);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const item = config[category];
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    const form = new FormData(event.currentTarget);
    const data = {};
    for (const [key, value] of form.entries()) data[key] = value;
    for (const [key, , type] of item.fields) {
      if (type === "checkbox") data[key] = form.has(key);
      if (type === "number" && data[key] !== undefined) data[key] = Number(data[key]);
    }
    try {
      const { entry } = await request(`/entries/${category}`, { method: "POST", body: JSON.stringify({ data }) });
      setEntries([entry, ...entries]);
      setShowForm(false);
      notify("Saved to your private workspace.");
    } catch (err) { setFormError(err.message); }
    finally { setBusy(false); }
  }
  async function toggleMedication(entry) {
    try {
      const { entry: updated } = await request(`/entries/${category}/${entry._id}`, { method: "PATCH", body: JSON.stringify({ data: { reminderEnabled: !entry.data.reminderEnabled } }) });
      setEntries(entries.map((item) => item._id === updated._id ? updated : item));
      notify(updated.data.reminderEnabled ? "Reminder enabled." : "Reminder turned off.");
    } catch (err) { notify(err.message); }
  }
  async function remove(entry) {
    if (!window.confirm("Delete this item from your workspace?")) return;
    try { await request(`/entries/${category}/${entry._id}`, { method: "DELETE" }); setEntries(entries.filter((item) => item._id !== entry._id)); notify("Item deleted."); }
    catch (err) { notify(err.message); }
  }
  const total = category === "expenses" ? entries.reduce((sum, entry) => sum + (Number(entry.data.amount) || 0), 0) : category === "groceries" ? entries.filter((entry) => !entry.data.available).reduce((sum, entry) => sum + (Number(entry.data.price) || 0) * (Number(entry.data.quantity) || 1), 0) : null;
  return <div className="feature-page">
    <div className="page-heading"><div><span className="eyebrow">YOUR HEALTH WORKSPACE</span><h1>{item.title}</h1><p>{item.description}</p></div><button className="button button-primary" onClick={() => setShowForm(!showForm)}><span>{showForm ? "×" : "＋"}</span>{showForm ? "Close" : category === "medications" ? "Add medication" : "Add new"}</button></div>
    {total !== null && <div className="total-banner"><span>{category === "expenses" ? "Total recorded expenses" : "Estimated grocery total"}</span><strong>{category === "expenses" ? "" : "Not already owned · "}{entries[0]?.data.currency || "₹"} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>}
    {showForm && <form className="panel entry-form" onSubmit={save}><div className="form-panel-title"><strong>New {item.title.toLowerCase().replace(/s$/, "")}</strong><span>Only you can see these details.</span></div><div className="input-grid">
      {item.fields.map(([name, label, type, required, options]) => <label key={name} className={type === "textarea" ? "wide-field" : ""}>{label}{type === "textarea" ? <textarea name={name} rows="3" required={required} /> : type === "select" ? <select name={name}>{options.map((option) => <option key={option}>{option}</option>)}</select> : type === "checkbox" ? <span className="checkbox-line"><input name={name} type="checkbox" /> {name === "reminderEnabled" ? "I have verified the schedule and want an in-app reminder" : "Yes"}</span> : <input name={name} type={type} required={required} min={type === "number" ? "0" : undefined} step={name === "amount" || name === "price" ? "0.01" : "1"} />}</label>)}
      </div>{formError && <div className="form-error">{formError}</div>}<div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save item"}</button></div></form>}
    {error && <div className="form-error">{error}</div>}
    {entries.length ? <div className="entry-list">{entries.map((entry) => <EntryCard key={entry._id} entry={entry} category={category} onDelete={() => remove(entry)} onToggle={() => toggleMedication(entry)} onDose={() => logDose(entry)} />)}</div> :
      <div className="panel"><EmptyState icon={sections.find(([id]) => id === category)?.[2]} title={`Your ${item.title.toLowerCase()} will appear here`} text="Add an item to keep your personal care information in one place." action={`Add ${item.title.toLowerCase().replace(/s$/, "")}`} onClick={() => setShowForm(true)} /></div>}
  </div>;
}

function EntryCard({ entry, category, onDelete, onToggle, onDose }) {
  const data = entry.data || {};
  const details = Object.entries(data).filter(([key, value]) => key !== "title" && key !== "reminderEnabled" && key !== "available" && value !== "" && value !== null && value !== false).slice(0, 5);
  return <article className="entry-card"><span className={`entry-kind ${category}`}>{sections.find(([id]) => id === category)?.[2] || "•"}</span><div className="entry-main"><div className="entry-title-row"><h3>{data.title}</h3>{data.reminderEnabled && <span className="status-pill green">Reminder preference on</span>}{category === "medications" && Number(data.stock) <= Number(data.refillThreshold || 0) && <span className="status-pill amber">Low stock</span>}</div><div className="entry-details">{details.map(([key, value]) => <span key={key}><b>{labelize(key)}:</b> {Array.isArray(value) ? value.join(", ") : String(value)}</span>)}</div><small className="entry-date">Added {new Date(entry.createdAt).toLocaleDateString()}</small></div><div className="entry-actions">{category === "medications" && <><button className="small-action" onClick={onDose}>Log dose</button><button className="small-action" onClick={onToggle}>{data.reminderEnabled ? "Turn preference off" : "Set reminder preference"}</button></>}<button className="icon-button delete-button" onClick={onDelete} aria-label="Delete item">×</button></div></article>;
}

function labelize(key) { return key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }

function Prescriptions({ notify, refresh }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [candidates, setCandidates] = useState([]);
  useEffect(() => { request("/prescriptions").then(({ prescriptions }) => setItems(prescriptions)).catch((err) => setError(err.message)); }, []);
  async function scan(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = formElement.elements.prescription.files[0];
    if (!file) { setError("Choose an image first."); return; }
    const data = new FormData();
    data.append("prescription", file);
    setBusy(true); setError("");
    try {
      const { prescription } = await request("/prescriptions/scan", { method: "POST", body: data });
      setItems([prescription, ...items]);
      openReview(prescription);
      notify("Draft created. Please verify every field against the original image.");
      formElement.reset();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function openReview(item) {
    setSelected(item);
    setCandidates(item.candidateMedicines.map((medicine) => ({ ...medicine })));
  }
  async function confirm() {
    setError("");
    try {
      const { prescription } = await request(`/prescriptions/${selected._id}/confirm`, { method: "POST", body: JSON.stringify({ candidateMedicines: candidates }) });
      setItems(items.map((item) => item._id === prescription._id ? prescription : item));
      setSelected(null);
      refresh();
      notify("Verified prescription saved. Reminders remain off until you enable them.");
    } catch (err) { setError(err.message); }
  }
  const updateCandidate = (index, key, value) => setCandidates(candidates.map((candidate, position) => position === index ? { ...candidate, [key]: value } : candidate));
  return <div className="feature-page">
    <div className="page-heading"><div><span className="eyebrow">PRESCRIPTION WORKSPACE</span><h1>Prescriptions</h1><p>Scan an image to create a draft, then check every detail before saving.</p></div></div>
    <div className="ocr-safety"><span className="safety-icon">ⓘ</span><div><strong>OCR can make mistakes.</strong><p>MedVault never activates a medicine or reminder from a scan. Compare each field with the original prescription and ask your clinician or pharmacist if anything is unclear.</p></div></div>
    <form className="upload-card" onSubmit={scan}><div className="upload-icon">▧</div><div><strong>Scan a prescription image</strong><p>Choose a clear JPG or PNG image, up to 8 MB.</p></div><label className="button button-soft file-button">Choose image<input type="file" name="prescription" accept="image/jpeg,image/png" required /></label><button className="button button-primary" disabled={busy}>{busy ? "Reading image…" : "Upload & scan"}</button></form>
    {error && <div className="form-error">{error}</div>}
    {selected && <div className="review-overlay"><div className="review-dialog"><div className="review-heading"><div><span className="eyebrow">MANUAL REVIEW REQUIRED</span><h2>Check the scan draft</h2><p>OCR lines are not classified as medicine names. Verify each field against the image; no medication is saved until you explicitly confirm.</p></div><button className="icon-button" onClick={() => setSelected(null)}>×</button></div><div className="review-content"><div className="review-image"><img src={`/api/prescriptions/${selected._id}/file`} alt="Your private prescription image" /><small>Original image — visible only to you</small></div><div className="review-fields">{candidates.map((candidate, index) => <div className="candidate-card" key={index}><div className="candidate-head"><strong>OCR text line {index + 1}</strong><span>Low OCR confidence · {Math.round((candidate.confidence || 0) * 100)}%</span></div>{[["name", "Extracted text / medicine name (verify)"], ["strength", "Strength"], ["instructions", "Instructions as written"], ["frequency", "Frequency"]].map(([key, label]) => <label key={key}>{label}<input value={candidate[key] || ""} onChange={(event) => updateCandidate(index, key, event.target.value)} /></label>)}<label className="confirm-check"><input type="checkbox" checked={!!candidate.userConfirmed} onChange={(event) => updateCandidate(index, "userConfirmed", event.target.checked)} /> I checked this against the original</label></div>)}</div></div>{error && <div className="form-error">{error}</div>}<div className="form-actions"><button className="button button-quiet" onClick={() => setSelected(null)}>Not now</button><button className="button button-primary" onClick={confirm}>Confirm verified details</button></div></div></div>}
    <div className="section-heading"><div><span className="eyebrow">YOUR DOCUMENTS</span><h2>Saved prescription scans</h2></div></div>
    {items.length ? <div className="entry-list">{items.map((item) => <article className="entry-card" key={item._id}><span className="entry-kind prescriptions">▧</span><div className="entry-main"><div className="entry-title-row"><h3>Prescription scan</h3><span className={`status-pill ${item.status === "confirmed" ? "green" : "amber"}`}>{item.status === "confirmed" ? "Confirmed" : item.status === "failed" ? "Scan failed" : item.status === "processing" ? "Processing" : "Review required"}</span></div><div className="entry-details"><span>Uploaded {new Date(item.createdAt).toLocaleDateString()}</span><span>{item.candidateMedicines?.length || 0} candidate lines — not medical advice</span></div></div>{item.status === "review_required" && <button className="button button-soft" onClick={() => openReview(item)}>Review draft</button>}</article>)}</div> : <div className="panel"><EmptyState icon="▧" title="No scans yet" text="Upload a clear image to start a reviewable OCR draft." /></div>}
  </div>;
}

function AdminConsole({ page, setPage, notify }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { request("/admin/overview").then(setOverview).catch((err) => setError(err.message)); }, []);
  useEffect(() => { if (page === "users") request(`/admin/users?search=${encodeURIComponent(search)}`).then(({ users: result }) => setUsers(result)).catch((err) => setError(err.message)); }, [page, search]);
  useEffect(() => { if (page === "audit") request("/admin/audit-logs").then(({ logs: result }) => setLogs(result)).catch((err) => setError(err.message)); }, [page]);
  async function changeStatus(user) {
    const status = user.status === "active" ? "disabled" : "active";
    try {
      const { user: updated } = await request(`/admin/users/${user._id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setUsers(users.map((item) => item._id === updated._id ? updated : item));
      notify(`Account ${status}. The action was recorded.`);
    } catch (err) { setError(err.message); }
  }
  return <div className="feature-page admin-page"><div className="page-heading"><div><span className="eyebrow">ACCOUNT OPERATIONS</span><h1>Admin console</h1><p>Account metadata and aggregate service activity only. Health details are not available here.</p></div></div>
    <div className="admin-tabs"><button className={page === "overview" ? "selected" : ""} onClick={() => setPage("overview")}>Overview</button><button className={page === "users" ? "selected" : ""} onClick={() => setPage("users")}>Accounts</button><button className={page === "audit" ? "selected" : ""} onClick={() => setPage("audit")}>Audit log</button></div>
    {error && <div className="form-error">{error}</div>}
    {page === "overview" && <>{overview ? <><div className="admin-metrics">{[["Registered accounts", overview.totalAccounts], ["Active accounts", overview.activeAccounts], ["Disabled accounts", overview.disabledAccounts], ["New · last 30 days", overview.registrationsLast30Days]].map(([label, value]) => <div className="admin-metric" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><section className="panel admin-ocr"><div><span className="eyebrow">PROCESSING STATUS</span><h2>OCR activity</h2><p>Only aggregate processing counts are shown. OCR text and health details are excluded.</p></div><div className="ocr-counts"><span><strong>{overview.ocr.total}</strong>Total</span><span><strong>{overview.ocr.pending}</strong>Review pending</span><span><strong>{overview.ocr.failed}</strong>Failed</span></div></section><p className="admin-footnote">Administrative actions recorded: {overview.auditEvents}</p></> : <div className="panel"><EmptyState icon="▦" title="Loading overview" text="Account metrics are being retrieved." /></div>}</>}
    {page === "users" && <section className="panel admin-table-panel"><div className="table-toolbar"><div><h2>Account directory</h2><p>Permitted account fields only. No clinical data is included.</p></div><input className="search-input" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="table-scroll"><table><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>REGISTERED</th><th>LAST LOGIN</th><th>STATUS</th><th></th></tr></thead><tbody>{users.map((user) => <tr key={user._id}><td><strong>{user.displayName}</strong><small>{user.email}</small></td><td>{user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "—"}</td><td><span className={`status-pill ${user.status === "active" ? "green" : "amber"}`}>{user.status}</span></td><td><button className="small-action" onClick={() => changeStatus(user)}>{user.status === "active" ? "Disable" : "Reactivate"}</button></td></tr>)}</tbody></table>{!users.length && <EmptyState icon="⌕" title="No accounts found" text="Try another search." />}</div></section>}
    {page === "audit" && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ADMINISTRATIVE ACTIVITY</span><h2>Recent actions</h2></div></div>{logs.length ? logs.map((log, index) => <div className="audit-row" key={`${log.createdAt}-${index}`}><span className="audit-icon">↗</span><div><strong>{labelize(log.action)}</strong><small>{log.actor} · account: {log.target}</small></div><time>{new Date(log.createdAt).toLocaleString()}</time></div>) : <EmptyState icon="◷" title="No actions recorded" text="Account administration events will be recorded here." />}</section>}
  </div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
