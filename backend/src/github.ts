import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios';
import https from 'node:https';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const GH_API = 'https://api.github.com';

/**
 * Force IPv4.
 *
 * On some Windows/Node environments, api.github.com can resolve to IPv6
 * and Node's HTTPS connection can hang even though curl works correctly.
 */
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
});

/**
 * GitHub API client.
 */
const api: AxiosInstance = axios.create({
  baseURL: GH_API,

  timeout: 30_000,

  httpsAgent,

  headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'GitHub-Automation-Bot',
  },
});

/**
 * Small retry wrapper for transient network failures.
 *
 * We retry only network/timeout errors.
 * We do NOT retry authentication errors such as 401/403.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  retries = 2,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isTimeout =
        error?.code === 'ECONNABORTED' ||
        error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase()?.includes('timeout');

      const isNetworkError =
        error?.code === 'ECONNRESET' ||
        error?.code === 'ENETUNREACH' ||
        error?.code === 'EAI_AGAIN' ||
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ENOTFOUND';

      const status = error?.response?.status;

      const retryable =
        isTimeout ||
        isNetworkError ||
        status === 502 ||
        status === 503 ||
        status === 504;

      console.error(
        JSON.stringify({
          component: 'github',
          operation: operationName,
          attempt,
          retries,
          retryable,
          code: error?.code,
          status,
          message: error?.message,

          githubError: error?.response?.data ?? null,

          acceptedPermissions:
            error?.response?.headers?.['x-accepted-github-permissions'] ?? null,
        }),
      );

      if (!retryable || attempt > retries) {
        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, attempt * 1000),
      );
    }
  }

  throw lastError;
}

/**
 * Create GitHub App JWT.
 */
export function createAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: config.github.appId,
    },
    config.github.privateKey,
    {
      algorithm: 'RS256',
    },
  );
}

/**
 * Generic GitHub API request.
 */
async function request<T>(
  configOrUrl: string | AxiosRequestConfig,
  opts?: AxiosRequestConfig,
): Promise<T> {
  return withRetry(
    async () => {
      const response =
        typeof configOrUrl === 'string'
          ? await api.get<T>(configOrUrl, opts)
          : await api.request<T>(configOrUrl);

      return response.data;
    },
    typeof configOrUrl === 'string'
      ? `GET ${configOrUrl}`
      : `${configOrUrl.method ?? 'GET'} ${configOrUrl.url ?? ''}`,
  );
}

/**
 * Exchange GitHub OAuth authorization code for user access token.
 */
export async function exchangeUserCode(
  code: string,
  redirectUri: string,
) {
  const body = new URLSearchParams({
    client_id: config.github.clientId,
    client_secret: config.github.clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await withRetry(
    () =>
      axios.post(
        'https://github.com/login/oauth/access_token',
        body.toString(),
        {
          headers: {
            Accept: 'application/json',
            'Content-Type':
              'application/x-www-form-urlencoded',
            'User-Agent': 'GitHub-Automation-Bot',
          },

          timeout: 30_000,

          httpsAgent,
        },
      ),
    'POST /login/oauth/access_token',
  );

  if (response.data.error) {
    throw new Error(
      response.data.error_description ??
      response.data.error,
    );
  }

  return response.data as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
  };
}

/**
 * Get authenticated GitHub user.
 */
export async function getAuthenticatedUser(
  userToken: string,
) {
  return request<any>('/user', {
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
  });
}

/**
 * Get GitHub App installation.
 */
export async function getInstallation(
  installationId: number,
) {
  return request<any>(
    `/app/installations/${installationId}`,
    {
      headers: {
        Authorization:
          `Bearer ${createAppJwt()}`,
      },
    },
  );
}

/**
 * Create GitHub App installation token.
 */
export async function createInstallationToken(
  installationId: number,
) {
  const response = await withRetry(
    () =>
      api.post(
        `/app/installations/${installationId}/access_tokens`,
        {},
        {
          headers: {
            Authorization:
              `Bearer ${createAppJwt()}`,
          },
        },
      ),
    `POST /app/installations/${installationId}/access_tokens`,
  );

  const data = response.data as {
    token: string;
    expires_at: string;
    permissions: Record<string, string>;
    repositories?: any[];
  };

  console.log(
    JSON.stringify({
      component: 'github',
      operation: 'installation_token_created',
      permissions: data.permissions,
      repositoryCount: data.repositories?.length ?? null,
    }),
  );

  return data;
}

/**
 * List repositories available to the GitHub App installation.
 */
export async function listInstallationRepositories(
  installationId: number,
) {
  const token =
    await createInstallationToken(installationId);

  let page = 1;
  const all: any[] = [];

  while (true) {
    const response = await withRetry(
      () =>
        api.get('/installation/repositories', {
          params: {
            per_page: 100,
            page,
          },
          headers: {
            Authorization:
              `Bearer ${token.token}`,
          },
        }),
      `GET /installation/repositories?page=${page}`,
    );

    all.push(...response.data.repositories);

    if (
      all.length >= response.data.total_count ||
      response.data.repositories.length === 0
    ) {
      break;
    }

    page++;
  }

  return all;
}

/**
 * Add issue label.
 */
export async function addLabel(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  label: string,
) {
  const token =
    await createInstallationToken(installationId);

  return request<any>({
    method: 'POST',
    url: `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    data: {
      labels: [label],
    },
    headers: {
      Authorization:
        `Bearer ${token.token}`,
    },
  });
}

/**
 * Add issue comment.
 */
export async function addComment(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
) {
  const token =
    await createInstallationToken(installationId);

  return request<any>({
    method: 'POST',
    url: `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    data: {
      body,
    },
    headers: {
      Authorization:
        `Bearer ${token.token}`,
    },
  });
}