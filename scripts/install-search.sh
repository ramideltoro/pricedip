#!/usr/bin/env bash
set -euo pipefail
revision=2e624bed40eb97b46faa98094a0b74d3ececd93d
id pricedip >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pricedip --shell /usr/sbin/nologin pricedip
install -d -o pricedip -g pricedip /var/lib/pricedip
install -d /opt/pricedip /etc/pricedip
if [ ! -d /opt/pricedip/search/.git ]; then git clone https://github.com/searxng/searxng.git /opt/pricedip/search; fi
git -C /opt/pricedip/search checkout "$revision"
python3 -m venv /opt/pricedip/search-venv
/opt/pricedip/search-venv/bin/pip install --quiet --upgrade pip setuptools wheel pyyaml msgspec typing-extensions pybind11
/opt/pricedip/search-venv/bin/pip install --quiet --use-pep517 --no-build-isolation /opt/pricedip/search granian
