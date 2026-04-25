// Cart domain logic: add/remove items, checkout flow, stock persistence, and order history storage in localStorage.
(function () {
  const CART_KEY = "b4_bakers_cart";
  const ORDER_HISTORY_KEY = "b4_bakers_order_history";
  const STOCK_KEY = "b4_bakers_product_stock";
  const AUTH_USER_KEY = "bubblebakery_auth_user";
  const AUTH_SESSION_TOKEN_KEY = "bubblebakery_auth_session_token";
  const productControlMap = new Map();
  const persistedStockById = loadPersistedStock();
  let pendingCheckout = null;
  let lastCompletedOrder = null;

  function formatRupiah(value) {
    return "â‚¹" + Number(value || 0).toLocaleString("en-IN");
  }

  // Reads and validates cart entries from localStorage.
  function getCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Number(item.price) > 0 &&
          Number(item.quantity) > 0
      );
    } catch (error) {
      return [];
    }
  }

  // Persists cart array after add/remove/quantity updates.
  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  // Bootstraps stock counts from localStorage to keep inventory state between reloads.
  function loadPersistedStock() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STOCK_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      const normalized = {};
      Object.keys(parsed).forEach((key) => {
        const value = Number(parsed[key]);
        if (Number.isFinite(value) && value >= 0) {
          normalized[key] = Math.floor(value);
        }
      });
      return normalized;
    } catch (error) {
      return {};
    }
  }

  function savePersistedStock() {
    localStorage.setItem(STOCK_KEY, JSON.stringify(persistedStockById));
  }

  function parseStockText(text) {
    const match = String(text || "").trim().match(/\((\d+)/);
    if (!match) {
      return null;
    }
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    return Math.floor(value);
  }

  function formatStockText(value) {
    return "(" + String(Math.max(0, Number(value) || 0)) + ")";
  }

  function findStockDisplayForButton(button) {
    const card = button.closest(".shop1");
    if (!card) {
      return null;
    }

    const candidates = card.querySelectorAll("div");
    for (const node of candidates) {
      if (/^\(\d+\+?\)$/.test(String(node.textContent || "").trim())) {
        return node;
      }
    }
    return null;
  }

  function getRemainingStockForId(id) {
    if (Object.prototype.hasOwnProperty.call(persistedStockById, id)) {
      return Number(persistedStockById[id]);
    }
    return null;
  }

  // Restores stock numbers on product cards after page load.
  function updateStockDisplays() {
    productControlMap.forEach((controls, id) => {
      const stockDisplay = controls.stockDisplay;
      if (!stockDisplay) {
        return;
      }
      const remaining = getRemainingStockForId(id);
      if (remaining === null) {
        return;
      }
      stockDisplay.textContent = formatStockText(remaining);
    });
  }

  function decrementStockAfterPurchase(items) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }

    let changed = false;
    items.forEach((item) => {
      const id = item && typeof item.id === "string" ? item.id : "";
      const qty = Number(item && item.quantity);
      if (!id || !Number.isFinite(qty) || qty <= 0) {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(persistedStockById, id)) {
        return;
      }

      const current = Math.max(0, Number(persistedStockById[id]) || 0);
      const next = Math.max(0, current - Math.floor(qty));
      if (next !== current) {
        persistedStockById[id] = next;
        changed = true;
      }
    });

    if (changed) {
      savePersistedStock();
      updateStockDisplays();
    }
  }

    // Order history is saved here after checkout. Profile page reads the same key.
  // Appends latest order at top of history and keeps max 30 records.
  function appendOrderHistory(order) {
    let history = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) || "[]");
      history = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      history = [];
    }

    history.unshift(order);
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
  }

  function isLoggedIn() {
    const user = localStorage.getItem(AUTH_USER_KEY);
    const token = localStorage.getItem(AUTH_SESSION_TOKEN_KEY);
    return Boolean(user && token);
  }

  function getLoggedInUser() {
    try {
      const userRaw = localStorage.getItem(AUTH_USER_KEY);
      const token = localStorage.getItem(AUTH_SESSION_TOKEN_KEY);
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (!user || !token) {
        return null;
      }
      const cachedLocation = String(
        localStorage.getItem(
          "bubblebakery_location_" + String(user.phone || "").replace(/\D/g, "")
        ) || ""
      ).trim();
      if (!user.deliveryLocation && cachedLocation) {
        user.deliveryLocation = cachedLocation;
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      }
      return user;
    } catch (error) {
      return null;
    }
  }

  function promptLogin() {
    alert("Please login first to add items to cart.");
    const authNavLink = document.getElementById("auth-nav-link");
    if (authNavLink) {
      authNavLink.click();
    }
  }

  function getQuantityById(id) {
    const cart = getCart();
    const existing = cart.find((item) => item.id === id);
    return existing ? Number(existing.quantity) : 0;
  }

  // Updates all cart badges (home/cart/profile nav) with current item count.
  function updateCartCount() {
    const cart = getCart();
    const totalItems = cart.reduce((sum, item) => sum + Number(item.quantity), 0);
    const badges = document.querySelectorAll("#cart-count");
    badges.forEach((badge) => {
      badge.textContent = String(totalItems);
      badge.style.display = totalItems > 0 ? "inline-block" : "none";
    });
  }

  // Core add-to-cart operation with stock guard.
  function addToCart(item) {
    const stockLeft = getRemainingStockForId(item.id);
    const quantityInCart = getQuantityById(item.id);
    if (stockLeft !== null && quantityInCart >= stockLeft) {
      alert("This item is out of stock.");
      return;
    }

    const cart = getCart();
    const existing = cart.find((entry) => entry.id === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        image: item.image || "",
        quantity: 1,
      });
    }
    saveCart(cart);
    updateCartCount();
    syncProductQuantityControls();
  }

  function setCartItemQuantity(item, quantity) {
    const cart = getCart();
    const existing = cart.find((entry) => entry.id === item.id);

    if (quantity <= 0) {
      const updated = cart.filter((entry) => entry.id !== item.id);
      saveCart(updated);
      updateCartCount();
      syncProductQuantityControls();
      return;
    }

    if (existing) {
      existing.quantity = quantity;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        image: item.image || "",
        quantity: quantity,
      });
    }

    saveCart(cart);
    updateCartCount();
    syncProductQuantityControls();
  }

    // Product cards are enhanced with +/- quantity controls linked to cart state.
