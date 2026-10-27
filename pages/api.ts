import * as auth from './actions/auth';
import * as community from './actions/community';
import * as companies from './actions/companies';
import * as companyImage from './actions/company-image';
import * as aboutImages from './actions/about-images';
import * as adminActivity from './actions/admin-activity';
import * as adminImages from './actions/admin-images';
import * as coordination from './actions/coordination';
import * as recovery from './actions/password-recovery';
import * as photo from './actions/photo';
import * as reports from './actions/reports';
import * as testUsers from './actions/test-users';
import * as ideas from './actions/ideas';
import { GithubStore, StoreError } from './github-store.mjs';
import { setContext } from './context.mjs';

const internalOrigin = 'https://prototype.local';
const actions: Record<string, any> = {
  auth,
  community,
  companies,
  'company-image': companyImage,
  'about-images': aboutImages,
  'admin-activity': adminActivity,
  'admin-images': adminImages,
  coordination,
  'password-recovery': recovery,
  photo,
  reports,
  'test-users': testUsers,
  ideas,
};

// The request context is shared. Preserve ordering across all clients in this
// browser; independent browsers are coordinated by Git revisions.
let queue = Promise.resolve();
function enqueue(work: () => Promise<Response>) {
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
}

function errorResponse(error: unknown) {
  if (error instanceof StoreError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({
    error: 'Não foi possível concluir a operação. Seus campos foram preservados.',
  }, { status: 503 });
}

function applySessionChange(change: any, sessions: any) {
  if (!change) return;
  if (change.token) sessions?.set(change.token, change.remember);
  else sessions?.clear();
}

export function createClient(config: any, options: any = {}) {
  const store = options.store || new GithubStore(config, options.fetch);
  const attempts = new Map();

  async function dispatch(path: string, init: RequestInit) {
    try {
      if (init.signal?.aborted) {
        throw new StoreError('A operação foi cancelada. Tente novamente.');
      }
      const url = new URL(path, internalOrigin);
      if (url.origin !== internalOrigin || !url.pathname.startsWith('/api/')) {
        return Response.json({ error: 'Operação inválida.' }, { status: 400 });
      }
      const method = (init.method || 'GET').toUpperCase();
      const action = actions[url.pathname.slice('/api/'.length)]?.[method];
      if (!action) {
        return Response.json({ error: 'Operação indisponível.' }, { status: 404 });
      }

      const transaction = await store.begin();
      const operation: any = {
        transaction,
        config,
        token: options.sessions?.get() || null,
        attempts,
        derive: options.derive,
        baseUrl: options.baseUrl,
      };
      setContext(operation);
      const request = new Request(url, { ...init, headers: new Headers(init.headers) });
      const response: Response = await action(request);

      // Failures discard staged writes. Local session changes only take effect
      // after GitHub confirms the same transaction that persisted the session.
      if (response.ok) {
        await transaction.commit();
        applySessionChange(operation.sessionChange, options.sessions);
      }
      return response;
    } catch (error) {
      return errorResponse(error);
    } finally {
      setContext(null);
    }
  }

  return {
    store,
    request: (path: string, init: RequestInit = {}) => enqueue(() => dispatch(path, init)),
  };
}
