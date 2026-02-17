const orderList = document.getElementById("order-list");
const apiBase = orderList?.dataset.apiBase || "/api/chef";
const groupList = document.getElementById("group-list");
const groupedOrdersCard = document.getElementById("grouped-orders-card");
const notification = document.getElementById("notification");
const ringNotification = document.getElementById("ring-notification");
const lunchPrediction = document.getElementById("lunch-prediction");
const soundToggle = document.getElementById("sound-toggle");
const lunchReadyToggle = document.getElementById("lunch-ready-toggle");
const chefMenuGrid = document.getElementById("chef-menu-grid");
const lunchCheckins = document.getElementById("lunch-checkins");
const lunchCheckinsCard = document.getElementById("lunch-checkins-card");
const SOUND_KEY = "chefSoundEnabled";
const LUNCH_KEY = "lunchReadyState";
const RING_SEEN_KEY = "chefRingSeenIds";
const PRED_SEEN_KEY = "chefLunchPredictionSeen";
let lastSeenId = null;
let notificationTimer;

const formatTimestamp = (order) => {
  const iso = order?.created_at_iso || order?.created_at || "";
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return order?.created_at || "";
};

const renderOrders = (orders) => {
  if (!orderList) {
    return;
  }

  orderList.replaceChildren();
  if (!orders || orders.length === 0) {
    return;
  }

  const now = Date.now();
  orders.forEach((order) => {
    if (order.status === "Cancelled") {
      const cancelledAt = order.cancelled_at ? Date.parse(order.cancelled_at) : NaN;
      if (Number.isFinite(cancelledAt) && now - cancelledAt > 60000) {
        return;
      }
    }
    const card = document.createElement("div");
    card.className = "card card-hero order-card";
    if (order.id) {
      card.dataset.orderId = order.id;
    }

    const header = document.createElement("div");
    header.className = "card-header";

    const name = document.createElement("strong");
    name.textContent = order.employee_name || "";

    const status = document.createElement("span");
    const statusValue = order.status || "Pending";
    status.className = `status-pill status-${statusValue.toLowerCase()}`;
    status.textContent = statusValue;

    const time = document.createElement("div");
    time.className = "muted";
    time.textContent = formatTimestamp(order);

    const text = document.createElement("p");
    text.textContent = order.order_text || "";

    header.appendChild(name);
    header.appendChild(status);
    card.appendChild(header);
    card.appendChild(time);
    if (order.mate_name) {
      const mate = document.createElement("p");
      mate.className = "muted";
      mate.textContent = `For: ${order.mate_name}`;
      card.appendChild(mate);
    }
    if (order.voice_filename) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = `/static/voice/${order.voice_filename}`;
      card.appendChild(audio);
    }
    card.appendChild(text);
    if (order.requirements) {
      const req = document.createElement("p");
      req.className = "muted";
      req.textContent = `Requirements: ${order.requirements}`;
      card.appendChild(req);
    }

    if (!["Delivered", "Cancelled"].includes(statusValue)) {
      const prepControls = document.createElement("div");
      prepControls.className = "prep-controls";
      const prepLabel = document.createElement("label");
      prepLabel.textContent = "Prep (min)";
      prepLabel.htmlFor = `prep-${order.id || "new"}`;
      const prepInput = document.createElement("input");
      prepInput.type = "number";
      prepInput.min = "1";
      prepInput.max = "240";
      prepInput.placeholder = "20";
      prepInput.id = `prep-${order.id || "new"}`;
      prepInput.value = order.prep_minutes || "";
      const prepButton = document.createElement("button");
      prepButton.type = "button";
      prepButton.textContent = "Start prep";
      prepButton.dataset.prep = "true";
      prepButton.dataset.orderId = order.id;
      prepControls.appendChild(prepLabel);
      prepControls.appendChild(prepInput);
      prepControls.appendChild(prepButton);
      if (order.suggested_eta) {
        const etaChip = document.createElement("span");
        etaChip.className = "chip";
        etaChip.textContent = `Suggested: ${order.suggested_eta} min`;
        const etaButton = document.createElement("button");
        etaButton.type = "button";
        etaButton.textContent = "Use ETA";
        etaButton.dataset.useEta = "true";
        etaButton.dataset.eta = order.suggested_eta;
        etaButton.dataset.orderId = order.id;
        prepControls.appendChild(etaChip);
        prepControls.appendChild(etaButton);
      }
      card.appendChild(prepControls);
    }

    if (!["Delivered", "Cancelled"].includes(statusValue)) {
      const actions = document.createElement("div");
      actions.className = "status-actions";
      ["Preparing", "Ready", "Delivered"].forEach((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.status = label;
        button.dataset.orderId = order.id;
        if (label === statusValue || statusValue === "Delivered" || statusValue === "Cancelled") {
          button.disabled = true;
        }
        actions.appendChild(button);
      });
      card.appendChild(actions);
    }
    orderList.appendChild(card);
  });
};

