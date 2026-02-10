const orderList = document.getElementById("order-list");
const apiBase = orderList?.dataset.apiBase || "/api/chef";
const groupList = document.getElementById("group-list");
const notification = document.getElementById("notification");
let lastSeenId = null;
let notificationTimer;

const renderOrders = (orders) => {
  if (!orderList) {
    return;
  }

  orderList.replaceChildren();
  if (!orders || orders.length === 0) {
    return;
  }

  orders.forEach((order) => {
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
    time.textContent = order.created_at || "";

    const text = document.createElement("p");
    text.textContent = order.order_text || "";

    header.appendChild(name);
    header.appendChild(status);
    card.appendChild(header);
    card.appendChild(time);
    card.appendChild(text);

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
    if (statusValue === "Delivered") {
      prepButton.disabled = true;
    }
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

    const actions = document.createElement("div");
    actions.className = "status-actions";
    ["Preparing", "Ready", "Delivered"].forEach((label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.status = label;
      button.dataset.orderId = order.id;
      if (label === statusValue || statusValue === "Delivered") {
        button.disabled = true;
      }
      actions.appendChild(button);
    });
    card.appendChild(actions);
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
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No grouped items yet.";
    groupList.appendChild(empty);
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
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No grouped items yet.";
    groupList.appendChild(empty);
    return;
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
    playChime();
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

