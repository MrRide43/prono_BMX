# BMX World Pronos

Jeu de pronostics sur la coupe du monde et le championnat du monde UCI de BMX Race, d'après le règlement « UCI BMX World Pronos 2026 ».

## Lancer l'application

Il faut seulement [Node.js](https://nodejs.org) (aucune dépendance à installer).

```bash
node server.js
```

Puis ouvrir http://localhost:3000 dans un navigateur.

- **Le premier compte créé est l'organisateur.** Il fixe l'heure limite de chaque course, saisit les podiums officiels, active ou désactive les jokers (article 5) et ferme les inscriptions.
- **Nouvelle saison** : dans l'onglet « Organisateur », créer la saison (ex : 2027), corriger son calendrier (villes, dates, blocs), puis la passer « en cours ». Les saisons passées restent consultables, les comptes sont conservés.
- **Sécurité** : mots de passe hachés (scrypt), sessions par cookie HttpOnly expirant après 30 jours, blocage 15 min après 5 mots de passe faux. En ligne, l'application doit être servie en **HTTPS**.
- Les données sont enregistrées dans `data.json` (à sauvegarder ; le supprimer remet le jeu à zéro).
- Le port se change avec la variable d'environnement `PORT`.

## Mise en ligne sur son propre serveur Linux

Voir [deploy/MISE_EN_LIGNE_LINUX.md](deploy/MISE_EN_LIGNE_LINUX.md) (service systemd, HTTPS avec Caddy, domaine OVH, sauvegardes).

## Fichiers

- `rules.js` : calendrier, catégories, calcul des points, jokers et départages
- `server.js` : serveur web, comptes et enregistrement des données
- `public/` : l'interface affichée dans le navigateur
- `test.js` : vérification du calcul des points (`node test.js`)
