import React, { useEffect, useMemo, useState } from "react";

// Console lavoro quotidiano – v2.3
// Fix syntax error and remove placeholders. Stable build.
// Features: Task list, Pipeline (Kanban), Calendar, Email/ICS reminders,
// JSON + CSV import/export, basic internal tests. LocalStorage persistence.

// ===== Types & Constants =====
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const PRIORITIES = ["Alta", "Media", "Bassa"] as const;
const CATEGORIES = [
  "Follow-up preventivo",
  "Visita cliente",
  "Post-fiera",
  "Offerta da inviare",
  "Contenzioso",
  "Altro",
] as const;

const STATUS = ["Da fare", "In corso", "In attesa", "Fatto"] as const;
const PIPE_STAGES = [
  "Lead",
  "Qualifica",
  "Offerta inviata",
  "Negoziazione",
  "Test shipment",
  "Chiuso vinto",
  "Chiuso perso",
] as const;

type Priority = typeof PRIORITIES[number];
type Category = typeof CATEGORIES[number];
type Status = typeof STATUS[number];
type PipeStage = typeof PIPE_STAGES[number];

type Task = {
  id: string;
  title: string;
  customer?: string;
  due?: string; // YYYY-MM-DD
  priority: Priority;
  category: Category;
  status: Status;
  channel?: string; // Email, Tel, LinkedIn, Fiera
  notes?: string;
  createdAt: string; // ISO
  pipe?: PipeStage | "";
  valueEUR?: number;
};

const STORAGE_KEY = "andrea-task-mvp-v23";

