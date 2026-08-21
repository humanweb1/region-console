import { signIn } from "../../services/auth.js";

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-card">
      <div class="login-brand">Region Console</div>

      <p>Hizmet alanı yönetim paneline giriş yapın.</p>

      <form id="loginForm" autocomplete="on">
        <label>
          E-posta
          <input
            id="loginEmail"
            name="email"
            type="email"
            required
            autocomplete="username"
            inputmode="email"
          >
        </label>

        <label>
          Şifre
          <input
            id="loginPassword"
            name="password"
            type="password"
            required
            autocomplete="current-password"
          >
        </label>

        <button
          class="button button-primary login-submit"
          type="submit"
        >
          Giriş yap
        </button>

        <div
          id="loginError"
          class="form-error"
          role="alert"
          aria-live="polite"
        ></div>
      </form>
    </div>
  `;

  const form = container.querySelector("#loginForm");
  const emailInput = container.querySelector("#loginEmail");
  const passwordInput = container.querySelector("#loginPassword");
  const error = container.querySelector("#loginError");
  const button = form.querySelector("button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    error.textContent = "";

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email) {
      error.textContent = "E-posta adresinizi girin.";
      emailInput.focus();
      return;
    }

    if (!password) {
      error.textContent = "Şifrenizi girin.";
      passwordInput.focus();
      return;
    }

    button.disabled = true;
    button.textContent = "Giriş yapılıyor…";

    try {
      console.log("[Region Console] Login attempt:", {
        email,
        passwordLength: password.length
      });

      const session = await signIn(
        email,
        password
      );

      console.log(
        "[Region Console] Supabase login başarılı."
      );

      await onSuccess(session);
    } catch (err) {
      console.error(
        "[Region Console] Login failed:",
        err
      );

      error.textContent =
        err?.message || "Giriş başarısız.";
    } finally {
      button.disabled = false;
      button.textContent = "Giriş yap";
    }
  });
}