# Desk Order Web App

Simple Flask website for employees to place orders and notify the chef.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python order.py
```

- Employee order form: `http://127.0.0.1:5000/employee/employee-access`
- Chef dashboard: `http://127.0.0.1:5000/chef/chef-access`

## Deploy for free (Render)

1. Push this repo to GitHub.
2. In Render: New → Web Service → connect the repo.
3. Use:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn order:app`
4. Set environment variables:
   - `SECRET_KEY` (required)
   - `EMPLOYEE_TOKEN` (optional)
   - `CHEF_TOKEN` (optional)
5. Deploy. Share these links:
   - `https://<app>.onrender.com/employee/<EMPLOYEE_TOKEN>`
   - `https://<app>.onrender.com/chef/<CHEF_TOKEN>`

## Menu images

The app looks for menu images in `static/menu/` first. Put these files there:

```
bbq_chicken.png
boost.png
chapathi.png
chips.png
chocolates.png
coffee.png
cookies.png
dates.png
dosa.png
fried_rice.png
gobi_manchurian.png
horlicks.png
idli.png
juice.png
noodles.png
nuts.png
pasta.png
sandwich.png
tea.png
wafers.png
water.png
```

If `static/menu/` is empty, the app will fall back to the legacy local path.

## Notes

- Orders are stored in memory and reset on restart.
- Replace the in-memory list with a database for production use.
