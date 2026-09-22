# Bot Discord LaFaille

Ce bot ajoute la commande slash `/lafaillestats joueur` et envoie l'image de stats du joueur dans le salon Discord.

## Installation

1. Copie `config.example.json` en `config.json`.
2. Remplis `token`, `guildId`, `statsFile` et `teamsFile`.
3. Installe les dependances :

```bash
npm install
```

4. Lance le bot :

```bash
npm start
```

Le bot enregistre la commande slash au demarrage. Si `statsFile` ou `teamsFile` pointent vers le mauvais dossier, la commande repondra que les stats sont introuvables.
