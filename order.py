from datetime import datetime, timedelta, timezone
import os

import json

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for

app = Flask(__name__, template_folder="views", static_folder="static")
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MENU_ASSETS_DIR = os.path.join(BASE_DIR, "static", "menu")
LEGACY_MENU_ASSETS_DIR = r"C:\Users\Admin\.cursor\projects\c-Users-Admin-OneDrive-Documents-Innov\assets"
MENU_ASSETS_DIR = os.getenv("MENU_ASSETS_DIR")
if not MENU_ASSETS_DIR:
    MENU_ASSETS_DIR = (
        DEFAULT_MENU_ASSETS_DIR
        if os.path.isdir(DEFAULT_MENU_ASSETS_DIR)
        else LEGACY_MENU_ASSETS_DIR
    )

# In-memory store for demo purposes. Replace with DB in production.
ORDERS = []
PRESETS = []
LUNCH_READY = {"is_ready": False, "updated_at": None}
MENU = {
    "Snacks": [
        {"name": "Cookies", "image": "/menu-images/cookies.png"},
        {"name": "Chocolates", "image": "/menu-images/chocolates.png"},
        {"name": "Wafers", "image": "/menu-images/wafers.png"},
        {"name": "Chips", "image": "/menu-images/chips.png"},
        {"name": "Nuts", "image": "/menu-images/nuts.png"},
        {"name": "Dates", "image": "/menu-images/dates.png"},
    ],
    "Mains": [
        {"name": "Pasta", "image": "/menu-images/pasta.png"},
        {"name": "Noodles", "image": "/menu-images/noodles.png"},
        {"name": "Fried Rice", "image": "/menu-images/fried_rice.png"},
        {"name": "BBQ Chicken", "image": "/menu-images/bbq_chicken.png"},
        {"name": "Gobi Manchurian", "image": "/menu-images/gobi_manchurian.png"},
        {"name": "Chapathi", "image": "/menu-images/chapathi.png"},
        {"name": "Sandwich", "image": "/menu-images/sandwich.png"},
        {"name": "Idli", "image": "/menu-images/idli.png"},
        {"name": "Dosa", "image": "/menu-images/dosa.png"},
    ],
    "Drinks": [
        {"name": "Tea", "image": "/menu-images/tea.png"},
        {"name": "Coffee", "image": "/menu-images/coffee.png"},
        {"name": "Boost", "image": "/menu-images/boost.png"},
        {"name": "Horlicks", "image": "/menu-images/horlicks.png"},
        {"name": "Juice", "image": "/menu-images/juice.png"},
        {"name": "Water", "image": "/menu-images/water.png"},
    ],
}

# Simple access separation via private URLs.
EMPLOYEE_TOKEN = os.getenv("EMPLOYEE_TOKEN", "employee-access")
CHEF_TOKEN = os.getenv("CHEF_TOKEN", "chef-access")

def prune_orders():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=12)
    kept = []
    for order in ORDERS:
        created_iso = order.get("created_at_iso")
        created_at = None
        if created_iso:
            try:
                created_at = datetime.fromisoformat(created_iso)
            except ValueError:
                created_at = None
        if not created_at:
            try:
                created_at = datetime.strptime(order.get("created_at", ""), "%Y-%m-%d %H:%M:%S")
            except ValueError:
                created_at = datetime.now(timezone.utc)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if created_at >= cutoff:
            kept.append(order)
    ORDERS.clear()
    ORDERS.extend(kept)

def get_smart_eta_minutes():
    durations = []
    for order in reversed(ORDERS):
        started_at = order.get("prep_started_at")
        finished_at = order.get("ready_at") or order.get("delivered_at")
        if started_at and finished_at:
            try:
                start = datetime.fromisoformat(started_at)
                end = datetime.fromisoformat(finished_at)
            except ValueError:
                continue
            minutes = max(1, int(round((end - start).total_seconds() / 60)))
            durations.append(minutes)
        if len(durations) >= 10:
            break

    if len(durations) >= 5:
        return int(round(sum(durations) / len(durations)))

    return None


