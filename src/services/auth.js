import { config, assertConfig } from "../core/config.js";

function headers(accessToken) {
  return {
    apikey: config.supabasePublishableKey,
    Authorization: accessToken ? `Bearer ${accessToken}` : "",
    "Content-Type": "application/json"
  };
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.msg ||
      data?.message ||
      data?.error_description ||
      "Supabase isteği başarısız."
    );
  }

  return data;
}

export async function signIn(email, password) {
  assertConfig();

  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ email, password })
    }
  );

  const data = await parseResponse(response);

  sessionStorage.setItem(
    "region-console-session",
    JSON.stringify(data)
  );

  return data;
}

export async function restoreSession() {
  assertConfig();

  const raw = sessionStorage.getItem("region-console-session");

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);

    if (!session?.access_token) {
      sessionStorage.removeItem("region-console-session");
      return null;
    }

    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/user`,
      {
        headers: headers(session.access_token)
      }
    );

    if (!response.ok) {
      sessionStorage.removeItem("region-console-session");
      return null;
    }

    const user = await response.json();

    return {
      ...session,
      user
    };
  } catch {
    sessionStorage.removeItem("region-console-session");
    return null;
  }
}

/**
 * Supabase password recovery linkindeki hash'i işler.
 *
 * Örnek:
 * #access_token=xxx&refresh_token=xxx&type=recovery
 */
export async function restoreRecoverySession() {
  assertConfig();

  const hash = window.location.hash.replace(/^#/, "");

  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");

  if (!accessToken || type !== "recovery") {
    return null;
  }

  try {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/user`,
      {
        headers: headers(accessToken)
      }
    );

    if (!response.ok) {
      throw new Error("Şifre sıfırlama oturumu geçersiz veya süresi dolmuş.");
    }

    const user = await response.json();

    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in") || 3600),
      token_type: "bearer",
      type: "recovery",
      user
    };

    sessionStorage.setItem(
      "region-console-recovery",
      JSON.stringify(session)
    );

    /*
     * Token'ı adres çubuğundan temizliyoruz.
     * Kullanıcı yenileme yaptığında token tekrar işlenmez.
     */
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.search}`
    );

    return session;
  } catch (error) {
    sessionStorage.removeItem("region-console-recovery");

    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.search}`
    );

    throw error;
  }
}

/**
 * Daha önce yakalanmış recovery session'ı geri getirir.
 */
export async function getRecoverySession() {
  const raw = sessionStorage.getItem(
    "region-console-recovery"
  );

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);

    if (!session?.access_token) {
      sessionStorage.removeItem(
        "region-console-recovery"
      );

      return null;
    }

    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/user`,
      {
        headers: headers(session.access_token)
      }
    );

    if (!response.ok) {
      sessionStorage.removeItem(
        "region-console-recovery"
      );

      return null;
    }

    const user = await response.json();

    return {
      ...session,
      user
    };
  } catch {
    sessionStorage.removeItem(
      "region-console-recovery"
    );

    return null;
  }
}

/**
 * Recovery session ile yeni şifre belirler.
 */
export async function updatePassword(password) {
  assertConfig();

  const recovery = await getRecoverySession();

  if (!recovery?.access_token) {
    throw new Error(
      "Şifre sıfırlama oturumu bulunamadı. Lütfen yeni bir sıfırlama bağlantısı isteyin."
    );
  }

  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/user`,
    {
      method: "PUT",
      headers: headers(recovery.access_token),
      body: JSON.stringify({ password })
    }
  );

  const data = await parseResponse(response);

  return data;
}

export async function signOut() {
  const raw = sessionStorage.getItem(
    "region-console-session"
  );

  const session = raw ? JSON.parse(raw) : null;

  if (session?.access_token) {
    await fetch(
      `${config.supabaseUrl}/auth/v1/logout`,
      {
        method: "POST",
        headers: headers(session.access_token)
      }
    ).catch(() => {});
  }

  sessionStorage.removeItem(
    "region-console-session"
  );

  sessionStorage.removeItem(
    "region-console-recovery"
  );
}

export function clearRecoverySession() {
  sessionStorage.removeItem(
    "region-console-recovery"
  );
}