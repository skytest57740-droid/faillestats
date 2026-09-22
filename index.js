import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  SlashCommandBuilder
} from "discord.js";
import sharp from "sharp";
import TextToSVG from "text-to-svg";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 1200;
const HEIGHT = 675;
const HEAD_SIZE = 148;

const TEAM_INFO = {
  TEAM_1: { label: "3FR3", color: "#FF5CC8" },
  TEAM_2: { label: "BOUBOU", color: "#9B5CFF" },
  TEAM_3: { label: "Dispo", color: "#FF0000" },
  TEAM_4: { label: "Shifty", color: "#7CFF6B" },
  TEAM_5: { label: "Les Transsillain", color: "#FFF06A" },
  TEAM_6: { label: "WiWiWi", color: "#FF9E4A" },
  ARBITRE: { label: "Arbitre", color: "#FFFFFF" }
};

const PLAYING_TEAMS = ["TEAM_1", "TEAM_2", "TEAM_3", "TEAM_4", "TEAM_5", "TEAM_6"];
const textToSVG = TextToSVG.loadSync();

const config = loadConfig();
const slashCommands = [
  new SlashCommandBuilder()
    .setName("lafaillestats")
    .setDescription("Envoie l'image de stats LaFaille d'un joueur.")
    .addStringOption((option) =>
      option
        .setName("nomjoueur")
        .setDescription("Pseudo Minecraft du joueur")
        .setRequired(true)
    )
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log(`Bot connecte en tant que ${client.user?.tag}`);

  if (!client.application) {
    return;
  }

  try {
    if (config.guildId) {
      await client.application.commands.set(slashCommands, config.guildId);
      console.log("Commande /lafaillestats enregistree sur le serveur configure.");
    } else {
      await client.application.commands.set(slashCommands);
      console.log("Commande /lafaillestats enregistree globalement.");
    }
  } catch (error) {
    console.error("Impossible d'enregistrer la commande slash.", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "lafaillestats") {
    return;
  }

  const playerName = interaction.options.getString("nomjoueur", true).trim();
  if (!playerName) {
    await interaction.reply({
      content: "Indique un pseudo Minecraft.",
      ephemeral: true
    });
    return;
  }

  let player;
  let teams;
  try {
    player = findPlayerStats(playerName);
    teams = readTeams();
  } catch (error) {
    console.error("Lecture des donnees impossible.", error);
    await interaction.reply({
      content: "Impossible de lire les fichiers de stats du plugin.",
      ephemeral: true
    });
    return;
  }

  if (!player) {
    await interaction.reply({
      content: `Aucune statistique trouvee pour \`${playerName}\`.`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply();

  try {
    const teamId = teams[player.uuid] || null;
    const imagePath = await generateStatsImage(player, teamId);
    const attachment = new AttachmentBuilder(imagePath, {
      name: `${sanitizeFileName(player.name)}-stats.png`
    });

    await interaction.editReply({
      content: `Stats LaFaille de **${escapeDiscord(player.name)}** :`,
      files: [attachment]
    });
  } catch (error) {
    console.error("Generation de l'image impossible.", error);
    await interaction.editReply("Impossible de generer l'image de stats.");
  }
});

if (!config.token) {
  console.error("Token Discord manquant. Configure DISCORD_TOKEN ou discord-bot/config.json.");
  process.exit(1);
} else {
  client.login(config.token).catch((error) => {
    console.error("Connexion Discord impossible. Verifie DISCORD_TOKEN.", error);
    process.exit(1);
  });
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection", error);
});

function loadConfig() {
  const configPath = path.resolve(__dirname, "config.json");
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  return {
    token: process.env.DISCORD_TOKEN || fileConfig.token || "",
    guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId || "",
    statsFile: resolveConfiguredPath(process.env.LAFAILLE_STATS_FILE || fileConfig.statsFile || "./stats.yml"),
    teamsFile: resolveConfiguredPath(process.env.LAFAILLE_TEAMS_FILE || fileConfig.teamsFile || "./teams-data.yml"),
    backgroundImage: resolveConfiguredPath(process.env.LAFAILLE_STATS_BACKGROUND || fileConfig.backgroundImage || ""),
    outputDir: resolveConfiguredPath(process.env.LAFAILLE_OUTPUT_DIR || fileConfig.outputDir || "./data/generated-stats")
  };
}

function resolveConfiguredPath(value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable: ${filePath}`);
  }

  return YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
}

function findPlayerStats(input) {
  const statsData = readYamlFile(config.statsFile);
  const players = statsData.players || {};
  const normalizedInput = input.toLowerCase();

  for (const [uuid, rawStats] of Object.entries(players)) {
    const playerName = rawStats?.name || uuid;
    if (playerName.toLowerCase() === normalizedInput || uuid.toLowerCase() === normalizedInput) {
      return normalizePlayerStats(uuid, rawStats);
    }
  }

  return null;
}

function readTeams() {
  if (!fs.existsSync(config.teamsFile)) {
    return {};
  }

  const teamData = readYamlFile(config.teamsFile);
  return teamData.players || {};
}

function normalizePlayerStats(uuid, rawStats = {}) {
  const kills = numberValue(rawStats.kills);
  const deaths = numberValue(rawStats.deaths);

  return {
    uuid,
    name: rawStats.name || uuid,
    kills,
    deaths,
    kdr: deaths === 0 ? kills : kills / deaths,
    playerDamage: numberValue(rawStats["player-damage"]),
    coinsGained: numberValue(rawStats["coins-gained"]),
    coinsSpent: numberValue(rawStats["coins-spent"]),
    goldenApplesConsumed: numberValue(rawStats["golden-apples-consumed"]),
    tntConsumed: numberValue(rawStats["tnt-consumed"]),
    blocksPlaced: numberValue(rawStats["blocks-placed"]),
    blocksBroken: numberValue(rawStats["blocks-broken"]),
    distanceWalked: numberValue(rawStats["distance-walked"]),
    distanceSwam: numberValue(rawStats["distance-swam"]),
    nexusDamage: rawStats["nexus-damage"] || {}
  };
}

async function generateStatsImage(player, teamId) {
  fs.mkdirSync(config.outputDir, { recursive: true });

  const headUri = await getPlayerHeadDataUri(player);
  const backgroundMarkup = await createBackgroundMarkup();
  const svg = createStatsSvg(player, teamId, headUri, backgroundMarkup);
  const outputPath = path.join(config.outputDir, `${sanitizeFileName(player.name)}-stats.png`);

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

async function createBackgroundMarkup() {
  const backgroundPath = findBackgroundImage();
  if (!backgroundPath) {
    console.warn("stats-background.png introuvable. Image generee avec un fond uni.");
    return `<rect width="${WIDTH}" height="${HEIGHT}" fill="#121218"/>`;
  }

  const backgroundUri = fileToDataUri(backgroundPath);
  return `<image href="${backgroundUri}" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`;
}

function findBackgroundImage() {
  const candidates = [
    config.backgroundImage,
    path.resolve(__dirname, "stats-background.png"),
    path.resolve(__dirname, "assets", "stats-background.png"),
    path.resolve(__dirname, "src", "main", "resources", "assets", "stats-background.png"),
    path.resolve(__dirname, "..", "src", "main", "resources", "assets", "stats-background.png"),
    path.resolve(process.cwd(), "stats-background.png"),
    path.resolve(process.cwd(), "assets", "stats-background.png"),
    path.resolve(process.cwd(), "src", "main", "resources", "assets", "stats-background.png")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createStatsSvg(player, teamId, headUri, backgroundMarkup) {
  const team = TEAM_INFO[teamId] || null;
  const teamLabel = team?.label || "Sans equipe";
  const teamColor = team?.color || "#BEB5CD";
  const nameFontSize = fitTextSize(player.name, 58, 28, 18);
  const nexusTotal = PLAYING_TEAMS.reduce((total, id) => total + numberValue(player.nexusDamage[id]), 0);
  const maxNexusDamage = Math.max(...PLAYING_TEAMS.map((id) => numberValue(player.nexusDamage[id])), 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <clipPath id="headClip">
      <rect x="${WIDTH - 64 - HEAD_SIZE}" y="54" width="${HEAD_SIZE}" height="${HEAD_SIZE}" rx="22" ry="22"/>
    </clipPath>
  </defs>
  ${backgroundMarkup}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgba(0,0,0,0.38)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgba(18,10,24,0.45)"/>

  ${svgText("LA FAILLE 2.0", 64, 70, 22, "#ff9a2f")}
  ${svgText(player.name, 64, 142, nameFontSize, "#f6f2ff")}
  ${svgText("Statistiques joueur", 68, 184, 24, "#beb5cd")}
  ${teamBadge(68, 204, teamLabel, teamColor)}

  <rect x="${WIDTH - 64 - HEAD_SIZE + 10}" y="64" width="${HEAD_SIZE}" height="${HEAD_SIZE}" rx="24" fill="rgba(0,0,0,0.38)"/>
  <image href="${headUri}" x="${WIDTH - 64 - HEAD_SIZE}" y="54" width="${HEAD_SIZE}" height="${HEAD_SIZE}" clip-path="url(#headClip)" preserveAspectRatio="xMidYMid slice"/>
  <rect x="${WIDTH - 64 - HEAD_SIZE}" y="54" width="${HEAD_SIZE}" height="${HEAD_SIZE}" rx="22" fill="none" stroke="rgba(255,255,255,0.66)" stroke-width="4"/>

  ${metricCard(64, 248, 250, 128, "KILLS", formatLong(player.kills), "#ff5cc8")}
  ${metricCard(334, 248, 250, 128, "MORTS", formatLong(player.deaths), "#9b5cff")}
  ${metricCard(604, 248, 250, 128, "K/D", formatDouble(player.kdr), "#ff9a2f")}
  ${metricCard(874, 248, 262, 128, "DEGATS JOUEURS", formatDouble(player.playerDamage), "#ff5cc8")}

  ${metricCard(64, 402, 250, 128, "COINS GAGNES", formatLong(player.coinsGained), "#ff9a2f")}
  ${metricCard(334, 402, 250, 128, "COINS DEPENSES", formatLong(player.coinsSpent), "#ff5cc8")}
  ${metricCard(604, 402, 250, 128, "POMMES / TNT", `${formatLong(player.goldenApplesConsumed)} / ${formatLong(player.tntConsumed)}`, "#9b5cff")}
  ${metricCard(874, 402, 262, 128, "BLOCS POSES/CASSES", `${formatLong(player.blocksPlaced)} / ${formatLong(player.blocksBroken)}`, "#ff9a2f")}

  ${metricCard(64, 556, 250, 76, "MARCHE", `${formatDouble(player.distanceWalked)} blocs`, "#9b5cff", 28)}
  ${metricCard(334, 556, 250, 76, "NAGE", `${formatDouble(player.distanceSwam)} blocs`, "#ff5cc8", 28)}
  ${nexusPanel(604, 556, 532, 76, nexusTotal, maxNexusDamage, player.nexusDamage)}
</svg>`;
}

function teamBadge(x, y, label, color) {
  const width = Math.max(152, 62 + label.length * 12);
  return `
  <rect x="${x}" y="${y}" width="${width}" height="34" rx="17" fill="rgba(0,0,0,0.35)"/>
  <circle cx="${x + 21}" cy="${y + 17}" r="7" fill="${color}"/>
  ${svgText(label, x + 40, y + 24, 20, "#f6f2ff")}`;
}

function metricCard(x, y, width, height, label, rawValue, accent, valueSize = 42) {
  const value = String(rawValue);
  const fittedSize = fitTextSize(value, valueSize, 18, width / 18);
  const baseline = y + 40 + (height - 44) / 2 + fittedSize / 3;

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="26" fill="rgba(8,8,14,0.46)" stroke="rgba(255,255,255,0.26)" stroke-width="1.5"/>
  <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="26" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="2"/>
  ${svgText(label, x + width / 2, y + 36, 15, "#beb5cd", "center baseline")}
  ${svgText(value, x + width / 2, baseline, fittedSize, "#f6f2ff", "center baseline")}`;
}

function nexusPanel(x, y, width, height, total, maxDamage, nexusDamage) {
  const barX = x + 168;
  const barY = y + 23;
  const barWidth = width - 196;
  const barHeight = 11;
  const gap = 7;

  const bars = PLAYING_TEAMS.map((teamId, index) => {
    const team = TEAM_INFO[teamId];
    const damage = numberValue(nexusDamage[teamId]);
    const fillWidth = maxDamage <= 0 ? 0 : Math.round(barWidth * (damage / maxDamage));
    const currentY = barY + index * (barHeight + gap);

    return `
    <rect x="${barX}" y="${currentY}" width="${barWidth}" height="${barHeight}" rx="5.5" fill="rgba(255,255,255,0.13)"/>
    <rect x="${barX}" y="${currentY}" width="${fillWidth}" height="${barHeight}" rx="5.5" fill="${team.color}"/>`;
  }).join("");

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="26" fill="rgba(8,8,14,0.46)" stroke="rgba(255,255,255,0.26)" stroke-width="1.5"/>
  ${svgText("DEGATS NEXUS", x + 24, y + 29, 16, "#beb5cd")}
  ${svgText(formatDouble(total), x + 24, y + 61, 30, "#f6f2ff")}
  ${bars}`;
}

async function getPlayerHeadDataUri(player) {
  const cacheDir = path.join(config.outputDir, "head-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedHead = path.join(cacheDir, `${player.uuid}.png`);
  if (fs.existsSync(cachedHead)) {
    return fileToDataUri(cachedHead);
  }

  const dashedUuid = player.uuid;
  const compactUuid = dashedUuid.replaceAll("-", "");
  const safeName = player.name.replace(/[^a-zA-Z0-9_]/g, "");
  const urls = [
    `https://mc-heads.net/avatar/${compactUuid}/160`,
    `https://minotar.net/helm/${compactUuid}/160.png`,
    `https://crafatar.com/avatars/${dashedUuid}?size=160&overlay`
  ];

  if (safeName) {
    urls.push(`https://mc-heads.net/avatar/${safeName}/160`);
    urls.push(`https://minotar.net/helm/${safeName}/160.png`);
  }

  for (const url of urls) {
    try {
      const buffer = await fetchImageBuffer(url);
      await sharp(buffer).png().resize(160, 160).toFile(cachedHead);
      return fileToDataUri(cachedHead);
    } catch (error) {
      console.warn(`Tete Minecraft indisponible via ${url}: ${error.message}`);
    }
  }

  return fallbackHeadDataUri(player.name);
}

async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "LaFaille2.0 Discord Bot" }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackHeadDataUri(playerName) {
  const initial = (playerName || "?").slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" fill="#3a2754"/>
    <circle cx="24" cy="24" r="48" fill="rgba(255,92,200,0.47)"/>
    <circle cx="136" cy="140" r="48" fill="rgba(255,154,47,0.46)"/>
    ${svgText(initial, 80, 105, 68, "#f6f2ff", "center baseline")}
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function fileToDataUri(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatLong(value) {
  return Math.round(numberValue(value)).toLocaleString("fr-FR").replace(/\u202f/g, " ");
}

function formatDouble(value) {
  const number = numberValue(value);
  if (Number.isInteger(number)) {
    return formatLong(number);
  }
  return number.toFixed(1).replace(".", ",");
}

function fitTextSize(text, baseSize, minSize, maxCharsAtBase) {
  const length = String(text || "").length;
  if (length <= maxCharsAtBase) {
    return baseSize;
  }

  return Math.max(minSize, Math.floor(baseSize * (maxCharsAtBase / length)));
}

function svgText(text, x, y, fontSize, fill, anchor = "left baseline") {
  return textToSVG.getPath(String(text ?? ""), {
    x,
    y,
    fontSize,
    anchor,
    attributes: {
      fill
    }
  });
}

function sanitizeFileName(name) {
  const sanitized = String(name || "player").replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "player";
}

function escapeDiscord(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("_", "\\_").replaceAll("`", "\\`");
}
