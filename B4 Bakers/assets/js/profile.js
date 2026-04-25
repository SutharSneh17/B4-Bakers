// Profile page logic: session-aware UI, location management, and order history rendering.
(function () {
  // Local storage/session keys shared with auth and cart flows.
  const AUTH_USER_KEY = "bubblebakery_auth_user";
  const AUTH_SESSION_TOKEN_KEY = "bubblebakery_auth_session_token";
  const AUTH_FLOW_KEY = "bubblebakery_auth_flow";
  const ORDER_HISTORY_KEY = "b4_bakers_order_history";
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

  function formatInr(value) {
    return "â‚¹" + Number(value || 0).toLocaleString("en-IN");
  }

  function getLoggedInUser() {
    try {
      const userRaw = localStorage.getItem(AUTH_USER_KEY);
      const token = localStorage.getItem(AUTH_SESSION_TOKEN_KEY);
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (!user || !token) {
        return null;
      }
      return user;
    } catch (error) {
      return null;
    }
  }

  function setLocationStatus(message, isError) {
    const status = document.getElementById("profile-location-status");
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.style.color = isError ? "#f87171" : "#9ca3af";
  }

  // Normalizes and displays location section state by login availability.
  function renderLocationSection(user) {
    const input = document.getElementById("profile-location-input");
    const saveBtn = document.getElementById("profile-location-save-btn");
    if (!input || !saveBtn) {
      return;
    }

    if (!user) {
      input.value = "";
      input.disabled = true;
      saveBtn.disabled = true;
      setLocationStatus("Login first to save your delivery location.", true);
      return;
    }

    input.disabled = false;
    saveBtn.disabled = false;
    const resolvedLocation = String(user.deliveryLocation || readCachedLocation(user.phone) || "");
    if (!user.deliveryLocation && resolvedLocation) {
      user.deliveryLocation = resolvedLocation;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }
    input.value = resolvedLocation;
    if (resolvedLocation) {
      setLocationStatus("Saved location: " + resolvedLocation, false);
    } else {
      setLocationStatus("Please add your delivery location for checkout.", false);
    }
  }

  // Reads b4_bakers_order_history from localStorage and paints recent orders.
  function renderOrderHistory() {
    const userTitle = document.getElementById("profile-user-title");
    const loginHint = document.getElementById("profile-login-hint");
    const orderHistory = document.getElementById("profile-order-history");
    const logoutBtn = document.getElementById("profile-logout-btn");
    const loginBtn = document.getElementById("profile-login-btn");

    if (!userTitle || !loginHint || !orderHistory || !logoutBtn || !loginBtn) {
      return;
    }

    const user = getLoggedInUser();
    const isLoggedIn = Boolean(user);

    orderHistory.innerHTML = "";
    renderLocationSection(user);

    if (!isLoggedIn) {
      userTitle.textContent = "Guest User";
      loginHint.textContent = "Please login from home page to access account.";
      logoutBtn.classList.add("d-none");
      loginBtn.classList.remove("d-none");
      orderHistory.innerHTML =
        '<div style="color:#9ca3af">No order history available.</div>';
      return;
    }

    userTitle.textContent = "Hello, " + user.name;
    loginHint.textContent = "Your recent orders:";
    logoutBtn.classList.remove("d-none");
    loginBtn.classList.add("d-none");

    let history = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) || "[]");
      history = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      history = [];
    }

    if (!history.length) {
      orderHistory.innerHTML = '<div style="color:#9ca3af">No orders yet.</div>';
      return;
    }

    history.slice(0, 20).forEach((order) => {
      const card = document.createElement("div");
      card.style.background = "#1f2937";
      card.style.border = "1px solid #374151";
      card.style.borderRadius = "10px";
      card.style.padding = "0.75rem 0.9rem";

      const orderTime = order.orderedAt
        ? new Date(order.orderedAt).toLocaleString("en-IN")
        : "";
      const itemsText = Array.isArray(order.items)
        ? order.items.map((item) => item.name + " x" + item.quantity).join(", ")
        : "";
      const orderLocation = String(order.deliveryLocation || "").trim();

      card.innerHTML =
        '<div style="font-weight:600">Order #' +
        (order.id || "-") +
        "</div>" +
        '<div style="font-size:13px;color:#d1d5db">' +
        orderTime +
        "</div>" +
        '<div style="font-size:14px;margin-top:4px">' +
        itemsText +
        "</div>" +
        (orderLocation
          ? '<div style="font-size:13px;margin-top:6px;color:#d1d5db">Delivery: ' +
            orderLocation +
            "</div>"
          : "") +
        '<div style="margin-top:6px;color:#93c5fd">Total: ' +
        formatInr(order.total || 0) +
        "</div>";
      orderHistory.appendChild(card);
    });
  }

    // Sync delivery location to Express backend for persistence across sessions/devices.
  // Calls backend endpoint to store location in users-db.json via Express.
  async function updateLocationOnServer(phone, location) {
    const response = await fetch(API_BASE + "/auth/update-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phone,
        location: location,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.message || "Failed to save location on server.";
      throw new Error(message);
    }
    return data;
  }

    // Wires profile actions: logout, go-to-login redirect, and location form submit.
function bindActions() {
    const logoutBtn = document.getElementById("profile-logout-btn");
    const loginBtn = document.getElementById("profile-login-btn");
    const locationForm = document.getElementById("profile-location-form");
    const locationInput = document.getElementById("profile-location-input");

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.removeItem(AUTH_SESSION_TOKEN_KEY);
        localStorage.removeItem(AUTH_FLOW_KEY);
        renderOrderHistory();
      });
    }

    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        window.location.href = "index.html?openLogin=1";
      });
    }

    if (locationForm && locationInput) {
      locationForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const user = getLoggedInUser();
        if (!user) {
          setLocationStatus("Login first to save your delivery location.", true);
          return;
        }

        const location = String(locationInput.value || "").trim();
        if (location.length < 5) {
          setLocationStatus("Please enter a valid full delivery address.", true);
          return;
        }

        user.deliveryLocation = location;
        cacheLocation(user.phone, location);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

        try {
          const result = await updateLocationOnServer(user.phone, location);
          const updatedUser = result && result.user ? result.user : user;
          cacheLocation(updatedUser.phone, updatedUser.deliveryLocation);
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
          setLocationStatus("Delivery location saved successfully.", false);
        } catch (error) {
          setLocationStatus(
            "Saved locally. Start backend to sync for future logins.",
            true
          );
        }
      });
    }
  }

  // Page bootstrap for profile: render current data then attach event handlers.
  document.addEventListener("DOMContentLoaded", function () {
    renderOrderHistory();
    bindActions();
  });
})();




