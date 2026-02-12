const presetList = document.getElementById("preset-list");
const menuGrid = document.querySelector(".menu-grid");
const cartList = document.getElementById("cart-list");
const cartInput = document.getElementById("order_items_json");
const requirementsField = document.getElementById("requirements");
const lunchBanner = document.getElementById("lunch-ready-banner");
const mateBanner = document.getElementById("mate-order-banner");
const ringBanner = document.getElementById("ring-banner");
const ringButton = document.getElementById("ring-chef");
const myOrdersList = document.getElementById("my-orders-list");
const mateOrdersList = document.getElementById("mate-orders-list");
const LUNCH_SEEN_KEY = "lunchReadySeenAt";
const MATE_SEEN_KEY = "mateOrderSeenIds";
const cart = new Map();

const renderCart = () => {
  if (!cartList) {
    return;
  }
  cartList.replaceChildren();
  if (cart.size === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No items added yet.";
    cartList.appendChild(empty);
    if (cartInput) {
      cartInput.value = "";
    }
    return;
  }

  const items = [];
  cart.forEach((qty, name) => items.push({ name, qty }));
  items.sort((a, b) => a.name.localeCompare(b.name));
  if (cartInput) {
    cartInput.value = JSON.stringify(items);
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `<strong>${item.name}</strong><span class="cart-qty">x${item.qty}</span>`;
    const actions = document.createElement("div");
    actions.className = "cart-actions";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "-";
    minus.addEventListener("click", () => {
      const next = Math.max(0, (cart.get(item.name) || 0) - 1);
      if (next === 0) {
        cart.delete(item.name);
      } else {
        cart.set(item.name, next);
      }
      renderCart();
    });
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      cart.set(item.name, (cart.get(item.name) || 0) + 1);
      renderCart();
    });
    actions.appendChild(minus);
    actions.appendChild(plus);
    row.appendChild(actions);
    cartList.appendChild(row);
  });

  if (menuGrid) {
    menuGrid.querySelectorAll(".menu-item").forEach((itemRow) => {
      const name = itemRow.dataset.item || "";
      const countEl = itemRow.querySelector(".menu-count");
      if (countEl) {
        countEl.textContent = String(cart.get(name) || 0);
      }
    });
  }
};

const renderMenu = (items) => {
  if (!menuGrid) {
    return;
  }
  menuGrid.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No items available right now.";
    menuGrid.appendChild(empty);
    return;
  }
  const grouped = new Map();
  items.forEach((item) => {
    const category = item.category || "Menu";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push(item);
  });
  Array.from(grouped.entries()).forEach(([category, entries]) => {
    const section = document.createElement("div");
    section.className = "menu-section";
    const title = document.createElement("h3");
    title.textContent = category;
    section.appendChild(title);
    const list = document.createElement("div");
    list.className = "menu-items";
    entries.forEach((item) => {
      const row = document.createElement("div");
      row.className = "menu-item";
      row.dataset.item = item.name || "";
      const image = document.createElement("img");
      image.className = "menu-image";
      image.src = item.image || "";
      image.alt = item.name || "Menu item";
      image.loading = "lazy";
      const details = document.createElement("div");
      details.className = "menu-details";
      const name = document.createElement("span");
      name.className = "menu-name";
      name.textContent = item.name || "";
      const controls = document.createElement("div");
      controls.className = "menu-controls";
      const count = document.createElement("span");
      count.className = "menu-count";
      count.dataset.count = "0";
      count.textContent = String(cart.get(item.name) || 0);
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "menu-minus";
      minus.setAttribute("aria-label", `Remove ${item.name}`);
      minus.textContent = "-";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "menu-add";
      add.setAttribute("aria-label", `Add ${item.name}`);
      add.textContent = "+";
      controls.appendChild(count);
      controls.appendChild(minus);
      controls.appendChild(add);
      details.appendChild(name);
      details.appendChild(controls);
      row.appendChild(image);
      row.appendChild(details);
      list.appendChild(row);
    });
    section.appendChild(list);
    menuGrid.appendChild(section);
  });
};

const refreshMenu = async () => {
  if (!menuGrid) {
    return;
  }
  const apiBase = menuGrid.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/menu`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    renderMenu(data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

const renderPresets = (presets) => {
  if (!presetList) {
    return;
  }
  presetList.replaceChildren();
  if (!presets || presets.length === 0) {
    return;
  }
  presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.textContent = preset.name;
    button.addEventListener("click", () => {
      if (preset.order_text) {
        cart.set(preset.order_text, (cart.get(preset.order_text) || 0) + 1);
        renderCart();
      }
      if (requirementsField) {
        requirementsField.value = preset.requirements || "";
      }
    });
    presetList.appendChild(button);
  });
};

const refreshPresets = async () => {
  if (!presetList) {
    return;
  }
  const apiBase = presetList.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/presets`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    renderPresets(data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshPresets();
refreshMenu();
renderCart();
setInterval(refreshMenu, 15000);

const playChime = () => {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audio.close();
    }, 150);
  } catch (error) {
    // Ignore audio errors.
  }
};

const showLunchNotification = () => {
  if (lunchBanner) {
    lunchBanner.classList.remove("hidden");
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Lunch is ready", {
      body: "Lunch is ready.",
    });
  }
  playChime();
};

const showMateNotification = (order) => {
  const employee = order.employee_name || "Someone";
  const items = order.order_text || "an order";
  const message = `${employee} has ordered ${items} for you.`;
  if (mateBanner) {
    mateBanner.textContent = message;
    mateBanner.classList.remove("hidden");
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Order for you", { body: message });
  }
  playChime();
};

