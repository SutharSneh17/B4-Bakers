const IS_BROWSER =
  typeof window !== "undefined" && typeof document !== "undefined";

// Backend section (Node.js runtime):
// This block runs only when this file is executed by Node (npm start),
// and it creates Express API endpoints for Twilio OTP send/verify.
if (!IS_BROWSER) {
  require("dotenv").config();

  const fs = require("fs");
  const path = require("path");
  const express = require("express");
  const cors = require("cors");
  const twilio = require("twilio");

  const app = express();
  app.use(express.json());
  app.use(cors());

  const PORT = Number(process.env.PORT || 3000);
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

  const hasValidTwilioSid = /^AC[0-9a-f]{32}$/i.test(TWILIO_ACCOUNT_SID || "");
  const hasValidVerifySid = /^VA[0-9a-f]{32}$/i.test(
    TWILIO_VERIFY_SERVICE_SID || ""
  );
  const hasValidAuthToken =
    typeof TWILIO_AUTH_TOKEN === "string" &&
    TWILIO_AUTH_TOKEN.length >= 16 &&
    !TWILIO_AUTH_TOKEN.startsWith("your_");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    console.error(
      "Missing Twilio env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID"
    );
    process.exit(1);
  }

  if (!hasValidTwilioSid || !hasValidVerifySid || !hasValidAuthToken) {
    console.error(
      "Invalid Twilio env vars. Set real values in .env (not placeholders) for TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID."
    );
    process.exit(1);
  }

  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  // In-memory stores; users are persisted to users-db.json on successful registration/location updates.
  const usersByPhone = new Map();
  const pendingRegistrationByPhone = new Map();
  const USERS_DB_PATH = path.join(process.cwd(), "users-db.json");

  function loadUsersFromDisk() {
    try {
      if (!fs.existsSync(USERS_DB_PATH)) {
        return;
      }
      const raw = fs.readFileSync(USERS_DB_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      Object.keys(parsed).forEach((phone) => {
        const user = parsed[phone];
        if (user && typeof user === "object") {
          usersByPhone.set(phone, user);
        }
      });
      console.log("Loaded registered users:", usersByPhone.size);
    } catch (error) {
      console.error("Failed to load users-db.json:", error.message);
    }
  }

  function saveUsersToDisk() {
    try {
      const asObject = Object.fromEntries(usersByPhone.entries());
      fs.writeFileSync(USERS_DB_PATH, JSON.stringify(asObject, null, 2), "utf8");
    } catch (error) {
      console.error("Failed to save users-db.json:", error.message);
    }
  }

  function normalizePhone(phone) {
    const trimmed = String(phone || "").trim();
    const compact = trimmed.replace(/\s+/g, "");

    if (compact.startsWith("00")) {
      return "+" + compact.slice(2).replace(/\D/g, "");
    }

    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) {
      return "+91" + digits;
    }
    if (digits.length === 11 && digits.startsWith("0")) {
      return "+91" + digits.slice(1);
    }

    if (!trimmed.startsWith("+")) {
      return "+" + digits;
    }
    return "+" + trimmed.slice(1).replace(/\D/g, "");
  }

  function isValidPhone(phone) {
    return /^\+[1-9]\d{9,14}$/.test(phone);
  }

  app.get("/auth/health", (req, res) => {
    res.json({ ok: true, mode: "twilio-verify" });
  });

  // Backend API: send OTP through Twilio Verify
  app.post("/auth/send-otp", async (req, res) => {
    try {
      const mode = String(req.body.mode || "login");
      const phone = normalizePhone(req.body.phone);
      const name = String(req.body.name || "").trim();

      if (!isValidPhone(phone)) {
        return res
          .status(400)
          .json({ ok: false, code: "INVALID_PHONE", message: "Invalid phone." });
      }

      if (mode === "register") {
        if (name.length < 3) {
          return res.status(400).json({
            ok: false,
            code: "INVALID_NAME",
            message: "Name must be at least 3 characters.",
          });
        }
        if (usersByPhone.has(phone)) {
          return res.status(409).json({
            ok: false,
            code: "ALREADY_REGISTERED",
            message: "Phone already registered. Please login.",
          });
        }
        pendingRegistrationByPhone.set(phone, { name: name, createdAt: Date.now() });
      } else {
        if (!usersByPhone.has(phone)) {
          return res.status(404).json({
            ok: false,
            code: "NOT_REGISTERED",
            message: "Phone not registered. Please register first.",
          });
        }
      }

      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: phone, channel: "sms" });

      return res.json({
        ok: true,
        message: "OTP sent successfully.",
      });
    } catch (error) {
      const twilioMessage =
        typeof error?.message === "string" && error.message
          ? error.message
          : "Failed to send OTP.";
      return res.status(500).json({
        ok: false,
        code: "OTP_SEND_FAILED",
        message: twilioMessage,
      });
    }
  });

  // Backend API: verify OTP entered by user
  app.post("/auth/verify-otp", async (req, res) => {
    try {
      const mode = String(req.body.mode || "login");
      const phone = normalizePhone(req.body.phone);
      const otp = String(req.body.otp || "").trim();

      if (!isValidPhone(phone) || !/^\d{4,8}$/.test(otp)) {
        return res.status(400).json({
          ok: false,
          code: "INVALID_INPUT",
          message: "Invalid phone or OTP.",
        });
      }

      const check = await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: phone, code: otp });

      if (check.status !== "approved") {
        return res.status(401).json({
          ok: false,
          code: "INVALID_OTP",
          message: "OTP verification failed.",
        });
      }

      if (mode === "register") {
        const pending = pendingRegistrationByPhone.get(phone);
        if (!pending) {
          return res.status(400).json({
            ok: false,
            code: "NO_PENDING_REGISTRATION",
            message: "No registration flow found for this number.",
          });
        }
        usersByPhone.set(phone, {
          name: pending.name,
          phone: phone,
          createdAt: new Date().toISOString(),
        });
        saveUsersToDisk();
        pendingRegistrationByPhone.delete(phone);
      }

      const user = usersByPhone.get(phone);
      if (!user) {
        return res.status(404).json({
          ok: false,
          code: "NOT_REGISTERED",
          message: "User not found.",
        });
      }

      const sessionToken =
        "bb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 12);

      return res.json({
        ok: true,
        user: user,
        sessionToken: sessionToken,
        message: "OTP verified.",
      });
    } catch (error) {
      const twilioMessage =
        typeof error?.message === "string" && error.message
          ? error.message
          : "Failed to verify OTP.";
      return res.status(500).json({
        ok: false,
        code: "OTP_VERIFY_FAILED",
        message: twilioMessage,
      });
    }
  });

  // Backend API: save/update delivery location for an existing user
  app.post("/auth/update-location", (req, res) => {
    try {
      const phone = normalizePhone(req.body.phone);
      const location = String(req.body.location || "").trim();

      if (!isValidPhone(phone)) {
        return res.status(400).json({
          ok: false,
          code: "INVALID_PHONE",
          message: "Invalid phone.",
        });
      }

      if (location.length < 5) {
        return res.status(400).json({
          ok: false,
          code: "INVALID_LOCATION",
          message: "Please provide a valid delivery location.",
        });
      }

      const user = usersByPhone.get(phone);
      if (!user) {
        return res.status(404).json({
          ok: false,
          code: "NOT_REGISTERED",
          message: "User not found.",
        });
      }

      const updatedUser = {
        ...user,
        deliveryLocation: location,
        updatedAt: new Date().toISOString(),
      };
      usersByPhone.set(phone, updatedUser);
      saveUsersToDisk();

      return res.json({
        ok: true,
        user: updatedUser,
        message: "Delivery location updated.",
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: "UPDATE_LOCATION_FAILED",
        message: "Failed to update delivery location.",
      });
    }
  });

  // Start backend server (http://localhost:3000 by default)
  app.listen(PORT, () => {
    loadUsersFromDisk();
    console.log("OTP backend running on http://localhost:" + PORT);
  });
}

