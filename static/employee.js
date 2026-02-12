const presetList = document.getElementById("preset-list");
const menuGrid = document.querySelector(".menu-grid");
const cartList = document.getElementById("cart-list");
const cartInput = document.getElementById("order_items_json");
const requirementsField = document.getElementById("requirements");
const lunchBanner = document.getElementById("lunch-ready-banner");
const LUNCH_SEEN_KEY = "lunchReadySeenAt";
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
renderCart();

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