// ===== Storage =====
function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as Task[];
  } catch {
    return [];
  }
}
function saveTasks(tasks: Task[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ===== Dates =====
function todayStr() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}
function startOfWeekStr() {
  const d = new Date();
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  d.setDate(d.getDate() + diff);
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}
function endOfWeekStr() {
  const d = new Date(startOfWeekStr());
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

// ===== ICS =====
function escapeICS(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function toICS(t: Task) {
  const dt = t.due ? new Date(t.due + "T09:00:00") : new Date();
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const date = `${y}${m}${d}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Andrea Tool//Task//IT",
    "BEGIN:VEVENT",
    `UID:${uid()}`,
    `DTSTAMP:${date}T080000Z`,
    `DTSTART:${date}T070000Z`,
    `DTEND:${date}T073000Z`,
    `SUMMARY:${escapeICS(t.title)}`,
    `DESCRIPTION:${escapeICS(`Cliente: ${t.customer || ""} | Note: ${t.notes || ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Blob([lines], { type: "text/calendar;charset=utf-8" });
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== CSV =====
function toCSV(tasks: Task[]) {
  const headers = [
    "id",
    "title",
    "customer",
    "due",
    "priority",
    "category",
    "status",
    "channel",
    "notes",
    "createdAt",
    "pipe",
    "valueEUR",
  ];
  const rows = tasks.map((t) =>
    [
      t.id,
      t.title,
      t.customer || "",
      t.due || "",
      t.priority,
      t.category,
      t.status,
      t.channel || "",
      (t.notes || "").replace(/\\n/g, " "),
      t.createdAt,
      t.pipe || "",
      t.valueEUR ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\r\n");
}
function parseCSV(text: string): Task[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map((h) => h.replace(/^\\"|\\"$/g, ""));
  const idx = (k: string) => headers.indexOf(k);
  const out: Task[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const g = (k: string) => cols[idx(k)]?.replace(/^\\"|\\"$/g, "") || "";
    out.push({
      id: g("id") || uid(),
      title: g("title") || "",
      customer: g("customer") || "",
      due: g("due") || "",
      priority: (g("priority") as Priority) || "Media",
      category: (g("category") as Category) || "Altro",
      status: (g("status") as Status) || "Da fare",
      channel: g("channel") || "",
      notes: g("notes") || "",
      createdAt: g("createdAt") || new Date().toISOString(),
      pipe: (g("pipe") as PipeStage) || "",
      valueEUR: g("valueEUR") ? Number(g("valueEUR")) : undefined,
    });
  }
  return out;
}
function splitCSVLine(line: string): string[] {
  const res: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      res.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  res.push(cur);
  return res;
}

// ===== Regex utils for Pipeline title formatting =====
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\\\]/g, "\\\\$&");
}
function formatTitleWithStage(title: string, nextStage: PipeStage, direction: -1 | 1) {
  if (direction !== 1) return title; // change only when moving right
  const prefixes = PIPE_STAGES.map(escapeRegex).join("|");
  const rePrefix = new RegExp("^(?:" + prefixes + ")(?::|\\s*[–-])\\s*", "i");
  const reSuffix = new RegExp("\\s*[–-]\\s*(?:" + prefixes + ")$", "i");
  const base = title.replace(rePrefix, "").replace(reSuffix, "").trim();
  return `${nextStage}: ${base}`;
}

// ===== App =====
export default function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "week" | "overdue">("today");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "createdAt">("due");
  const [view, setView] = useState<"lista" | "pipeline" | "calendario">("lista");

  useEffect(() => saveTasks(tasks), [tasks]);
  useEffect(() => { runInternalTests(); }, []);

  const filtered = useMemo(() => {
    const t = todayStr();
    const sow = startOfWeekStr();
    const eow = endOfWeekStr();
    return tasks
      .filter((x) => {
        const q = query.trim().toLowerCase();
        const hit = !q
          ? true
          : [x.title, x.customer, x.category, x.priority, x.status, x.channel, x.notes, x.pipe]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q));
        if (!hit) return false;
        if (filter === "all") return true;
        if (!x.due) return filter === "overdue" ? false : filter === "all";
        if (filter === "today") return x.due === t;
        if (filter === "week") return x.due >= sow && x.due <= eow;
        if (filter === "overdue") return x.due < t && x.status !== "Fatto";
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "due") return String(a.due).localeCompare(String(b.due));
        if (sortBy === "priority") return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
  }, [tasks, query, filter, sortBy]);

  // CRUD & helpers
  function addTask(partial: Partial<Task>) {
    const nt: Task = {
      id: uid(),
      title: (partial.title || "Nuovo task").trim(),
      customer: (partial.customer || "").trim(),
      due: partial.due || todayStr(),
      priority: (partial.priority as Priority) || "Media",
      category: (partial.category as Category) || "Altro",
      status: (partial.status as Status) || "Da fare",
      channel: partial.channel || "",
      notes: partial.notes || "",
      createdAt: new Date().toISOString(),
      pipe: (partial.pipe as PipeStage) || "",
      valueEUR: partial.valueEUR,
    };
    setTasks((prev) => [nt, ...prev]);
  }
  function updateTask(id: string, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function removeTask(id: string) {
    if (!confirm("Eliminare questo task?")) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }
  function bulk(action: "done" | "toDoWeek") {
    if (action === "done") setTasks((prev) => prev.map((t) => ({ ...t, status: "Fatto" })));
    if (action === "toDoWeek") {
      const sow = new Date(startOfWeekStr());
      setTasks((prev) => prev.map((t, i) => { const d = new Date(sow); d.setDate(d.getDate() + (i % 5)); return { ...t, due: d.toISOString().slice(0, 10) }; }));
    }
  }
  function exportJson() { downloadBlob(new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" }), "tasks-andrea.json"); }
  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (!Array.isArray(data)) throw new Error("Formato non valido"); setTasks(data as Task[]); } catch (e: any) { alert("Errore import: " + e.message); } };
    reader.readAsText(file);
  }
  function exportCSV() { downloadBlob(new Blob([toCSV(tasks)], { type: "text/csv;charset=utf-8" }), "tasks-andrea.csv"); }
  function importCSV(file: File) {
    const reader = new FileReader();
    reader.onload = () => { try { const list = parseCSV(String(reader.result)); if (list.length === 0) throw new Error("CSV vuoto o non valido"); setTasks(list); } catch (e: any) { alert("Errore import CSV: " + e.message); } };
    reader.readAsText(file);
  }
  function mailtoReminder(t: Task) {
    const to = ""; // opzionale
    const sub = encodeURIComponent(`Promemoria: ${t.title}`);
    const body = encodeURIComponent([
      `Task: ${t.title}`,
      `Cliente: ${t.customer || "-"}`,
      `Scadenza: ${t.due || "-"}`,
      `Pipeline: ${t.pipe || "-"}`,
      `Note: ${t.notes || "-"}`,
    ].join("\\n"));
    window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
  }
  function icsReminder(t: Task) {
    downloadBlob(toICS(t), `promemoria-${(t.title || "task").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`);
  }

  // ===== UI Subcomponents =====
  function QuickTemplates() {
    function addFollowUpQuote() {
      addTask({ title: "Follow-up preventivo", category: "Follow-up preventivo", priority: "Alta", channel: "Email", notes: "Scrivi al cliente. Chiedi feedback. Proponi call 15'. Allegare PDF offerta.", pipe: "Qualifica" });
    }
    function addFairVisit() {
      addTask({ title: "Visita cliente", category: "Visita cliente", priority: "Media", channel: "Fiera", notes: "Pad./Stand, referenti, volumi, trade-lanes, criticità attuali.", pipe: "Lead" });
    }
    function addFollowUpVisit() {
      addTask({ title: "Follow up post visita", category: "Post-fiera", priority: "Alta", channel: "Email/LinkedIn", notes: "Materiali, case study, proposta step test shipment.", pipe: "Offerta inviata" });
    }
    function addOffer() {
      addTask({ title: "Offerta da inviare", category: "Offerta da inviare", priority: "Alta", channel: "Email", notes: "Quote door/port, free time, cut-off, validità 14 gg.", pipe: "Offerta inviata" });
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <button className="btn" onClick={addFollowUpQuote}>+ Follow-up preventivo</button>
        <button className="btn" onClick={addFairVisit}>+ Visita cliente</button>
        <button className="btn" onClick={addFollowUpVisit}>+ Follow up post visita</button>
        <button className="btn" onClick={addOffer}>+ Offerta da inviare</button>
      </div>
    );
  }

  function NewTaskForm() {
    const [title, setTitle] = useState("");
    const [customer, setCustomer] = useState("");
    const [due, setDue] = useState(todayStr());
    const [priority, setPriority] = useState<Priority>("Media");
    const [category, setCategory] = useState<Category>("Altro");
    const [status, setStatus] = useState<Status>("Da fare");
    const [channel, setChannel] = useState("");
    const [notes, setNotes] = useState("");
    const [pipe, setPipe] = useState<PipeStage | "">("");
    const [valueEUR, setValueEUR] = useState<string>("");

    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-2">Nuovo task</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="inp" placeholder="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="inp" placeholder="Cliente" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <input className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <select className="inp" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => (<option key={p} value={p}>{p}</option>))}</select>
          <select className="inp" value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}</select>
          <select className="inp" value={status} onChange={(e) => setStatus(e.target.value as Status)}>{STATUS.map((s) => (<option key={s} value={s}>{s}</option>))}</select>
          <select className="inp" value={pipe} onChange={(e) => setPipe(e.target.value as PipeStage | "") }>
            <option value="">— Pipeline (opzionale) —</option>
            {PIPE_STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <input className="inp" placeholder="Valore €" value={valueEUR} onChange={(e)=> setValueEUR(e.target.value)} />
          <input className="inp" placeholder="Canale (Email/Tel/LinkedIn)" value={channel} onChange={(e) => setChannel(e.target.value)} />
          <input className="inp col-span-1 md:col-span-4" placeholder="Note" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="mt-2 flex gap-2 flex-wrap">
          <button className="btn" onClick={() => { addTask({ title, customer, due, priority, category, status, channel, notes, pipe, valueEUR: valueEUR? Number(valueEUR): undefined }); setTitle(""); setCustomer(""); setDue(todayStr()); setPriority("Media"); setCategory("Altro"); setStatus("Da fare"); setChannel(""); setNotes(""); setPipe(""); setValueEUR(""); }}>Aggiungi</button>
          <QuickTemplates />
        </div>
      </div>
    );
  }

  function TaskRow({ t }: { t: Task }) {
    const valueFmt = typeof t.valueEUR === 'number' ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR'}).format(t.valueEUR) : "";
    return (
      <div className="card flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex-1">
          <div className="font-medium">{t.title}</div>
          <div className="text-sm opacity-80">{t.customer} • {t.category} • {t.channel} {t.pipe ? `• ${t.pipe}`: ''} {valueFmt? `• ${valueFmt}`: ''}</div>
          {t.notes && <div className="text-sm mt-1">{t.notes}</div>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-center">
          <select className="pill" value={t.status} onChange={(e) => updateTask(t.id, { status: e.target.value as Status })}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select className="pill" value={t.priority} onChange={(e) => updateTask(t.id, { priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <input className="pill" type="date" value={t.due || ""} onChange={(e) => updateTask(t.id, { due: e.target.value })} />
          <select className="pill" value={t.pipe || ""} onChange={(e)=> updateTask(t.id, { pipe: e.target.value as PipeStage })}>
            <option value="">—Stage—</option>
            {PIPE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn" onClick={() => mailtoReminder(t)}>Email promemoria</button>
          <button className="btn" onClick={() => icsReminder(t)}>Scarica ICS</button>
          <button className="btn-danger" onClick={() => removeTask(t.id)}>Elimina</button>
        </div>
      </div>
    );
  }

  function Toolbar() {
    return (
      <div className="card flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex gap-2 flex-wrap">
          <button className={`tab ${filter === "today" ? "tab-active" : ""}`} onClick={() => setFilter("today")}>Oggi</button>
          <button className={`tab ${filter === "week" ? "tab-active" : ""}`} onClick={() => setFilter("week")}>Settimana</button>
          <button className={`tab ${filter === "overdue" ? "tab-active" : ""}`} onClick={() => setFilter("overdue")}>Scaduti</button>
          <button className={`tab ${filter === "all" ? "tab-active" : ""}`} onClick={() => setFilter("all")}>Tutti</button>
          <button className={`tab ${view === "lista" ? "tab-active" : ""}`} onClick={() => setView("lista")}>Lista</button>
          <button className={`tab ${view === "pipeline" ? "tab-active" : ""}`} onClick={() => setView("pipeline")}>Pipeline</button>
          <button className={`tab ${view === "calendario" ? "tab-active" : ""}`} onClick={() => setView("calendario")}>Calendario</button>
        </div>
        <input className="inp flex-1" placeholder="Cerca…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="inp" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
          <option value="due">Ordina per scadenza</option>
          <option value="priority">Ordina per priorità</option>
          <option value="createdAt">Ordina per creazione</option>
        </select>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={exportJson}>Export JSON</button>
          <label className="btn cursor-pointer">Import JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files && importJson(e.target.files[0])} /></label>
          <button className="btn" onClick={exportCSV}>Export CSV</button>
          <label className="btn cursor-pointer">Import CSV<input type="file" accept="text/csv,.csv" className="hidden" onChange={(e) => e.target.files && importCSV(e.target.files[0])} /></label>
        </div>
      </div>
    );
  }

  const kpis = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Fatto").length;
    const overdue = tasks.filter((t) => t.due && t.due < todayStr() && t.status !== "Fatto").length;
    const thisWeek = tasks.filter((t) => t.due && t.due >= startOfWeekStr() && t.due <= endOfWeekStr()).length;
    const pipelineValue = tasks.filter(t=> t.pipe && !["Chiuso perso"].includes(t.pipe!)).reduce((s,t)=> s + (t.valueEUR||0), 0);
    return { total, done, overdue, thisWeek, pipelineValue };
  }, [tasks]);

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gray-50">
      <style>{`
        .card{background:white;border:1px solid #e5e7eb;border-radius:1rem;padding:1rem}
        .btn{background:#111827;color:white;border-radius:0.75rem;padding:0.5rem 0.75rem}
        .btn-danger{background:#991b1b;color:white;border-radius:0.75rem;padding:0.5rem 0.75rem}
        .inp{border:1px solid #e5e7eb;border-radius:0.75rem;padding:0.5rem 0.75rem}
        .pill{border:1px solid #e5e7eb;border-radius:999px;padding:0.4rem 0.75rem}
        .tab{border:1px solid #e5e7eb;border-radius:999px;padding:0.4rem 0.75rem;background:white}
        .tab-active{background:#111827;color:white}
        .kpi{background:white;border:1px solid #e5e7eb;border-radius:1rem;padding:1rem;text-align:center}
        .title{font-size:1.5rem;font-weight:700}
        .board{display:grid;gap:0.75rem}
        @media(min-width:900px){.board{grid-template-columns: repeat(7, minmax(0,1fr));}}
        .col{background:white;border:1px dashed #e5e7eb;border-radius:1rem;padding:0.5rem}
        .chip{display:inline-block;border:1px solid #e5e7eb;border-radius:999px;padding:0.1rem 0.5rem;font-size:0.75rem}
      `}</style>

      <div className="mb-4 flex flex-col md:flex-row md:items-end gap-2 justify-between">
        <div>
          <div className="title">Console lavoro quotidiano</div>
          <div className="opacity-80">Dati salvati nel browser. Nessun server. CSV apribile in Excel.</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="kpi"><div className="text-2xl font-bold">{kpis.total}</div><div className="text-sm opacity-80">Totale</div></div>
          <div className="kpi"><div className="text-2xl font-bold">{kpis.done}</div><div className="text-sm opacity-80">Fatti</div></div>
          <div className="kpi"><div className="text-2xl font-bold">{kpis.overdue}</div><div className="text-sm opacity-80">Scaduti</div></div>
          <div className="kpi"><div className="text-2xl font-bold">{kpis.thisWeek}</div><div className="text-sm opacity-80">In settimana</div></div>
          <div className="kpi"><div className="text-2xl font-bold">{new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(kpis.pipelineValue)}</div><div className="text-sm opacity-80">Pipeline €</div></div>
        </div>
      </div>

      <Toolbar />
      <NewTaskForm />

      {view === "lista" && (
        <div className="mt-4 grid gap-2">
          {filtered.map((t) => (<TaskRow key={t.id} t={t} />))}
          {filtered.length === 0 && (<div className="opacity-60 text-center">Nessun task per il filtro selezionato.</div>)}
        </div>
      )}

      {view === "pipeline" && <Pipeline tasks={tasks} setTasks={setTasks} />}
      {view === "calendario" && <Calendar tasks={tasks} />}

      <div className="mt-6 card">
        <h3 className="font-semibold mb-2">Azioni rapide</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => bulk("done")}>Segna tutti come fatti</button>
          <button className="btn" onClick={() => bulk("toDoWeek")}>Spalma attività nella settimana</button>
        </div>
        <p className="text-sm opacity-80 mt-2">Promemoria: usa "Email promemoria" o scarica un file .ics per import nel calendario. Apri il CSV in Excel per filtri e pivot.</p>
      </div>
    </div>
  );
}

// ===== Pipeline (Kanban) =====
function Pipeline({ tasks, setTasks }: { tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>; }) {
  const stages = PIPE_STAGES;
  const byStage: Record<string, Task[]> = {};
  stages.forEach(s => byStage[s] = []);
  tasks.filter(t => t.pipe).forEach(t => { byStage[t.pipe as string].push(t); });

  function move(t: Task, dir: -1 | 1) {
    const idx = stages.indexOf(t.pipe as PipeStage);
    if (idx < 0) return;
    const ni = Math.min(Math.max(idx + dir, 0), stages.length - 1);
    const newStage = stages[ni];
    setTasks(prev => prev.map(x => {
      if (x.id !== t.id) return x;
      const newTitle = formatTitleWithStage(x.title, newStage, dir);
      return { ...x, pipe: newStage, title: newTitle };
    }));
  }

  return (
    <div className="board mt-4">
      {stages.map((s) => (
        <div key={s} className="col">
          <div className="font-semibold mb-2 flex items-baseline justify-between"><span>{s}</span><span className="chip">{byStage[s].length}</span></div>
          <div className="grid gap-2">
            {byStage[s].map((t) => (
              <div key={t.id} className="card">
                <div className="font-medium">{t.title}</div>
                <div className="text-sm opacity-80">{t.customer} {typeof t.valueEUR === 'number' ? `• ${new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(t.valueEUR)}`: ''}</div>
                <div className="text-xs opacity-70">Due: {t.due || '-'}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn" onClick={() => move(t, -1)}>◀︎</button>
                  <button className="btn" onClick={() => move(t, 1)}>▶︎</button>
                </div>
              </div>
            ))}
            {byStage[s].length === 0 && <div className="opacity-60 text-sm">Nessun elemento</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Calendar =====
function Calendar({ tasks }: { tasks: Task[] }) {
  const [refDate, setRefDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const y = refDate.getFullYear();
  const m = refDate.getMonth();

  const firstDay = new Date(y, m, 1);
  const start = new Date(firstDay);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday grid
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });

  const itemsByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach(t => { if (!t.due) return; map[t.due] = map[t.due] || []; map[t.due].push(t); });
    return map;
  }, [tasks]);

  function fmt(d: Date) { return d.toISOString().slice(0,10); }
  function monthName(n: number) { return ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][n]; }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <button className="btn" onClick={() => setRefDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}>◀︎</button>
        <div className="font-semibold">{monthName(m)} {y}</div>
        <button className="btn" onClick={() => setRefDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}>▶︎</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-sm opacity-70 mb-1">{['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map(d => <div key={d} className="text-center">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => { const inMonth = d.getMonth() === m; const key = fmt(d); const dayItems = itemsByDay[key] || []; return (
          <div key={i} className="card" style={{opacity: inMonth ? 1 : 0.45, padding: '0.5rem'}}>
            <div className="text-xs font-semibold mb-1">{d.getDate()}</div>
            <div className="grid gap-1">
              {dayItems.slice(0,4).map(t => (<div key={t.id} className="chip" title={t.title}>{t.title.slice(0,18)}{t.title.length>18?'…':''}</div>))}
              {dayItems.length>4 && <div className="text-xs opacity-70">+{dayItems.length-4} altro…</div>}
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ===== Tests =====
function runInternalTests() {
  try {
    // escapeICS
    console.assert(escapeICS("a,b;c\\d\ne") === "a\\,b\\;c\\\\d\\ne", "escapeICS");

    // CSV roundtrip
    const sample: Task[] = [{ id: "1", title: 'Titolo con "virgolette"', customer: "Cliente X", due: "2025-09-16", priority: "Alta", category: "Altro", status: "Da fare", channel: "Email", notes: "Riga1\nRiga2", createdAt: new Date().toISOString(), pipe: "Lead", valueEUR: 123.45 }];
    const csv = toCSV(sample);
    console.assert(/Titolo con ""virgolette""/.test(csv), "CSV escape virgolette");
    const parsed = parseCSV(csv);
    console.assert(parsed[0].title.includes('virgolette'), "CSV parse titolo");

    // ICS MIME
    const icsBlob = toICS(sample[0]);
    console.assert(icsBlob.type.includes("text/calendar"), "ICS MIME");

    // splitCSVLine
    const cols = splitCSVLine('"a,b",c,"d""e"');
    console.assert(cols.length === 3 && cols[0] === 'a,b' && cols[2] === 'd"e', "splitCSVLine");

    // formatTitleWithStage
    const t1 = formatTitleWithStage('Lead: Offerta ABC', 'Qualifica', 1);
    console.assert(t1 === 'Qualifica: Offerta ABC', 'prefix stage fwd');
    const t2 = formatTitleWithStage('Qualifica: Offerta ABC', 'Offerta inviata', 1);
    console.assert(t2 === 'Offerta inviata: Offerta ABC', 'replace previous prefix');
    const t3 = formatTitleWithStage('Offerta ABC', 'Qualifica', -1);
    console.assert(t3 === 'Offerta ABC', 'no change on left');

    console.log("Tests OK");
  } catch (e) {
    console.error("Tests FAILED", e);
  }
}
