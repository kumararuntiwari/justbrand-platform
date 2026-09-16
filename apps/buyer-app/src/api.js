// ==========================================
// JUSTBRAND BACKEND API (BUYER APP)
// ==========================================
// Single place for backend calls + auth token storage.
// The backend URL is the existing live JustBrand backend.

export const API_URL =
  "https://justbrand-in-144629.hostingersite.com";

const MLM_TOKEN_KEY = "justbrand_mlm_token";
const CUSTOMER_TOKEN_KEY = "justbrand_customer_token";

export function setMlmToken(token) {
  if (token) {
    localStorage.setItem(MLM_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(MLM_TOKEN_KEY);
  }
}

export function getMlmToken() {
  return localStorage.getItem(MLM_TOKEN_KEY) || "";
}

export function setCustomerToken(token) {
  if (token) {
    localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  }
}

export function getCustomerToken() {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}

export async function api(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || `Request failed (${response.status})`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}
