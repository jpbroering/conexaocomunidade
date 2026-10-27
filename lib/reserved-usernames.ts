import { normalizeUsername } from './local-auth';

const reservedNames = ['eugenio.admin', 'admin', 'escola'];
export const reservedAdminUsername = (username: string) => reservedNames.includes(normalizeUsername(username));
