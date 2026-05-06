const API_ROOT = "https://api.github.com";

export async function verifyPrivateRepo(config) {
  const { owner, repo } = parseRepo(config.repo);
  const response = await githubFetch(`/repos/${owner}/${repo}`, config);
  if (!response.ok) throw await githubError(response);
  const details = await response.json();
  return details.private === true;
}

export async function syncData(localData) {
  const config = localData.settings.github;
  validateConfig(config);

  const remote = await getRemoteFile(config);
  if (!remote.exists) {
    await putRemoteFile(config, localData, null);
    return { data: localData, message: "Remote file created." };
  }

  const remoteData = JSON.parse(remote.content);
  const localTime = Date.parse(localData.updatedAt || "");
  const remoteTime = Date.parse(remoteData.updatedAt || "");

  if (remoteTime > localTime) {
    return { data: remoteData, message: "Pulled newer remote data." };
  }

  if (localTime > remoteTime) {
    await putRemoteFile(config, localData, remote.sha);
    return { data: localData, message: "Pushed local changes." };
  }

  return { data: localData, message: "Already up to date." };
}

async function getRemoteFile(config) {
  const { owner, repo } = parseRepo(config.repo);
  const path = encodePath(config.path || "leave.json");
  const branch = encodeURIComponent(config.branch || "main");
  const response = await githubFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, config);

  if (response.status === 404) return { exists: false };
  if (!response.ok) throw await githubError(response);

  const payload = await response.json();
  return {
    exists: true,
    sha: payload.sha,
    content: decodeBase64(payload.content)
  };
}

async function putRemoteFile(config, data, sha) {
  const { owner, repo } = parseRepo(config.repo);
  const path = encodePath(config.path || "leave.json");
  const body = {
    message: "Update leave tracker data",
    content: encodeBase64(JSON.stringify(data, null, 2)),
    branch: config.branch || "main"
  };
  if (sha) body.sha = sha;

  const response = await githubFetch(`/repos/${owner}/${repo}/contents/${path}`, config, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!response.ok) throw await githubError(response);
}

function githubFetch(path, config, options = {}) {
  return fetch(`${API_ROOT}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
}

function validateConfig(config) {
  if (!config || !config.repo || !config.branch || !config.path || !config.token) {
    throw new Error("Add GitHub sync settings first.");
  }
}

function parseRepo(repoName) {
  const [owner, repo] = String(repoName || "").split("/");
  if (!owner || !repo) throw new Error("Repo must use owner/repo format.");
  return { owner: encodeURIComponent(owner), repo: encodeURIComponent(repo) };
}

function encodePath(path) {
  return String(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function encodeBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeBase64(text) {
  return decodeURIComponent(escape(atob(String(text).replace(/\s/g, ""))));
}

async function githubError(response) {
  if (response.status === 401) return new Error("Token expired or invalid - update in Settings.");
  try {
    const payload = await response.json();
    return new Error(payload.message || "GitHub sync failed.");
  } catch {
    return new Error("GitHub sync failed.");
  }
}
