
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate
} from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import {
  Activity,
  ShieldCheck,
  Database,
  Users,
  FileSearch,
  AlertTriangle,
  LogOut,
  Play,
  Pause,
  RefreshCw,
  Lock
} from 'lucide-react';
import './style.css';

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const SOCKET =
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

function App() {
  const [token, setToken] = useState(
    localStorage.getItem('token') || ''
  );

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState([]);

  const nav = useNavigate();

  async function api(path, opts = {}) {
    const response = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...(opts.headers || {})
      }
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Request failed');
    }

    return result.data;
  }

  function notify(message) {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  }

  useEffect(() => {
    if (!token) return;

    const socket = io(SOCKET);

    socket.on('evidence:new', event => {
      setFeed(old => [event, ...old].slice(0, 20));
    });

    return () => socket.disconnect();
  }, [token]);

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    nav('/login');
  }

  if (!token) {
    return (
      <Login
        onLogin={(newToken, newUser) => {
          localStorage.setItem('token', newToken);
          localStorage.setItem('user', JSON.stringify(newUser));
          setToken(newToken);
          setUser(newUser);
          nav('/');
        }}
      />
    );
  }

  return (
    <div className={dark ? 'app dark' : 'app'}>
      <aside className="sidebar">

        <div className="brand">
          <div className="brandicon">
            <ShieldCheck />
          </div>

          <div>
            <b>Forensic<span>Ready</span></b>
            <small>SMART BUILDING</small>
          </div>
        </div>

        <div className="sim-label">
          <span /> SIMULATED BUILDING
        </div>

        <nav>
          <NavLink to="/" end>
            <Activity /> Overview
          </NavLink>

          <NavLink to="/alerts">
            <AlertTriangle /> Alerts
          </NavLink>

          <NavLink to="/integrity">
            <Lock /> Integrity & Custody
          </NavLink>

          <NavLink to="/investigation">
            <FileSearch /> Investigation
          </NavLink>

          <NavLink to="/readiness">
            <ShieldCheck /> Readiness
          </NavLink>

          {user?.role === 'admin' && (
            <NavLink to="/users">
              <Users /> Users
            </NavLink>
          )}

          <NavLink to="/results">
            <Database /> Results
          </NavLink>
        </nav>

        <div className="sidebottom">
          <button
            className="ghost"
            onClick={() => setDark(!dark)}
          >
            ◐ Toggle theme
          </button>

          <button className="ghost" onClick={logout}>
            <LogOut /> Sign out
          </button>

          <small>Team 3081 · Research prototype</small>
        </div>
      </aside>

      <main className="main">

        <header>
          <div>
            <small>SMART BUILDING / DIGITAL FORENSICS</small>
            <h1>Forensic readiness dashboard</h1>
          </div>

          <div className="userbox">
            <span className="avatar">
              {user?.name?.[0] || 'U'}
            </span>

            <div>
              <b>{user?.name}</b>
              <small>{user?.role}</small>
            </div>
          </div>
        </header>

        {toast && <div className="toast">{toast}</div>}

        <Routes>
          <Route
            path="/"
            element={
              <Overview
                api={api}
                refresh={refresh}
                notify={notify}
                feed={feed}
              />
            }
          />

          <Route
            path="/alerts"
            element={<Alerts api={api} />}
          />

          <Route
            path="/integrity"
            element={
              <Integrity
                api={api}
                notify={notify}
                refresh={() => setRefresh(x => x + 1)}
              />
            }
          />

          <Route
            path="/investigation"
            element={
              <Investigation api={api} notify={notify} />
            }
          />

          <Route
            path="/readiness"
            element={
              <Readiness api={api} notify={notify} />
            }
          />

          <Route
            path="/users"
            element={<UsersPage api={api} />}
          />

          <Route
            path="/results"
            element={<Results api={api} />}
          />

          <Route
            path="*"
            element={<Overview api={api} refresh={refresh} notify={notify} feed={feed} />}
          />
        </Routes>

        <footer>
          Simulated environment · No live building devices are connected.
        </footer>
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');

    try {
      const response = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Login failed');
      }

      onLogin(result.data.token, result.data.user);

    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">

        <div className="brandicon">
          <ShieldCheck />
        </div>

        <h1>ForensicReady</h1>

        <p>
          Sign in to the simulated smart building console.
        </p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        {err && <p className="error">{err}</p>}

        <button className="primary">Sign in</button>

        <small>
          Seed credentials are configured by the deployment administrator.
        </small>

      </form>
    </div>
  );
}

