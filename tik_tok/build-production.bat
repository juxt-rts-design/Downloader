@echo off
echo 🚀 Build de production pour TikTok Juxt_RTS
echo.

echo 📦 Installation des dépendances...
call npm install

echo.
echo 🔨 Build du frontend...
call npm run build

echo.
echo ✅ Build terminé !
echo 📁 Fichiers de production dans le dossier 'dist'
echo.

echo 🌐 Pour déployer :
echo    1. Uploadez le contenu de 'dist' sur votre hébergeur
echo    2. Configurez votre backend sur Render/Vercel/Netlify
echo    3. Mettez à jour les URLs dans config.ts
echo.

pause
