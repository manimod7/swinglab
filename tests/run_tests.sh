#!/usr/bin/env bash
# Run from the repository root: bash tests/run_tests.sh   (needs node 18+; the headset-flow test also needs python3 + playwright)
set -e
node tests/test_core.mjs
if python3 -c "import playwright" 2>/dev/null; then
  python3 -m http.server 8130 >/dev/null 2>&1 & SRV=$!
  sleep 1
  python3 tests/xr_flow.py || { kill $SRV 2>/dev/null; exit 1; }
  kill $SRV 2>/dev/null || true
else
  echo "(skipping tests/xr_flow.py: playwright not installed)"
fi
