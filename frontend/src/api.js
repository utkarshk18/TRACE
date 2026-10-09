const API =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "http://localhost:8000");

export function getToken() {
  return localStorage.getItem("trace_token");
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(`${API}${path}`, { ...options, headers });
  } catch (netErr) {
    const err = new Error(
      `Unable to reach TRACE API at ${API}. Verify the backend server is running and accessible.`
    );
    err.status = 0;
    err.cause = netErr;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || "Request failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