def now_iso():
    return datetime.now(timezone.utc).isoformat()

NEXT_ORDER_ID = 1
NEXT_PRESET_ID = 1


def is_employee_token(token: str) -> bool:
    return token == EMPLOYEE_TOKEN


def is_chef_token(token: str) -> bool:
    return token == CHEF_TOKEN


@app.get("/menu-images/<path:filename>")
def menu_images(filename: str):
    return send_from_directory(MENU_ASSETS_DIR, filename)


@app.get("/")
def index():
    return redirect(url_for("employee_order", token=EMPLOYEE_TOKEN))

@app.get("/employee/<token>")
def employee_order(token: str):
    if not is_employee_token(token):
        return "Not found", 404
    prune_orders()
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return redirect(url_for("employee_login", token=token))
    return render_template(
        "index.html",
        employee_token=token,
        employee_name=employee_name,
        menu=MENU,
    )


@app.get("/employee/<token>/login")
def employee_login(token: str):
    if not is_employee_token(token):
        return "Not found", 404
    return render_template("employee_login.html", employee_token=token)


@app.post("/employee/<token>/login")
def employee_login_submit(token: str):
    if not is_employee_token(token):
        return "Not found", 404
    employee_name = request.form.get("employee_name", "").strip()
    if not employee_name:
        return render_template(
            "employee_login.html",
            employee_token=token,
            error="Please enter your name.",
        )
    session["employee_name"] = employee_name
    return redirect(url_for("employee_order", token=token))


@app.get("/employee/<token>/logout")
def employee_logout(token: str):
    if not is_employee_token(token):
        return "Not found", 404
    session.pop("employee_name", None)
    return redirect(url_for("employee_login", token=token))


@app.post("/employee/<token>/order")
def place_order(token: str):
    global NEXT_ORDER_ID
    if not is_employee_token(token):
        return "Not found", 404
    prune_orders()
    employee_name = session.get("employee_name", "").strip()
    order_items_json = request.form.get("order_items_json", "").strip()
    order_text = request.form.get("order_text", "").strip()
    requirements = request.form.get("requirements", "").strip()
    order_items = []

    if order_items_json:
        try:
            parsed = json.loads(order_items_json)
            if isinstance(parsed, list):
                for item in parsed:
                    name = str(item.get("name", "")).strip()
                    qty = int(item.get("qty", 0))
                    if name and qty > 0:
                        order_items.append({"name": name, "qty": qty})
        except (ValueError, TypeError, json.JSONDecodeError):
            order_items = []

    if not employee_name:
        return redirect(url_for("employee_login", token=token))

    if not order_items and not order_text:
        return render_template(
            "index.html",
            error="Please add at least one item.",
            employee_name=employee_name,
            order_text=order_text,
            requirements=requirements,
            employee_token=token,
            menu=MENU,
        )

    if not order_text:
        order_text = ", ".join(
            f"{item['name']} x{item['qty']}" for item in order_items
        )

    order = {
        "id": NEXT_ORDER_ID,
        "employee_name": employee_name,
        "order_text": order_text,
        "order_items": order_items,
        "requirements": requirements,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "created_at_iso": now_iso(),
        "status": "Pending",
        "prep_minutes": None,
        "prep_started_at": None,
    }
    ORDERS.append(order)
    NEXT_ORDER_ID += 1

    return redirect(
        url_for("order_status", token=token, order_id=order["id"], name=employee_name)
    )


@app.get("/order/success")
def order_success():
    prune_orders()
    name = request.args.get("name", "").strip() or session.get("employee_name", "")
    return render_template("order_success.html", employee_name=name)