// Frontend section (Browser runtime):
// This block runs in index.html and calls backend APIs via fetch().
// Frontend auth workflow (login/register/OTP modal) lives below and calls the backend APIs.
if (IS_BROWSER) {
  // Browser-side auth/session keys.
  const AUTH_USER_KEY = "bubblebakery_auth_user";
  const AUTH_SESSION_TOKEN_KEY = "bubblebakery_auth_session_token";
  const AUTH_FLOW_KEY = "bubblebakery_auth_flow";
  const API_BASE = "http://localhost:3000";

  function locationCacheKey(phone) {
    return "bubblebakery_location_" + String(phone || "").replace(/\D/g, "");
  }

  function readCachedLocation(phone) {
    if (!phone) {
      return "";
    }
    return String(localStorage.getItem(locationCacheKey(phone)) || "").trim();
  }

  function cacheLocation(phone, location) {
    if (!phone) {
      return;
    }
    const value = String(location || "").trim();
    if (!value) {
      return;
    }
    localStorage.setItem(locationCacheKey(phone), value);
  }

  function normalizePhone(phone) {
    const raw = String(phone || "").trim();
    const compact = raw.replace(/\s+/g, "");

    if (compact.startsWith("00")) {
      return "+" + compact.slice(2).replace(/\D/g, "");
    }

    if (raw.startsWith("+")) {
      return "+" + raw.slice(1).replace(/\D/g, "");
    }

    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) {
      return "";
    }

    if (cleaned.length === 10) {
      return "+91" + cleaned;
    }

    if (cleaned.length === 11 && cleaned.startsWith("0")) {
      return "+91" + cleaned.slice(1);
    }

    return "+" + cleaned;
  }

  // Mobile menu open/close behavior for the top nav.
  function myNav() {
    let bar = document.querySelector(".bar");
    let nav = document.querySelector(".navigation");

    if (!bar || !nav) {
      return;
    }

    bar.onclick = () => {
      if (nav.style.left == "0%") {
        nav.style.left = "-100%";
        bar.src = "assets/images/others/menu.png";
        document.body.style.overflow = "";
      } else {
        nav.style.left = "0%";
        bar.src = "assets/images/others/x.png";
        document.body.style.overflow = "hidden";
      }
    };

    document.addEventListener("click", (event) => {
      if (
        !nav.contains(event.target) &&
        !bar.contains(event.target) &&
        nav.style.left == "0%"
      ) {
        nav.style.left = "-100%";
        bar.src = "assets/images/others/menu.png";
        document.body.style.overflow = "";
      }
    });
  }

  function setAuthMessage(message, type) {
    const messageEl = document.getElementById("auth-status-message");
    if (!messageEl) {
      return;
    }

    if (!message) {
      messageEl.className = "alert d-none mb-3";
      messageEl.textContent = "";
      return;
    }

    const validType = type === "danger" || type === "success" ? type : "info";
    messageEl.className = "alert mb-3 alert-" + validType;
    messageEl.textContent = message;
  }

  function setActiveAuthPanel(panel) {
    const loginPanel = document.getElementById("login-panel");
    const registerPanel = document.getElementById("register-panel");
    const otpPanel = document.getElementById("otp-panel");

    if (!loginPanel || !registerPanel || !otpPanel) {
      return;
    }

    loginPanel.classList.add("d-none");
    registerPanel.classList.add("d-none");
    otpPanel.classList.add("d-none");

    if (panel === "register") {
      registerPanel.classList.remove("d-none");
    } else if (panel === "otp") {
      otpPanel.classList.remove("d-none");
    } else {
      loginPanel.classList.remove("d-none");
    }
  }

  // Renders login/profile label in nav based on local session.
  function renderAuthNav() {
    const userRaw = localStorage.getItem(AUTH_USER_KEY);
    const token = localStorage.getItem(AUTH_SESSION_TOKEN_KEY);
    const user = userRaw ? JSON.parse(userRaw) : null;

    const loginItem = document.getElementById("auth-login-item");
    const authNavLink = document.getElementById("auth-nav-link");

    if (!loginItem || !authNavLink) {
      return;
    }

    if (user && token) {
      loginItem.classList.remove("d-none");
      authNavLink.innerHTML =
        '<i class="fa-solid fa-user"></i>&ensp;Profile';
    } else {
      loginItem.classList.remove("d-none");
      authNavLink.innerHTML =
        '<i class="fa-solid fa-right-to-bracket"></i>&ensp;Login';
    }
  }

  // Opens Bootstrap modal and resets auth UI state.
  function openAuthModal(initialPanel) {
    const modalElement = document.getElementById("authModal");
    if (!modalElement || typeof bootstrap === "undefined") {
      return;
    }

    setAuthMessage("", "info");
    setActiveAuthPanel(initialPanel || "login");

    const otpCodeInput = document.getElementById("otp-code");
    if (otpCodeInput) {
      otpCodeInput.value = "";
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
  }

    // Shared POST helper for auth endpoints exposed by Express backend.
async function callApi(path, payload) {
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
    } catch (error) {
      const networkError = new Error(
        "Cannot reach OTP server. Start backend with: npm start"
      );
      networkError.code = "API_UNREACHABLE";
      throw networkError;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.message || "Request failed.";
      const error = new Error(message);
      error.code = data.code || "REQUEST_FAILED";
      throw error;
    }
    return data;
  }

    // Binds auth modal events and moves between login/register/OTP panels.
