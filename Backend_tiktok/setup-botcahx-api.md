# 🚀 Configuration de l'API BOTCAHX locale

## Option 1 : Héberger l'API BOTCAHX localement

### 1. Cloner le repository
```bash
cd Tiktok/Backend
git clone https://github.com/BOTCAHX/tiktokdl-api.git botcahx-api
cd botcahx-api
```

### 2. Installer les dépendances
```bash
npm install
npm install -g coffeescript
```

### 3. Compiler le CoffeeScript
```bash
coffee -c index.coffee
```

### 4. Démarrer l'API BOTCAHX
```bash
node index.js
```

L'API sera disponible sur : `http://localhost:3000`

### 5. Modifier notre backend pour utiliser l'API locale
Dans `index.js`, ajouter cette fonction :

```javascript
// Fonction pour utiliser l'API BOTCAHX locale
async function getTikTokVideoBOTCAHX(url) {
  console.log('Tentative avec BOTCAHX API locale pour:', url);
  
  try {
    const response = await axios.get(`http://localhost:3000/tiktok/api.php?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    console.log('BOTCAHX - Status:', response.status);
    console.log('BOTCAHX - Data:', response.data);
    
    if (response.data && (response.data.video || response.data.audio)) {
      return {
        success: true,
        data: {
          id: Date.now().toString(),
          title: 'Vidéo TikTok',
          author: {
            username: 'tiktok_user',
            nickname: 'Utilisateur TikTok',
            avatar: null
          },
          video: {
            url: response.data.video?.[0] || response.data.video,
            duration: 0,
            size: 0,
            quality: 'HD'
          },
          thumbnail: null,
          stats: {
            likes: 0,
            shares: 0,
            comments: 0,
            views: 0
          },
          downloadUrl: response.data.video?.[0] || response.data.video
        }
      };
    }
    
    throw new Error('BOTCAHX ne retourne pas de données valides');
    
  } catch (error) {
    console.error('BOTCAHX - Erreur:', error.message);
    throw error;
  }
}
```

## Option 2 : Utiliser TikWM (plus simple)

TikWM fonctionne déjà et est fiable. Pas besoin d'installation supplémentaire.

## Option 3 : Déployer sur le cloud

### Render.com
1. Fork le repository BOTCAHX
2. Connecter à Render
3. Déployer automatiquement
4. Utiliser l'URL de déploiement dans notre backend

### Railway
1. Fork le repository BOTCAHX
2. Connecter à Railway
3. Déployer automatiquement
4. Utiliser l'URL de déploiement dans notre backend

## Recommandation

Pour commencer rapidement, utilisez **TikWM** qui fonctionne déjà. Si vous voulez une solution complètement autonome, hébergez l'API BOTCAHX localement.
