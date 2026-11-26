# R&P Planning

Diagramme de Gantt partagé de Racines & Perspectives (François et Guillaume) :
projets, phases (APS, APD, PC…), qui fait quoi, petites notes.

→ https://planning.racines-perspectives.fr (mot de passe partagé)

## Architecture (même principe que bliss)

- **Express** (`server/index.js`) sert l'API `/api` et, en prod, le front compilé (`dist/`).
- **SQLite** (`better-sqlite3`, `server/db.js`) : un seul fichier `data/planning.db`,
  tables `projects`, `tasks`, `closures` + un compteur `rev` incrémenté à chaque écriture.
  Les évolutions de schéma se font uniquement par ajout de colonnes (`addColumn` dans `db.js`).
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

| Glisser la barre fine d'un projet | décaler tout le projet d'un coup |
| ▲ ▼ au survol d'un projet | changer l'ordre (propre à ce navigateur) |
| Icône ↗ d'un projet / « Vue détail » | vue études / chantier, semaines de production, export client (PDF) |
| Clic sur le fond | fermer le panneau |
| Échap sur une tâche juste créée et vide | la supprimer |

Dans le panneau d'une tâche : **Suit la tâche** (lien : quand la précédente glisse, celle-ci et
toutes ses suivantes se décalent d'autant), **Validation client** (traîne hachurée après la tâche),
**À caler** (pointillé avant la tâche), **Phase** études / chantier (déduite de l'intitulé par
défaut), et pour un jalon : **Heure** + bouton **Ajouter à Google Agenda**.

Un projet peut avoir le statut **Prospect** (proposition envoyée le…, relancer le…) : il apparaît
en pointillé, et le bouton **Relances** de la barre d'outils liste les prospects (pastille = relances
dues). **Fermetures** : vacances de l'agence, hachurées sur tout le planning, elles « coupent » les
barres et ne comptent pas dans les jours ouvrés. Thème clair / sombre / automatique : icône ◐.

« Couleurs : Projets / Personnes » bascule la couleur des barres (palette lisible pour un daltonien
deutéranope). « Qui » filtre
sur François ou Guillaume (les nouvelles tâches leur sont alors assignées).

## Claude (connecteur MCP, lecture seule)

`server/mcp.js` expose le planning à Claude : `https://planning.racines-perspectives.fr/mcp/<MCP_KEY>`
(clé dans `.env`, ne pas la diffuser ; la changer = régénérer `MCP_KEY` puis `pm2 restart rp-planning`
et remettre l'adresse dans les connecteurs).

Chacun (François, Guillaume) l'ajoute une fois sur claude.ai : **Réglages › Connecteurs ›
Ajouter un connecteur personnalisé**, nom « R&P Planning », URL ci-dessus. Il est alors disponible
dans l'appli, sur mobile et dans Claude Code. Outils : `planning_a_venir`, `planning_projets`,
`planning_charge`.

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
