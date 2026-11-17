
require('dotenv').config();

const mongoose = require('mongoose');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const M = require('./models');
const core = require('./core');

const app = express();

app.use(helmet());

app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({
  windowMs: 60000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false
}));

const asyncRoute = fn =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const h = req.headers.authorization || '';

  try {
    if (!h.startsWith('Bearer ')) {
      throw Error();
    }

    req.user = jwt.verify(
      h.slice(7),
      process.env.JWT_SECRET
    );

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
}

const roles = (...allowed) =>
  (req, res, next) =>
    allowed.includes(req.user.role)
      ? next()
      : res.status(403).json({
          success: false,
          message: 'Insufficient permissions'
        });

const page = req => ({
  page: Math.max(1, Number(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20))
});

const response = (res, data, status = 200) =>
  res.status(status).json({
    success: true,
    data
  });

function mongooseId(v) {
  return /^[a-f\d]{24}$/i.test(v);
}

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    mode: 'SIMULATED',
    service: 'smart-building-forensic-api'
  });
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }).safeParse(req.body);

  if (!body.success) {
    return res.status(400).json({
      success: false,
      message: 'Valid email and password required'
    });
  }

  const u = await M.User.findOne({
    email: body.data.email.toLowerCase(),
    active: true
  }).select('+password');

  if (!u || !await bcrypt.compare(body.data.password, u.password)) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  const token = jwt.sign(
    {
      id: u._id,
      email: u.email,
      role: u.role
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES || '8h'
    }
  );

  await core.appendCustody('LOGIN', u._id, {
    email: u.email
  });

  response(res, {
    token,
    user: {
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role
    }
  });
}));

app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const u = await M.User.findById(req.user.id).select('-password');

  if (!u) {
    return res.status(401).json({
      success: false,
      message: 'User not found'
    });
  }

  response(res, u);
}));

// --------------------------------------------------
// USER MANAGEMENT
// --------------------------------------------------

app.get('/api/users', auth, roles('admin'), asyncRoute(async (req, res) => {
  const p = page(req);

  const [items, total] = await Promise.all([
    M.User.find()
      .select('-password')
      .skip((p.page - 1) * p.limit)
      .limit(p.limit),

    M.User.countDocuments()
  ]);

  response(res, {
    items,
    total,
    ...p
  });
}));

app.post('/api/users', auth, roles('admin'), asyncRoute(async (req, res) => {
  const b = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(10),
    role: z.enum(['admin', 'analyst', 'viewer'])
  }).parse(req.body);

  const u = await M.User.create({
    ...b,
    password: await bcrypt.hash(b.password, 12)
  });

  await core.appendCustody('USER_CREATED', req.user.id, {
    user: u.email,
    role: u.role
  });

  response(res, {
    _id: u._id,
    name: u.name,
    email: u.email,
    role: u.role
  }, 201);
}));

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

app.get('/api/settings', auth, asyncRoute(async (req, res) => {
  response(res, await M.Settings.findOne());
}));

app.put('/api/settings', auth, roles('admin'), asyncRoute(async (req, res) => {
  const allowed = z.object({
    simulationSpeed: z.union([
      z.literal(1),
      z.literal(5),
      z.literal(20)
    ]).optional(),

    messageLossProbability: z.number().min(0).max(1).optional(),
    clockErrorSigma: z.number().min(0).max(3600).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    integrityMode: z.number().int().min(0).max(2).optional(),
    detectorRecall: z.number().min(0).max(1).optional()
  }).strict().parse(req.body);

  const s = await M.Settings.findOne();

  if (
    allowed.integrityMode === 1 &&
    s.integrityMode === 0 &&
    await M.Evidence.countDocuments()
  ) {
    return res.status(400).json({
      success: false,
      message: 'Cannot enable hash chain over existing unhashed evidence'
    });
  }

  Object.assign(s, allowed);
  await s.save();

  await core.appendCustody(
    'SETTINGS_UPDATED',
    req.user.id,
    allowed
  );

  response(res, s);
}));

// --------------------------------------------------
// SOURCES
// --------------------------------------------------

app.get('/api/sources', auth, asyncRoute(async (req, res) => {
  response(res, await M.Source.find().sort({ index: 1 }));
}));

