import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fp = require('./farmpulse.db.cjs');

export const getFarmPulseDb = fp.getFarmPulseDb;
export const initFarmPulseDb = fp.initFarmPulseDb;
