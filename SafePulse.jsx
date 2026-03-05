import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";

/* ═══════════════════════════════════════════
   CONFIGURACIÓN DE API
   ═══════════════════════════════════════════ 
   
   ⚠️ IMPORTANTE: Cambia esta URL por la de tu backend en producción
   Ejemplo Railway: https://safepulse-api-production.up.railway.app
   Ejemplo Render: https://safepulse-api.onrender.com
*/
// URL vacía = usa el mismo dominio (Nginx hace proxy a /api/)
const API_URL = "";

/* ═══════════════════════════════════════════
   SECURITY & UTILS
   ═══════════════════════════════════════════ */
const Sec = {
  clean: s => typeof s !== "string" ? "" : s.replace(/<[^>]*>/g, "").trim(),
  uid: () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join(""),
  validDni: d => /^[\d\s\-\.]{6,15}$/.test(d),
  validPhone: p => /^\+?[\d\s\-()]{7,20}$/.test(p),
};

/* ═══════════════════════════════════════════
   API CLIENT
   ═══════════════════════════════════════════ */
const API = {
  token: null,
  
  setToken(t) { 
    this.token = t; 
    if (t) localStorage.setItem("sp_token", t);
    else localStorage.removeItem("sp_token");
  },
  
  getToken() {
    if (!this.token) this.token = localStorage.getItem("sp_token");
    return this.token;
  },
  
  async request(endpoint, options = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    
    if (res.status === 401) {
      this.setToken(null);
      throw new Error("Sesión expirada");
    }
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Error en la petición");
    }
    
    return res.json();
  },
  
  // Auth
  async login(password) {
    const data = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    this.setToken(data.token);
    return data;
  },
  
  async logout() {
    try { await this.request("/api/auth/logout", { method: "POST" }); } catch {}
    this.setToken(null);
  },
  
  // Users
  getUsers: () => API.request("/api/users"),
  getUser: (id) => API.request(`/api/users/${id}`),
  createUser: (data) => API.request("/api/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => API.request(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id) => API.request(`/api/users/${id}`, { method: "DELETE" }),
  toggleStatus: (id) => API.request(`/api/users/${id}/toggle-status`, { method: "PATCH" }),
  
  // Scans
  getScans: () => API.request("/api/scans"),
  createScan: (data) => API.request("/api/scans", { method: "POST", body: JSON.stringify(data) }),
  
  // Stats & Audit
  getStats: () => API.request("/api/stats"),
  getAudit: (limit = 100) => API.request(`/api/audit?limit=${limit}`),
};

/* ═══════════════════════════════════════════
   QR MATRIX GENERATOR
   ═══════════════════════════════════════════ */
function genQR(text) {
  const sz = 25, mx = Array.from({ length: sz }, () => Array(sz).fill(false));
  const finder = (r, c) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) mx[r + i][c + j] = true; } };
  finder(0, 0); finder(0, sz - 7); finder(sz - 7, 0);
  for (let i = 8; i < sz - 8; i++) { mx[6][i] = i % 2 === 0; mx[i][6] = i % 2 === 0; }
  let bits = []; for (let i = 0; i < text.length; i++) { const b = text.charCodeAt(i); for (let j = 7; j >= 0; j--) bits.push((b >> j) & 1); }
  let idx = 0;
  for (let col = sz - 1; col > 0; col -= 2) { if (col === 6) col = 5; for (let row = 0; row < sz; row++) for (let c = 0; c < 2; c++) { const x = col - c, y = row; if (mx[y][x] || (y < 9 && x < 9) || (y < 9 && x > sz - 9) || (y > sz - 9 && x < 9) || y === 6 || x === 6) continue; mx[y][x] = idx < bits.length ? bits[idx++] === 1 : (idx++ % 3 === 0); } }
  return mx;
}

/* ═══════════════════════════════════════════
   APP
   ═══════════════════════════════════════════ */