// --------------------------------------------------
// SIMULATION
// --------------------------------------------------

app.get('/api/simulation/status', auth, asyncRoute(async (req, res) => {
  const s = await M.Settings.findOne();

  response(res, {
    running: !!s.simulationEnabled,
    speed: s.simulationSpeed,
    time: s.simulatedTime,
    mode: 'SIMULATED'
  });
}));

let simTimer = null;

async function captureSource(
  sourceIndex,
  incidentId,
  eventName,
  trueTime,
  kind = 'event'
) {
  const src = await M.Source.findOne({
    index: sourceIndex
  });

  if (!src || !src.enabled || src.loggingLevel <= 0) {
    return null;
  }

  src.sentMessages++;

  const settings = await M.Settings.findOne();

  if (Math.random() < settings.messageLossProbability) {
    src.droppedMessages++;
    await src.save();
    return null;
  }

  if (Math.random() > src.loggingLevel) {
    await src.save();
    return null;
  }

  src.capturedMessages++;
  await src.save();

  const record = await core.appendEvidence({
    t: trueTime + src.clockOffset,
    source: sourceIndex,
    incident: incidentId,
    ev: eventName,
    msg: `Simulated ${eventName || src.name + ' activity'}`,
    kind
  });

  return record;
}

async function tick(io) {
  const s = await M.Settings.findOne();

  if (!s?.simulationEnabled) {
    return;
  }

  s.simulatedTime += 60 * s.simulationSpeed;
  await s.save();

  const sources = await M.Source.find({
    enabled: true,
    loggingLevel: { $gt: 0 }
  });

  if (sources.length) {
    const src = sources[Math.floor(Math.random() * sources.length)];

    const rec = await captureSource(
      src.index,
      null,
      null,
      s.simulatedTime,
      'event'
    );

    if (rec) {
      io?.emit('evidence:new', rec.toObject());
    }

    if (src.index === 8 && Math.random() < 0.06) {
      const detector = await captureSource(
        11,
        null,
        'Normal network-flow false positive',
        s.simulatedTime,
        'alert'
      );

      if (detector) {
        detector.conf = 0.50 + Math.random() * 0.20;
        await detector.save();

        io?.emit('alert:new', detector.toObject());
        io?.emit('evidence:new', detector.toObject());
      }
    }
  }

  const incidents = await M.Incident.find({
    status: 'injected'
  });

  for (const incident of incidents) {
    const due = incident.events.filter(ev =>
      !incident.processedOffsets.includes(ev.offset) &&
      incident.startTime + ev.offset <= s.simulatedTime
    );

    for (const ev of due) {
      for (const sourceIndex of ev.sources || []) {
        if (sourceIndex === 11) {
          if (Math.random() <= s.detectorRecall) {
            const rec = await captureSource(
              11,
              incident._id,
              ev.name,
              incident.startTime + ev.offset,
              'alert'
            );

            if (rec) {
              rec.conf = 0.70 + Math.random() * 0.29;
              await rec.save();

              io?.emit('alert:new', rec.toObject());
              io?.emit('evidence:new', rec.toObject());
            }
          }
        } else {
          const rec = await captureSource(
            sourceIndex,
            incident._id,
            ev.name,
            incident.startTime + ev.offset,
            'event'
          );

          if (rec) {
            io?.emit('evidence:new', rec.toObject());
          }
        }
      }

      incident.processedOffsets.push(ev.offset);
    }

    if (incident.processedOffsets.length >= incident.events.length) {
      incident.status = 'completed';
    }

    await incident.save();
  }

  io?.emit('simulation:status', {
    running: true,
    time: s.simulatedTime,
    speed: s.simulationSpeed
  });
}

app.post('/api/simulation/start', auth, roles('admin'), asyncRoute(async (req, res) => {
  const s = await M.Settings.findOne();

  s.simulationEnabled = true;
  await s.save();

  if (!simTimer) {
    simTimer = setInterval(
      () => tick(app.get('io')).catch(console.error),
      1000
    );

    simTimer.unref?.();
  }

  await core.appendCustody('SIMULATION_STARTED', req.user.id);

  response(res, {
    running: true
  });
}));

