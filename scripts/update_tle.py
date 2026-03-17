#!/usr/bin/env python3
"""
SatContact — скрипт обновления TLE с Space-Track.org

Скачивает TLE для Satcom и Меридианов по NORAD ID.
Учётные данные берутся из переменных окружения:
  SPACETRACK_USER — логин Space-Track
  SPACETRACK_PASS — пароль Space-Track

Использование:
  python scripts/update_tle.py

Выход:
  data/tle.txt — файл с TLE в формате 3 строки на спутник
"""

import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Ошибка: требуется библиотека requests. Установите: pip install requests", file=sys.stderr)
    sys.exit(1)

# Space-Track API
LOGIN_URL = "https://www.space-track.org/ajaxauth/login"
TLE_URL = (
    "https://www.space-track.org/basicspacedata/query/class/gp/"
    "NORAD_CAT_ID/35943%2C36582%2C38098%2C28117%2C20253%2C25967%2C23967%2C32294%2C30794%2C39034%2C20776%2C25639%2C40614%2C34810%2C23467%2C27168%2C26635%2C22787%2C40296%2C44453%2C45254%2C52145/"
    "orderby/NORAD_CAT_ID%20asc/format/tle/emptyresult/show"
)


def main() -> int:
    user = os.environ.get("SPACETRACK_USER")
    password = os.environ.get("SPACETRACK_PASS")

    if not user or not password:
        print(
            "Ошибка: задайте переменные окружения SPACETRACK_USER и SPACETRACK_PASS",
            file=sys.stderr,
        )
        sys.exit(1)

    # Путь к data/tle.txt относительно корня репозитория
    repo_root = Path(__file__).resolve().parent.parent
    output_path = repo_root / "data" / "tle.txt"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "SatContact-TLE-Updater/1.0"})

    # Авторизация
    try:
        login_resp = session.post(
            LOGIN_URL,
            data={"identity": user, "password": password},
            timeout=15,
        )
        login_resp.raise_for_status()
    except requests.RequestException as e:
        print(f"Ошибка авторизации Space-Track: {e}", file=sys.stderr)
        sys.exit(1)

    # Проверка успешного входа (при ошибке Space-Track возвращает HTML с сообщением)
    if "Login Failed" in login_resp.text or login_resp.status_code != 200:
        print("Ошибка: неверный логин или пароль Space-Track", file=sys.stderr)
        sys.exit(1)

    # Скачивание TLE
    try:
        tle_resp = session.get(TLE_URL, timeout=30)
        tle_resp.raise_for_status()
    except requests.RequestException as e:
        print(f"Ошибка загрузки TLE: {e}", file=sys.stderr)
        sys.exit(1)

    content = tle_resp.text.strip()
    if not content:
        print("Предупреждение: Space-Track вернул пустой ответ", file=sys.stderr)
        sys.exit(1)

    output_path.write_text(content, encoding="utf-8")
    print(f"TLE сохранён: {output_path} ({len(content)} байт)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