function initAuth() {
    const authNavLink = document.getElementById("auth-nav-link");
    const goRegisterBtn = document.getElementById("go-register-btn");
    const goLoginBtn = document.getElementById("go-login-btn");
    const backRegisterBtn = document.getElementById("back-register-btn");
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const otpForm = document.getElementById("otp-form");

    if (!authNavLink || !loginForm || !registerForm || !otpForm) {
      return;
    }

    renderAuthNav();

    authNavLink.addEventListener("click", (event) => {
      event.preventDefault();
      const userRaw = localStorage.getItem(AUTH_USER_KEY);
      const token = localStorage.getItem(AUTH_SESSION_TOKEN_KEY);
      if (userRaw && token) {
        window.location.href = "profile.html";
        return;
      }
      openAuthModal("login");
    });

    if (goRegisterBtn) {
      goRegisterBtn.addEventListener("click", () => {
        setAuthMessage("", "info");
        setActiveAuthPanel("register");
      });
    }

    if (goLoginBtn) {
      goLoginBtn.addEventListener("click", () => {
        setAuthMessage("", "info");
        setActiveAuthPanel("login");
      });
    }

    if (backRegisterBtn) {
      backRegisterBtn.addEventListener("click", () => {
        setAuthMessage("", "info");
        setActiveAuthPanel("register");
      });
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const phoneInput = document.getElementById("login-phone");
      const otpPhone = document.getElementById("otp-phone");
      const phone = normalizePhone(phoneInput ? phoneInput.value : "");

      try {
        await callApi("/auth/send-otp", { mode: "login", phone: phone });
        localStorage.setItem(
          AUTH_FLOW_KEY,
          JSON.stringify({ mode: "login", phone: phone })
        );
        if (otpPhone) {
          otpPhone.value = phone;
        }
        setActiveAuthPanel("otp");
        setAuthMessage("OTP sent to your phone.", "success");
      } catch (error) {
        if (error.code === "NOT_REGISTERED") {
          const regPhone = document.getElementById("register-phone");
          if (regPhone) {
            regPhone.value = phone;
          }
          setActiveAuthPanel("register");
        }
        setAuthMessage(error.message, "danger");
      }
    });

    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nameInput = document.getElementById("register-name");
      const phoneInput = document.getElementById("register-phone");
      const otpPhone = document.getElementById("otp-phone");

      const name = String(nameInput ? nameInput.value : "").trim();
      const phone = normalizePhone(phoneInput ? phoneInput.value : "");

      try {
        await callApi("/auth/send-otp", {
          mode: "register",
          phone: phone,
          name: name,
        });
        localStorage.setItem(
          AUTH_FLOW_KEY,
          JSON.stringify({ mode: "register", phone: phone })
        );
        if (otpPhone) {
          otpPhone.value = phone;
        }
        setActiveAuthPanel("otp");
        setAuthMessage("OTP sent to your phone.", "success");
      } catch (error) {
        setAuthMessage(error.message, "danger");
      }
    });

    otpForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const otpInput = document.getElementById("otp-code");
      const flowRaw = localStorage.getItem(AUTH_FLOW_KEY);
      const flow = flowRaw ? JSON.parse(flowRaw) : null;

      if (!flow || !flow.phone || !flow.mode) {
        setAuthMessage("Session expired. Start login/register again.", "danger");
        setActiveAuthPanel("login");
        return;
      }

      try {
        const data = await callApi("/auth/verify-otp", {
          mode: flow.mode,
          phone: flow.phone,
          otp: String(otpInput ? otpInput.value : "").trim(),
        });
        const existingUserRaw = localStorage.getItem(AUTH_USER_KEY);
        const existingUser = existingUserRaw ? JSON.parse(existingUserRaw) : null;
        const cachedLocation = readCachedLocation(data.user ? data.user.phone : "");
        const mergedUser = {
          ...(data.user || {}),
          deliveryLocation:
            (data.user && data.user.deliveryLocation) ||
            cachedLocation ||
            (existingUser && existingUser.phone === data.user.phone
              ? existingUser.deliveryLocation
              : "") ||
            "",
        };
        if (mergedUser.phone && mergedUser.deliveryLocation) {
          cacheLocation(mergedUser.phone, mergedUser.deliveryLocation);
        }

        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(mergedUser));
        localStorage.setItem(AUTH_SESSION_TOKEN_KEY, data.sessionToken || "");
        localStorage.removeItem(AUTH_FLOW_KEY);

        renderAuthNav();
            setAuthMessage("Authentication successful.", "success");

        const modalElement = document.getElementById("authModal");
        if (modalElement && typeof bootstrap !== "undefined") {
          const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
          setTimeout(() => modal.hide(), 400);
        }
      } catch (error) {
        setAuthMessage(error.message, "danger");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    myNav();
    initAuth();

    const params = new URLSearchParams(window.location.search);
    if (params.get("openLogin") === "1") {
      openAuthModal("login");
      params.delete("openLogin");
      const cleanQuery = params.toString();
      const cleanUrl = window.location.pathname + (cleanQuery ? "?" + cleanQuery : "");
      window.history.replaceState({}, "", cleanUrl);
    }
  });

  document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "F12") {
      e.preventDefault();
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J")) {
      e.preventDefault();
    }
    if (e.ctrlKey && e.key === "u") {
      e.preventDefault();
    }
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
    }
  });
}