app.post('/api/simulation/pause', auth, roles('admin'), asyncRoute(async (req, res) => {
  const s = await M.Settings.findOne();

  s.simulationEnabled = false;
  await s.save();

  await core.appendCustody('SIMULATION_PAUSED', req.user.id);

  response(res, {
    running: false
  });
}));

app.post('/api/simulation/reset', auth, roles('admin'), asyncRoute(async (req, res) => {
  const s = await M.Settings.findOne();

  s.simulatedTime = 0;
  s.simulationEnabled = false;
  await s.save();

  await core.appendCustody('SIMULATION_RESET', req.user.id);

  response(res, {
    reset: true
  });
}));

app.put('/api/simulation/speed', auth, roles('admin'), asyncRoute(async (req, res) => {
  const speed = z.union([
    z.literal(1),
    z.literal(5),
    z.literal(20)
  ]).parse(req.body.speed);

  const s = await M.Settings.findOne();

  s.simulationSpeed = speed;
  await s.save();

  await core.appendCustody(
    'SIMULATION_SPEED_CHANGED',
    req.user.id,
    { speed }
  );

  response(res, { speed });
}));

// --------------------------------------------------
// INCIDENT SCENARIOS
// --------------------------------------------------

const scenarios = {
  S1: {
    name: 'Badge cloning',
    events: [
      ['Badge read at server-room door', 0, [0, 10]],
      ['Door-open change', 3, [0, 7]],
      ['Motion in room', 8, [1, 3]],
      ['Motion at exit', 415, [1, 3]],
      ['Badge read at exit', 420, [0, 10]]
    ]
  },

  S2: {
    name: 'HVAC manipulation',
    events: [
      ['Probing of gateway', 0, [8, 11]],
      ['Login from unknown address', 30, [9, 8]],
      ['Setpoint change', 95, [2, 9, 7]],
      ['Abnormal telemetry', 600, [4, 7]],
      ['Operator acknowledges alarm', 900, [10]]
    ]
  },

  S3: {
    name: 'Camera botnet and C&C',
    events: [
      ['Telnet brute force', 0, [8, 11]],
      ['Malware download', 60, [8, 9, 11]],
      ['C&C beacon', 120, [8, 11]],
      ['Outbound flood', 900, [8, 1, 7]],
      ['Scan toward server', 1500, [8, 11]]
    ]
  },

  S4: {
    name: 'False data injection',
    events: [
      ['Rogue MQTT client', 0, [7, 8]],
      ['Spoofed publish', 20, [7, 10]],
      ['Meter discontinuity', 300, [4, 10]],
      ['Falsified export', 3600, [10, 9]]
    ]
  },

  S5: {
    name: 'Fire-alarm tampering',
    events: [
      ['Zone disabled', 0, [5, 10]],
      ['Door unlock', 40, [0, 10]],
      ['Motion in restricted zone', 75, [1, 3]],
      ['Elevator override', 90, [6]],
      ['Zone re-enabled', 900, [5, 10]]
    ]
  },

  S6: {
    name: 'Exfiltration',
    events: [
      ['Anomalous remote login', 0, [9, 8]],
      ['Bulk database query', 120, [10]],
      ['Large outbound transfer', 300, [8, 11]],
      ['Log-cleaning attempt', 420, [10, 9]]
    ]
  }
};

// --------------------------------------------------
// INCIDENTS
// --------------------------------------------------

app.get('/api/incidents', auth, asyncRoute(async (req, res) => {
  const p = page(req);

  const [items, total] = await Promise.all([
    M.Incident.find()
      .sort({ createdAt: -1 })
      .skip((p.page - 1) * p.limit)
      .limit(p.limit),

    M.Incident.countDocuments()
  ]);

  response(res, {
    items,
    total,
    ...p
  });
}));

app.post('/api/incidents/inject', auth, roles('admin'), asyncRoute(async (req, res) => {
  const id = z.enum([
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6'
  ]).parse(req.body.scenarioId);

  const s = await M.Settings.findOne();
  const sc = scenarios[id];

  const incident = await M.Incident.create({
    scenarioId: id,
    name: sc.name,
    startTime: s.simulatedTime,
    events: sc.events.map(([name, offset, sources]) => ({
      name,
      offset,
      sources
    })),
    injectedBy: req.user.id
  });

  await core.appendCustody(
    'INCIDENT_INJECTED',
    req.user.id,
    {
      scenarioId: id,
      incident: String(incident._id)
    }
  );

  response(res, incident, 201);
}));

