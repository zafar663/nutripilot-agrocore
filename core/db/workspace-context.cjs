'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

function runWithWorkspaceUser(user, fn) {
  const u = String(user || '').toLowerCase().trim();
  if (!u) throw new Error('Workspace requires a signed-in user');
  return als.run({ user: u }, fn);
}

function currentWorkspaceUser() {
  return als.getStore()?.user || null;
}

module.exports = { runWithWorkspaceUser, currentWorkspaceUser };