function Panel({ title, sub, children, action }) {
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Overview({ api, refresh, notify, feed }) {
  const [data, setData] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [status, records, incidentData, readiness] =
        await Promise.all([
          api('/simulation/status'),
          api('/evidence?limit=8'),
          api('/incidents?limit=6'),
          api('/readiness/current')
        ]);

      setData({ s: status, r: readiness });
      setEvidence(records.items || []);
      setIncidents(incidentData.items || []);

    } catch (error) {
      notify(error.message);
    }
  }

  useEffect(() => {
    load();
  }, [refresh]);

  async function action(path, body = null, method = 'POST') {
    setBusy(true);

    try {
      await api(path, {
        method,
        body: body ? JSON.stringify(body) : '{}'
      });

      notify('Action completed successfully');
      await load();

    } catch (error) {
      notify(error.message);

    } finally {
      setBusy(false);
    }
  }

  const chart = [
    { name: 'Door', count: 18 },
    { name: 'CCTV', count: 14 },
    { name: 'HVAC', count: 11 },
    { name: 'Network', count: 26 },
    { name: 'BMS', count: 9 }
  ];

  return (
    <>
      <div className="notice">
        <span className="pulse" />
        SIMULATION MODE
        <span>
          All devices, events, attacks and detector alerts are simulated.
        </span>
      </div>

      <div className="kpis">
        <Kpi
          icon={<Activity />}
          label="Simulation"
          value={data?.s?.running ? 'Running' : 'Paused'}
          tone="blue"
        />

        <Kpi
          icon={<Database />}
          label="Evidence records"
          value={evidence.length}
          tone="violet"
        />

        <Kpi
          icon={<ShieldCheck />}
          label="Readiness score"
          value={
            data?.r?.score != null
              ? `${(data.r.score * 100).toFixed(1)}%`
              : '—'
          }
          tone="green"
        />

        <Kpi
          icon={<Lock />}
          label="Integrity mode"
          value="HMAC seals"
          tone="amber"
        />
      </div>

      <div className="grid2">

        <Panel
          title="Simulation controls"
          sub="Advance the simulated building event stream"
        >
          <div className="controlrow">

            <button
              className="primary"
              disabled={busy || data?.s?.running}
              onClick={() => action('/simulation/start')}
            >
              <Play /> Start
            </button>

            <button
              className="secondary"
              disabled={busy || !data?.s?.running}
              onClick={() => action('/simulation/pause')}
            >
              <Pause /> Pause
            </button>

            <button
              className="secondary"
              disabled={busy}
              onClick={() => action('/simulation/reset')}
            >
              <RefreshCw /> Reset clock
            </button>

          </div>

          <div className="speed">
            <label>Simulation speed</label>

            <select
              value={data?.s?.speed || 1}
              disabled={busy}
              onChange={e =>
                action(
                  '/simulation/speed',
                  { speed: Number(e.target.value) },
                  'PUT'
                )
              }
            >
              <option value="1">1×</option>
              <option value="5">5×</option>
              <option value="20">20×</option>
            </select>
          </div>

          <div className="timebox">
            <small>SIMULATED TIME</small>
            <b>
              {Math.floor((data?.s?.time || 0) / 3600)}h{' '}
              {Math.floor(((data?.s?.time || 0) % 3600) / 60)}m
            </b>
          </div>
        </Panel>

        <Panel
          title="Inject incident"
          sub="Choose a predefined simulated attack scenario"
        >
          <div className="scenario-grid">

            {[
              'S1 · Badge cloning',
              'S2 · HVAC manipulation',
              'S3 · Camera botnet',
              'S4 · False data injection',
              'S5 · Fire-alarm tampering',
              'S6 · Exfiltration'
            ].map((scenario, index) => (
              <button
                key={scenario}
                className="scenario"
                disabled={busy}
                onClick={() =>
                  action('/incidents/inject', {
                    scenarioId: `S${index + 1}`
                  })
                }
              >
                {scenario}
                <span>Inject →</span>
              </button>
            ))}

          </div>
        </Panel>
      </div>

      <div className="grid2">

        <Panel
          title="Evidence feed"
          sub="Most recent captured events"
        >
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Source</th>
                  <th>Event</th>
                  <th>Kind</th>
                </tr>
              </thead>

              <tbody>
                {[...feed, ...evidence].slice(0, 8).map((event, index) => (
                  <tr key={`${event._id || index}-${index}`}>
                    <td>#{event.i}</td>
                    <td>{event.source}</td>
                    <td>{event.msg}</td>
                    <td>
                      <span className="pill">{event.kind}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Source activity"
          sub="Illustrative source event distribution"
        >
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill="#6475e8"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

      </div>

      <Panel title="Recent incidents">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>
              {incidents.map(incident => (
                <tr key={incident._id}>
                  <td>{incident.scenarioId}</td>
                  <td>{incident.name}</td>
                  <td>
                    <span className="pill">{incident.status}</span>
                  </td>
                  <td>
                    {new Date(incident.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Kpi({ icon, label, value, tone }) {
  return (
    <div className="kpi">
      <div className={`kpiicon ${tone}`}>{icon}</div>
      <div>
        <small>{label}</small>
        <b>{value}</b>
      </div>
    </div>
  );
}

function Alerts({ api }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api('/alerts')
      .then(result => setItems(result.items || []))
      .catch(console.error);
  }, []);

  return (
    <Panel
      title="Detector alerts"
      sub="Alerts generated by the simulated detector"
    >
      <DataTable
        items={items}
        columns={['i', 'source', 'msg', 'conf', 't']}
      />
    </Panel>
  );
}

function DataTable({ items = [], columns = [] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {items.map((item, index) => (
            <tr key={item._id || index}>
              {columns.map(column => (
                <td key={column}>{item[column] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {!items.length && (
        <p className="empty">No records to display yet.</p>
      )}
    </div>
  );
}

function Integrity({ api, notify, refresh }) {
  const [result, setResult] = useState(null);
  const [seals, setSeals] = useState([]);
  const [attacks, setAttacks] = useState([]);

  async function load() {
    try {
      const [sealData, attackData] = await Promise.all([
        api('/integrity/seals'),
        api('/attacker/log')
      ]);

      setSeals(Array.isArray(sealData) ? sealData : []);
      setAttacks(Array.isArray(attackData) ? attackData : []);

    } catch (error) {
      notify(error.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(path) {
    let method = 'POST';

    if (
      path.includes('/attacker/edit/') ||
      path.includes('/attacker/recompute/')
    ) {
      method = 'PATCH';
    }

    if (
      path.includes('/attacker/delete/') ||
      path.endsWith('/attacker/truncate')
    ) {
      method = 'DELETE';
    }

    try {
      const response = await api(path, {
        method,
        body: '{}'
      });

      setResult(response);
      notify('Operation completed successfully');

      await load();
      refresh();

    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <>
      <div className="grid2">

        <Panel
          title="Evidence integrity"
          sub="Recompute the evidence chain and verify historical seals"
        >
          <button
            className="primary"
            onClick={() => run('/integrity/verify')}
          >
            <ShieldCheck /> Verify evidence
          </button>

          {result && (
            <pre className="result">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </Panel>

        <Panel
          title="Signed checkpoint"
          sub="Create an HMAC-SHA256 checkpoint for the current evidence head"
        >
          <button
            className="primary"
            onClick={() => run('/integrity/seal')}
          >
            <Lock /> Create seal
          </button>

          <p className="muted">
            The signing key remains in the server environment and is never returned.
          </p>
        </Panel>

      </div>

      <Panel title="Historical seals">
        <DataTable
          items={seals}
          columns={['n', 'head', 't', 'algorithm']}
        />
      </Panel>

      <Panel
        title="Simulated attacker panel"
        sub="Simulation only · Disabled in production"
      >
        <div className="controlrow">

          <button
            className="danger"
            onClick={() => run('/attacker/edit/0')}
          >
            Edit record #0
          </button>

          <button
            className="danger"
            onClick={() => run('/attacker/delete/0')}
          >
            Delete record #0
          </button>

          <button
            className="danger"
            onClick={() => run('/attacker/truncate')}
          >
            Delete last 5
          </button>

          <button
            className="danger"
            onClick={() => run('/attacker/recompute/0')}
          >
            Edit + recompute
          </button>

        </div>

        <DataTable
          items={attacks}
          columns={['action', 'evidenceIndex', 'actor', 'createdAt']}
        />
      </Panel>
    </>
  );
}

function Investigation({ api, notify }) {
  const [incidents, setIncidents] = useState([]);
  const [id, setId] = useState('');
  const [delay, setDelay] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api('/incidents')
      .then(data => {
        setIncidents(data.items || []);

        if (data.items?.[0]) {
          setId(data.items[0]._id);
        }
      })
      .catch(error => notify(error.message));
  }, []);

  async function run() {
    try {
      const response = await api('/investigation/reconstruct', {
        method: 'POST',
        body: JSON.stringify({
          incidentId: id,
          delayDays: Number(delay)
        })
      });

      setResult(response);

    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <>
      <Panel
        title="Incident reconstruction"
        sub="Reconstruct a simulated incident from recorded evidence"
      >
        <div className="formrow">

          <label>
            Incident

            <select
              value={id}
              onChange={e => setId(e.target.value)}
            >
              {incidents.map(incident => (
                <option value={incident._id} key={incident._id}>
                  {incident.scenarioId} · {incident.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Investigation delay (days)

            <input
              type="number"
              min="0"
              value={delay}
              onChange={e => setDelay(e.target.value)}
            />
          </label>

          <button
            className="primary"
            disabled={!id}
            onClick={run}
          >
            Reconstruct timeline
          </button>

        </div>
      </Panel>

      {result && (
        <>
          <div className="kpis">
            <Kpi
              label="Reconstruction score"
              value={`${(result.score * 100).toFixed(1)}%`}
              tone="green"
            />

            <Kpi
              label="Recovered ratio"
              value={`${(result.recoveredRatio * 100).toFixed(1)}%`}
              tone="blue"
            />

            <Kpi
              label="Ordering accuracy"
              value={`${(result.orderingAccuracy * 100).toFixed(1)}%`}
              tone="violet"
            />
          </div>

          <Panel title="Reconstructed timeline">
            <DataTable
              items={result.timeline || []}
              columns={[
                'event',
                'trueTime',
                'recordedTime',
                'source',
                'status'
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}

function Readiness({ api, notify }) {
  const [score, setScore] = useState(null);

  const [weights, setWeights] = useState({
    coverage: 0.552,
    availability: 0.432,
    integrity: 0.016,
    timing: 0
  });

  async function load() {
    try {
      const data = await api('/readiness/current');

      setScore(data);

      if (data.weights) {
        setWeights(data.weights);
      }

    } catch (error) {
      notify(error.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    try {
      await api('/readiness/weights', {
        method: 'PUT',
        body: JSON.stringify(weights)
      });

      notify('Weights saved successfully');
      await load();

    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <>
      <Panel
        title="Forensic Readiness Score"
        sub="Computed from logging coverage, availability, integrity and timing"
      >
        <div className="scorehero">

          <strong>
            {score
              ? (score.score * 100).toFixed(1)
              : '—'}
            <small>%</small>
          </strong>

          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={Object.entries(score?.components || {}).map(
                  ([name, value]) => ({
                    name,
                    value: Number(value)
                  })
                )}
              >
                <XAxis dataKey="name" />
                <YAxis domain={[0, 1]} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  fill="#6475e8"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>

        <div className="recommendations">
          {score?.recommendations?.map(item => (
            <p key={item}>• {item}</p>
          ))}
        </div>
      </Panel>

      <Panel
        title="Readiness weights"
        sub="Weights must total 1.00"
      >
        <div className="weightgrid">

          {Object.entries(weights).map(([key, value]) => (
            <label key={key}>
              {key}

              <input
                type="number"
                min="0"
                max="1"
                step="0.001"
                value={value}
                onChange={e =>
                  setWeights(old => ({
                    ...old,
                    [key]: Number(e.target.value)
                  }))
                }
              />
            </label>
          ))}

        </div>

        <button className="primary" onClick={save}>
          Save weights
        </button>
      </Panel>
    </>
  );
}

function UsersPage({ api }) {
  const [items, setItems] = useState([]);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'analyst'
  });

  async function load() {
    try {
      const data = await api('/users');
      setItems(data.items || []);

    } catch (error) {
      alert(error.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();

    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify(form)
      });

      setForm({
        name: '',
        email: '',
        password: '',
        role: 'analyst'
      });

      load();

    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <>
      <Panel title="Create user">
        <form className="formrow" onSubmit={create}>

          {Object.entries(form).map(([key, value]) =>
            key === 'role' ? (
              <label key={key}>
                Role

                <select
                  value={value}
                  onChange={e =>
                    setForm(old => ({
                      ...old,
                      role: e.target.value
                    }))
                  }
                >
                  <option value="admin">admin</option>
                  <option value="analyst">analyst</option>
                  <option value="viewer">viewer</option>
                </select>
              </label>
            ) : (
              <label key={key}>
                {key}

                <input
                  type={key === 'password' ? 'password' : 'text'}
                  required
                  value={value}
                  onChange={e =>
                    setForm(old => ({
                      ...old,
                      [key]: e.target.value
                    }))
                  }
                />
              </label>
            )
          )}

          <button className="primary">Create</button>

        </form>
      </Panel>

      <Panel title="Registered users">
        <DataTable
          items={items}
          columns={['name', 'email', 'role', 'active']}
        />
      </Panel>
    </>
  );
}

function Results({ api }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/results')
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <>
      <div className="notice warn">
        <AlertTriangle />
        VERIFY BEFORE PRESENTING
        <span>
          These are reported research results, not live detector measurements.
        </span>
      </div>

      <Panel title="Detector evaluation">
        <DataTable
          items={Object.entries(data?.detector || {}).map(
            ([model, recall]) => ({ model, recall })
          )}
          columns={['model', 'recall']}
        />
      </Panel>

      <Panel title="Readiness and reconstruction correlation">
        <DataTable
          items={Object.entries(
            data?.readinessCorrelation || {}
          ).map(([method, correlation]) => ({
            method,
            correlation
          }))}
          columns={['method', 'correlation']}
        />

        <p className="muted">{data?.note}</p>
      </Panel>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
