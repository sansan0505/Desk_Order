from datetime import datetime, timedelta, timezone
import os

import json
import sqlite3
from zoneinfo import ZoneInfo
from uuid import uuid4

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.utils import secure_filename

app = Flask(__name__, template_folder="views", static_folder="static")
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MENU_ASSETS_DIR = os.path.join(BASE_DIR, "static", "menu")
LEGACY_MENU_ASSETS_DIR = r"C:\Users\Admin\.cursor\projects\c-Users-Admin-OneDrive-Documents-Innov\assets"
VOICE_UPLOAD_DIR = os.path.join(BASE_DIR, "static", "voice")
DB_PATH = os.path.join(BASE_DIR, "data.db")
IST_TZ = ZoneInfo("Asia/Kolkata")
MENU_ASSETS_DIR = os.getenv("MENU_ASSETS_DIR")
if not MENU_ASSETS_DIR:
    MENU_ASSETS_DIR = (
        DEFAULT_MENU_ASSETS_DIR
        if os.path.isdir(DEFAULT_MENU_ASSETS_DIR)
        else LEGACY_MENU_ASSETS_DIR
    )
os.makedirs(VOICE_UPLOAD_DIR, exist_ok=True)

# In-memory store for demo purposes. Replace with DB in production.
ORDERS = []
PRESETS = []
LUNCH_READY = {"is_ready": False, "updated_at": None}
RING_EVENTS = []
RING_EVENTS = []
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

# Track menu availability by item name (lowercased).
MENU_AVAILABILITY = {}

# Simple access separation via private URLs.
EMPLOYEE_TOKEN = os.getenv("EMPLOYEE_TOKEN", "employee-access")
CHEF_TOKEN = os.getenv("CHEF_TOKEN", "chef-access")


def normalize_item_name(name: str) -> str:
    return str(name or "").strip().lower()


def init_menu_availability():
    for items in MENU.values():
        for item in items:
            key = normalize_item_name(item.get("name", ""))
            if key and key not in MENU_AVAILABILITY:
                MENU_AVAILABILITY[key] = True


init_menu_availability()

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


def get_order_created_at(order: dict):
    created_iso = order.get("created_at_iso")
    if created_iso:
        try:
            created_at = datetime.fromisoformat(created_iso)
        except ValueError:
            created_at = None
    else:
        created_at = None
    if not created_at:
        try:
            created_at = datetime.strptime(order.get("created_at", ""), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            created_at = datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at


def filter_recent_orders(orders: list, hours: int):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [order for order in orders if get_order_created_at(order) >= cutoff]

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


def now_ist():
    return datetime.now(IST_TZ)


def is_sleeping_now():
    now = now_ist().time()
    return now >= datetime.strptime("19:30", "%H:%M").time()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lunch_checkins (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              employee_name TEXT NOT NULL,
              checked_at_iso TEXT NOT NULL,
              checked_date TEXT NOT NULL,
              UNIQUE(employee_name, checked_date)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


init_db()


def prune_rings():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=12)
    kept = []
    for ring in RING_EVENTS:
        created_at = ring.get("created_at_iso")
        if created_at:
            try:
                ring_time = datetime.fromisoformat(created_at)
            except ValueError:
                ring_time = datetime.now(timezone.utc)
        else:
            ring_time = datetime.now(timezone.utc)
        if ring_time.tzinfo is None:
            ring_time = ring_time.replace(tzinfo=timezone.utc)
        if ring_time >= cutoff:
            kept.append(ring)
    RING_EVENTS.clear()
    RING_EVENTS.extend(kept)


def menu_items_with_availability():
    items = []
    for category, entries in MENU.items():
        for entry in entries:
            name = entry.get("name", "")
            key = normalize_item_name(name)
            available = MENU_AVAILABILITY.get(key, True)
            items.append(
                {
                    "name": name,
                    "image": entry.get("image", ""),
                    "category": category,
                    "available": available,
                }
            )
    return items


def prune_rings():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=12)
    kept = []
    for ring in RING_EVENTS:
        created_iso = ring.get("created_at_iso")
        if created_iso:
            try:
                ring_time = datetime.fromisoformat(created_iso)
            except ValueError:
                ring_time = datetime.now(timezone.utc)
        else:
            ring_time = datetime.now(timezone.utc)
        if ring_time.tzinfo is None:
            ring_time = ring_time.replace(tzinfo=timezone.utc)
        if ring_time >= cutoff:
            kept.append(ring)
    RING_EVENTS.clear()
    RING_EVENTS.extend(kept)