const refreshLunchReady = async () => {
  if (!lunchBanner) {
    return;
  }
  const apiBase = lunchBanner.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/lunch-ready`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const ready = Boolean(data?.is_ready);
    const updatedAt = data?.updated_at || "";
    if (!ready) {
      lunchBanner.classList.add("hidden");
      return;
    }
    const lastSeen = localStorage.getItem(LUNCH_SEEN_KEY) || "";
    if (updatedAt && updatedAt !== lastSeen) {
      localStorage.setItem(LUNCH_SEEN_KEY, updatedAt);
      showLunchNotification();
    } else {
      lunchBanner.classList.remove("hidden");
    }
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshLunchReady();
setInterval(refreshLunchReady, 10000);

const getSeenMateIds = () => {
  try {
    const raw = localStorage.getItem(MATE_SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const setSeenMateIds = (ids) => {
  localStorage.setItem(MATE_SEEN_KEY, JSON.stringify(ids));
};

const refreshMateOrders = async () => {
  if (!mateBanner) {
    return;
  }
  const apiBase = mateBanner.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/mate-orders`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      mateBanner.classList.add("hidden");
      if (mateOrdersList) {
        mateOrdersList.classList.add("hidden");
        mateOrdersList.replaceChildren();
      }
      return;
    }
    const seenIds = new Set(getSeenMateIds());
    const newest = data.find((item) => !seenIds.has(item.id));
    if (newest) {
      seenIds.add(newest.id);
      setSeenMateIds(Array.from(seenIds));
      showMateNotification(newest);
    } else {
      const last = data[0];
      const employee = last.employee_name || "Someone";
      const items = last.order_text || "an order";
      mateBanner.textContent = `${employee} has ordered ${items} for you.`;
      mateBanner.classList.remove("hidden");
    }

    if (mateOrdersList) {
      mateOrdersList.replaceChildren();
      mateOrdersList.classList.remove("hidden");
      const title = document.createElement("h3");
      title.textContent = "Orders for you";
      mateOrdersList.appendChild(title);
      data.forEach((order) => {
        const row = document.createElement("div");
        row.className = "card-header";
        row.innerHTML = `<strong>${order.order_text || "Order"}</strong><span class="status-pill status-${(order.status || "").toLowerCase()}">${order.status || "Pending"}</span>`;
        mateOrdersList.appendChild(row);
        const actions = document.createElement("div");
        actions.className = "status-actions";
        if (!["Ready", "Delivered", "Cancelled"].includes(order.status)) {
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "notify-button cancel-order-btn";
          cancel.dataset.orderId = order.id;
          cancel.textContent = "Cancel order";
          actions.appendChild(cancel);
          mateOrdersList.appendChild(actions);
        }
      });
    }
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshMateOrders();
setInterval(refreshMateOrders, 10000);

const renderOrdersList = (container, titleText, orders) => {
  if (!container) {
    return;
  }
  container.replaceChildren();
  container.classList.remove("hidden");
  const title = document.createElement("h3");
  title.textContent = titleText;
  container.appendChild(title);
  orders.forEach((order) => {
    const row = document.createElement("div");
    row.className = "card-header";
    row.innerHTML = `<strong>${order.order_text || "Order"}</strong><span class="status-pill status-${(order.status || "").toLowerCase()}">${order.status || "Pending"}</span>`;
    container.appendChild(row);
    if (!["Ready", "Delivered", "Cancelled"].includes(order.status)) {
      const actions = document.createElement("div");
      actions.className = "status-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "notify-button cancel-order-btn";
      cancel.dataset.orderId = order.id;
      cancel.textContent = "Cancel order";
      actions.appendChild(cancel);
      container.appendChild(actions);
    }
  });
};

const refreshMyOrders = async () => {
  if (!myOrdersList) {
    return;
  }
  const apiBase = mateBanner?.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/my-orders`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      myOrdersList.classList.add("hidden");
      myOrdersList.replaceChildren();
      return;
    }
    renderOrdersList(myOrdersList, "Your orders", data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshMyOrders();
setInterval(refreshMyOrders, 10000);

if (ringButton) {
  ringButton.addEventListener("click", async () => {
    if (!lunchBanner) {
      return;
    }
    const apiBase = lunchBanner.dataset.apiBase;
    if (!apiBase) {
      return;
    }
    try {
      const response = await fetch(`${apiBase}/ring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        if (ringBanner) {
          ringBanner.textContent = "Chef has been notified.";
          ringBanner.classList.remove("hidden");
        }
        playChime();
      }
    } catch (error) {
      // Ignore transient network errors.
    }
  });
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  const button = target.closest(".cancel-order-btn");
  if (!button) {
    return;
  }
  const orderId = button.dataset.orderId;
  if (!orderId) {
    return;
  }
  const apiBase = mateBanner?.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      refreshMateOrders();
      refreshMyOrders();
    }
  } catch (error) {
    // Ignore transient network errors.
  }
});

if (menuGrid) {
  menuGrid.addEventListener("click", (event) => {
    const addButton = event.target.closest(".menu-add");
    const minusButton = event.target.closest(".menu-minus");
    if (!addButton && !minusButton) {
      return;
    }
    const itemRow = (addButton || minusButton).closest(".menu-item");
    if (!itemRow) {
      return;
    }
    const name = itemRow.dataset.item || "";
    if (!name) {
      return;
    }
    if (addButton) {
      cart.set(name, (cart.get(name) || 0) + 1);
    } else {
      const next = Math.max(0, (cart.get(name) || 0) - 1);
      if (next === 0) {
        cart.delete(name);
      } else {
        cart.set(name, next);
      }
    }
    renderCart();
  });
}
