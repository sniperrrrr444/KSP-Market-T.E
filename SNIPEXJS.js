const STORAGE_KEY = "snipex_accounts";
const SESSION_KEY = "snipex_session";

const adminUser = {
  name: "Administrador SNIPE X",
  email: "admin@snipex.aero",
  password: "SnipeAdmin2026!",
  role: "admin"
};

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const sessionState = document.getElementById("sessionState");
const adminList = document.getElementById("adminList");
const logoutBtn = document.getElementById("logoutBtn");

function getAccounts() {
  const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const hasAdmin = parsed.some((a) => a.email === adminUser.email);

  if (!hasAdmin) {
    parsed.push(adminUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }

  return parsed;
}

function saveAccounts(accounts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

function setSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function getSession() {
  return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function flashMessage(form, message, isError = false) {
  const old = form.querySelector(".alert");
  if (old) old.remove();

  const p = document.createElement("p");
  p.className = isError ? "alert error" : "alert";
  p.textContent = message;
  form.appendChild(p);
}

function renderSession() {
  const session = getSession();

  if (!session) {
    sessionState.textContent = "No hay usuario autenticado.";
    logoutBtn.disabled = true;
    adminList.innerHTML = "<li>Inicia sesión como admin para cargar cuentas registradas.</li>";
    return;
  }

  sessionState.textContent = `Sesión activa: ${session.name} (${session.email}) - rol ${session.role || "cliente"}.`;
  logoutBtn.disabled = false;

  if (session.role === "admin") {
    const accounts = getAccounts();
    adminList.innerHTML = accounts
      .map((acc) => `<li>${acc.name} · ${acc.email} · rol: ${acc.role || "cliente"}</li>`)
      .join("");
  } else {
    adminList.innerHTML = "<li>Tu cuenta no tiene permisos de administración.</li>";
  }
}

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const password = document.getElementById("regPassword").value;

  const accounts = getAccounts();
  const exists = accounts.some((a) => a.email === email);

  if (exists) {
    flashMessage(registerForm, "Ese correo ya existe. Prueba otro.", true);
    return;
  }

  accounts.push({ name, email, password, role: "cliente" });
  saveAccounts(accounts);
  flashMessage(registerForm, "Cuenta creada correctamente. Ya puedes iniciar sesión.");
  registerForm.reset();
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;

  const accounts = getAccounts();
  const user = accounts.find((a) => a.email === email && a.password === password);

  if (!user) {
    flashMessage(loginForm, "Credenciales inválidas.", true);
    return;
  }

  setSession({ name: user.name, email: user.email, role: user.role || "cliente" });
  flashMessage(loginForm, "Login correcto. Bienvenido al portal.");
  loginForm.reset();
  renderSession();
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  renderSession();
});

getAccounts();
renderSession();