def get_lunch_checkins_for_date(date_str: str):
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT employee_name, checked_at_iso FROM lunch_checkins WHERE checked_date = ? ORDER BY checked_at_iso",
            (date_str,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def set_lunch_checkin(employee_name: str, date_str: str, checked_at_iso: str):
    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO lunch_checkins (employee_name, checked_at_iso, checked_date)
            VALUES (?, ?, ?)
            ON CONFLICT(employee_name, checked_date) DO UPDATE SET
              checked_at_iso = excluded.checked_at_iso
            """,
            (employee_name, checked_at_iso, date_str),
        )
        conn.commit()
    finally:
        conn.close()


def delete_lunch_checkin(employee_name: str, date_str: str):
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM lunch_checkins WHERE employee_name = ? AND checked_date = ?",
            (employee_name, date_str),
        )
        conn.commit()
    finally:
        conn.close()


def get_lunch_prediction(date_obj: datetime):
    conn = get_db()
    try:
        first_row = conn.execute(
            "SELECT MIN(checked_date) as first_date FROM lunch_checkins"
        ).fetchone()
        first_date = first_row["first_date"] if first_row else None
        if not first_date:
            return None
        try:
            first_dt = datetime.fromisoformat(first_date).date()
        except ValueError:
            return None
        if (date_obj.date() - first_dt).days < 14:
            return None
        start = first_dt.isoformat()
        end = date_obj.date().isoformat()
        rows = conn.execute(
            """
            SELECT checked_date, COUNT(*) as count
            FROM lunch_checkins
            WHERE checked_date >= ? AND checked_date < ?
            GROUP BY checked_date
            """,
            (start, end),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        return None
    weekday = date_obj.weekday()
    weekday_counts = []
    for row in rows:
        try:
            day = datetime.fromisoformat(row["checked_date"]).date()
        except ValueError:
            continue
        if day.weekday() == weekday:
            weekday_counts.append(row["count"])
    if not weekday_counts:
        return None
    return int(round(sum(weekday_counts) / len(weekday_counts)))

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
        sleeping=is_sleeping_now(),
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
    role = request.form.get("role", "employee").strip().lower()
    if role == "chef":
        return redirect(url_for("chef_dashboard", token=CHEF_TOKEN))
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
    if is_sleeping_now():
        employee_name = session.get("employee_name", "").strip()
        return render_template(
            "index.html",
            error="Ordering is closed for today.",
            employee_name=employee_name,
            employee_token=token,
            menu=MENU,
            sleeping=True,
        )
    employee_name = session.get("employee_name", "").strip()
    order_items_json = request.form.get("order_items_json", "").strip()
    order_text = request.form.get("order_text", "").strip()
    requirements = request.form.get("requirements", "").strip()
    mate_name = request.form.get("mate_name", "").strip()
    voice_file = request.files.get("voice_message")
    voice_filename = ""
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

    if voice_file and voice_file.filename:
        original = secure_filename(voice_file.filename)
        ext = os.path.splitext(original)[1] or ".webm"
        voice_filename = f"{uuid4().hex}{ext}"
        voice_path = os.path.join(VOICE_UPLOAD_DIR, voice_filename)
        voice_file.save(voice_path)

    if not order_items and not order_text and not voice_filename:
        return render_template(
            "index.html",
            error="Please add at least one item.",
            employee_name=employee_name,
            order_text=order_text,
            requirements=requirements,
            mate_name=mate_name,
            employee_token=token,
            menu=MENU,
        )

    if not order_text and order_items:
        order_text = ", ".join(
            f"{item['name']} x{item['qty']}" for item in order_items
        )
    if not order_text and voice_filename:
        order_text = "Voice order"

    order = {
        "id": NEXT_ORDER_ID,
        "employee_name": employee_name,
        "mate_name": mate_name,
        "order_text": order_text,
        "voice_filename": voice_filename,
        "order_items": order_items,
        "requirements": requirements,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "created_at_iso": now_iso(),
        "status": "Pending",
        "prep_minutes": None,
        "prep_started_at": None,
        "cancelled_at": None,
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
    recent_orders = filter_recent_orders(ORDERS, 1)
    orders_sorted = sorted(recent_orders, key=lambda item: item.get("id", 0), reverse=True)
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
    recent_orders = filter_recent_orders(ORDERS, 1)
    orders_sorted = sorted(recent_orders, key=lambda item: item.get("id", 0), reverse=True)
    orders = []
    for order in orders_sorted:
        item = dict(order)
        item["suggested_eta"] = suggested_eta
        orders.append(item)
    return jsonify(orders)


@app.get("/api/employee/<token>/menu")
def employee_menu_api(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    items = [item for item in menu_items_with_availability() if item["available"]]
    return jsonify(items)


@app.get("/api/employee/<token>/lunch-checkin")
def employee_lunch_checkin_status(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return jsonify({"checked": False})
    today = now_ist().date().isoformat()
    rows = get_lunch_checkins_for_date(today)
    checked = any(
        row["employee_name"].strip().lower() == employee_name.lower() for row in rows
    )
    return jsonify({"checked": checked})


@app.post("/api/employee/<token>/lunch-checkin")
def employee_lunch_checkin(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return jsonify({"error": "Name required"}), 400
    payload = request.get_json(silent=True) or {}
    took = bool(payload.get("took"))
    today = now_ist().date().isoformat()
    if took:
        set_lunch_checkin(employee_name, today, now_iso())
    else:
        delete_lunch_checkin(employee_name, today)
    return jsonify({"checked": took})


@app.get("/api/chef/<token>/menu")
def chef_menu_api(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    return jsonify(menu_items_with_availability())


@app.post("/api/chef/<token>/menu/availability")
def chef_menu_availability_update(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    available = payload.get("available")
    if not name or available is None:
        return jsonify({"error": "Name and availability required"}), 400
    key = normalize_item_name(name)
    if not key:
        return jsonify({"error": "Invalid item"}), 400
    MENU_AVAILABILITY[key] = bool(available)
    return jsonify({"name": name, "available": MENU_AVAILABILITY[key]})


@app.get("/api/chef/<token>/lunch-checkins")
def chef_lunch_checkins(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    today = now_ist().date().isoformat()
    rows = get_lunch_checkins_for_date(today)
    names = [row["employee_name"] for row in rows]
    return jsonify({"date": today, "count": len(names), "names": names})


@app.get("/api/chef/<token>/lunch-prediction")
def chef_lunch_prediction(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    now = now_ist()
    predicted = get_lunch_prediction(now)
    return jsonify(
        {
            "predicted": predicted,
            "date": now.date().isoformat(),
            "hour": now.hour,
        }
    )


@app.get("/api/chef/<token>/rings")
def chef_ring_events(token: str):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    prune_rings()
    return jsonify(RING_EVENTS[-20:])


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


@app.get("/api/employee/<token>/mate-orders")
def employee_mate_orders(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return jsonify([])
    matches = []
    for order in ORDERS:
        mate_name = str(order.get("mate_name", "")).strip()
        if mate_name and mate_name.lower() == employee_name.lower():
            matches.append(
                {
                    "id": order.get("id"),
                    "employee_name": order.get("employee_name", ""),
                    "order_text": order.get("order_text", ""),
                    "status": order.get("status", ""),
                }
            )
    return jsonify(matches)


@app.get("/api/employee/<token>/my-orders")
def employee_my_orders(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return jsonify([])
    matches = []
    for order in ORDERS:
        owner = str(order.get("employee_name", "")).strip()
        if owner.lower() == employee_name.lower():
            matches.append(
                {
                    "id": order.get("id"),
                    "order_text": order.get("order_text", ""),
                    "status": order.get("status", ""),
                }
            )
    matches.sort(key=lambda item: item.get("id", 0), reverse=True)
    return jsonify(matches)


@app.post("/api/employee/<token>/orders/<int:order_id>/cancel")
def employee_cancel_order(token: str, order_id: int):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip().lower()
    if not employee_name:
        return jsonify({"error": "Name required"}), 400
    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    owner = str(order.get("employee_name", "")).strip().lower()
    mate = str(order.get("mate_name", "")).strip().lower()
    if employee_name not in {owner, mate}:
        return jsonify({"error": "Not allowed"}), 403
    status = order.get("status", "")
    if status in {"Ready", "Delivered", "Cancelled"}:
        return jsonify({"error": "Cannot cancel now"}), 400
    order["status"] = "Cancelled"
    order["cancelled_at"] = now_iso()
    ring = {
        "id": uuid4().hex,
        "employee_name": employee_name or order.get("employee_name", ""),
        "created_at_iso": now_iso(),
        "message": "Order cancelled",
    }
    RING_EVENTS.append(ring)
    return jsonify(order)


@app.post("/api/employee/<token>/ring")
def employee_ring(token: str):
    if not is_employee_token(token):
        return jsonify({"error": "Not found"}), 404
    employee_name = session.get("employee_name", "").strip()
    if not employee_name:
        return jsonify({"error": "Name required"}), 400
    prune_rings()
    ring = {
        "id": uuid4().hex,
        "employee_name": employee_name,
        "created_at_iso": now_iso(),
    }
    RING_EVENTS.append(ring)
    return jsonify(ring), 201


@app.post("/api/chef/<token>/orders/<int:order_id>/status")
def update_order_status(token: str, order_id: int):
    if not is_chef_token(token):
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).strip()
    allowed = {"Pending", "Preparing", "Ready", "Delivered", "Cancelled"}
    if status not in allowed:
        return jsonify({"error": "Invalid status"}), 400

    order = next((item for item in ORDERS if item["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    if order.get("status") == "Cancelled":
        return jsonify({"error": "Order cancelled"}), 400

    order["status"] = status
    if status == "Ready":
        order["ready_at"] = now_iso()
    if status == "Delivered":
        order["delivered_at"] = now_iso()
        voice_filename = order.get("voice_filename", "")
        if voice_filename:
            voice_path = os.path.join(VOICE_UPLOAD_DIR, voice_filename)
            try:
                if os.path.isfile(voice_path):
                    os.remove(voice_path)
            except OSError:
                pass
            order["voice_filename"] = ""
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
    if order.get("status") == "Cancelled":
        return jsonify({"error": "Order cancelled"}), 400

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
