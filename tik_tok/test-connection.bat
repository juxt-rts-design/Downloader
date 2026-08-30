@echo off
echo 🔍 Test de connectivité pour TikTok Juxt_RTS
echo.

echo 📱 Test 1: Backend depuis PC
curl -s http://localhost:3001/api/health
echo.
echo.

echo 📱 Test 2: Backend depuis IP mobile
curl -s http://192.168.1.68:3001/api/health
echo.
echo.

echo 📱 Test 3: Frontend depuis PC
curl -s http://localhost:5173
echo.
echo.

echo 📱 Test 4: Frontend depuis IP mobile
curl -s http://192.168.1.68:5173
echo.
echo.

echo ✅ Tests terminés !
echo.
echo Si les tests échouent, vérifiez que :
echo 1. Les serveurs sont démarrés
echo 2. Le firewall Windows n bloque pas les ports
echo 3. PC et téléphone sont sur le même Wi-Fi
echo.
pause
