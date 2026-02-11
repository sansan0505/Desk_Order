const statusCard = document.querySelector("[data-order-id]");
const apiBase = statusCard?.dataset.apiBase || "/api/employee";
const statusPill = document.getElementById("status-pill");
const statusMessage = document.getElementById("status-message");
const orderTime = document.getElementById("order-time");
const progressWrapper = document.getElementById("progress-wrapper");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

const statusMessages = {
  Pending: "Chef has received your order.",
  Preparing: "Chef is preparing your order.",
  Ready: "Order is ready for pickup/delivery.",
  Delivered: "Order delivered. Enjoy your meal!",
};

const updateStatusUi = (order) => {
  if (!order || !statusPill || !statusMessage) {
    return;
  }
  const status = order.status || "Pending";
  statusPill.textContent = status;
  statusPill.className = `status-pill status-${status.toLowerCase()}`;
  statusMessage.textContent = statusMessages[status] || "Status updated.";
  if (orderTime) {
    const iso = order.created_at_iso || orderTime.dataset.createdIso || order.created_at;
    const parsed = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(parsed)) {
      orderTime.textContent = new Date(parsed).toLocaleString();
    }
  }

  if (!progressWrapper || !progressBar || !progressText) {
    return;
  }
  const prepMinutes = Number(order.prep_minutes);
  const startedAt = order.prep_started_at ? Date.parse(order.prep_started_at) : NaN;
  const totalMs = prepMinutes > 0 ? prepMinutes * 60 * 1000 : 0;

  if (status === "Preparing" && Number.isFinite(startedAt) && totalMs > 0) {
    const elapsed = Date.now() - startedAt;
    const percent = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
    progressWrapper.classList.remove("hidden");
    progressBar.style.width = `${percent}%`;
    const remainingMs = Math.max(0, totalMs - elapsed);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    if (remainingMs <= 0) {
      progressText.textContent = "Prep time reached. Waiting for chef to mark ready.";
    } else {
      progressText.textContent = `${remainingMinutes} min remaining (est).`;
    }
  } else if (status === "Ready" || status === "Delivered") {
    progressWrapper.classList.remove("hidden");
    progressBar.style.width = "100%";
    progressText.textContent = "";
  } else {
    progressWrapper.classList.add("hidden");
    progressBar.style.width = "0%";
    progressText.textContent = "";
  }
};

const refreshStatus = async () => {
  if (!statusCard) {
    return;
  }
  const orderId = statusCard.dataset.orderId;
  if (!orderId) {
    return;
  }
  try {
    const response = await fetch(`${apiBase}/orders/${orderId}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    updateStatusUi(data);
  } catch (error) {
    // Ignore transient network errors.
  }
};

refreshStatus();
setInterval(refreshStatus, 5000);