@app.get("/employee/<token>/order/status/<int:order_id>")
def order_status(token: str, order_id: int):
    if not is_employee_token(token):
        return "Not found", 404
    prune_orders()
    name = request.args.get("name", "").strip() or session.get("employee_name", "")
    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return render_template("order_success.html", employee_name=name)
    if not name:
        name = order.get("employee_name", "")
    previous_orders = [
        item
        for item in ORDERS
        if item.get("employee_name") == name and item.get("id") != order_id
    ]
    previous_orders.sort(key=lambda item: item.get("id", 0), reverse=True)
    return render_template(
        "order_status.html",
        employee_name=name,
        order=order,
        employee_token=token,
        previous_orders=previous_orders,
    )


@app.get("/chef/<token>")
def chef_dashboard(token: str):
    if not is_chef_token(token):
        return "Not found", 404
    prune_orders()
    suggested_eta = get_smart_eta_minutes()
    orders_sorted = sorted(ORDERS, key=lambda item: item.get("id", 0), reverse=True)
    return render_template(
        "chef.html",
        orders=orders_sorted,
        chef_token=token,
        suggested_eta=suggested_eta,
    )


@app.get("/api/chef/<token>/orders")
def orders_api(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    prune_orders()
    suggested_eta = get_smart_eta_minutes()
    orders_sorted = sorted(ORDERS, key=lambda item: item.get("id", 0), reverse=True)
    orders = []
    for order in orders_sorted:
        item = dict(order)
        item["suggested_eta"] = suggested_eta
        orders.append(item)
    return jsonify(orders)


@app.get("/api/employee/<token>/orders/<int:order_id>")
def order_detail_api(token: str, order_id: int):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    prune_orders()
    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    return jsonify(order)


@app.get("/api/employee/<token>/lunch-ready")
def lunch_ready_status(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    return jsonify(LUNCH_READY)


@app.post("/api/chef/<token>/orders/<int:order_id>/status")
def update_order_status(token: str, order_id: int):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).strip()
    allowed = {"Pending", "Preparing", "Ready", "Delivered"}
    if status not in allowed:
        return jsonify({"error": "Invalid status"}), 400

    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404

    order["status"] = status
    if status == "Ready":
        order["ready_at"] = now_iso()
    if status == "Delivered":
        order["delivered_at"] = now_iso()
    return jsonify(order)


@app.get("/api/chef/<token>/lunch-ready")
def chef_lunch_ready_status(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    return jsonify(LUNCH_READY)


@app.post("/api/chef/<token>/lunch-ready")
def chef_lunch_ready_update(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    ready_value = payload.get("ready")
    ready = bool(ready_value)
    LUNCH_READY["is_ready"] = ready
    LUNCH_READY["updated_at"] = now_iso()
    return jsonify(LUNCH_READY)


@app.post("/api/chef/<token>/orders/<int:order_id>/prep")
def update_prep_time(token: str, order_id: int):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    minutes_value = payload.get("minutes")
    try:
        minutes = int(minutes_value)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid minutes"}), 400
    if minutes <= 0 or minutes > 240:
        return jsonify({"error": "Minutes out of range"}), 400

    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404

    order["prep_minutes"] = minutes
    order["prep_started_at"] = now_iso()
    order["status"] = "Preparing"
    return jsonify(order)


@app.get("/api/employee/<token>/presets")
def employee_presets(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    return jsonify(PRESETS)


@app.get("/api/chef/<token>/presets")
def chef_presets(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    return jsonify(PRESETS)


@app.post("/api/chef/<token>/presets")
def add_preset(token: str):
    global NEXT_PRESET_ID
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    order_text = str(payload.get("order_text", "")).strip()
    requirements = str(payload.get("requirements", "")).strip()
    if not name or not order_text:
        return jsonify({"error": "Name and order are required"}), 400

    preset = {
        "id": NEXT_PRESET_ID,
        "name": name,
        "order_text": order_text,
        "requirements": requirements,
    }
    PRESETS.append(preset)
    NEXT_PRESET_ID += 1
    return jsonify(preset), 201


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
