@echo off
echo === STEP 1: LOGIN ===
curl -s -m 8 -X POST http://localhost:3001/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@fois.in\",\"password\":\"admin123\"}" ^
  -o login_response.json
echo Login response:
type login_response.json
echo.
echo === STEP 2: CHECK PORT ===
curl -s -m 3 http://localhost:3001/api/health 2>&1 || echo Health check failed
curl -s -m 3 http://localhost:3000/api/health 2>&1 || echo Port 3000 failed
echo.
echo DONE