// --------------------------------------------------
// EVIDENCE
// --------------------------------------------------

app.get('/api/evidence', auth, asyncRoute(async (req, res) => {
  const p = page(req);
  const q = {};

  if (req.query.source !== undefined) {
    q.source = Number(req.query.source);
  }

  if (req.query.kind) {
    q.kind = req.query.kind;
  }

  if (req.query.incident) {
    q.incident = req.query.incident;
  }

  const [items, total] = await Promise.all([
    M.Evidence.find(q)
      .sort({ i: -1 })
      .skip((p.page - 1) * p.limit)
      .limit(p.limit),

    M.Evidence.countDocuments(q)
  ]);

  response(res, {
    items,
    total,
    ...p
  });
}));

app.get('/api/evidence/:id', auth, asyncRoute(async (req, res) => {
  const e = mongooseId(req.params.id)
    ? await M.Evidence.findById(req.params.id)
    : await M.Evidence.findOne({
        i: Number(req.params.id)
      });

  if (!e) {
    return res.status(404).json({
      success: false,
      message: 'Evidence not found'
    });
  }

  response(res, e);
}));

// --------------------------------------------------
// ALERTS
// --------------------------------------------------

app.get('/api/alerts', auth, asyncRoute(async (req, res) => {
  const p = page(req);

  const [items, total] = await Promise.all([
    M.Evidence.find({ kind: 'alert' })
      .sort({ i: -1 })
      .skip((p.page - 1) * p.limit)
      .limit(p.limit),

    M.Evidence.countDocuments({ kind: 'alert' })
  ]);

  response(res, {
    items,
    total,
    ...p
  });
}));

// --------------------------------------------------
// INTEGRITY VERIFICATION AND SEALING
// --------------------------------------------------

app.post('/api/integrity/verify', auth, roles('admin', 'analyst'), asyncRoute(async (req, res) => {
  const result = await core.verify();

  await core.appendCustody(
    'INTEGRITY_VERIFIED',
    req.user.id,
    { status: result.status }
  );

  app.get('io')?.emit('integrity:verified', result);

  response(res, result);
}));

app.post('/api/integrity/seal', auth, roles('admin'), asyncRoute(async (req, res) => {
  const seal = await core.createSeal();

  await core.appendCustody(
    'EVIDENCE_SEALED',
    req.user.id,
    {
      seal: seal._id,
      n: seal.n
    }
  );

  response(res, seal, 201);
}));

app.get('/api/integrity/seals', auth, asyncRoute(async (req, res) => {
  response(
    res,
    await M.Seal.find()
      .select('-signature')
      .sort({ n: -1 })
  );
}));

app.get('/api/integrity/export', auth, roles('admin'), asyncRoute(async (req, res) => {
  await core.appendCustody('EVIDENCE_EXPORTED', req.user.id);

  const evidence = await M.Evidence.find()
    .sort({ i: 1 })
    .lean();

  const seals = await M.Seal.find()
    .select('-signature')
    .lean();

  const custody = await M.Custody.find()
    .sort({ i: 1 })
    .lean();

  const bundle = {
    manifest: {
      createdAt: new Date().toISOString(),
      entryCount: evidence.length,
      headHash: evidence.at(-1)?.hash || null,
      simulated: true
    },
    evidence,
    seals,
    custody
  };

  res.setHeader(
    'Content-Disposition',
    'attachment; filename="forensic-evidence-export.json"'
  );

  res.json(bundle);
}));

// --------------------------------------------------
// SIMULATED ATTACKER OPERATIONS
// --------------------------------------------------

app.get('/api/attacker/log', auth, roles('admin'), asyncRoute(async (req, res) => {
  response(
    res,
    await M.AttackLog.find()
      .sort({ createdAt: -1 })
      .limit(100)
  );
}));