export default function SafePulse() {
  const [phase, setPhase] = useState("loading");
  const [users, setUsers] = useState([]);
  const [scans, setScans] = useState([]);
  const [audit, setAudit] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, totalScans: 0, emergencies: 0, lost: 0, info: 0, bloodTypes: [], conditions: [], allergies: [], scanTimeline: [] });
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [qrUser, setQrUser] = useState(null);
  const [previewUser, setPreviewUser] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [sidebar, setSidebar] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const pwRef = useRef(null);

  const toast = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  // Cargar datos
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [usersData, scansData, auditData, statsData] = await Promise.all([
        API.getUsers(),
        API.getScans(),
        API.getAudit(),
        API.getStats()
      ]);
      setUsers(usersData);
      setScans(scansData);
      setAudit(auditData);
      setStats(statsData);
    } catch (err) {
      if (err.message === "Sesión expirada") {
        setPhase("login");
        toast("Sesión expirada, inicia sesión nuevamente", "error");
      } else {
        toast("Error cargando datos", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // INIT - Verificar sesión existente
  useEffect(() => {
    const checkSession = async () => {
      const token = API.getToken();
      if (token) {
        try {
          await loadData();
          setPhase("app");
        } catch {
          API.setToken(null);
          setPhase("login");
        }
      } else {
        setPhase("login");
      }
    };
    checkSession();
  }, [loadData]);

  // LOGIN
  const handleLogin = useCallback(async () => {
    const pw = pwRef.current?.value || "";
    if (!pw) { setLoginErr("Ingresa la contraseña"); return; }
    
    try {
      setLoading(true);
      await API.login(pw);
      await loadData();
      setPhase("app");
      setLoginErr("");
      setLoginAttempts(0);
    } catch (err) {
      setLoginAttempts(p => p + 1);
      setLoginErr(err.message || "Contraseña incorrecta");
    } finally {
      setLoading(false);
    }
  }, [loadData]);

  // LOGOUT
  const handleLogout = useCallback(async () => {
    await API.logout();
    setPhase("login");
    setUsers([]);
    setScans([]);
    setAudit([]);
  }, []);

  // CRUD USERS
  const addUser = useCallback(async (data) => {
    try {
      setLoading(true);
      const newUser = await API.createUser(data);
      setUsers(prev => [...prev, newUser]);
      toast(`${data.name} registrado con pulsera ${newUser.nfcId}`);
      setTab("manage");
      loadData(); // Refresh stats
    } catch (err) {
      toast(err.message || "Error al registrar", "error");
    } finally {
      setLoading(false);
    }
  }, [toast, loadData]);

  const updateUser = useCallback(async (id, data) => {
    try {
      setLoading(true);
      const updated = await API.updateUser(id, data);
      setUsers(prev => prev.map(u => u.id === id ? updated : u));
      toast("Perfil actualizado");
      setEditing(null);
    } catch (err) {
      toast(err.message || "Error al actualizar", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deleteUser = useCallback(async (id) => {
    try {
      setLoading(true);
      await API.deleteUser(id);
      setUsers(prev => prev.filter(u => u.id !== id));
      toast("Usuario eliminado", "error");
      setDeleting(null);
      loadData();
    } catch (err) {
      toast(err.message || "Error al eliminar", "error");
    } finally {
      setLoading(false);
    }
  }, [toast, loadData]);

  const toggleStatus = useCallback(async (id) => {
    try {
      const result = await API.toggleStatus(id);
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status: result.status } : u));
      toast(`Pulsera ${result.status === "active" ? "activada" : "desactivada"}`, "info");
    } catch (err) {
      toast(err.message || "Error", "error");
    }
  }, [toast]);

  // EXPORT
  const exportCSV = useCallback(() => {
    const h = ["NFC ID", "Nombre", "DNI", "Sangre", "Condición", "Alergias", "Medicamentos", "Observación", "Contacto 1", "Tel 1", "Contacto 2", "Tel 2", "Pulsera", "Estado"];
    const rows = users.map(u => [u.nfcId, u.name, u.dni, u.bloodType, u.condition, (u.allergies||[]).join("; "), (u.meds||[]).join("; "), u.observation || "", (u.contacts||[])[0]?.name || "", (u.contacts||[])[0]?.phone || "", (u.contacts||[])[1]?.name || "", (u.contacts||[])[1]?.phone || "", u.braceletColor || "", u.status]);
    const csv = [h, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `safepulse_usuarios_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    toast("CSV exportado");
  }, [users, toast]);

  const exportScansCSV = useCallback(() => {
    const h = ["Fecha", "Usuario", "NFC ID", "Tipo", "Ubicación", "Tel Rescatista", "Notas"];
    const rows = scans.map(s => { const u = users.find(x => x.id === s.userId); return [s.ts, u?.name || "", u?.nfcId || "", s.type, s.location, s.scannerPhone, s.notes]; });
    const csv = [h, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `safepulse_escaneos_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    toast("Escaneos exportados");
  }, [scans, users, toast]);

  // Computed
  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q) || u.dni.includes(q) || u.nfcId.toLowerCase().includes(q) || u.condition.toLowerCase().includes(q) || (u.observation || "").toLowerCase().includes(q) || u.bloodType.toLowerCase().includes(q));
  }, [users, search]);

  const TABS = [
    { key: "dashboard", icon: "📊", label: "Dashboard" },
    { key: "manage", icon: "⌚", label: "Pulseras", badge: users.length },
    { key: "register", icon: "➕", label: "Registrar" },
    { key: "scans", icon: "📡", label: "Escaneos", badge: scans.length },
    { key: "qr", icon: "📱", label: "Códigos QR" },
    { key: "export", icon: "📤", label: "Exportar" },
    { key: "audit", icon: "🔒", label: "Seguridad" },
  ];

  // ── LOADING ──
  if (phase === "loading") return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#05080F", fontFamily: "'Outfit',sans-serif" }}>
      <style>{CSS}</style><div className="bgfx" /><div className="bggr" />
      <div style={{ textAlign: "center", zIndex: 1, animation: "fadeUp .6s ease" }}>
        <div style={{ fontSize: "2.5rem", animation: "pulse 1.2s ease-in-out infinite" }}>⌚</div>
        <p style={{ color: "#5A6580", fontSize: ".85rem", marginTop: "1rem" }}>Cargando SafePulse...</p>
      </div>
    </div>
  );

  // ── LOGIN ──
  if (phase === "login") return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#05080F", fontFamily: "'Outfit',sans-serif" }}>
      <style>{CSS}</style><div className="bgfx" /><div className="bggr" />
      <div className="login-card">
        <div className="login-logo"><div className="login-logo-inner">⌚</div><div className="login-logo-ring" /></div>
        <h1 className="login-title">SafePulse Tech Perú</h1>
        <p className="login-sub">Panel de Gestión — Pulseras NFC de Emergencia</p>
        <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
          <div><label className="fl">Contraseña</label><input ref={pwRef} type="password" className="fi" placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} autoFocus style={{ width: "100%", marginTop: ".35rem" }} disabled={loading} /></div>
          {loginErr && <div className="login-err">⚠ {loginErr}</div>}
          <button className="btn-p" style={{ width: "100%" }} onClick={handleLogin} disabled={loading}>
            {loading ? "⏳ Conectando..." : "🔐 Ingresar"}
          </button>
          {loginAttempts > 0 && <p style={{ textAlign: "center", fontSize: ".72rem", color: "#5A6580" }}>Intentos: {loginAttempts}/5</p>}
        </div>
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <div className="sec-badge">🔒 API Segura · JWT Auth · PostgreSQL</div>
          <p style={{ fontSize: ".68rem", color: "#3A4560", marginTop: ".6rem" }}>Contraseña: admin</p>
        </div>
      </div>
    </div>
  );

  // ── APP ──
  return (
    <div style={{ fontFamily: "'Outfit',sans-serif", background: "#05080F", color: "#EDF0F7", minHeight: "100vh" }}>
      <style>{CSS}</style><div className="bgfx" /><div className="bggr" />
      <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast t-${t.type}`}>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"} {t.msg}</div>)}</div>
      
      {/* Loading overlay */}
      {loading && <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg, #CC2027, #2A6DB5)", zIndex: 9999, animation: "loading 1s ease-in-out infinite" }} />}

      <div className="layout">
        <button className="mob-btn" onClick={() => setSidebar(!sidebar)}>☰</button>
        {sidebar && <div className="mob-ov" onClick={() => setSidebar(false)} />}

        {/* SIDEBAR */}
        <aside className={`sb${sidebar ? " open" : ""}`}>
          <div className="sb-hd">
            <div className="sb-brand"><div className="sb-logo">⌚</div><div><div className="sb-name">SafePulse</div><div className="sb-tag">Emergency NFC Tech</div></div></div>
          </div>
          <nav className="sb-nav">
            {TABS.map(t => (
              <div key={t.key} className={`sb-item${tab === t.key ? " active" : ""}`} onClick={() => { setTab(t.key); setSidebar(false); setEditing(null); }}>
                <span className="sb-ico">{t.icon}</span>{t.label}
                {t.badge != null && <span className="sb-badge">{t.badge}</span>}
              </div>
            ))}
          </nav>
          <div className="sb-ft">
            <div className="sb-sec"><span className="sb-dot" />Conectado al servidor</div>
            <button className="btn-lo" onClick={handleLogout}>Cerrar Sesión</button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="mn">

          {/* ═══ DASHBOARD ═══ */}
          {tab === "dashboard" && <>
            <div className="ph"><h1 className="pt">Dashboard</h1><p className="ps">Resumen del sistema de pulseras NFC</p></div>
            <div className="pb">
              <div className="kpi-g">
                {[
                  { i: "⌚", v: stats.total, l: "Pulseras Registradas", c: "#CC2027", s: `${stats.active} activas` },
                  { i: "📡", v: stats.totalScans, l: "Escaneos Totales", c: "#2A6DB5", s: "Desde el inicio" },
                  { i: "🚨", v: stats.emergencies, l: "Emergencias", c: "#EF4444", s: "Escaneos de emergencia" },
                  { i: "🔍", v: stats.lost, l: "Personas Encontradas", c: "#F59E0B", s: "Escaneos por extravío" },
                ].map((k, i) => (
                  <div key={i} className="kpi" style={{ animationDelay: `${i * .1}s` }}>
                    <div className="kpi-i" style={{ background: `${k.c}18`, color: k.c }}>{k.i}</div>
                    <div className="kpi-v">{k.v}</div>
                    <div className="kpi-l">{k.l}</div>
                    <div className="kpi-s">{k.s}</div>
                  </div>
                ))}
              </div>

              <div className="ch-row">
                <div className="ch-p">
                  <h3 className="ch-h">Tipos de Sangre</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart><Pie data={stats.bloodTypes} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}(${value})`} labelLine={false} fontSize={11}>
                      {stats.bloodTypes.map((_, i) => <Cell key={i} fill={["#CC2027", "#2A6DB5", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"][i % 8]} />)}
                    </Pie><Tooltip contentStyle={{ background: "#141928", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#EDF0F7", fontSize: 13 }} /></PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="ch-p">
                  <h3 className="ch-h">Condiciones Médicas</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.conditions} layout="vertical" margin={{ left: 80, right: 20 }}>
                      <XAxis type="number" hide /><YAxis type="category" dataKey="name" tick={{ fill: "#A0ADC4", fontSize: 10 }} width={75} />
                      <Tooltip contentStyle={{ background: "#141928", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#EDF0F7", fontSize: 13 }} />
                      <Bar dataKey="value" radius={[0, 8, 8, 0]} fill="#CC2027" barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Últimos escaneos */}
              <h3 className="ch-h" style={{ marginTop: "1.5rem", marginBottom: ".75rem" }}>Últimos Escaneos</h3>
              <div className="scan-list">
                {scans.slice(0, 4).map(s => {
                  const u = users.find(x => x.id === s.userId);
                  return (
                    <div key={s.id} className="scan-card">
                      <div className={`scan-type st-${s.type}`}>{s.type === "emergency" ? "🚨" : s.type === "lost" ? "🔍" : "ℹ️"}</div>
                      <div className="scan-info">
                        <div className="scan-name">{u?.name || "Desconocido"} <span className="scan-nfc">{u?.nfcId}</span></div>
                        <div className="scan-loc">📍 {s.location}</div>
                      </div>
                      <div className="scan-time">{new Date(s.ts).toLocaleDateString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>}

          {/* ═══ MANAGE ═══ */}
          {tab === "manage" && <>
            <div className="ph"><h1 className="pt">Pulseras NFC</h1><p className="ps">{users.length} usuarios registrados</p></div>
            <div className="pb">
              <div className="srch"><span>🔍</span><input placeholder="Buscar por nombre, DNI, NFC, condición, observación..." value={search} onChange={e => setSearch(Sec.clean(e.target.value))} /></div>
              <div className="user-grid">
                {filtered.length === 0 ? <div className="emp"><div style={{ fontSize: "2rem" }}>🔍</div><p>No se encontraron usuarios</p></div> :
                  filtered.map(u => (
                    <div key={u.id} className="user-card">
                      <div className="uc-top">
                        <div className="uc-avatar">{u.photo}</div>
                        <span className={`uc-status s-${u.status}`} onClick={() => toggleStatus(u.id)}><span className="sdot" />{u.status === "active" ? "Activa" : "Inactiva"}</span>
                      </div>
                      <h3 className="uc-name">{u.name}</h3>
                      <div className="uc-meta">{u.nfcId} · DNI: {u.dni}</div>
                      <div className="uc-tags">
                        <span className="btag">{u.bloodType}</span>
                        <span className="ctag">{u.condition}</span>
                      </div>
                      {u.observation && <p className="uc-obs">👁 {u.observation}</p>}
                      <div className="uc-contacts">
                      {(u.contacts||[]).map((c, i) => <div key={i} className="uc-contact">{c.emoji} {c.name} · <span style={{ color: "#5A6580" }}>{c.relation}</span></div>)}
                      </div>
                      <div className="uc-bracelet">⌚ Pulsera {u.braceletColor || "Estándar"}</div>
                      <div className="uc-actions">
                        <button className="uc-btn" onClick={() => setSelected(u)}>👁 Ver</button>
                        <button className="uc-btn" onClick={() => setPreviewUser(u)}>📡 Preview</button>
                        <button className="uc-btn" onClick={() => { setQrUser(u); setTab("qr"); }}>📱 QR</button>
                        <button className="uc-btn" onClick={() => { setEditing(u); setTab("register"); }}>✏️</button>
                        <button className="uc-btn uc-btn-d" onClick={() => setDeleting(u)}>🗑️</button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>}

          {/* ═══ REGISTER ═══ */}
          {tab === "register" && <UserForm user={editing} onSubmit={d => editing ? updateUser(editing.id, d) : addUser(d)} onCancel={() => { setEditing(null); setTab("manage"); }} loading={loading} />}

          {/* ═══ SCANS ═══ */}
          {tab === "scans" && <>
            <div className="ph"><h1 className="pt">Registro de Escaneos</h1><p className="ps">Historial de activaciones de pulseras NFC</p></div>
            <div className="pb">
              <div className="scan-stats">
                <div className="ss-item"><span className="ss-icon" style={{ color: "#EF4444" }}>🚨</span><span className="ss-val">{stats.emergencies}</span><span className="ss-lbl">Emergencias</span></div>
                <div className="ss-item"><span className="ss-icon" style={{ color: "#F59E0B" }}>🔍</span><span className="ss-val">{stats.lost}</span><span className="ss-lbl">Extravíos</span></div>
                <div className="ss-item"><span className="ss-icon" style={{ color: "#2A6DB5" }}>ℹ️</span><span className="ss-val">{stats.info}</span><span className="ss-lbl">Informativos</span></div>
              </div>
              <div className="scan-list full">
                {scans.length === 0 ? <div className="emp"><p>Sin escaneos registrados</p></div> :
                  scans.map((s, i) => {
                    const u = users.find(x => x.id === s.userId);
                    return (
                      <div key={s.id} className="scan-card" style={{ animationDelay: `${i * .04}s` }}>
                        <div className={`scan-type st-${s.type}`}>{s.type === "emergency" ? "🚨" : s.type === "lost" ? "🔍" : "ℹ️"}</div>
                        <div className="scan-info">
                          <div className="scan-name">{u?.name || "—"} <span className="scan-nfc">{u?.nfcId}</span></div>
                          <div className="scan-loc">📍 {s.location}</div>
                          {s.notes && <div className="scan-notes">{s.notes}</div>}
                          {s.scannerPhone && <div className="scan-phone">📱 Rescatista: {s.scannerPhone}</div>}
                        </div>
                        <div className="scan-time">{new Date(s.ts).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>}

          {/* ═══ QR ═══ */}
          {tab === "qr" && <>
            <div className="ph"><h1 className="pt">Generador de Códigos</h1><p className="ps">{qrUser ? `Código de ${qrUser.name}` : "Selecciona un usuario para generar su código QR"}</p></div>
            <div className="pb">
              {!qrUser ? (
                <div className="pkg">{users.map(u => (
                  <div key={u.id} className="pkc" onClick={() => setQrUser(u)}><span style={{ fontSize: "1.4rem" }}>{u.photo}</span><div><div style={{ fontWeight: 700, fontSize: ".86rem" }}>{u.name}</div><div style={{ fontSize: ".72rem", color: "#5A6580" }}>{u.nfcId} · ⌚ {u.braceletColor || "Estándar"}</div></div></div>
                ))}</div>
              ) : (<>
                <button className="btn-gh" onClick={() => setQrUser(null)} style={{ marginBottom: "1.25rem" }}>← Todos los usuarios</button>
                <div className="qr-layout">
                  <div className="qr-main">
                    <QRView data={`safepulse.pe/id?id=${qrUser.nfcId}`} />
                    <p className="qr-url">safepulse.pe/id?id={qrUser.nfcId}</p>
                    <p style={{ fontSize: ".72rem", color: "#5A6580", marginTop: ".5rem" }}>Este código se programa en la pulsera NFC del usuario</p>
                  </div>
                  <div className="id-card">
                    <div className="idc-bar" />
                    <div className="idc-hd"><div className="idc-logo">⌚</div><span>SafePulse Emergency ID</span></div>
                    <div className="idc-photo">{qrUser.photo}</div>
                    <h3 className="idc-nm">{qrUser.name}</h3>
                    <div className="idc-row"><span className="idc-lbl">DNI</span><span>{qrUser.dni}</span></div>
                    <div className="idc-row"><span className="idc-lbl">Sangre</span><span className="btag">{qrUser.bloodType}</span></div>
                    <div className="idc-row"><span className="idc-lbl">Condición</span><span>{qrUser.condition}</span></div>
                    <div className="idc-row"><span className="idc-lbl">NFC</span><span style={{ fontFamily: "'DM Mono',monospace" }}>{qrUser.nfcId}</span></div>
                    <div className="idc-row"><span className="idc-lbl">Pulsera</span><span>⌚ {qrUser.braceletColor || "Estándar"}</span></div>
                    {qrUser.observation && <div className="idc-obs">👁 {qrUser.observation}</div>}
                    <div className="idc-ft">En caso de emergencia, escanear pulsera NFC</div>
                  </div>
                </div>
              </>)}
            </div>
          </>}

          {/* ═══ EXPORT ═══ */}
          {tab === "export" && <>
            <div className="ph"><h1 className="pt">Exportar Datos</h1><p className="ps">Descarga información del sistema</p></div>
            <div className="pb">
              <div className="exp-grid">
                <div className="exp-card" onClick={exportCSV}><div className="exp-i">⌚</div><h3>Usuarios y Pulseras</h3><p>{users.length} registros</p><span className="exp-fmt">CSV</span></div>
                <div className="exp-card" onClick={exportScansCSV}><div className="exp-i">📡</div><h3>Registro de Escaneos</h3><p>{scans.length} eventos</p><span className="exp-fmt">CSV</span></div>
                <div className="exp-card" onClick={() => {
                  const d = JSON.stringify({ users, scans, audit: audit.slice(0, 100) }, null, 2);
                  const blob = new Blob([d], { type: "application/json" }); const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `safepulse_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
                  toast("Backup exportado");
                }}><div className="exp-i">💾</div><h3>Backup Completo</h3><p>Todo el sistema</p><span className="exp-fmt">JSON</span></div>
              </div>
            </div>
          </>}

          {/* ═══ AUDIT ═══ */}
          {tab === "audit" && <>
            <div className="ph"><h1 className="pt">Seguridad y Auditoría</h1><p className="ps">{audit.length} eventos registrados</p></div>
            <div className="pb">
              {audit.length === 0 ? <div className="emp"><p>Sin actividad</p></div> :
                <div className="au-list">{audit.slice(0, 60).map((e, i) => (
                  <div key={e.id} className="au-row" style={{ animationDelay: `${i * .03}s` }}>
                    <div className="au-badge">{e.action.includes("LOGIN") ? "🔑" : e.action.includes("REGISTRO") ? "➕" : e.action.includes("ELIM") ? "🗑️" : e.action.includes("EDIT") ? "✏️" : e.action.includes("EXPORT") ? "📤" : e.action.includes("ESTADO") ? "⌚" : "📝"}</div>
                    <div className="au-info"><div className="au-act">{e.action}</div><div className="au-det">{e.detail}</div></div>
                    <div className="au-time">{new Date(e.ts).toLocaleDateString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                ))}</div>
              }
            </div>
          </>}

        </main>
      </div>

      {/* ═══ MODALS ═══ */}
      {selected && <Modal onClose={() => setSelected(null)} title="Perfil de Emergencia" sub={selected.nfcId}>
        <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
          <div className="m-avatar">{selected.photo}</div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>{selected.name}</h2>
          <p style={{ fontFamily: "'DM Mono',monospace", fontSize: ".78rem", color: "#5A6580", marginTop: ".2rem" }}>🪪 DNI: {selected.dni} · ⌚ Pulsera {selected.braceletColor || "Estándar"}</p>
        </div>
        <div className="dg">
          <div className="dc"><div className="dl">🩸 Sangre</div><div className="dv">{selected.bloodType}</div></div>
          <div className="dc"><div className="dl">🫀 Condición</div><div className="dv">{selected.condition}</div></div>
          <div className="dc full"><div className="dl">⚠️ Alergias</div><div className="tgl">{(selected.allergies||[]).map((a, i) => <span key={i} className="tgr">{a}</span>)}</div></div>
          <div className="dc full"><div className="dl">💊 Medicamentos</div><div className="tgl">{(selected.meds||[]).map((m, i) => <span key={i} className="tgb">{m}</span>)}</div></div>
          {selected.observation && <div className="dc full obs-hl"><div className="dl">👁 Observación Importante</div><div className="dv" style={{ fontWeight: 500, lineHeight: 1.6 }}>{selected.observation}</div></div>}
          <div className="dc full"><div className="dl">📞 Contactos de Emergencia</div>{(selected.contacts||[]).map((c, i) => <div key={i} className="crow"><span style={{ fontSize: "1.2rem" }}>{c.emoji}</span><div><strong>{c.name}</strong><br /><span style={{ fontSize: ".78rem", color: "#A0ADC4" }}>{c.relation} · {c.phone}</span></div></div>)}</div>
        </div>
      </Modal>}

      {/* SCAN PREVIEW */}
      {previewUser && <Modal onClose={() => setPreviewUser(null)} title="Vista del Rescatista" sub="Así se ve cuando alguien escanea la pulsera">
        <div className="preview-frame">
          <div className="pv-header">
            <div className="pv-pill">⚕ INFORMACIÓN MÉDICA DE EMERGENCIA</div>
            <div className="pv-photo">{previewUser.photo}</div>
            <div className="pv-blood">{previewUser.bloodType}</div>
            <h2 className="pv-name">{previewUser.name}</h2>
            <p className="pv-dni">🪪 DNI: {previewUser.dni}</p>
          </div>
          <div className="pv-body">
            <div className="pv-card"><span className="pv-lbl">🫀 Condición</span><span className="pv-val">{previewUser.condition}</span></div>
            <div className="pv-card"><span className="pv-lbl">⚠️ Alergias</span><div className="tgl" style={{ marginTop: ".3rem" }}>{(previewUser.allergies||[]).map((a, i) => <span key={i} className="tgr">{a}</span>)}</div></div>
            <div className="pv-card"><span className="pv-lbl">💊 Medicamentos</span><div className="tgl" style={{ marginTop: ".3rem" }}>{(previewUser.meds||[]).map((m, i) => <span key={i} className="tgb">{m}</span>)}</div></div>
            {previewUser.observation && <div className="pv-card pv-obs"><span className="pv-lbl">👁 Observación</span><p style={{ marginTop: ".3rem", fontSize: ".84rem", lineHeight: 1.55, color: "#EDF0F7" }}>{previewUser.observation}</p></div>}
            <div className="pv-card"><span className="pv-lbl">📞 Contactos de Emergencia</span>
              {(previewUser.contacts||[]).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: ".6rem", marginTop: ".5rem", padding: ".5rem", background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                  <span style={{ fontSize: "1.3rem" }}>{c.emoji}</span>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: ".88rem" }}>{c.name}</div><div style={{ fontSize: ".75rem", color: "#5A6580" }}>{c.relation} · {c.phone}</div></div>
                  <a href={`tel:${c.phone}`} style={{ padding: ".35rem .65rem", background: "rgba(96,165,250,.1)", borderRadius: 8, color: "#60A5FA", fontSize: ".8rem", fontWeight: 600, textDecoration: "none" }}>📞 Llamar</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>}

      {deleting && <Modal onClose={() => setDeleting(null)} title="Desactivar Pulsera" small>
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>⌚</div>
          <p style={{ fontSize: ".9rem", color: "#A0ADC4", lineHeight: 1.6 }}>¿Eliminar la pulsera de <strong style={{ color: "#EDF0F7" }}>{deleting.name}</strong> ({deleting.nfcId})?</p>
          <div style={{ display: "flex", gap: ".75rem", marginTop: "1.25rem" }}>
            <button className="btn-gh" style={{ flex: 1 }} onClick={() => setDeleting(null)}>Cancelar</button>
            <button className="btn-dng" style={{ flex: 1 }} onClick={() => deleteUser(deleting.id)} disabled={loading}>
              {loading ? "..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUBCOMPONENTS
   ═══════════════════════════════════════════ */
function Modal({ children, onClose, title, sub, small }) {
  return <div className="mbg" onClick={onClose}><div className={`mbox${small ? " msm" : ""}`} onClick={e => e.stopPropagation()}>
    <div className="mhd"><div><div className="mtt">{title}</div>{sub && <div className="msu">{sub}</div>}</div><button className="mx" onClick={onClose}>✕</button></div>{children}
  </div></div>;
}

function QRView({ data }) {
  const mx = useMemo(() => genQR(data), [data]);
  const cs = 6;
  return <svg width={mx.length * cs + 20} height={mx.length * cs + 20} style={{ background: "white", borderRadius: 14, padding: 10 }}>
    {mx.map((row, y) => row.map((cell, x) => cell ? <rect key={`${y}-${x}`} x={x * cs + 10} y={y * cs + 10} width={cs - .5} height={cs - .5} rx={1} fill="#0a0f1a" /> : null))}
  </svg>;
}

function UserForm({ user, onSubmit, onCancel, loading }) {
  const [f, sf] = useState({
    name: user?.name || "", dni: user?.dni || "", photo: user?.photo || "👤", bloodType: user?.bloodType || "O+",
    condition: user?.condition || "", observation: user?.observation || "", braceletColor: user?.braceletColor || "Negro",
    allergies: user?.allergies || [], meds: user?.meds || [],
    contacts: user?.contacts || [{ name: "", relation: "", phone: "", emoji: "👤" }, { name: "", relation: "", phone: "", emoji: "👤" }],
  });
  const [ai, setAi] = useState(""); const [mi, setMi] = useState(""); const [err, setErr] = useState({});
  const s = (k, v) => sf(p => ({ ...p, [k]: v }));
  const sc = (i, k, v) => { const c = [...f.contacts]; c[i] = { ...c[i], [k]: v }; s("contacts", c); };
  const val = () => { const e = {}; if (!f.name.trim()) e.name = 1; if (!f.dni.trim() || !Sec.validDni(f.dni)) e.dni = 1; if (!f.condition.trim()) e.condition = 1; if (!f.contacts[0]?.name.trim()) e.c0n = 1; if (!f.contacts[0]?.phone.trim() || !Sec.validPhone(f.contacts[0].phone)) e.c0p = 1; setErr(e); return !Object.keys(e).length; };
  const sub = () => { if (!val()) return; onSubmit({ name: Sec.clean(f.name), dni: Sec.clean(f.dni), photo: f.photo, bloodType: f.bloodType, condition: Sec.clean(f.condition), observation: Sec.clean(f.observation), braceletColor: f.braceletColor, allergies: f.allergies.map(Sec.clean), meds: f.meds.map(Sec.clean), contacts: f.contacts.filter(c => c.name.trim()).map(c => ({ name: Sec.clean(c.name), relation: Sec.clean(c.relation), phone: Sec.clean(c.phone), emoji: c.emoji })) }); };
  const emos = ["👤", "👨", "👩", "👦", "👧", "👨‍🦳", "👩‍🦳", "👶", "👩‍🦱", "👨‍🦱", "👴", "👵"];
  const bts = ["O+", "O−", "A+", "A−", "B+", "B−", "AB+", "AB−"];
  const cemos = ["👤", "👨", "👩", "👨‍⚕️", "👩‍⚕️", "👴", "👵", "🏫", "🏠"];
  const braceletColors = ["Negro", "Rojo", "Azul", "Rosa", "Blanco", "Verde"];

  return <>
    <div className="ph"><h1 className="pt">{user ? "Editar Pulsera" : "Registrar Nueva Pulsera"}</h1><p className="ps">{user ? "Actualiza la información" : "Asigna una pulsera NFC a un nuevo usuario"}</p></div>
    <div className="pb">
      <div className="fs"><h3 className="fh">👤 Datos del Usuario</h3><div className="fg">
        <div className="fgp"><label className="fl">Foto / Emoji</label><div className="emr">{emos.map(e => <button key={e} className={`emb${f.photo === e ? " esl" : ""}`} onClick={() => s("photo", e)}>{e}</button>)}</div></div>
        <div className="fgp"><label className="fl">Color de Pulsera</label><select className="fi" value={f.braceletColor} onChange={e => s("braceletColor", e.target.value)}>{braceletColors.map(c => <option key={c} value={c}>⌚ {c}</option>)}</select></div>
        <div className="fgp"><label className="fl">Nombre Completo *</label><input className={`fi${err.name ? " ferr" : ""}`} value={f.name} onChange={e => s("name", e.target.value)} placeholder="María Elena García" /></div>
        <div className="fgp"><label className="fl">DNI / Documento *</label><input className={`fi${err.dni ? " ferr" : ""}`} value={f.dni} onChange={e => s("dni", e.target.value)} placeholder="47 382 910" /></div>
        <div className="fgp"><label className="fl">Tipo de Sangre</label><select className="fi" value={f.bloodType} onChange={e => s("bloodType", e.target.value)}>{bts.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
      </div></div>

      <div className="fs"><h3 className="fh">🫀 Información Médica</h3><div className="fg">
        <div className="fgp full"><label className="fl">Condición Médica Principal *</label><input className={`fi${err.condition ? " ferr" : ""}`} value={f.condition} onChange={e => s("condition", e.target.value)} placeholder="Diabetes, Epilepsia, Alzheimer, Anafilaxia..." /></div>
        <div className="fgp full"><label className="fl">⚠️ Alergias</label><div className="tir"><input className="fi" value={ai} onChange={e => setAi(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const v = Sec.clean(ai); if (v && !f.allergies.includes(v)) s("allergies", [...f.allergies, v]); setAi(""); } }} placeholder="Escribe y presiona Enter" /><button className="bta" onClick={() => { const v = Sec.clean(ai); if (v && !f.allergies.includes(v)) s("allergies", [...f.allergies, v]); setAi(""); }}>+</button></div><div className="tgl">{f.allergies.map((a, i) => <span key={i} className="tgr" onClick={() => s("allergies", f.allergies.filter((_, j) => j !== i))}>{a} ×</span>)}</div></div>
        <div className="fgp full"><label className="fl">💊 Medicamentos</label><div className="tir"><input className="fi" value={mi} onChange={e => setMi(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const v = Sec.clean(mi); if (v && !f.meds.includes(v)) s("meds", [...f.meds, v]); setMi(""); } }} placeholder="Escribe y presiona Enter" /><button className="bta" onClick={() => { const v = Sec.clean(mi); if (v && !f.meds.includes(v)) s("meds", [...f.meds, v]); setMi(""); }}>+</button></div><div className="tgl">{f.meds.map((m, i) => <span key={i} className="tgb" onClick={() => s("meds", f.meds.filter((_, j) => j !== i))}>{m} ×</span>)}</div></div>
        <div className="fgp full"><label className="fl">👁 Observación Importante</label><textarea className="fta" value={f.observation} onChange={e => s("observation", e.target.value)} placeholder="Información crítica para rescatistas (miedos, ubicación de medicamentos, instrucciones especiales...)" /></div>
      </div></div>

      <div className="fs"><h3 className="fh">📞 Contactos de Emergencia</h3>
        {f.contacts.map((c, i) => (
          <div key={i} style={{ marginBottom: "1rem", padding: "1rem", background: "rgba(255,255,255,.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".75rem" }}>
              <span style={{ fontSize: ".75rem", fontWeight: 700, color: "#5A6580" }}>CONTACTO {i + 1} {i === 0 && "*"}</span>
              <div className="emr" style={{ marginLeft: "auto" }}>{cemos.map(e => <button key={e} className={`emb emsm${c.emoji === e ? " esl" : ""}`} onClick={() => sc(i, "emoji", e)}>{e}</button>)}</div>
            </div>
            <div className="fg">
              <div className="fgp"><label className="fl">Nombre {i === 0 && "*"}</label><input className={`fi${i === 0 && err.c0n ? " ferr" : ""}`} value={c.name} onChange={e => sc(i, "name", e.target.value)} placeholder="Carlos García" /></div>
              <div className="fgp"><label className="fl">Relación</label><input className="fi" value={c.relation} onChange={e => sc(i, "relation", e.target.value)} placeholder="Esposo, Madre, Médico..." /></div>
              <div className="fgp full"><label className="fl">Teléfono {i === 0 && "*"}</label><input className={`fi${i === 0 && err.c0p ? " ferr" : ""}`} value={c.phone} onChange={e => sc(i, "phone", e.target.value)} placeholder="+51 987 654 321" /></div>
            </div>
          </div>
        ))}
        {f.contacts.length < 3 && <button className="btn-gh" onClick={() => s("contacts", [...f.contacts, { name: "", relation: "", phone: "", emoji: "👤" }])}>+ Añadir otro contacto</button>}
      </div>

      <div style={{ display: "flex", gap: ".75rem", marginTop: "1.5rem" }}>
        <button className="btn-gh" onClick={onCancel}>Cancelar</button>
        <button className="btn-p" onClick={sub} disabled={loading} style={{ flex: 1 }}>
          {loading ? "⏳ Guardando..." : user ? "💾 Guardar Cambios" : "⌚ Registrar Pulsera"}
        </button>
      </div>
    </div>
  </>;
}

/* ═══════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800;900&display=swap');

*{margin:0;padding:0;box-sizing:border-box}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes loading{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

.bgfx{position:fixed;inset:0;background:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(204,32,39,.12),transparent),radial-gradient(ellipse 60% 40% at 100% 100%,rgba(42,109,181,.08),transparent);pointer-events:none;z-index:0}
.bggr{position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");opacity:.03;pointer-events:none;z-index:0}

.toasts{position:fixed;top:1rem;right:1rem;z-index:200;display:flex;flex-direction:column;gap:.5rem}
.toast{padding:.65rem 1.1rem;border-radius:12px;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:.5rem;animation:fadeUp .3s ease;backdrop-filter:blur(12px)}
.t-success{background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.25);color:#10B981}
.t-error{background:rgba(204,32,39,.15);border:1px solid rgba(204,32,39,.25);color:#FF5560}
.t-info{background:rgba(42,109,181,.15);border:1px solid rgba(42,109,181,.25);color:#5EA4E8}

.login-card{background:rgba(15,19,32,.8);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:2.5rem 2rem;width:100%;max-width:380px;position:relative;z-index:1;animation:fadeUp .5s ease}
.login-logo{position:relative;width:70px;height:70px;margin:0 auto 1.5rem}.login-logo-inner{width:100%;height:100%;background:linear-gradient(135deg,#CC2027,#e84850);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;box-shadow:0 8px 32px rgba(204,32,39,.4)}.login-logo-ring{position:absolute;inset:-8px;border:2px solid rgba(204,32,39,.2);border-radius:26px;animation:pulse 2s infinite}
.login-title{text-align:center;font-size:1.4rem;font-weight:800;letter-spacing:-.03em;margin-bottom:.25rem}.login-sub{text-align:center;font-size:.78rem;color:#5A6580;margin-bottom:1.5rem}
.login-err{background:rgba(204,32,39,.1);border:1px solid rgba(204,32,39,.2);border-radius:10px;padding:.55rem .85rem;font-size:.78rem;color:#FF5560;text-align:center}
.sec-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .75rem;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.15);border-radius:20px;font-size:.68rem;font-weight:600;color:#10B981}

.layout{display:flex;min-height:100vh;position:relative}
.sb{width:248px;background:rgba(12,16,28,.85);backdrop-filter:blur(16px);border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:40;transition:transform .25s ease}
.sb-hd{padding:1.3rem 1.1rem;border-bottom:1px solid rgba(255,255,255,.06)}.sb-brand{display:flex;align-items:center;gap:.6rem}.sb-logo{width:34px;height:34px;background:linear-gradient(135deg,#CC2027,#e84850);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;box-shadow:0 4px 14px rgba(204,32,39,.35)}.sb-name{font-weight:800;font-size:.96rem;letter-spacing:-.02em}.sb-tag{font-size:.58rem;color:#5A6580;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.sb-nav{flex:1;padding:.7rem .55rem;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
.sb-item{display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;border-radius:10px;cursor:pointer;font-weight:500;font-size:.8rem;color:#A0ADC4;transition:all .15s;border:1px solid transparent;position:relative;user-select:none}.sb-item:hover{background:rgba(255,255,255,.04);color:#EDF0F7}.sb-item.active{background:rgba(204,32,39,.1);border-color:rgba(204,32,39,.18);color:#ff6b70;font-weight:600}.sb-item.active::before{content:'';position:absolute;left:-.55rem;top:50%;transform:translateY(-50%);width:3px;height:16px;background:#CC2027;border-radius:0 3px 3px 0}
.sb-ico{font-size:.9rem;width:20px;text-align:center}.sb-badge{margin-left:auto;background:#CC2027;color:#fff;font-size:.58rem;font-weight:700;padding:1px 6px;border-radius:8px}
.sb-ft{padding:.8rem 1.1rem;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:.45rem}.sb-sec{display:flex;align-items:center;gap:.4rem;font-size:.66rem;font-weight:600;color:#10B981}.sb-dot{width:5px;height:5px;background:#10B981;border-radius:50%;animation:pulse 2s infinite}
.btn-lo{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.4rem .7rem;color:#5A6580;font-family:'Outfit',sans-serif;font-size:.73rem;font-weight:600;cursor:pointer;transition:all .15s}.btn-lo:hover{background:rgba(204,32,39,.1);color:#ff6b70;border-color:rgba(204,32,39,.2)}

.mn{flex:1;margin-left:248px;min-height:100vh;position:relative;z-index:1}
.ph{padding:1.4rem 1.8rem 1rem;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(12,16,28,.5);backdrop-filter:blur(12px);position:sticky;top:0;z-index:20}.pt{font-size:1.4rem;font-weight:800;letter-spacing:-.03em}.ps{font-size:.78rem;color:#5A6580;margin-top:.12rem}.pb{padding:1.4rem 1.8rem 3rem}

.kpi-g{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin-bottom:1.4rem}.kpi{background:rgba(15,19,32,.7);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:1.1rem;animation:fadeUp .5s ease both;transition:all .2s}.kpi:hover{border-color:rgba(255,255,255,.12);transform:translateY(-2px)}.kpi-i{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;margin-bottom:.5rem}.kpi-v{font-size:1.7rem;font-weight:900;font-family:'DM Mono',monospace}.kpi-l{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#5A6580;margin-top:.08rem}.kpi-s{font-size:.66rem;color:#3A4560;margin-top:.1rem}

.ch-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.ch-p{background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:1.2rem}.ch-h{font-size:.84rem;font-weight:700;margin-bottom:.8rem}

.srch{display:flex;align-items:center;gap:.55rem;background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:0 1rem;margin-bottom:1.2rem;transition:border-color .2s}.srch:focus-within{border-color:#CC2027}.srch input{flex:1;background:transparent;border:none;color:#EDF0F7;font-family:'Outfit',sans-serif;font-size:.84rem;padding:.7rem 0;outline:none}.srch input::placeholder{color:#3A4560}

.user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem}
.user-card{background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:1.25rem;transition:all .2s;display:flex;flex-direction:column;gap:.4rem}.user-card:hover{border-color:rgba(255,255,255,.12);transform:translateY(-2px)}
.uc-top{display:flex;justify-content:space-between;align-items:center}
.uc-avatar{width:42px;height:42px;border-radius:50%;border:2px solid #CC2027;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:1.4rem;box-shadow:0 0 0 4px rgba(204,32,39,.1)}
.uc-status{display:inline-flex;align-items:center;gap:.3rem;font-size:.68rem;font-weight:600;cursor:pointer;padding:.18rem .5rem;border-radius:12px}.s-active{color:#10B981;background:rgba(16,185,129,.08)}.s-inactive{color:#F59E0B;background:rgba(245,158,11,.08)}.sdot{width:5px;height:5px;border-radius:50%;background:currentColor}
.uc-name{font-size:1rem;font-weight:700;margin-top:.25rem}
.uc-meta{font-family:'DM Mono',monospace;font-size:.7rem;color:#5A6580}
.uc-tags{display:flex;gap:.35rem;flex-wrap:wrap}
.btag{display:inline-flex;padding:.15rem .45rem;background:rgba(204,32,39,.12);border:1px solid rgba(204,32,39,.2);border-radius:6px;font-family:'DM Mono',monospace;font-size:.7rem;font-weight:600;color:#ff6b70}
.ctag{padding:.15rem .5rem;border-radius:6px;font-size:.7rem;font-weight:600;background:rgba(42,109,181,.1);color:#5EA4E8;border:1px solid rgba(42,109,181,.18)}
.uc-obs{font-size:.76rem;color:#F59E0B;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.1);border-radius:8px;padding:.4rem .6rem;line-height:1.45}
.uc-contacts{font-size:.76rem;color:#A0ADC4;display:flex;flex-direction:column;gap:.15rem}
.uc-contact{display:flex;align-items:center;gap:.3rem}
.uc-bracelet{font-size:.72rem;color:#5A6580;font-weight:600;margin-top:.15rem}
.uc-actions{display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap}
.uc-btn{padding:.3rem .55rem;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:transparent;color:#A0ADC4;font-family:'Outfit',sans-serif;font-size:.7rem;font-weight:600;cursor:pointer;transition:all .15s}.uc-btn:hover{background:rgba(255,255,255,.06);color:#EDF0F7}.uc-btn-d:hover{background:rgba(204,32,39,.12);color:#CC2027}

.scan-stats{display:flex;gap:1rem;margin-bottom:1.25rem}.ss-item{display:flex;align-items:center;gap:.5rem;background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:.65rem 1rem;flex:1}.ss-icon{font-size:1.2rem}.ss-val{font-size:1.3rem;font-weight:900;font-family:'DM Mono',monospace}.ss-lbl{font-size:.72rem;color:#5A6580;font-weight:600}
.scan-list{display:flex;flex-direction:column;gap:.5rem}
.scan-card{display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:14px;animation:fadeUp .3s ease both;transition:all .15s}.scan-card:hover{border-color:rgba(255,255,255,.1)}
.scan-type{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}.st-emergency{background:rgba(204,32,39,.12)}.st-lost{background:rgba(245,158,11,.12)}.st-info{background:rgba(42,109,181,.12)}
.scan-info{flex:1;min-width:0}.scan-name{font-size:.86rem;font-weight:600}.scan-nfc{font-family:'DM Mono',monospace;font-size:.7rem;color:#5A6580;margin-left:.3rem}.scan-loc{font-size:.76rem;color:#A0ADC4;margin-top:.1rem}.scan-notes{font-size:.76rem;color:#5A6580;margin-top:.2rem;line-height:1.4}.scan-phone{font-size:.72rem;color:#5A6580;margin-top:.15rem;font-family:'DM Mono',monospace}
.scan-time{font-family:'DM Mono',monospace;font-size:.68rem;color:#3A4560;white-space:nowrap;flex-shrink:0}

.pkg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem}.pkc{display:flex;align-items:center;gap:.7rem;padding:.8rem 1rem;background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:14px;cursor:pointer;transition:all .15s}.pkc:hover{border-color:rgba(204,32,39,.25);background:rgba(204,32,39,.04);transform:translateY(-1px)}
.qr-layout{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;align-items:start}.qr-main{background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:2rem;display:flex;flex-direction:column;align-items:center}.qr-url{font-family:'DM Mono',monospace;font-size:.72rem;color:#5A6580;margin-top:.8rem;text-align:center}
.id-card{background:linear-gradient(135deg,rgba(15,19,32,.92),rgba(20,25,40,.92));border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:1.65rem;position:relative;overflow:hidden}
.idc-bar{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#CC2027,#2A6DB5)}
.idc-hd{display:flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:700;color:#5A6580;letter-spacing:.06em;margin-bottom:1.2rem;margin-top:.3rem}.idc-logo{width:26px;height:26px;background:#CC2027;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.75rem}
.idc-photo{width:56px;height:56px;border-radius:50%;border:2px solid #CC2027;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:1.7rem;margin:0 auto .7rem}
.idc-nm{text-align:center;font-size:1.05rem;font-weight:800;margin-bottom:.8rem}
.idc-row{display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem}
.idc-lbl{font-size:.66rem;font-weight:700;color:#5A6580;letter-spacing:.06em;text-transform:uppercase}
.idc-obs{margin-top:.7rem;padding:.6rem;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.12);border-radius:10px;font-size:.76rem;color:#F59E0B;line-height:1.45}
.idc-ft{text-align:center;margin-top:.85rem;font-size:.62rem;font-weight:600;color:#3A4560;letter-spacing:.08em;text-transform:uppercase}

.exp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}.exp-card{background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:1.65rem;text-align:center;cursor:pointer;transition:all .2s}.exp-card:hover{border-color:rgba(204,32,39,.25);transform:translateY(-3px);box-shadow:0 8px 28px rgba(0,0,0,.3)}.exp-i{font-size:2rem;margin-bottom:.55rem}.exp-card h3{font-size:.92rem;font-weight:700;margin-bottom:.15rem}.exp-card p{font-size:.76rem;color:#5A6580}.exp-fmt{display:inline-block;margin-top:.55rem;padding:.18rem .55rem;background:rgba(42,109,181,.1);border:1px solid rgba(42,109,181,.2);border-radius:8px;font-size:.68rem;font-weight:700;color:#5EA4E8}

.au-list{display:flex;flex-direction:column;gap:.35rem}.au-row{display:flex;align-items:center;gap:.7rem;padding:.6rem .8rem;background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.04);border-radius:11px;animation:fadeUp .3s ease both}.au-badge{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0}.au-info{flex:1;min-width:0}.au-act{font-size:.78rem;font-weight:700}.au-det{font-size:.72rem;color:#5A6580;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.au-time{font-family:'DM Mono',monospace;font-size:.66rem;color:#3A4560;white-space:nowrap;flex-shrink:0}

.fs{background:rgba(15,19,32,.7);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:1.4rem;margin-bottom:1.2rem}.fh{font-size:.9rem;font-weight:700;margin-bottom:.9rem}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.fgp{display:flex;flex-direction:column;gap:.3rem}.fgp.full{grid-column:1/-1}
.fl{font-size:.65rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5A6580}
.fi{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:.65rem .85rem;color:#EDF0F7;font-family:'Outfit',sans-serif;font-size:.84rem;outline:none;transition:border-color .2s}.fi:focus{border-color:#CC2027}.fi::placeholder{color:#3A4560}.fi option{background:#0F1320}.ferr{border-color:#CC2027!important}
.fta{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:.65rem .85rem;color:#EDF0F7;font-family:'Outfit',sans-serif;font-size:.84rem;outline:none;min-height:80px;resize:vertical;width:100%;transition:border-color .2s}.fta:focus{border-color:#CC2027}.fta::placeholder{color:#3A4560}
.emr{display:flex;gap:.25rem;flex-wrap:wrap}.emb{width:34px;height:34px;font-size:1.05rem;border:1px solid rgba(255,255,255,.06);border-radius:9px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}.emsm{width:30px;height:30px;font-size:.9rem;border-radius:7px}.esl{border-color:#CC2027;background:rgba(204,32,39,.12)}
.tir{display:flex;gap:.45rem}.tir input{flex:1}.bta{width:38px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#A0ADC4;font-size:1rem;cursor:pointer}.bta:hover{background:rgba(204,32,39,.12);color:#ff6b70}
.tgl{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.35rem}.tgr{padding:.18rem .55rem;border-radius:14px;font-size:.72rem;font-weight:600;background:rgba(204,32,39,.1);color:#FF5560;border:1px solid rgba(204,32,39,.2);cursor:pointer;transition:opacity .15s}.tgr:hover{opacity:.7}.tgb{padding:.18rem .55rem;border-radius:14px;font-size:.72rem;font-weight:600;background:rgba(42,109,181,.1);color:#5EA4E8;border:1px solid rgba(42,109,181,.2);cursor:pointer;transition:opacity .15s}.tgb:hover{opacity:.7}

.btn-p{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;padding:.65rem 1.4rem;background:linear-gradient(135deg,#CC2027,#e84850);border:none;border-radius:12px;color:#fff;font-family:'Outfit',sans-serif;font-weight:700;font-size:.84rem;cursor:pointer;box-shadow:0 4px 18px rgba(204,32,39,.3);transition:all .2s}.btn-p:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(204,32,39,.4)}.btn-p:disabled{opacity:.6;cursor:not-allowed;transform:none}
.btn-gh{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#A0ADC4;font-family:'Outfit',sans-serif;font-weight:600;font-size:.8rem;cursor:pointer;transition:all .15s}.btn-gh:hover{background:rgba(255,255,255,.08);color:#EDF0F7}
.btn-dng{display:inline-flex;align-items:center;justify-content:center;padding:.65rem 1.4rem;background:#CC2027;border:none;border-radius:12px;color:#fff;font-family:'Outfit',sans-serif;font-weight:700;font-size:.84rem;cursor:pointer}.btn-dng:disabled{opacity:.6;cursor:not-allowed}

.mbg{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(10px);z-index:100;display:flex;align-items:center;justify-content:center;padding:1.5rem;animation:fadeUp .15s ease}
.mbox{background:rgba(15,19,32,.95);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.1);border-radius:22px;width:100%;max-width:580px;max-height:85vh;overflow-y:auto;padding:1.65rem;animation:fadeUp .3s cubic-bezier(.34,1.56,.64,1)}.msm{max-width:420px}
.mhd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.2rem}.mtt{font-size:1.05rem;font-weight:800}.msu{font-size:.72rem;color:#5A6580;margin-top:.15rem}.mx{width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:transparent;color:#5A6580;cursor:pointer;font-size:.85rem;display:flex;align-items:center;justify-content:center}.mx:hover{background:rgba(255,255,255,.05);color:#EDF0F7}
.m-avatar{width:60px;height:60px;border-radius:50%;border:3px solid #CC2027;box-shadow:0 0 0 5px rgba(204,32,39,.12);background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto .6rem}
.dg{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.dc{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:.75rem}.dc.full{grid-column:1/-1}.dl{font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5A6580;margin-bottom:.18rem}.dv{font-size:.84rem;font-weight:600}
.obs-hl{background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.15)}.obs-hl .dl{color:#F59E0B}
.crow{display:flex;align-items:center;gap:.55rem;margin-top:.45rem;font-size:.82rem}
.emp{text-align:center;padding:2.5rem 1.5rem;color:#5A6580;font-size:.86rem}

.preview-frame{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden}
.pv-header{background:linear-gradient(180deg,rgba(27,43,94,.2),transparent);padding:1.5rem 1.2rem 1rem;text-align:center}
.pv-pill{display:inline-flex;align-items:center;gap:.3rem;background:rgba(204,32,39,.12);border:1px solid rgba(204,32,39,.25);color:#FF4D55;padding:.25rem .75rem;border-radius:18px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1rem}
.pv-photo{width:70px;height:70px;border-radius:50%;border:3px solid #CC2027;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto .5rem;box-shadow:0 0 0 5px rgba(204,32,39,.1)}
.pv-blood{display:inline-block;background:#CC2027;color:#fff;font-family:'DM Mono',monospace;font-size:.75rem;padding:.15rem .45rem;border-radius:6px;margin-bottom:.5rem}
.pv-name{font-size:1.2rem;font-weight:800}.pv-dni{font-size:.8rem;color:#A0ADC4;font-family:'DM Mono',monospace;margin-top:.15rem}
.pv-body{padding:1rem 1.2rem 1.2rem;display:flex;flex-direction:column;gap:.6rem}
.pv-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:.75rem}
.pv-lbl{font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5A6580}
.pv-val{font-size:.88rem;font-weight:600;margin-top:.2rem;display:block}
.pv-obs{background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.12)}.pv-obs .pv-lbl{color:#F59E0B}

.mob-btn{display:none;position:fixed;top:.65rem;left:.65rem;z-index:50;width:36px;height:36px;background:rgba(15,19,32,.9);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#EDF0F7;font-size:1rem;cursor:pointer;align-items:center;justify-content:center}.mob-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:35}
@media(max-width:900px){.mob-btn{display:flex}.sb{transform:translateX(-100%)}.sb.open{transform:translateX(0)}.mn{margin-left:0}.ph{padding:1.2rem 1rem .8rem;padding-left:3.2rem}.pb{padding:1rem}.kpi-g{grid-template-columns:1fr 1fr}.ch-row{grid-template-columns:1fr}.fg{grid-template-columns:1fr}.user-grid{grid-template-columns:1fr}.qr-layout{grid-template-columns:1fr}.dg{grid-template-columns:1fr}.scan-stats{flex-direction:column}}
`;
