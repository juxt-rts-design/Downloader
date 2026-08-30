# Configuration YouTube avec Fallback yt-dlp

## Installation de yt-dlp (Fallback)

Le système utilise `@distube/ytdl-core` par défaut, mais si une erreur 403 se produit, il bascule automatiquement vers `yt-dlp` qui est plus fiable.

### Installation sur Windows

1. **Avec pip (recommandé)** :
```bash
pip install yt-dlp
```

2. **Vérifier l'installation** :
```bash
yt-dlp --version
```

3. **Si pip n'est pas installé**, téléchargez depuis :
   - https://github.com/yt-dlp/yt-dlp/releases
   - Ou installez Python depuis https://www.python.org/

### Installation sur Linux/Mac

```bash
# Avec pip
pip install yt-dlp

# Ou avec pip3
pip3 install yt-dlp

# Ou avec brew (Mac)
brew install yt-dlp
```

## Fonctionnement

1. **Première tentative** : Le système essaie d'abord avec `@distube/ytdl-core`
2. **En cas d'erreur 403** : Bascule automatiquement vers `yt-dlp`
3. **Résultat** : La vidéo est téléchargée et mise en cache pour les prochaines requêtes

## Notes

- `yt-dlp` est plus fiable mais plus lent que `ytdl-core`
- Le fallback est automatique, aucune configuration supplémentaire n'est nécessaire
- Si `yt-dlp` n'est pas installé, le système retournera l'erreur originale

