const load=require('./core/db/requirements/_index/LOAD_REQUIREMENTS.cjs');
const r=load({species:'poultry',type:'broiler',production:'meat',breed:'ross_308',phase:'starter',region:'us',version:'v1'});
console.log("ok=", r.ok);
console.log("reqKey=", r.reqKey);
console.log("mode=", (r.source&&r.source.mode) || (r.meta&&r.meta.mode));
console.log("keys=", r.requirements ? Object.keys(r.requirements).length : 0);
console.log("first10=", r.requirements ? Object.keys(r.requirements).slice(0,10) : []);
console.log("profile=", r.profile ? {key:r.profile.key, phase:r.profile.phase, production:r.profile.production} : null);
