// bomSlotReviseRunner.js
//
// Moves a project's BOM slots onto a new revision.
//
// There is no bulk endpoint: each slot is one PUT, each PUT is its own
// transaction, and the calls must be sequential — only three gunicorn workers
// serve the entire API, so three concurrent revises starve every other request,
// and two on the same project contend on the same rows. A run therefore has
// PER-SLOT outcomes, not one verdict, and a failure partway is a real state
// worth reporting rather than collapsing into "the export failed".
//
// The awkward part is deciding what happened when the response does not arrive.
// A revise is synchronous and slow — cost scales as (rows in the slot) × (items
// in the target revision) — against a 60s worker timeout. A timeout is SAFE:
// the whole thing is one transaction, so a killed worker rolls back and no slot
// is left half-migrated. But the process record lies about it. `process_id` is
// written RUNNING before the work starts and committed immediately, while the
// FAILED write lives in an exception handler a SIGKILL'd worker never reaches.
// So RUNNING is not evidence of progress, only of having started, and RUNNING
// well past the worker limit means "rolled back", not "still going".
//
// See BOM_MAPPER_PROJECT_REVISE_API.md §5–§7 in the backend repo.

import { reviseProjectBom, fetchProcessStatus, newProcessId } from './factwiseApi';

// Past this, a RUNNING record is a dead transaction. The server's own limit is
// 60s; the margin covers a slow status round-trip rather than any belief that
// the work might still land.
const ROLLED_BACK_AFTER_MS = 90000;
const STATUS_POLL_INTERVAL_MS = 3000;
// One retry. A revise that failed for a real reason fails again, and a second
// attempt on one that actually succeeded is destructive busywork — it
// soft-deletes and recreates every project item, delivery schedule and custom
// field in the slot with fresh ids, for no change.
const MAX_ATTEMPTS_PER_SLOT = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const SLOT_OUTCOMES = {
  REVISED: 'revised',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  // The attempt's fate could not be established — the response never came AND
  // the process record could not be read. Deliberately not retried: it may have
  // committed, and it may not.
  UNKNOWN: 'unknown',
};

// What really happened to an attempt whose response we never saw, or that came
// back 409 because its process_id had already been consumed.
async function resolveByProcessRecord(processId, startedAt) {
  for (;;) {
    const res = await fetchProcessStatus(processId);
    if (res?.status === 'SUCCESS') return { verdict: 'succeeded' };
    if (res?.status === 'FAILED') return { verdict: 'rolledBack', error: res.error };
    // Not readable at all. Guessing either way is worse than saying so.
    if (!res?.success && !res?.status) return { verdict: 'unknown', error: res?.error };

    if (Date.now() - startedAt > ROLLED_BACK_AFTER_MS) {
      return {
        verdict: 'rolledBack',
        error: 'The revise timed out on the server and was rolled back.',
      };
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
}

async function reviseOneSlot({ projectId, targetEnterpriseBomId, slot }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SLOT; attempt += 1) {
    // Fresh per attempt, always. Reusing one is the server's replay guard and
    // comes straight back as 409, so a retry that inherited its predecessor's
    // id could never succeed.
    const processId = newProcessId();
    const startedAt = Date.now();

    const res = await reviseProjectBom({
      projectId,
      bomModuleId: slot.bomModuleId,
      enterpriseBomId: targetEnterpriseBomId,
      processId,
    });

    if (res?.success) {
      return { outcome: SLOT_OUTCOMES.REVISED, slot, attempts: attempt };
    }

    // A plain rejection — 400 for a cross-BOM target, 404 for a bad linkage id
    // — is final and says why. Only an absent or replayed response is worth
    // resolving against the process record.
    if (!res?.timedOut && !res?.conflict) {
      return {
        outcome: SLOT_OUTCOMES.FAILED, slot, attempts: attempt, error: res?.error,
      };
    }

    const { verdict, error } = await resolveByProcessRecord(processId, startedAt);
    if (verdict === 'succeeded') {
      return { outcome: SLOT_OUTCOMES.REVISED, slot, attempts: attempt };
    }
    if (verdict === 'unknown') {
      return {
        outcome: SLOT_OUTCOMES.UNKNOWN,
        slot,
        attempts: attempt,
        error: error || res?.error
          || 'The revise did not answer and its status could not be read.',
      };
    }
    lastError = error || res?.error;
    // rolledBack: nothing was written, so a fresh attempt is safe.
  }

  return {
    outcome: SLOT_OUTCOMES.FAILED,
    slot,
    attempts: MAX_ATTEMPTS_PER_SLOT,
    error: lastError || 'The revise did not complete.',
  };
}

// Moves every slot in `slots` onto `targetEnterpriseBomId`, one at a time.
//
// slots: [{ bomModuleId, baseBomModuleLinkageId, enterpriseBomId, bomCode, version }]
// onSlotResult: called with each result as it lands, so a long run can report
//   progress rather than going quiet for minutes.
//
// Resolves with { ok, results } and never rejects — a thrown error would lose
// the outcomes of the slots that already moved, which are exactly what the user
// needs to know before retrying.
export async function reviseSlots({
  projectId,
  targetEnterpriseBomId,
  slots = [],
  onSlotResult,
  stopOnFailure = true,
} = {}) {
  const results = [];

  for (const slot of slots) {
    if (!slot?.bomModuleId) {
      results.push({
        outcome: SLOT_OUTCOMES.FAILED,
        slot,
        error: 'This slot has no linkage id, so there is nothing to revise.',
      });
    } else if (String(slot.enterpriseBomId) === String(targetEnterpriseBomId)) {
      // Already on the target. Revising R6 → R6 recreates every project item,
      // delivery schedule and custom field in the slot with fresh ids for no
      // change, so it is skipped rather than performed.
      results.push({ outcome: SLOT_OUTCOMES.SKIPPED, slot });
    } else {
      let result;
      try {
        result = await reviseOneSlot({ projectId, targetEnterpriseBomId, slot });
      } catch (err) {
        result = {
          outcome: SLOT_OUTCOMES.UNKNOWN,
          slot,
          error: err?.message || 'The revise threw before it could report.',
        };
      }
      results.push(result);
    }

    const latest = results[results.length - 1];
    if (typeof onSlotResult === 'function') onSlotResult(latest, results);

    // Stopping is the default: the slots share a project and a target, so
    // whatever broke the first one usually breaks the rest, and marching on
    // turns one bad state into several.
    if (stopOnFailure
        && latest.outcome !== SLOT_OUTCOMES.REVISED
        && latest.outcome !== SLOT_OUTCOMES.SKIPPED) {
      break;
    }
  }

  const ok = results.length === slots.length
    && results.every(r => r.outcome === SLOT_OUTCOMES.REVISED
                       || r.outcome === SLOT_OUTCOMES.SKIPPED);
  return { ok, results };
}

// One line per slot, for an error surface that has to explain a partial run.
export function summariseSlotResults(results = []) {
  return results.map((r) => {
    const name = r.slot?.bomCode || r.slot?.bomModuleId || 'slot';
    if (r.outcome === SLOT_OUTCOMES.REVISED) return `${name}: revised`;
    if (r.outcome === SLOT_OUTCOMES.SKIPPED) return `${name}: already on this revision, left alone`;
    if (r.outcome === SLOT_OUTCOMES.UNKNOWN) return `${name}: outcome unknown — ${r.error}`;
    return `${name}: failed — ${r.error}`;
  });
}