function bindAddToCartButtons() {
    const buttons = document.querySelectorAll("[data-add-to-cart]");
    buttons.forEach((button) => {
      const name = button.getAttribute("data-name") || "Product";
      const price = Number(button.getAttribute("data-price") || 0);
      const image = button.getAttribute("data-image") || "";
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!price) {
        return;
      }

      const itemMeta = { id: id, name: name, price: price, image: image };
      const stockDisplay = findStockDisplayForButton(button);
      const initialStock = stockDisplay ? parseStockText(stockDisplay.textContent) : null;
      if (
        initialStock !== null &&
        !Object.prototype.hasOwnProperty.call(persistedStockById, id)
      ) {
        persistedStockById[id] = initialStock;
        savePersistedStock();
      }

      const wrapper = document.createElement("div");
      wrapper.className = "mt-1";

      const quantityControls = document.createElement("div");
      quantityControls.className = "align-items-center gap-2";
      quantityControls.style.display = "none";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "btn btn-outline-light btn-sm";
      minusBtn.textContent = "-";

      const qtyLabel = document.createElement("button");
      qtyLabel.type = "button";
      qtyLabel.className = "btn btn-outline-light btn-sm";
      qtyLabel.disabled = true;
      qtyLabel.style.minWidth = "56px";
      qtyLabel.textContent = "0";

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "btn btn-outline-light btn-sm";
      plusBtn.textContent = "+";

      button.addEventListener("click", function () {
        if (!isLoggedIn()) {
          promptLogin();
          return;
        }
        addToCart(itemMeta);
      });

      plusBtn.addEventListener("click", function () {
        if (!isLoggedIn()) {
          promptLogin();
          return;
        }
        addToCart(itemMeta);
      });

      minusBtn.addEventListener("click", function () {
        if (!isLoggedIn()) {
          promptLogin();
          return;
        }
        const currentQty = getQuantityById(itemMeta.id);
        setCartItemQuantity(itemMeta, currentQty - 1);
      });

      button.parentNode.insertBefore(wrapper, button);
      wrapper.appendChild(button);
      wrapper.appendChild(quantityControls);
      quantityControls.appendChild(minusBtn);
      quantityControls.appendChild(qtyLabel);
      quantityControls.appendChild(plusBtn);

      productControlMap.set(itemMeta.id, {
        addBtn: button,
        quantityControls: quantityControls,
        minusBtn: minusBtn,
        qtyLabel: qtyLabel,
        plusBtn: plusBtn,
        stockDisplay: stockDisplay,
      });
    });

    updateStockDisplays();
    syncProductQuantityControls();
  }

  function syncProductQuantityControls() {
    productControlMap.forEach((controls, id) => {
      const qty = getQuantityById(id);
      const stockLeft = getRemainingStockForId(id);
      const isOutOfStock = stockLeft !== null && stockLeft <= 0;
      const canIncrease = stockLeft === null || qty < stockLeft;

      controls.qtyLabel.textContent = String(qty);
      controls.minusBtn.disabled = qty <= 0;
      if (controls.plusBtn) {
        controls.plusBtn.disabled = !canIncrease;
      }

      if (isOutOfStock && qty <= 0) {
        controls.addBtn.disabled = true;
        controls.addBtn.textContent = "Out of Stock";
        controls.addBtn.style.display = "";
        controls.quantityControls.style.display = "none";
        return;
      }

      controls.addBtn.disabled = false;
      controls.addBtn.textContent = "Add To Cart";
      controls.addBtn.style.display = qty > 0 ? "none" : "";
      controls.quantityControls.style.display = qty > 0 ? "flex" : "none";
    });
  }

  // Builds cart table rows and action buttons on cart page.
  function renderCartRows() {
    const tbody = document.getElementById("cart-items-body");
    const emptyState = document.getElementById("cart-empty-state");
    const tableWrap = document.getElementById("cart-table-wrap");
    const selectAll = document.getElementById("select-all-items");
    if (!tbody || !emptyState || !tableWrap) {
      return;
    }

    const cart = getCart();
    tbody.innerHTML = "";

    if (!cart.length) {
      emptyState.classList.remove("d-none");
      tableWrap.classList.add("d-none");
      if (selectAll) {
        selectAll.checked = false;
      }
      updateSummary();
      return;
    }

    emptyState.classList.add("d-none");
    tableWrap.classList.remove("d-none");

    cart.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input class="form-check-input cart-select" type="checkbox" data-id="' +
        item.id +
        '" checked></td>' +
        '<td class="d-flex align-items-center gap-2">' +
        (item.image
          ? '<img src="' +
            item.image +
            '" alt="' +
            item.name +
            '" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">'
          : "") +
        "<span>" +
        item.name +
        "</span></td>" +
        "<td>" +
        formatRupiah(item.price) +
        "</td>" +
        '<td><div class="btn-group btn-group-sm" role="group">' +
        '<button class="btn btn-outline-light" data-action="decrease" data-id="' +
        item.id +
        '">-</button>' +
        '<button class="btn btn-outline-light" type="button" disabled>' +
        item.quantity +
        "</button>" +
        '<button class="btn btn-outline-light" data-action="increase" data-id="' +
        item.id +
        '">+</button>' +
        "</div></td>" +
        "<td>" +
        formatRupiah(item.price * item.quantity) +
        "</td>" +
        '<td><button class="btn btn-sm btn-danger" data-action="remove" data-id="' +
        item.id +
        '">Remove</button></td>';
      tbody.appendChild(tr);
    });

    if (selectAll) {
      selectAll.checked = true;
    }
    updateSummary();
  }

  // Recomputes selected quantity and selected total for checkout.
  function updateSummary() {
    const selectedCountEl = document.getElementById("cart-summary-selected");
    const totalEl = document.getElementById("cart-summary-total");
    const checkboxes = document.querySelectorAll(".cart-select");
    const cart = getCart();
    let selectedItems = 0;
    let selectedTotal = 0;

    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        const item = cart.find((entry) => entry.id === checkbox.dataset.id);
        if (!item) {
          return;
        }
        selectedItems += item.quantity;
        selectedTotal += item.price * item.quantity;
      }
    });

    if (selectedCountEl) {
      selectedCountEl.textContent = String(selectedItems);
    }
    if (totalEl) {
      totalEl.textContent = formatRupiah(selectedTotal);
    }
  }

  // Gets selected cart subset to purchase (used by Buy Selected button).
  function getSelectedCheckoutData() {
    const selected = Array.from(document.querySelectorAll(".cart-select:checked"));
    if (!selected.length) {
      return null;
    }

    const selectedIds = new Set(selected.map((node) => node.dataset.id));
    const cart = getCart();
    const selectedItems = cart.filter((item) => selectedIds.has(item.id));
    const selectedTotal = selectedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    if (!selectedItems.length || selectedTotal <= 0) {
      return null;
    }

    return {
      selectedIds: selectedIds,
      selectedItems: selectedItems,
      selectedTotal: selectedTotal,
    };
  }

  function getSelectedPaymentMethod() {
    const selected = document.querySelector('input[name="payment-method"]:checked');
    return selected ? selected.value : "Google Pay";
  }

  function openPaymentModal(totalAmount) {
    const totalEl = document.getElementById("payment-total-amount");
    if (totalEl) {
      totalEl.textContent = formatRupiah(totalAmount);
    }

    const modalEl = document.getElementById("paymentModal");
    if (!modalEl || typeof bootstrap === "undefined") {
      return false;
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    return true;
  }

  function closePaymentModal() {
    const modalEl = document.getElementById("paymentModal");
    if (!modalEl || typeof bootstrap === "undefined") {
      return;
    }
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();
  }

  function normalizeWhatsAppNumber(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) {
      return "";
    }
    if (digits.length === 10) {
      return "91" + digits;
    }
    if (digits.length === 11 && digits.startsWith("0")) {
      return "91" + digits.slice(1);
    }
    return digits;
  }

  function createBillMessage(order) {
    const itemsText = order.items
      .map((item) => "- " + item.name + " x" + item.quantity + " = " + formatRupiah(item.price * item.quantity))
      .join("%0A");

    return (
      "Hi " +
      (order.customerName || "Customer") +
      ",%0A%0A" +
      "Thank you for purchasing from B4 Bakers!%0A" +
      "Order ID: " +
      order.id +
      "%0A" +
      "Payment: " +
      order.paymentMethod +
      "%0A" +
      "Delivery Address: " +
      (order.deliveryLocation || "N/A") +
      "%0A%0AItems:%0A" +
      itemsText +
      "%0A%0ATotal: " +
      formatRupiah(order.total) +
      "%0A%0AWe appreciate your order."
    );
  }

  // Opens WhatsApp with generated order bill message.
  function sendBillOnWhatsApp(order) {
    if (!order) {
      return false;
    }
    const phone = normalizeWhatsAppNumber(order.customerPhone);
    if (!phone) {
      return false;
    }
    const billMessage = createBillMessage(order);
    const url = "https://wa.me/" + phone + "?text=" + billMessage;
    window.open(url, "_blank");
    return true;
  }

  function showPurchaseSuccessModal() {
    const modalEl = document.getElementById("purchaseSuccessModal");
    if (!modalEl || typeof bootstrap === "undefined") {
      return;
    }
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

    // Final checkout step: creates order object, stores history, updates stock, clears purchased items.
function completePurchase(paymentMethod) {
    if (!pendingCheckout) {
      return;
    }

    const user = getLoggedInUser();
    const deliveryLocation = user ? String(user.deliveryLocation || "").trim() : "";

    const order = {
      id: Date.now(),
      orderedAt: new Date().toISOString(),
      customerName: user ? String(user.name || "") : "",
      customerPhone: user ? String(user.phone || "") : "",
      deliveryLocation: deliveryLocation,
      paymentMethod: paymentMethod,
      items: pendingCheckout.selectedItems,
      total: pendingCheckout.selectedTotal,
    };

    appendOrderHistory(order);
    decrementStockAfterPurchase(pendingCheckout.selectedItems);

    const cart = getCart();
    const remaining = cart.filter((item) => !pendingCheckout.selectedIds.has(item.id));
    saveCart(remaining);
    updateCartCount();
    syncProductQuantityControls();
    renderCartRows();

    lastCompletedOrder = order;
    const sent = sendBillOnWhatsApp(order);
    if (!sent) {
      alert("Payment successful. Add a valid login phone number to send WhatsApp bill.");
    }
    showPurchaseSuccessModal();

    pendingCheckout = null;
  }

    // Cart page controls: quantity edits, select-all, clear cart, and payment flow.
function bindCartPageEvents() {
    const tbody = document.getElementById("cart-items-body");
    const clearBtn = document.getElementById("clear-cart-btn");
    const buyBtn = document.getElementById("buy-selected-btn");
    const selectAll = document.getElementById("select-all-items");
    const confirmPaymentBtn = document.getElementById("confirm-payment-btn");
    const cancelPaymentBtn = document.getElementById("cancel-payment-btn");
    const sendBillWhatsappBtn = document.getElementById("send-bill-whatsapp-btn");

    if (!tbody) {
      return;
    }

    tbody.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const action = target.getAttribute("data-action");
      const id = target.getAttribute("data-id");
      if (!action || !id) {
        return;
      }

      const cart = getCart();
      const item = cart.find((entry) => entry.id === id);
      if (!item) {
        return;
      }

      if (action === "increase") {
        item.quantity += 1;
      } else if (action === "decrease") {
        item.quantity -= 1;
      } else if (action === "remove") {
        const updated = cart.filter((entry) => entry.id !== id);
        saveCart(updated);
        updateCartCount();
        syncProductQuantityControls();
        renderCartRows();
        return;
      }

      const updated = cart.filter((entry) => entry.quantity > 0);
      saveCart(updated);
      updateCartCount();
      syncProductQuantityControls();
      renderCartRows();
    });

    tbody.addEventListener("change", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("cart-select")) {
        return;
      }
      updateSummary();
    });

    if (selectAll) {
      selectAll.addEventListener("change", function () {
        const checked = this.checked;
        const checkboxes = document.querySelectorAll(".cart-select");
        checkboxes.forEach((box) => {
          box.checked = checked;
        });
        updateSummary();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        saveCart([]);
        updateCartCount();
        syncProductQuantityControls();
        renderCartRows();
      });
    }

    if (buyBtn) {
      buyBtn.addEventListener("click", function () {
        const user = getLoggedInUser();
        if (!user) {
          alert("Please login first before buying items.");
          window.location.href = "index.html?openLogin=1";
          return;
        }

        const deliveryLocation = String(user.deliveryLocation || "").trim();
        if (!deliveryLocation) {
          alert("Please fill your delivery location first in Profile.");
          window.location.href = "profile.html";
          return;
        }
        const checkoutData = getSelectedCheckoutData();
        if (!checkoutData) {
          alert("Please select at least one item.");
          return;
        }

        pendingCheckout = checkoutData;
        const opened = openPaymentModal(checkoutData.selectedTotal);
        if (!opened) {
          completePurchase(getSelectedPaymentMethod());
        }
      });
    }

    if (confirmPaymentBtn) {
      confirmPaymentBtn.addEventListener("click", function () {
        if (!pendingCheckout) {
          return;
        }
        const paymentMethod = getSelectedPaymentMethod();
        closePaymentModal();
        completePurchase(paymentMethod);
      });
    }

    if (cancelPaymentBtn) {
      cancelPaymentBtn.addEventListener("click", function () {
        pendingCheckout = null;
      });
    }

    if (sendBillWhatsappBtn) {
      sendBillWhatsappBtn.addEventListener("click", function () {
        const sent = sendBillOnWhatsApp(lastCompletedOrder);
        if (!sent) {
          alert("Unable to send bill on WhatsApp. Missing valid phone number.");
        }
      });
    }
  }

  // Initializer for every page that includes assets/js/cart.js.
  function init() {
    updateCartCount();
    bindAddToCartButtons();
    bindCartPageEvents();
    renderCartRows();
  }

  document.addEventListener("DOMContentLoaded", init);
})();





