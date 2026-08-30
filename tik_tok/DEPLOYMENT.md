# 🚀 Guide de Déploiement - TikTok Juxt_RTS

## 📋 Prérequis

- Node.js 18+ installé
- Compte sur un hébergeur (Render, Vercel, Netlify, etc.)
- Backend déployé et accessible

## 🔧 Étapes de déploiement

### 1. **Configuration des URLs**

Modifiez `src/config.ts` avec vos URLs de production :

```typescript
export const config = {
  backend: {
    baseUrl: 'https://votre-backend.onrender.com',
    healthCheck: 'https://votre-backend.onrender.com/api/health',
    download: 'https://votre-backend.onrender.com/api/download',
  },
  frontend: {
    baseUrl: 'https://votre-frontend.onrender.com',
  }
};
```

### 2. **Build de production**

```bash
# Windows
build-production.bat

# Ou manuellement
npm install
npm run build
```

### 3. **Déploiement Frontend**

#### **Option A : Render (Recommandé)**
1. Créez un nouveau service "Static Site"
2. Connectez votre repository GitHub
3. Build Command : `npm install && npm run build`
4. Publish Directory : `dist`

#### **Option B : Vercel**
1. Connectez votre repository
2. Framework Preset : Vite
3. Build Command : `npm run build`
4. Output Directory : `dist`

#### **Option C : Netlify**
1. Drag & drop du dossier `dist`
2. Ou connectez votre repository

### 4. **Déploiement Backend**

#### **Render (Recommandé)**
1. Créez un nouveau service "Web Service"
2. Connectez votre repository
3. Build Command : `cd Backend && npm install`
4. Start Command : `cd Backend && npm start`
5. Environment Variables :
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://votre-frontend.onrender.com`

### 5. **Configuration CORS**

Le backend est déjà configuré pour accepter :
- `https://votre-frontend.onrender.com`
- URLs locales pour le développement

### 6. **Test de déploiement**

1. Vérifiez que le backend répond : `https://votre-backend.onrender.com/api/health`
2. Testez le frontend : `https://votre-frontend.onrender.com`
3. Testez le téléchargement d'une vidéo

## 🔒 Configuration HTTPS

Pour iOS 18 + Brave, HTTPS est obligatoire pour l'API Clipboard.

### **Solution 1 : Hébergement cloud (Recommandé)**
- Render, Vercel, Netlify fournissent HTTPS automatiquement

### **Solution 2 : Certificat local (Développement)**
```bash
# Installer mkcert
mkcert -install
mkcert localhost 192.168.1.67

# Modifier vite.config.ts
https: {
  key: fs.readFileSync('localhost-key.pem'),
  cert: fs.readFileSync('localhost.pem'),
}
```

## 📱 Compatibilité Mobile

- ✅ **iOS 18 + Safari** : Fonctionne parfaitement
- ✅ **iOS 18 + Brave** : Collage manuel (focus automatique)
- ✅ **Android** : Fonctionne parfaitement
- ✅ **PC** : Fonctionne parfaitement

## 🎯 URLs de production

Après déploiement, votre app sera accessible sur :
- **Frontend** : `https://votre-frontend.onrender.com`
- **Backend** : `https://votre-backend.onrender.com/api`

## 🛠️ Maintenance

- **Logs** : Disponibles dans le dashboard de votre hébergeur
- **Mises à jour** : Push sur GitHub → Déploiement automatique
- **Monitoring** : Utilisez les outils de votre hébergeur

## ❓ Support

En cas de problème :
1. Vérifiez les logs du backend
2. Testez l'API : `https://votre-backend.onrender.com/api/health`
3. Vérifiez la configuration CORS
4. Testez sur différents navigateurs

---

**🎉 Votre TikTok Downloader est prêt pour la production !**