const normalizeItemName = (value) =>
  (value || "").toLowerCase().replace(/\s+/g, " ").trim();

const toItemList = (order) => {
  if (Array.isArray(order.order_items) && order.order_items.length > 0) {
    return order.order_items
      .map((item) => ({
        name: String(item.name || "").trim(),
        qty: Number(item.qty) || 0,
      }))
      .filter((item) => item.name && item.qty > 0);
  }
  const text = String(order.order_text || "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)(?:\s*x\s*(\d+))?$/i);
      const name = match ? String(match[1] || "").trim() : part;
      const qty = match && match[2] ? Number(match[2]) : 1;
      return { name, qty };
    })
    .filter((item) => item.name && item.qty > 0);
};

const renderGroups = (orders) => {
  if (!groupList) {
    return;
  }
  groupList.replaceChildren();
  if (!orders || orders.length === 0) {
    if (groupedOrdersCard) {
      groupedOrdersCard.classList.add("hidden");
    }
    return;
  }

  const totals = new Map();
  orders.forEach((order) => {
    const items = toItemList(order);
    items.forEach((item) => {
      const key = normalizeItemName(item.name);
      if (!key) {
        return;
      }
      const existing = totals.get(key) || { name: item.name, qty: 0 };
      existing.qty += item.qty;
      totals.set(key, existing);
    });
  });

  const groupedItems = Array.from(totals.values()).filter((item) => item.qty > 1);
  if (groupedItems.length === 0) {
    if (groupedOrdersCard) {
      groupedOrdersCard.classList.add("hidden");
    }
    return;
  }

  if (groupedOrdersCard) {
    groupedOrdersCard.classList.remove("hidden");
    if (orderList && groupedOrdersCard.previousElementSibling !== orderList) {
      orderList.insertAdjacentElement("afterend", groupedOrdersCard);
    }
  }

  groupedItems
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
    .forEach((group) => {
      const item = document.createElement("div");
      item.className = "group-item";
      const title = document.createElement("div");
      title.innerHTML = `<strong>${group.qty}x</strong> ${group.name}`;
      item.appendChild(title);
      groupList.appendChild(item);
    });
};

const renderChefMenu = (items) => {
  if (!chefMenuGrid) {
    return;
  }
  chefMenuGrid.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No menu items available.";
    chefMenuGrid.appendChild(empty);
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
      row.className = "menu-item chef-menu-item";
      if (!item.available) {
        row.classList.add("is-unavailable");
      }
      row.dataset.name = item.name || "";
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
      controls.className = "menu-controls menu-toggle";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = Boolean(item.available);
      toggle.dataset.name = item.name || "";
      const label = document.createElement("span");
      label.textContent = "In stock";
      controls.appendChild(toggle);
      controls.appendChild(label);
      details.appendChild(name);
      details.appendChild(controls);
      row.appendChild(image);
      row.appendChild(details);
      list.appendChild(row);
    });
    section.appendChild(list);
    chefMenuGrid.appendChild(section);
  });
};


const showNotification = () => {
  if (!notification) {
    return;
  }
  notification.classList.remove("hidden");
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    notification.classList.add("hidden");
  }, 4000);
};

