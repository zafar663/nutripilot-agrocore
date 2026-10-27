import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mill = require('./mill.db.cjs');

export const getMillDb = mill.getMillDb;
export const initMillDb = mill.initMillDb;
export const runWithMillUser = mill.runWithMillUser;
export const currentMillUser = mill.currentMillUser;
export const upsertInboundIndex = mill.upsertInboundIndex;
export const lookupInboundOwner = mill.lookupInboundOwner;
export const recordInboundPulse = mill.recordInboundPulse;
export const getInboundPulse = mill.getInboundPulse;
export const millDbHealth = mill.millDbHealth;
export const closeMillDb = mill.closeMillDb;
