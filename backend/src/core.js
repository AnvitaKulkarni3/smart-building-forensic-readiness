
const crypto = require('crypto');

const {
  Evidence,
  Counter,
  Settings,
  Source,
  Seal,
  Custody,
  AttackLog
} = require('./models');

const ZERO = '0'.repeat(64);

// --------------------------------------------------
// HASH FUNCTIONS
// --------------------------------------------------

function evidenceHash(e) {
  const data = [
    e.i,
    Number(e.t).toFixed(1),
    e.source,
    e.kind,
    e.msg,
    e.incident || '',
    e.ev || '',
    e.conf ?? '',
    e.prev
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

function custodyHash(e) {
  const data = [
    e.i,
    Number(e.t).toFixed(1),
    e.action,
    e.actor,
    e.prev,
    JSON.stringify(e.details || {})
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

// --------------------------------------------------
// SERIALIZED EVIDENCE APPENDING
// --------------------------------------------------

let appendQueue = Promise.resolve();

function serial(fn) {
  const promise = appendQueue.then(fn, fn);
  appendQueue = promise.catch(() => {});
  return promise;
}

// --------------------------------------------------
// APPEND EVIDENCE
// --------------------------------------------------

async function appendEvidence(input) {
  return serial(async () => {
    const settings = await Settings.findOne();

    const last = await Evidence.findOne()
      .sort({ i: -1 });

    const counter = await Counter.findByIdAndUpdate(
      'evidence',
      { $inc: { sequence: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    const i = counter.sequence - 1;

    const doc = {
      i,
      t: Number(
        input.t ?? settings?.simulatedTime ?? 0
      ),
      source: input.source ?? 0,
      kind: input.kind || 'event',
      msg: input.msg || 'Simulated event',
      incident: input.incident || null,
      ev: input.ev || null,
      conf: input.conf ?? null,
      prev:
        settings?.integrityMode === 0
          ? ''
          : (last?.hash || ZERO)
    };

    if (settings?.integrityMode !== 0) {
      doc.hash = evidenceHash(doc);
    }

    return Evidence.create(doc);
  });
}

// --------------------------------------------------
// APPEND CUSTODY RECORD
// --------------------------------------------------

async function appendCustody(
  action,
  actor,
  details = {}
) {
  const last = await Custody.findOne()
    .sort({ i: -1 });

  const i = last ? last.i + 1 : 0;

  const doc = {
    i,
    t: Date.now() / 1000,
    action,
    actor: String(actor || 'system'),
    details,
    prev: last?.hash || ZERO
  };

  doc.hash = custodyHash(doc);

  return Custody.create(doc);
}

// --------------------------------------------------
// VERIFY EVIDENCE INTEGRITY
// --------------------------------------------------

async function verify() {
  const settings = await Settings.findOne();

  const rows = await Evidence.find()
    .sort({ i: 1 })
    .lean();

  const findings = [];

  if (settings?.integrityMode === 0) {
    return {
      status: 'UNVERIFIABLE',
      findings: [
        'Integrity mode 0: evidence changes cannot be detected.'
      ],
      count: rows.length
    };
  }

  let prev = ZERO;

  rows.forEach((e, position) => {
    if (e.i !== position) {
      findings.push(
        `Sequence gap at evidence ${e.i}; expected ${position}`
      );
    }

    if (e.prev !== prev) {
      findings.push(
        `Chain broken before evidence ${e.i}`
      );
    }

    const calculatedHash = evidenceHash(e);

    if (e.hash !== calculatedHash) {
      findings.push(
        `Altered record ${e.i}`
      );
    }

    prev = e.hash || '';
  });

  // Verify signed checkpoints.
  const seals = await Seal.find()
    .select('+signature')
    .sort({ n: 1 })
    .lean();

  for (const seal of seals) {
    const expected = crypto
      .createHmac('sha256', process.env.HMAC_SECRET)
      .update(`${seal.n}|${seal.head}|${seal.t}`)
      .digest('hex');

    const received = seal.signature || '';

    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(
        expectedBuffer,
        receivedBuffer
      )
    ) {
      findings.push(
        `Seal ${seal.n} forged`
      );
    }

    const lastSealedRecord = rows.find(
      record => record.i === seal.n - 1
    );

    if (
      rows.length < seal.n ||
      !lastSealedRecord ||
      lastSealedRecord.hash !== seal.head
    ) {
      findings.push(
        `History covered by seal ${seal.n} changed or truncated`
      );
    }
  }

  return {
    status: findings.length ? 'FAIL' : 'PASS',
    findings,
    count: rows.length,
    head: rows.at(-1)?.hash || null
  };
}

// --------------------------------------------------
// CREATE HMAC-SHA256 SEAL
// --------------------------------------------------

async function createSeal() {
  const settings = await Settings.findOne();

  if (!settings || settings.integrityMode !== 2) {
    throw Object.assign(
      new Error(
        'Signed seals require integrity mode 2'
      ),
      { status: 400 }
    );
  }

  const rows = await Evidence.find()
    .sort({ i: 1 })
    .lean();

  if (!rows.length) {
    throw Object.assign(
      new Error(
        'Cannot seal an empty evidence log'
      ),
      { status: 400 }
    );
  }

  const n = rows.length;
  const head = rows.at(-1)?.hash || ZERO;
  const t = Date.now() / 1000;

  const signature = crypto
    .createHmac(
      'sha256',
      process.env.HMAC_SECRET
    )
    .update(`${n}|${head}|${t}`)
    .digest('hex');

  const seal = await Seal.create({
    n,
    head,
    t,
    signature
  });

  return {
    _id: seal._id,
    n,
    head,
    t,
    algorithm: seal.algorithm
  };
}

// --------------------------------------------------
// SIMULATED ATTACKER OPERATIONS
// --------------------------------------------------

async function simulateAttack(
  action,
  index,
  actor,
  msg
) {
  if (process.env.NODE_ENV === 'production') {
    throw Object.assign(
      new Error(
        'Attacker simulation disabled in production'
      ),
      { status: 403 }
    );
  }

  const requestedIndex = Number(index);

  if (
    action !== 'truncate' &&
    (!Number.isInteger(requestedIndex) ||
      requestedIndex < 0)
  ) {
    throw Object.assign(
      new Error('Invalid evidence index'),
      { status: 400 }
    );
  }

  let result;
  let loggedIndex = requestedIndex;

  // ----------------------------------------------
  // 1. EDIT EVIDENCE RECORD
  // ----------------------------------------------

  if (action === 'edit') {
    result = await Evidence.findOneAndUpdate(
      { i: requestedIndex },
      {
        $set: {
          msg: msg || 'Simulated unauthorized modification'
        }
      },
      { new: true }
    );

    if (!result) {
      throw Object.assign(
        new Error(
          `Evidence record ${requestedIndex} not found`
        ),
        { status: 404 }
      );
    }
  }

  // ----------------------------------------------
  // 2. DELETE EVIDENCE RECORD
  // ----------------------------------------------

  else if (action === 'delete') {
    result = await Evidence.findOneAndDelete({
      i: requestedIndex
    });

    if (!result) {
      throw Object.assign(
        new Error(
          `Evidence record ${requestedIndex} not found`
        ),
        { status: 404 }
      );
    }
  }

  // ----------------------------------------------
  // 3. DELETE LAST FIVE RECORDS
  // ----------------------------------------------

  else if (action === 'truncate') {
    const records = await Evidence.find()
      .sort({ i: -1 })
      .limit(5);

    const ids = records.map(
      record => record._id
    );

    if (ids.length > 0) {
      await Evidence.deleteMany({
        _id: { $in: ids }
      });
    }

    result = {
      deleted: ids.length
    };

    loggedIndex = -1;
  }

  // ----------------------------------------------
  // 4. EDIT AND RECOMPUTE HASHES
  // ----------------------------------------------

  else if (action === 'recompute') {

    // First, look for the requested record.
    let target = await Evidence.findOne({
      i: requestedIndex
    });

    // FIX:
    // If record #0 or the requested record was
    // deleted, select the first remaining record.
    if (!target) {
      target = await Evidence.findOne()
        .sort({ i: 1 });
    }

    if (!target) {
      throw Object.assign(
        new Error(
          'No evidence records available to recompute'
        ),
        { status: 404 }
      );
    }

    const startIndex = target.i;

    loggedIndex = startIndex;

    // Simulate unauthorized modification.
    target.msg =
      msg || 'Simulated unauthorized modification';

    await target.save();

    // Find the previous record.
    const previousRecord = await Evidence.findOne({
      i: startIndex - 1
    });

    // Use the previous hash when available.
    // If the previous record was deleted, use ZERO.
    let previousHash =
      previousRecord?.hash || ZERO;

    // Retrieve this record and all subsequent records.
    const laterRecords = await Evidence.find({
      i: { $gte: startIndex }
    }).sort({ i: 1 });

    // Recompute the hash chain.
    for (const record of laterRecords) {
      record.prev = previousHash;

      record.hash = evidenceHash(record);

      await record.save();

      previousHash = record.hash;
    }

    result = {
      modifiedFrom: startIndex,
      recomputedRecords: laterRecords.length,
      message:
        'Evidence modified and subsequent hashes recomputed successfully'
    };
  }

  // ----------------------------------------------
  // INVALID OPERATION
  // ----------------------------------------------

  else {
    throw Object.assign(
      new Error('Unknown attack operation'),
      { status: 400 }
    );
  }

  // ----------------------------------------------
  // RECORD ATTACK IN ATTACK LOG
  // ----------------------------------------------

  await AttackLog.create({
    action,
    evidenceIndex: loggedIndex,
    details: {
      message:
        msg || 'Simulated unauthorized modification'
    },
    actor: String(actor || 'unknown')
  });

  // ----------------------------------------------
  // RECORD ATTACK IN CUSTODY LOG
  // ----------------------------------------------

  await appendCustody(
    `SIMULATED_ATTACK_${action}`,
    actor,
    {
      index: loggedIndex,
      requestedIndex
    }
  );

  return result;
}

// --------------------------------------------------
// EXPORT FUNCTIONS USED BY app.js
// --------------------------------------------------

module.exports = {
  ZERO,
  evidenceHash,
  custodyHash,
  appendEvidence,
  appendCustody,
  verify,
  createSeal,
  simulateAttack
};
