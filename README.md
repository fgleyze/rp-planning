# R&P Planning

Diagramme de Gantt partagé de Racines & Perspectives (François et Guillaume) :
projets, phases (APS, APD, PC…), qui fait quoi, petites notes.

→ https://planning.racines-perspectives.fr (mot de passe partagé)

## Architecture (même principe que bliss)

- **Express** (`server/index.js`) sert l'API `/api` et, en prod, le front compilé (`dist/`).
- **SQLite** (`better-sqlite3`, `server/db.js`) : un seul fichier `data/planning.db`,
  deux tables (`projects`, `tasks`) + un compteur `rev` incrémenté à chaque écriture.
  Sauvegarde quotidienne automatique dans `data/backups/` (30 jours gardés).
- **React + Vite** (`src/`) : mises à jour optimistes, écritures envoyées en file,
  polling toutes les 4 s (`/api/state?rev=N`, réponse vide si rien n'a changé)
  pour voir les modifications de l'autre.
- **Auth** : `APP_PASSWORD` dans `.env`, envoyé en `Authorization: Bearer`.
  20 essais ratés / 15 min par IP, puis 429.

## Utilisation

| Geste | Effet |
| --- | --- |
| Glisser une barre | la déplacer |
| Glisser un bord de barre | l'allonger / la raccourcir |
| Cliquer une barre ou un libellé | ouvrir le panneau (intitulé, projet, assigné, dates, note, jalon, terminé) |
| Glisser sur la ligne « + Ajouter une tâche » | dessiner une nouvelle tâche (un clic = 5 jours) |
| Glisser le fond | faire défiler le calendrier |
| Poignée ⋮⋮ d'un libellé | réordonner / changer de projet |
| Ctrl/⌘ + molette, pincement, `+` / `−` | zoom |
| `T` | aujourd'hui |
| Ctrl/⌘ + Z | annuler |
| Suppr | supprimer la tâche sélectionnée |

« Couleurs : Projets / Personnes » bascule la couleur des barres. « Qui » filtre
sur François ou Guillaume (les nouvelles tâches leur sont alors assignées).

## Dev

```bash
npm install
npm run dev        # Vite :5173 + API :3002
```

## Prod

```bash
npm run build
pm2 restart rp-planning      # lancé avec : pm2 start npm --name rp-planning --restart-delay 10000 -- start
```

`.env` : `APP_PASSWORD`, `PORT=2124`, `HOST=172.17.0.1` (IP de docker0 : joignable
par le conteneur nginx via `host.docker.internal`, pas exposé sur Internet).

Reverse-proxy : `deploy/planning.conf` → `/home/ubuntu/reverse-proxy/config/nginx/`,
copié par `deploy/activate.sh` après obtention du certificat Let's Encrypt.