const showRingNotification = (ring) => {
  if (!ringNotification) {
    return;
  }
  if (ring.message === "Order cancelled") {
    ringNotification.textContent = `${ring.employee_name || "Someone"} cancelled their order.`;
  } else {
    ringNotification.textContent = `${ring.employee_name || "Someone"} is calling you.`;
  }
  ringNotification.classList.remove("hidden");
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    ringNotification.classList.add("hidden");
  }, 5000);
};

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
    // Some browsers block audio before user interaction.
  }
};

const playRingTone = () => {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 650;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    const interval = setInterval(() => {
      oscillator.frequency.value = oscillator.frequency.value === 650 ? 480 : 650;
    }, 350);
    setTimeout(() => {
      clearInterval(interval);
      oscillator.stop();
      audio.close();
    }, 4500);
  } catch (error) {
    // Ignore audio errors.
  }
};

const getSoundEnabled = () => {
  const stored = localStorage.getItem(SOUND_KEY);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return true;
};

const setSoundEnabled = (enabled) => {
  localStorage.setItem(SOUND_KEY, enabled ? "true" : "false");
};

const setLunchReadyState = (state) => {
  localStorage.setItem(LUNCH_KEY, state ? "true" : "false");
};

const handleNewOrders = (orders) => {
  if (!orders || orders.length === 0) {
    return;
  }
  const ids = orders.map((order) => order.id).filter((id) => typeof id === "number");
  if (ids.length === 0) {
    return;
  }
  const newestId = Math.max(...ids);
  if (lastSeenId === null) {
    lastSeenId = newestId;
    return;
  }
  if (newestId > lastSeenId) {
    lastSeenId = newestId;
    showNotification();
    if (getSoundEnabled()) {
      playChime();
    }
  }
};

const refreshOrders = async () => {
  try {
    const response = await fetch(`${apiBase}/orders`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    handleNewOrders(data);
    renderOrders(data);
    renderGroups(data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshOrders();
setInterval(refreshOrders, 5000);

const refreshLunchReady = async () => {
  if (!lunchReadyToggle) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/lunch-ready`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const ready = Boolean(data?.is_ready);
    lunchReadyToggle.checked = ready;
    setLunchReadyState(ready);
  } catch (error) {
    // Ignore transient network errors.
  }
};

if (lunchReadyToggle) {
  lunchReadyToggle.addEventListener("change", async () => {
    const ready = lunchReadyToggle.checked;
    try {
      const response = await fetch(`${apiBase}/lunch-ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready }),
      });
      if (response.ok) {
        setLunchReadyState(ready);
        refreshLunchCheckins();
      }
    } catch (error) {
      // Ignore transient network errors.
    }
  });
  refreshLunchReady();
  setInterval(refreshLunchReady, 8000);
}

const refreshChefMenu = async () => {
  if (!chefMenuGrid) {
    return;
  }
  const apiBase = chefMenuGrid.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/menu`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    renderChefMenu(data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

if (chefMenuGrid) {
  chefMenuGrid.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const name = target.dataset.name || "";
    if (!name) {
      return;
    }
    const apiBase = chefMenuGrid.dataset.apiBase;
    if (!apiBase) {
      return;
    }
    try {
      const response = await fetch(`${apiBase}/menu/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, available: target.checked }),
      });
      if (response.ok) {
        refreshChefMenu();
      }
    } catch (error) {
      // Ignore transient network errors.
    }
  });
  refreshChefMenu();
  setInterval(refreshChefMenu, 5000);
}