/*
 * IMPORTANT CORRECTION:
 *
 * The route paths already contain /api.
 * Do not prepend another /api to these paths.
 *
 * These endpoints are:
 * PATCH  /api/attacker/edit/:id
 * DELETE /api/attacker/delete/:id
 * DELETE /api/attacker/truncate
 * PATCH  /api/attacker/recompute/:id
 */

for (const [method, path, action] of [
  ['patch', '/api/attacker/edit/:id', 'edit'],
  ['delete', '/api/attacker/delete/:id', 'delete'],
  ['delete', '/api/attacker/truncate', 'truncate'],
  ['patch', '/api/attacker/recompute/:id', 'recompute']
]) {
  app[method](
    path,
    auth,
    roles('admin'),
    asyncRoute(async (req, res) => {

      // Attacker simulation is disabled in production.
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          message: 'Simulation-only endpoint disabled in production'
        });
      }

      const idx = req.params.id === undefined
        ? undefined
        : Number(req.params.id);

      const result = await core.simulateAttack(
        action,
        idx,
        req.user.id,
        req.body?.msg || 'Simulated unauthorized modification'
      );

      response(res, result);
    })
  );
}

// --------------------------------------------------
// CUSTODY
// --------------------------------------------------

app.get('/api/custody', auth, asyncRoute(async (req, res) => {
  response(
    res,
    await M.Custody.find()
      .sort({ i: -1 })
      .limit(100)
  );
}));

app.get('/api/custody/verify', auth, roles('admin', 'analyst'), asyncRoute(async (req, res) => {
  const rows = await M.Custody.find()
    .sort({ i: 1 })
    .lean();

  let prev = core.ZERO;
  const findings = [];

  rows.forEach((r, i) => {
    if (
      r.i !== i ||
      r.prev !== prev ||
      r.hash !== core.custodyHash(r)
    ) {
      findings.push(`Custody chain issue at ${i}`);
    }

    prev = r.hash;
  });

  response(res, {
    status: findings.length ? 'FAIL' : 'PASS',
    findings
  });
}));

// --------------------------------------------------
// READINESS
// --------------------------------------------------

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1 / (1 + 0.3275911 * x);

  const y = 1 -
    (((((1.061405429 * t - 1.453152027) * t) +
      1.421413741) * t - 0.284496736) * t +
      0.254829592) * t * Math.exp(-x * x);

  return sign * y;
}

app.get('/api/readiness/current', auth, asyncRoute(async (req, res) => {
  const s = await M.Settings.findOne();
  const sources = await M.Source.find();

  const total = 56;
  const weights = s.weights;

  const criticality = [
    4, 4, 1, 3, 2, 2, 1, 6, 10, 6, 11, 6
  ];

  const coverage = sources.reduce(
    (a, x) =>
      a + (criticality[x.index] / total) * x.loggingLevel,
    0
  );

  const logged = sources.filter(
    x => x.loggingLevel > 0
  );

  const sent = logged.reduce(
    (a, x) => a + x.sentMessages,
    0
  );

  const dropped = logged.reduce(
    (a, x) => a + x.droppedMessages,
    0
  );

  const loss = sent > 50
    ? dropped / sent
    : s.messageLossProbability;

  const A = logged.length
    ? (1 - loss) * Math.min(1, s.retentionDays / 30)
    : 0;

  const I = logged.length
    ? s.integrityMode / 2
    : 0;

  const sigma = s.clockErrorSigma;

  const T = sigma === 0
    ? 1
    : erfApprox(1 / (Math.sqrt(2) * sigma));

  const C = coverage;

  const score =
    weights.coverage * C +
    weights.availability * A +
    weights.integrity * I +
    weights.timing * T;

  const components = {
    coverage: C,
    availability: A,
    integrity: I,
    timing: T
  };

  const recommendations = [];

  for (
    const [k, v] of Object.entries(components)
      .sort((a, b) => a[1] - b[1])
  ) {
    if (v < 0.9) {
      recommendations.push(
        `${k} is below target; review its source configuration.`
      );
    }
  }

  await M.Readiness.create({
    score,
    components,
    weights,
    recommendations
  });

  response(res, {
    score,
    components,
    weights,
    recommendations
  });
}));

