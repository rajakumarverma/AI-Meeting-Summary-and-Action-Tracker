#!/usr/bin/env bash
# Runs every test suite. Requires:  pip install -r requirements.txt   and   npm install
set -e
cd "$(dirname "$0")"
echo "== Backend (pytest) ==";            python3 -m pytest tests/test_backend.py -q
echo "== Core logic (node:test) ==";      node --test tests/core.test.js
echo "== End-to-end UI (jsdom + real backend) =="; node --test tests/ui.test.js
