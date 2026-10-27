let active;
export function context() { if (!active) throw Error('No active prototype operation'); return active; }
export function setContext(value) { active = value; }