const getSeenRingIds = () => {
  try {
    const raw = localStorage.getItem(RING_SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const setSeenRingIds = (ids) => {
  localStorage.setItem(RING_SEEN_KEY, JSON.stringify(ids));
};

const refreshRings = async () => {
  try {
    const response = await fetch(`${apiBase}/rings`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return;
    }
    const seenIds = new Set(getSeenRingIds());
    const newest = data.find((item) => !seenIds.has(item.id));
    if (newest) {
      seenIds.add(newest.id);
      setSeenRingIds(Array.from(seenIds));
      showRingNotification(newest);
      if (getSoundEnabled()) {
        playRingTone();
      }
    }
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshRings();
setInterval(refreshRings, 5000);

const refreshLunchCheckins = async () => {
  if (!lunchCheckins) {
    return;
  }
  if (lunchReadyToggle && !lunchReadyToggle.checked) {
    if (lunchCheckinsCard) {
      lunchCheckinsCard.classList.add("hidden");
    }
    return;
  }
  if (lunchCheckinsCard) {
    lunchCheckinsCard.classList.remove("hidden");
  }
  const apiBase = lunchCheckins.dataset.apiBase;
  if (!apiBase) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/lunch-checkins`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    lunchCheckins.replaceChildren();
    const names = Array.isArray(data?.names) ? data.names : [];
    const count = Number(data?.count || names.length);
    if (names.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No check-ins yet.";
      lunchCheckins.appendChild(empty);
      return;
    }
    const summary = document.createElement("div");
    summary.className = "chip";
    summary.textContent = `${count} checked in`;
    lunchCheckins.appendChild(summary);
    names.forEach((name) => {
      const item = document.createElement("div");
      item.className = "group-item";
      item.textContent = name;
      lunchCheckins.appendChild(item);
    });
  } catch (error) {
    // Ignore transient network errors.
  }
};

const refreshLunchPrediction = async () => {
  if (!lunchPrediction) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/lunch-prediction`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const predicted = data?.predicted;
    const hour = Number(data?.hour);
    const date = data?.date || "";
    if (!predicted || !date) {
      lunchPrediction.classList.add("hidden");
      return;
    }
    if (hour < 10) {
      lunchPrediction.classList.add("hidden");
      return;
    }
    lunchPrediction.textContent = `(${predicted}) number of people is expected for lunch today`;
    lunchPrediction.classList.remove("hidden");
    const lastSeen = localStorage.getItem(PRED_SEEN_KEY);
    if (lastSeen !== date) {
      localStorage.setItem(PRED_SEEN_KEY, date);
      if (getSoundEnabled()) {
        playChime();
      }
    }
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshLunchCheckins();
setInterval(refreshLunchCheckins, 20000);
refreshLunchPrediction();
setInterval(refreshLunchPrediction, 3600000);

if (soundToggle) {
  soundToggle.checked = getSoundEnabled();
  soundToggle.addEventListener("change", () => {
    setSoundEnabled(soundToggle.checked);
    if (soundToggle.checked) {
      playChime();
    }
  });
}

document.addEventListener("click", async (event) => {
    const statusButton = event.target.closest("button[data-status]");
    const prepButton = event.target.closest("button[data-prep]");
    const etaButton = event.target.closest("button[data-use-eta]");

    if (etaButton) {
      const card = etaButton.closest(".card");
      const input = card ? card.querySelector("input[type='number']") : null;
      const eta = Number(etaButton.dataset.eta);
      if (input && Number.isFinite(eta)) {
        input.value = eta;
      }
      return;
    }

    if (prepButton) {
      const card = prepButton.closest(".card");
      const input = card ? card.querySelector("input[type='number']") : null;
      const minutes = input ? Number(input.value) : NaN;
      const orderId = Number(prepButton.dataset.orderId);
      if (!orderId || !Number.isFinite(minutes)) {
        return;
      }
      try {
        const response = await fetch(`${apiBase}/orders/${orderId}/prep`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes }),
        });
        if (response.ok) {
          refreshOrders();
        }
      } catch (error) {
        // Ignore transient network errors.
      }
      return;
    }

    if (statusButton) {
      const orderId = Number(statusButton.dataset.orderId);
      const status = statusButton.dataset.status;
      if (!orderId || !status) {
        return;
      }
      try {
        const response = await fetch(`${apiBase}/orders/${orderId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (response.ok) {
          refreshOrders();
        }
      } catch (error) {
        // Ignore transient network errors.
      }
    }
  });