app.get('/api/readiness/history', auth, asyncRoute(async (req, res) => {
  response(
    res,
    await M.Readiness.find()
      .sort({ createdAt: -1 })
      .limit(100)
  );
}));

app.put('/api/readiness/weights', auth, roles('admin'), asyncRoute(async (req, res) => {
  const w = z.object({
    coverage: z.number().min(0),
    availability: z.number().min(0),
    integrity: z.number().min(0),
    timing: z.number().min(0)
  }).parse(req.body);

  if (
    Math.abs(
      Object.values(w).reduce((a, b) => a + b, 0) - 1
    ) > 1e-8
  ) {
    return res.status(400).json({
      success: false,
      message: 'Weights must sum to 1'
    });
  }

  const s = await M.Settings.findOne();

  s.weights = w;
  await s.save();

  await core.appendCustody(
    'READINESS_WEIGHTS_CHANGED',
    req.user.id,
    w
  );

  response(res, w);
}));

// --------------------------------------------------
// INVESTIGATION AND RECONSTRUCTION
// --------------------------------------------------

app.post('/api/investigation/reconstruct', auth, roles('admin', 'analyst'), asyncRoute(async (req, res) => {
  const b = z.object({
    incidentId: z.string().regex(/^[a-f\d]{24}$/i),
    delayDays: z.number().min(0).max(3650)
  }).parse(req.body);

  const incident = await M.Incident.findById(b.incidentId);

  if (!incident) {
    return res.status(404).json({
      success: false,
      message: 'Incident not found'
    });
  }

  const settings = await M.Settings.findOne();

  const all = await M.Evidence.find()
    .sort({ i: 1 })
    .lean();

  const integrity = await core.verify();

  const timeline = incident.events.map(ev => {
    const candidates = all.filter(
      e =>
        String(e.incident) === String(incident._id) &&
        e.ev === ev.name
    );

    let status = 'Missing';
    let entry = null;

    if (candidates.length) {
      entry = candidates[0];

      if (b.delayDays > settings.retentionDays) {
        status = 'Expired';
      } else if (
        settings.integrityMode > 0 &&
        integrity.status !== 'PASS'
      ) {
        status = 'Excluded';
      } else {
        status = 'Recovered';
      }
    }

    return {
      event: ev.name,
      trueTime: incident.startTime + ev.offset,
      status,
      recordedTime: entry?.t ?? null,
      source: entry?.source ?? null
    };
  });

  const recovered = timeline.filter(
    x => x.status === 'Recovered'
  );

  const ratio = timeline.length
    ? recovered.length / timeline.length
    : 0;

  let pairs = 0;
  let correct = 0;

  for (let i = 0; i < recovered.length; i++) {
    for (let j = i + 1; j < recovered.length; j++) {
      pairs++;

      if (
        Math.sign(
          recovered[i].trueTime - recovered[j].trueTime
        ) ===
        Math.sign(
          recovered[i].recordedTime -
          recovered[j].recordedTime
        )
      ) {
        correct++;
      }
    }
  }

  const ordering = pairs
    ? correct / pairs
    : 1;

  const result = await M.Reconstruction.create({
    incident: incident._id,
    delayDays: b.delayDays,
    score: ratio * ordering,
    recoveredRatio: ratio,
    orderingAccuracy: ordering,
    timeline
  });

  await core.appendCustody(
    'INCIDENT_RECONSTRUCTED',
    req.user.id,
    {
      incident: String(incident._id),
      score: result.score
    }
  );

  response(res, result);
}));

app.get('/api/investigation', auth, roles('admin', 'analyst'), asyncRoute(async (req, res) => {
  response(
    res,
    await M.Reconstruction.find()
      .sort({ createdAt: -1 })
      .limit(100)
  );
}));

// --------------------------------------------------
// RESEARCH RESULTS
// --------------------------------------------------

app.get('/api/results', auth, asyncRoute(async (req, res) => {
  response(res, require('./results.json'));
}));

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);

  const status =
    err.name === 'ZodError'
      ? 400
      : err.code === 11000
        ? 409
        : err.status || 500;

  res.status(status).json({
    success: false,
    message: status === 500
      ? 'Internal server error'
      : err.message
  });
});

module.exports = app;
