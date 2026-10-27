export const normalizeEmail = value => value.trim().toLowerCase();
export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const emailRecoveryReady = () => false;
